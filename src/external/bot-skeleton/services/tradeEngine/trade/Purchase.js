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

            // ── BULK TRADES: Determine how many contracts to fire ──
            const bulkEnabled = options.bulk === 'ENABLED';
            const numContracts = bulkEnabled ? Math.max(1, Number(options.count) || 1) : 1;

            if (numContracts <= 1) {
                return this._executeSinglePurchase(contract_type);
            }

            // ═══════════════════════════════════════════════════════════
            //  BULK PATH — Sequential firing
            //  Deriv's API does NOT accept parallel buy calls for the
            //  same contract type. We MUST fire them one at a time and
            //  await each response before firing the next.
            // ═══════════════════════════════════════════════════════════

            this.isSold = false;

            // Broadcast once at the start so the UI shows "purchase sent"
            contractStatus({
                id: 'contract.purchase_sent',
                data: this.tradeOptions.amount * numContracts,
            });

            let successCount = 0;
            const purchaseResponses = [];

            for (let i = 0; i < numContracts; i++) {
                try {
                    // Build the trade option fresh for each iteration
                    const trade_option = tradeOptionToBuy(contract_type, this.tradeOptions);

                    // Fire ONE request and wait for the response
                    const response = await api_base.api.send(trade_option);

                    if (response && response.buy && response.buy.contract_id) {
                        // Register this contract with the store
                        this.contractId = response.buy.contract_id;

                        // Broadcast this individual purchase
                        contractStatus({
                            id: 'contract.purchase_received',
                            data: response.buy.transaction_id,
                            buy: response.buy,
                        });

                        // Log this specific trade
                        log(LogTypes.PURCHASE, { transaction_id: response.buy.transaction_id });
                        info({
                            accountID: this.accountInfo.loginid,
                            totalRuns: this.updateAndReturnTotalRuns(),
                            transaction_ids: { buy: response.buy.transaction_id },
                            contract_type,
                            buy_price: response.buy.buy_price,
                        });

                        purchaseResponses.push(response.buy);
                        successCount++;

                        console.log(
                            `[BULK] Contract ${i + 1}/${numContracts} purchased — ` +
                            `ID ${response.buy.contract_id}, price ${response.buy.buy_price}`
                        );
                    } else {
                        console.warn(`[BULK] Contract ${i + 1}/${numContracts} — invalid response:`, response);
                    }
                } catch (err) {
                    console.warn(`[BULK] Contract ${i + 1}/${numContracts} failed:`, err);
                    // Continue to next contract — don't abort the whole batch
                }
            }

            // After all contracts fired, mark the purchase as complete
            if (successCount > 0) {
                this.store.dispatch(purchaseSuccessful());
            }

            if (this.is_proposal_subscription_required) {
                this.renewProposalsOnPurchase();
            }

            console.log(`[BULK] Total purchased: ${successCount}/${numContracts}`);

            return Promise.resolve();
        }

        _executeSinglePurchase(contract_type) {
            // ── Single trade path (unchanged from template) ──
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