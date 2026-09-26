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
            if (this.store.getState().scope !== BEFORE_PURCHASE) {
                return Promise.resolve();
            }

            const bulkEnabled = options.bulk === 'ENABLED';
            const numContracts = bulkEnabled ? Math.max(1, Number(options.count) || 1) : 1;

            if (numContracts <= 1) {
                return this._executeSinglePurchase(contract_type);
            }

            // ═══════════════════════════════════════════════════════════
            //  TRUE SIMULTANEOUS EXECUTION
            //  Fire all requests in the same event-loop tick, then
            //  wait for all to settle. Bypass the store lock to prevent
            //  the first success from cancelling the others.
            // ═══════════════════════════════════════════════════════════

            this.isSold = false;

            // Broadcast once for the whole batch (UI feedback)
            contractStatus({
                id: 'contract.purchase_sent',
                data: this.tradeOptions.amount * numContracts,
            });

            // ─── STEP 1: Build all trade options SYNCHRONOUSLY ───
            const tradeOptions = [];
            for (let i = 0; i < numContracts; i++) {
                const trade_option = tradeOptionToBuy(contract_type, this.tradeOptions);
                tradeOptions.push(trade_option);
            }

            // ─── STEP 2: Fire all requests AT THE SAME TIME ───
            // Do NOT await each one. Let them all hit the server
            // in the same event loop tick. The server will queue them
            // before the next market tick and give them the same price.
            const promises = tradeOptions.map(option =>
                api_base.api
                    .send(option)
                    .catch(err => ({ _error: err, _option: option }))
            );

            // ─── STEP 3: Wait for ALL of them to complete ───
            const results = await Promise.all(promises);

            // ─── STEP 4: Process each response ───
            let successCount = 0;
            const successfulContracts = [];

            results.forEach((response, i) => {
                if (response && response.buy && response.buy.contract_id) {
                    const buy = response.buy;

                    // Register this contract individually — DO NOT dispatch
                    // purchaseSuccessful() here, we do it once at the end
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

                    successfulContracts.push(buy);
                    successCount++;

                    console.log(
                        `[BULK] Contract ${i + 1}/${numContracts} ✓ ` +
                        `ID ${buy.contract_id}, price ${buy.buy_price}`
                    );
                } else {
                    const errMsg = response?._error?.error?.message || response?.error?.message || 'unknown';
                    console.warn(`[BULK] Contract ${i + 1}/${numContracts} ✗ ${errMsg}`);
                }
            });

            // ─── STEP 5: Only NOW mark the purchase as complete ───
            if (successCount > 0) {
                this.store.dispatch(purchaseSuccessful());
            }

            if (this.is_proposal_subscription_required) {
                this.renewProposalsOnPurchase();
            }

            console.log(`[BULK] Complete: ${successCount}/${numContracts} contracts purchased`);

            return Promise.resolve();
        }

        _executeSinglePurchase(contract_type) {
            // ── Single trade path (unchanged) ──
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