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

            // 🎯 BULK TRADES: Determine how many contracts to fire
            const bulkEnabled = options.bulk === 'ENABLED';
            const numContracts = bulkEnabled ? Math.max(1, Number(options.count) || 1) : 1;

            // If bulk is disabled or count is 1, use the normal single-trade path
            if (numContracts <= 1) {
                return this._executeSinglePurchase(contract_type);
            }

            // 🚀 TRUE SIMULTANEOUS EXECUTION
            // We build ALL trade requests synchronously, then fire them in
            // the SAME event loop tick using Promise.all(). This gives Deriv
            // all requests at the exact same instant, resulting in near-
            // identical entry prices.

            const tradePromises = [];

            // Build all requests FIRST (synchronously) so they're ready to fire together
            for (let i = 0; i < numContracts; i++) {
                // Build the trade option synchronously
                const trade_option = tradeOptionToBuy(contract_type, this.tradeOptions);

                // Push the promise WITHOUT awaiting it — this queues the send
                tradePromises.push(
                    api_base.api.send(trade_option)
                );
            }

            // 🔥 FIRE ALL AT ONCE — Promise.allSettled awaits all simultaneously
            const results = await Promise.allSettled(tradePromises);

            // Process each successful result
            let successCount = 0;
            for (let i = 0; i < results.length; i++) {
                const result = results[i];

                if (result.status === 'fulfilled' && result.value && result.value.buy) {
                    successCount++;
                    this._handlePurchaseSuccess(result.value, contract_type);
                } else if (result.status === 'rejected') {
                    console.warn(`[PURCHASE] Trade #${i + 1} failed:`, result.reason);
                }
            }

            return Promise.resolve();
        }

        _executeSinglePurchase(contract_type) {
            // Standard single-trade path (used when bulk is disabled)
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
            // Extract the buy object from the response
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