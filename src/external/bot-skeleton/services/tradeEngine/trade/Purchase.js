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
            console.log('🔍 [PURCHASE] Called with:', { contract_type, options });
            console.log('🔍 [PURCHASE] Current scope:', this.store.getState().scope);

            // Prevent calling purchase twice
            if (this.store.getState().scope !== BEFORE_PURCHASE) {
                console.log('❌ [PURCHASE] Blocked by scope check. Scope is:', this.store.getState().scope);
                return Promise.resolve();
            }

            // 🎯 BULK TRADES: Determine how many contracts to fire
            const bulkEnabled = options.bulk === 'ENABLED';
            const numContracts = bulkEnabled ? Math.max(1, Number(options.count) || 1) : 1;

            console.log('🎯 [PURCHASE] Bulk enabled:', bulkEnabled);
            console.log('🎯 [PURCHASE] Firing', numContracts, 'contract(s)');

            // 🚀 Fire all contracts SIMULTANEOUSLY
            const purchasePromises = [];
            for (let contractIndex = 0; contractIndex < numContracts; contractIndex++) {
                console.log(`🚀 [PURCHASE] Starting contract #${contractIndex + 1}`);
                purchasePromises.push(this._executeSinglePurchase(contract_type, contractIndex + 1));
            }

            // Wait for all to complete
            const results = await Promise.allSettled(purchasePromises);
            console.log('📊 [PURCHASE] All settled. Results:', results.map(r => r.status));
        }

        _executeSinglePurchase(contract_type, index = 1) {
            console.log(`⚙️ [SINGLE #${index}] Firing trade`);

            const onSuccess = response => {
                const { buy } = response;
                console.log(`✅ [SINGLE #${index}] Purchase successful! Transaction:`, buy.transaction_id);

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
            };

            const onError = error => {
                console.log(`❌ [SINGLE #${index}] Purchase failed:`, error);
                throw error;
            };

            if (this.is_proposal_subscription_required) {
                console.log(`📋 [SINGLE #${index}] Using proposal subscription path`);

                const { id, askPrice } = this.selectProposal(contract_type);
                console.log(`📋 [SINGLE #${index}] Proposal ID:`, id, 'Ask price:', askPrice);

                const action = () => api_base.api.send({ buy: id, price: askPrice });

                this.isSold = false;

                contractStatus({
                    id: 'contract.purchase_sent',
                    data: askPrice,
                });

                if (!this.options.timeMachineEnabled) {
                    return doUntilDone(action).then(onSuccess).catch(onError);
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
                ).then(onSuccess).catch(onError);
            }

            console.log(`💼 [SINGLE #${index}] Using direct trade path`);

            const trade_option = tradeOptionToBuy(contract_type, this.tradeOptions);
            console.log(`💼 [SINGLE #${index}] Trade option:`, trade_option);

            const action = () => api_base.api.send(trade_option);

            this.isSold = false;

            contractStatus({
                id: 'contract.purchase_sent',
                data: this.tradeOptions.amount,
            });

            if (!this.options.timeMachineEnabled) {
                return doUntilDone(action).then(onSuccess).catch(onError);
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
            ).then(onSuccess).catch(onError);
        }

        getPurchaseReference = () => purchase_reference;
        regeneratePurchaseReference = () => {
            purchase_reference = getUUID();
        };
    };