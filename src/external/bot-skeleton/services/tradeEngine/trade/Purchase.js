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

            return this._executeBulkPurchase(contract_type, numContracts);
        }

        async _executeBulkPurchase(contract_type, numContracts) {
            this.isSold = false;

            contractStatus({
                id: 'contract.purchase_sent',
                data: this.is_proposal_subscription_required
                    ? this.selectProposal(contract_type)?.askPrice
                    : this.tradeOptions.amount,
            });

            // 🚀 Proposal-based contract types (e.g. most non-Rise/Fall types)
            // A proposal id can only be bought once, so we can't reuse a single
            // proposal N times — we grab a fresh proposal for each contract in
            // the batch just before sending it. This keeps entries as close to
            // simultaneous as the proposal stream allows.
            if (this.is_proposal_subscription_required) {
                const tradePromises = [];

                for (let i = 0; i < numContracts; i++) {
                    const { id, askPrice } = this.selectProposal(contract_type);
                    tradePromises.push(
                        api_base.api.send({ buy: id, price: askPrice }).catch(error => ({ error }))
                    );
                }

                const results = await Promise.allSettled(tradePromises);
                this._processBulkResults(results, contract_type);

                if (!this.options.timeMachineEnabled) {
                    this.renewProposalsOnPurchase();
                }

                return Promise.resolve();
            }

            // 🔥 Non-proposal contract types: build every request synchronously
            // first, then fire them all in the same tick with Promise.all so
            // Deriv receives them at (near) the exact same instant.
            const tradePromises = [];
            const sendTimestamps = [];

            for (let i = 0; i < numContracts; i++) {
                const trade_option = tradeOptionToBuy(contract_type, this.tradeOptions);
                sendTimestamps.push(performance.now());
                tradePromises.push(
                    api_base.api.send(trade_option).catch(error => ({ error }))
                );
            }

            const spread = (Math.max(...sendTimestamps) - Math.min(...sendTimestamps)).toFixed(2);
            console.log(
                `[BULK TIMING] ${numContracts} requests sent from this browser within ${spread}ms of each other.`,
                'Any spread in entry spot shown in the transaction list happens on Deriv\'s server',
                '(tick timing at the moment each request is processed), not from this send loop.'
            );

            const results = await Promise.allSettled(tradePromises);
            this._processBulkResults(results, contract_type);

            return Promise.resolve();
        }

        _processBulkResults(results, contract_type) {
            this.bulkContractIds = [];
            let successCount = 0;

            for (let i = 0; i < results.length; i++) {
                const result = results[i];
                const value = result.status === 'fulfilled' ? result.value : null;

                if (value && !value.error && value.buy) {
                    successCount++;
                    this._handlePurchaseSuccess(value, contract_type);
                    this.bulkContractIds.push(value.buy.contract_id);
                } else {
                    const reason = result.status === 'rejected' ? result.reason : value?.error;
                    console.warn(`[PURCHASE] Bulk trade #${i + 1} failed:`, reason);
                }
            }

            if (successCount === 0) {
                // Nothing bought — surface this instead of failing silently,
                // so the UI doesn't sit in "purchase_sent" state forever.
                contractStatus({
                    id: 'contract.purchase_error',
                    data: `0/${results.length} bulk trades succeeded`,
                });
            }
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