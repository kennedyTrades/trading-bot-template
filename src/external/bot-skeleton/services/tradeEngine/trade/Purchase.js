```javascript
import { LogTypes } from '../../../constants/messages';
import { api_base } from '../../api/api-base';
import { contractStatus, info, log } from '../utils/broadcast';
import {
    doUntilDone,
    getUUID,
    recoverFromError,
    tradeOptionToBuy,
} from '../utils/helpers';
import { purchaseSuccessful } from './state/actions';
import { BEFORE_PURCHASE } from './state/constants';

let delayIndex = 0;
let purchase_reference;

export default Engine =>
    class Purchase extends Engine {
        async purchase(contract_type, options = {}) {
            // Prevent duplicate purchase calls while a normal purchase
            // is already being processed.
            if (this.store.getState().scope !== BEFORE_PURCHASE) {
                return Promise.resolve();
            }

            const bulkEnabled = options.bulk === 'ENABLED';
            const count = Math.max(1, Number(options.count) || 1);

            // Normal DTrader purchase
            if (!bulkEnabled || count === 1) {
                return this._executeSinglePurchase(contract_type);
            }

            // Safety limit. Change this if your application requires another limit.
            const MAX_BULK_CONTRACTS = 20;
            const numberOfContracts = Math.min(count, MAX_BULK_CONTRACTS);

            return this._executeBulkPurchase(
                contract_type,
                numberOfContracts
            );
        }

        async _executeBulkPurchase(contract_type, count) {
            this.isSold = false;

            const purchases = [];

            /*
             * Build independent purchase actions.
             *
             * We do NOT directly manipulate contractId here because the
             * original DTrader engine expects one active contractId.
             *
             * Instead, we collect every successful contract separately.
             */
            for (let i = 0; i < count; i++) {
                purchases.push(this._createPurchaseAction(contract_type));
            }

            // Fire the purchase requests without waiting for one to finish
            // before starting the next one.
            const results = await Promise.allSettled(
                purchases.map(purchase => purchase())
            );

            const successfulContracts = [];
            const failedPurchases = [];

            results.forEach((result, index) => {
                if (
                    result.status === 'fulfilled' &&
                    result.value &&
                    result.value.buy &&
                    result.value.buy.contract_id
                ) {
                    const buy = result.value.buy;

                    successfulContracts.push({
                        index: index + 1,
                        contract_id: buy.contract_id,
                        transaction_id: buy.transaction_id,
                        buy_price: buy.buy_price,
                    });

                    this._handleBulkPurchaseSuccess(
                        result.value,
                        contract_type
                    );
                } else {
                    failedPurchases.push({
                        index: index + 1,
                        error:
                            result.status === 'rejected'
                                ? result.reason
                                : 'Invalid purchase response',
                    });
                }
            });

            return {
                success: successfulContracts,
                failed: failedPurchases,
                total: count,
                successful_count: successfulContracts.length,
                failed_count: failedPurchases.length,
            };
        }

        _createPurchaseAction(contract_type) {
            /*
             * Proposal-based contracts
             */
            if (this.is_proposal_subscription_required) {
                const { id, askPrice } =
                    this.selectProposal(contract_type);

                return () =>
                    api_base.api.send({
                        buy: id,
                        price: askPrice,
                    });
            }

            /*
             * Standard contract purchase
             */
            const trade_option = tradeOptionToBuy(
                contract_type,
                this.tradeOptions
            );

            return () => api_base.api.send(trade_option);
        }

        _executeSinglePurchase(contract_type) {
            if (this.is_proposal_subscription_required) {
                const { id, askPrice } =
                    this.selectProposal(contract_type);

                const action = () =>
                    api_base.api.send({
                        buy: id,
                        price: askPrice,
                    });

                this.isSold = false;

                contractStatus({
                    id: 'contract.purchase_sent',
                    data: askPrice,
                });

                if (!this.options.timeMachineEnabled) {
                    return doUntilDone(action).then(response =>
                        this._handlePurchaseSuccess(
                            response,
                            contract_type
                        )
                    );
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
                            const {
                                scope,
                                proposalsReady,
                            } = this.store.getState();

                            if (
                                scope === BEFORE_PURCHASE &&
                                proposalsReady
                            ) {
                                makeDelay().then(() =>
                                    this.observer.emit(
                                        'REVERT',
                                        'before'
                                    )
                                );

                                unsubscribe();
                            }
                        });
                    },
                    ['PriceMoved', 'InvalidContractProposal'],
                    delayIndex++
                ).then(response =>
                    this._handlePurchaseSuccess(
                        response,
                        contract_type
                    )
                );
            }

            const trade_option = tradeOptionToBuy(
                contract_type,
                this.tradeOptions
            );

            const action = () =>
                api_base.api.send(trade_option);

            this.isSold = false;

            contractStatus({
                id: 'contract.purchase_sent',
                data: this.tradeOptions.amount,
            });

            if (!this.options.timeMachineEnabled) {
                return doUntilDone(action).then(response =>
                    this._handlePurchaseSuccess(
                        response,
                        contract_type
                    )
                );
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
                            makeDelay().then(() =>
                                this.observer.emit(
                                    'REVERT',
                                    'before'
                                )
                            );

                            unsubscribe();
                        }
                    });
                },
                ['PriceMoved', 'InvalidContractProposal'],
                delayIndex++
            ).then(response =>
                this._handlePurchaseSuccess(
                    response,
                    contract_type
                )
            );
        }

        _handlePurchaseSuccess(response, contract_type) {
            const buy = response.buy || response;

            if (!buy || !buy.contract_id) {
                console.warn(
                    '[PURCHASE] Invalid response:',
                    response
                );
                return;
            }

            contractStatus({
                id: 'contract.purchase_received',
                data: buy.transaction_id,
                buy,
            });

            /*
             * Preserve the existing DTrader behaviour.
             * This is still used by the normal single-purchase flow.
             */
            this.contractId = buy.contract_id;

            this.store.dispatch(purchaseSuccessful());

            if (this.is_proposal_subscription_required) {
                this.renewProposalsOnPurchase();
            }

            delayIndex = 0;

            log(LogTypes.PURCHASE, {
                transaction_id: buy.transaction_id,
            });

            info({
                accountID: this.accountInfo.loginid,
                totalRuns: this.updateAndReturnTotalRuns(),
                transaction_ids: {
                    buy: buy.transaction_id,
                },
                contract_type,
                buy_price: buy.buy_price,
            });

            return buy;
        }

        _handleBulkPurchaseSuccess(response, contract_type) {
            const buy = response.buy || response;

            if (!buy || !buy.contract_id) {
                return;
            }

            /*
             * Broadcast every successful contract so the rest of the
             * application can observe it.
             */
            contractStatus({
                id: 'contract.purchase_received',
                data: buy.transaction_id,
                buy,
            });

            log(LogTypes.PURCHASE, {
                transaction_id: buy.transaction_id,
            });

            info({
                accountID: this.accountInfo.loginid,
                totalRuns: this.updateAndReturnTotalRuns(),
                transaction_ids: {
                    buy: buy.transaction_id,
                },
                contract_type,
                buy_price: buy.buy_price,
            });
        }

        getPurchaseReference = () => purchase_reference;

        regeneratePurchaseReference = () => {
            purchase_reference = getUUID();
        };
    };
```
