import { LogTypes } from '../../../constants/messages';
import { api_base } from '../../api/api-base';
import { contractStatus, info, log } from '../utils/broadcast';
import { doUntilDone, getUUID, recoverFromError, tradeOptionToBuy } from '../utils/helpers';
import { purchaseSuccessful } from './state/actions';
import { BEFORE_PURCHASE } from './state/constants';

let delayIndex = 0;
let purchase_reference;

export default Engine =>
    class Purchase extends Engine {
        async purchase(contract_type, options = {}) {
            // Prevent calling purchase twice
            if (this.store.getState().scope !== BEFORE_PURCHASE) {
                return Promise.resolve();
            }

            const bulkEnabled = options.bulk === 'ENABLED';
            const sequentialEnabled = options.sequential === 'ENABLED';
            const numContracts = (bulkEnabled || sequentialEnabled)
                ? Math.max(1, Number(options.count) || 1)
                : 1;

            // Single trade
            if (numContracts <= 1) {
                return this._executeSinglePurchase(contract_type);
            }

            // ── MULTI-TRADE MODE ──
            // Priority: Sequential if explicitly enabled, else Bulk (parallel)
            if (sequentialEnabled) {
                return this._executeSequentialPurchases(contract_type, numContracts);
            }

            return this._executeParallelPurchases(contract_type, numContracts);
        }

        // ═══════════════════════════════════════════════════════════
        //  PARALLEL — Fire all buy requests at the same time
        // ═══════════════════════════════════════════════════════════
        async _executeParallelPurchases(contract_type, numContracts) {
            this.isSold = false;

            contractStatus({
                id: 'contract.purchase_sent',
                data: this.tradeOptions.amount * numContracts,
            });

            const tradeOptions = [];
            for (let i = 0; i < numContracts; i++) {
                tradeOptions.push(tradeOptionToBuy(contract_type, this.tradeOptions));
            }

            const results = await Promise.allSettled(
                tradeOptions.map(option => api_base.api.send(option))
            );

            let successCount = 0;

            results.forEach((result, i) => {
                if (result.status === 'fulfilled' && result.value && result.value.buy && result.value.buy.contract_id) {
                    const buy = result.value.buy;
                    this.contractId = buy.contract_id;

                    contractStatus({
                        id: 'contract.purchase_received',
                        data: buy.transaction_id,
                        buy,
                    });

                    log(LogTypes.PURCHASE, { transaction_id: buy.transaction_id });
                    info({
                        accountID: this.accountInfo.loginid,
                        totalRuns: this.updateAndReturnTotalRuns(),
                        transaction_ids: { buy: buy.transaction_id },
                        contract_type,
                        buy_price: buy.buy_price,
                    });

                    successCount++;
                    console.log(`[BULK] Contract ${i + 1}/${numContracts} — ID ${buy.contract_id} @ ${buy.buy_price}`);
                } else {
                    console.warn(`[BULK] Contract ${i + 1}/${numContracts} failed`);
                }
            });

            if (successCount > 0) {
                this.store.dispatch(purchaseSuccessful());
            }

            if (this.is_proposal_subscription_required) {
                this.renewProposalsOnPurchase();
            }

            console.log(`[BULK] Total: ${successCount}/${numContracts}`);
            return Promise.resolve();
        }

        // ═══════════════════════════════════════════════════════════
        //  SEQUENTIAL — Fire one, wait for result, fire next
        // ═══════════════════════════════════════════════════════════
        async _executeSequentialPurchases(contract_type, numContracts) {
            this.isSold = false;

            contractStatus({
                id: 'contract.purchase_sent',
                data: this.tradeOptions.amount * numContracts,
            });

            let successCount = 0;

            for (let i = 0; i < numContracts; i++) {
                try {
                    const trade_option = tradeOptionToBuy(contract_type, this.tradeOptions);

                    console.log(`[SEQUENTIAL] Firing contract ${i + 1}/${numContracts}...`);

                    const response = await api_base.api.send(trade_option);

                    if (response && response.buy && response.buy.contract_id) {
                        const buy = response.buy;
                        this.contractId = buy.contract_id;

                        contractStatus({
                            id: 'contract.purchase_received',
                            data: buy.transaction_id,
                            buy,
                        });

                        log(LogTypes.PURCHASE, { transaction_id: buy.transaction_id });
                        info({
                            accountID: this.accountInfo.loginid,
                            totalRuns: this.updateAndReturnTotalRuns(),
                            transaction_ids: { buy: buy.transaction_id },
                            contract_type,
                            buy_price: buy.buy_price,
                        });

                        successCount++;
                        console.log(`[SEQUENTIAL] Contract ${i + 1}/${numContracts} @ ${buy.buy_price}`);

                        // Wait for this contract to close before firing next
                        await this._waitForContractResult(buy.contract_id);
                    } else {
                        console.warn(`[SEQUENTIAL] Contract ${i + 1}/${numContracts} — invalid response`);
                    }
                } catch (err) {
                    console.warn(`[SEQUENTIAL] Contract ${i + 1}/${numContracts} failed:`, err);
                }
            }

            if (successCount > 0) {
                this.store.dispatch(purchaseSuccessful());
            }

            if (this.is_proposal_subscription_required) {
                this.renewProposalsOnPurchase();
            }

            console.log(`[SEQUENTIAL] Total: ${successCount}/${numContracts}`);
            return Promise.resolve();
        }

        _waitForContractResult(contract_id) {
            return new Promise(resolve => {
                const { api } = api_base;
                let subscription = null;

                subscription = api.onMessage().subscribe(response => {
                    if (
                        response.proposal_open_contract &&
                        response.proposal_open_contract.contract_id === contract_id &&
                        response.proposal_open_contract.is_sold
                    ) {
                        try { subscription.unsubscribe(); } catch (e) {}
                        console.log(`[SEQUENTIAL] Contract ${contract_id} settled`);
                        resolve();
                    }
                });

                try {
                    api.send({
                        proposal_open_contract: 1,
                        contract_id,
                        subscribe: 1,
                    });
                } catch (e) {
                    console.warn('[SEQUENTIAL] Could not subscribe:', e);
                    resolve();
                }

                setTimeout(() => {
                    try { subscription.unsubscribe(); } catch (e) {}
                    console.warn('[SEQUENTIAL] Timeout — moving on');
                    resolve();
                }, 60000);
            });
        }

        // ═══════════════════════════════════════════════════════════
        //  SINGLE PURCHASE (unchanged)
        // ═══════════════════════════════════════════════════════════
        _executeSinglePurchase(contract_type) {
            if (this.is_proposal_subscription_required) {
                const { id, askPrice } = this.selectProposal(contract_type);

                const action = () => api_base.api.send({ buy: id, price: askPrice });

                this.isSold = false;

                contractStatus({
                    id: 'contract.purchase_sent',
                    data: askPrice,
                });

                if (!this.options.timeMachineEnabled) {
                    return doUntilDone(action).then(response => this._handlePurchaseSuccess(response, contract_type));
                }

                return recoverFromError(
                    action,
                    (errorCode, makeDelay) => {
                        if (errorCode !== 'DisconnectError') {
                            this.renewProposalsOnPurchase();
                        } else {
                            this.clearProposals();
                        }

                        const unsubscribe = this.store.subscribe(() => {
                            const { scope, proposalsReady } = this.store.getState();
                            if (scope === BEFORE_PURCHASE && proposalsReady) {
                                makeDelay().then(() => this.observer.emit('REVERT', 'before'));
                                unsubscribe();
                            }
                        });
                    },
                    ['PriceMoved', 'InvalidContractProposal'],
                    delayIndex++
                ).then(response => this._handlePurchaseSuccess(response, contract_type));
            }

            const trade_option = tradeOptionToBuy(contract_type, this.tradeOptions);
            const action = () => api_base.api.send(trade_option);

            this.isSold = false;

            contractStatus({
                id: 'contract.purchase_sent',
                data: this.tradeOptions.amount,
            });

            if (!this.options.timeMachineEnabled) {
                return doUntilDone(action).then(response => this._handlePurchaseSuccess(response, contract_type));
            }

            return recoverFromError(
                action,
                (errorCode, makeDelay) => {
                    if (errorCode === 'DisconnectError') {
                        this.clearProposals();
                    }
                    const unsubscribe = this.store.subscribe(() => {
                        const { scope } = this.store.getState();
                        if (scope === BEFORE_PURCHASE) {
                            makeDelay().then(() => this.observer.emit('REVERT', 'before'));
                            unsubscribe();
                        }
                    });
                },
                ['PriceMoved', 'InvalidContractProposal'],
                delayIndex++
            ).then(response => this._handlePurchaseSuccess(response, contract_type));
        }

        _handlePurchaseSuccess(response, contract_type) {
            const buy = response.buy || response;

            if (!buy || !buy.contract_id) {
                console.warn('[PURCHASE] Invalid response:', response);
                return;
            }

            contractStatus({
                id: 'contract.purchase_received',
                data: buy.transaction_id,
                buy,
            });

            this.contractId = buy.contract_id;
            this.store.dispatch(purchaseSuccessful());

            if (this.is_proposal_subscription_required) {
                this.renewProposalsOnPurchase();
            }

            delayIndex = 0;
            log(LogTypes.PURCHASE, { transaction_id: buy.transaction_id });
            info({
                accountID: this.accountInfo.loginid,
                totalRuns: this.updateAndReturnTotalRuns(),
                transaction_ids: { buy: buy.transaction_id },
                contract_type,
                buy_price: buy.buy_price,
            });
        }

        getPurchaseReference = () => purchase_reference;
        regeneratePurchaseReference = () => {
            purchase_reference = getUUID();
        };
    };