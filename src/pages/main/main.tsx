 import React, { lazy, Suspense, useEffect, useState } from 'react';
import classNames from 'classnames';
import { observer } from 'mobx-react-lite';
import { useLocation, useNavigate } from 'react-router-dom';
import ChunkLoader from '@/components/loader/chunk-loader';
import { generateOAuthURL } from '@/components/shared';
import DesktopWrapper from '@/components/shared_ui/desktop-wrapper';
import Dialog from '@/components/shared_ui/dialog';
import MobileWrapper from '@/components/shared_ui/mobile-wrapper';
import Tabs from '@/components/shared_ui/tabs/tabs';
import TradeTypeConfirmationModal from '@/components/trade-type-confirmation-modal';
import TradingViewModal from '@/components/trading-view-chart/trading-view-modal';
import { DBOT_TABS, TAB_IDS } from '@/constants/bot-contents';
import { api_base, updateWorkspaceName } from '@/external/bot-skeleton';
import { CONNECTION_STATUS } from '@/external/bot-skeleton/services/api/observables/connection-status-stream';
import { isDbotRTL } from '@/external/bot-skeleton/utils/workspace';
import { useApiBase } from '@/hooks/useApiBase';
import { useStore } from '@/hooks/useStore';
import {
    disableUrlParameterApplication,
    enableUrlParameterApplication,
    setupTradeTypeChangeListener,
} from '@/utils/blockly-url-param-handler';
import {
    checkAndShowTradeTypeModal,
    getModalState,
    handleTradeTypeCancel,
    handleTradeTypeConfirm,
    resetUrlParamProcessing,
    setModalStateChangeCallback,
} from '@/utils/trade-type-modal-handler';
import {
    LabelPairedChartLineCaptionRegularIcon,
    LabelPairedObjectsColumnCaptionRegularIcon,
    LabelPairedPuzzlePieceTwoCaptionBoldIcon,
    LabelPairedMagnifyingGlassPlusCaptionRegularIcon,
} from '@deriv/quill-icons/LabelPaired';
import { LegacyGuide1pxIcon } from '@deriv/quill-icons/Legacy';
import { Localize, localize } from '@deriv-com/translations';
import { useDevice } from '@deriv-com/ui';
import RunPanel from '../../components/run-panel';
import ChartModal from '../chart/chart-modal';
import Dashboard from '../dashboard';
import RunStrategy from '../dashboard/run-strategy';
// @ts-ignore
import './main.scss';

const ChartWrapper = lazy(() => import('../chart/chart-wrapper'));
const Analyzer = lazy(() => import('../analyzer'));
const BulkTrader = lazy(() => import('../bulk-trader'));

// --- Inline Native UI Components for Tabs ---

const FreebotsNative: React.FC = () => {
    const strategies = [
        { id: 1, name: 'Quantum Signal Bot', category: 'Digits', description: 'Matches & Differs automated strategy' },
        { id: 2, name: 'Hedging Beast Bot', category: 'Rise/Fall', description: 'Auto recovery hedging strategy' },
        { id: 3, name: 'Tick Pattern Master', category: 'Analysis', description: 'High probability tick pattern detector' },
    ];

    return (
        <div style={{ padding: '24px', color: 'var(--text-general)' }}>
            <h2 style={{ marginBottom: '16px' }}>Freebots & Strategies</h2>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))', gap: '16px' }}>
                {strategies.map(bot => (
                    <div
                        key={bot.id}
                        style={{
                            border: '1px solid var(--border-normal)',
                            borderRadius: '8px',
                            padding: '16px',
                            background: 'var(--general-section-1)',
                        }}
                    >
                        <h3>{bot.name}</h3>
                        <span style={{ fontSize: '12px', color: 'var(--text-less-prominent)' }}>{bot.category}</span>
                        <p style={{ marginTop: '8px', fontSize: '14px' }}>{bot.description}</p>
                        <button
                            style={{
                                marginTop: '16px',
                                width: '100%',
                                padding: '10px',
                                background: 'var(--button-primary-default)',
                                color: '#ffffff',
                                border: 'none',
                                borderRadius: '4px',
                                cursor: 'pointer',
                                fontWeight: 'bold',
                            }}
                        >
                            Load Strategy
                        </button>
                    </div>
                ))}
            </div>
        </div>
    );
};

const DtraderNative: React.FC = () => {
    const [strategy, setStrategy] = useState('Matches & Differs');
    const [market, setMarket] = useState('Volatility 10 (1s) Index');

    return (
        <div style={{ padding: '32px 16px', maxWidth: '700px', margin: '0 auto', color: 'var(--text-general)' }}>
            <div style={{
                border: '1px solid var(--border-normal)',
                borderRadius: '12px',
                padding: '24px',
                background: 'var(--general-section-1)',
                boxShadow: '0 4px 12px rgba(0,0,0,0.05)',
            }}>
                <h2 style={{ color: '#ff444f', textAlign: 'center', marginBottom: '24px' }}>
                    Quantum Signal Analyzer
                </h2>

                <div style={{ marginBottom: '16px' }}>
                    <label style={{ display: 'block', marginBottom: '8px', fontWeight: 'bold' }}>SELECT STRATEGY</label>
                    <select
                        value={strategy}
                        onChange={(e) => setStrategy(e.target.value)}
                        style={{
                            width: '100%',
                            padding: '12px',
                            borderRadius: '6px',
                            border: '1px solid var(--border-normal)',
                            background: 'var(--general-main)',
                            color: 'var(--text-general)',
                        }}
                    >
                        <option value="Matches & Differs">Matches & Differs</option>
                        <option value="Over / Under">Over / Under</option>
                        <option value="Rise / Fall">Rise / Fall</option>
                    </select>
                </div>

                <div style={{ marginBottom: '24px' }}>
                    <label style={{ display: 'block', marginBottom: '8px', fontWeight: 'bold' }}>SELECT MARKET</label>
                    <select
                        value={market}
                        onChange={(e) => setMarket(e.target.value)}
                        style={{
                            width: '100%',
                            padding: '12px',
                            borderRadius: '6px',
                            border: '1px solid var(--border-normal)',
                            background: 'var(--general-main)',
                            color: 'var(--text-general)',
                        }}
                    >
                        <option value="Volatility 10 (1s) Index">Volatility 10 (1s) Index</option>
                        <option value="Volatility 100 Index">Volatility 100 Index</option>
                        <option value="Volatility 75 Index">Volatility 75 Index</option>
                    </select>
                </div>

                <div style={{
                    padding: '20px',
                    background: 'var(--general-main)',
                    borderRadius: '8px',
                    textAlign: 'center',
                    border: '1px solid var(--border-normal)',
                }}>
                    <h4>Active Signal Status</h4>
                    <p style={{ fontSize: '22px', fontWeight: 'bold', color: '#4bb543', margin: '12px 0' }}>
                        SIGNAL: READY
                    </p>
                    <p style={{ fontSize: '12px', color: 'var(--text-less-prominent)' }}>
                        Connected to live market ticks for {market}
                    </p>
                </div>
            </div>
        </div>
    );
};

const HedgingNative: React.FC = () => {
    return (
        <div style={{ padding: '32px 16px', maxWidth: '700px', margin: '0 auto', color: 'var(--text-general)' }}>
            <div style={{
                border: '1px solid var(--border-normal)',
                borderRadius: '12px',
                padding: '24px',
                background: 'var(--general-section-1)',
            }}>
                <h2 style={{ textAlign: 'center', marginBottom: '16px' }}>Hedging Beast</h2>
                <p style={{ textAlign: 'center', color: 'var(--text-less-prominent)' }}>
                    Automated position hedging and risk mitigation module.
                </p>
            </div>
        </div>
    );
};

const MoreNative: React.FC = () => {
    return (
        <div style={{ padding: '32px 16px', maxWidth: '700px', margin: '0 auto', color: 'var(--text-general)' }}>
            <div style={{
                border: '1px solid var(--border-normal)',
                borderRadius: '12px',
                padding: '24px',
                background: 'var(--general-section-1)',
            }}>
                <h2 style={{ textAlign: 'center', marginBottom: '16px' }}>Additional Utilities</h2>
                <p style={{ textAlign: 'center', color: 'var(--text-less-prominent)' }}>
                    Access extra tools, market analytics, and strategy calculators.
                </p>
            </div>
        </div>
    );
};

// --- Main Application Component ---

const AppWrapper = observer(() => {
    const { connectionStatus } = useApiBase();
    const { dashboard, load_modal, run_panel, quick_strategy, summary_card, blockly_store } = useStore();
    const { is_loading } = blockly_store;
    const {
        active_tab,
        active_tour,
        is_chart_modal_visible,
        is_trading_view_modal_visible,
        setActiveTab,
        setWebSocketState,
        setActiveTour,
        setTourDialogVisibility,
    } = dashboard;
    const { dashboard_strategies } = load_modal;
    const {
        is_dialog_open,
        is_drawer_open,
        dialog_options,
        onCancelButtonClick,
        onCloseDialog,
        onOkButtonClick,
        stopBot,
    } = run_panel;
    const { is_open } = quick_strategy;
    const {
        cancel_button_text,
        ok_button_text,
        title,
        message,
        dismissable,
        is_closed_on_cancel,
    } = dialog_options as {
        [key: string]: string | boolean | undefined;
    };
    const { clear } = summary_card;
    const { DASHBOARD, BOT_BUILDER } = DBOT_TABS;
    const init_render = React.useRef(true);
    const hash = ['dashboard', 'bot_builder', 'bulk_trader', 'freebots', 'dtrader', 'hedging', 'more', 'chart', 'analyzer'];
    const { isDesktop } = useDevice();
    const location = useLocation();
    const navigate = useNavigate();
    const [left_tab_shadow, setLeftTabShadow] = useState<boolean>(false);
    const [right_tab_shadow, setRightTabShadow] = useState<boolean>(false);

    // Trade type modal state
    const [tradeTypeModalState, setTradeTypeModalState] = useState(getModalState());

    const getTradeTypeModalProps = () => {
        const { tradeTypeData } = tradeTypeModalState;

        return {
            is_visible: tradeTypeModalState.isVisible,
            trade_type_display_name: tradeTypeData?.displayName || '',
            current_trade_type: tradeTypeData?.currentTradeType
                ? `${tradeTypeData.currentTradeType.tradeTypeCategory}/${tradeTypeData.currentTradeType.tradeType}`
                : 'N/A',
            current_trade_type_display_name: tradeTypeData?.currentTradeTypeDisplayName || 'N/A',
            onConfirm: handleTradeTypeConfirm,
            onCancel: handleTradeTypeCancel,
        };
    };

    let tab_value: number | string = active_tab;
    const GetHashedValue = (tab: number) => {
        tab_value = location.hash?.split('#')[1];
        if (!tab_value) return tab;
        return Number(hash.indexOf(String(tab_value)));
    };
    const active_hash_tab = GetHashedValue(active_tab);

    React.useEffect(() => {
        setModalStateChangeCallback(new_state => {
            setTradeTypeModalState(new_state);
        });
    }, [is_loading]);

    React.useEffect(() => {
        resetUrlParamProcessing();
    }, [location.search]);

    React.useEffect(() => {
        const el_dashboard = document.getElementById('id-dbot-dashboard');
        const el_tutorial = document.getElementById('id-tutorials');

        const observer_dashboard = new window.IntersectionObserver(
            ([entry]) => {
                if (entry.isIntersecting) {
                    setLeftTabShadow(false);
                    return;
                }
                setLeftTabShadow(true);
            },
            { root: null, threshold: 0.5 }
        );

        const observer_tutorial = new window.IntersectionObserver(
            ([entry]) => {
                if (entry.isIntersecting) {
                    setRightTabShadow(false);
                    return;
                }
                setRightTabShadow(true);
            },
            { root: null, threshold: 0.5 }
        );

        if (el_dashboard) observer_dashboard.observe(el_dashboard);
        if (el_tutorial) observer_tutorial.observe(el_tutorial);

        return () => {
            if (el_dashboard) observer_dashboard.unobserve(el_dashboard);
            if (el_tutorial) observer_tutorial.unobserve(el_tutorial);
        };
    }, []);

    React.useEffect(() => {
        if (connectionStatus !== CONNECTION_STATUS.OPENED) {
            const is_bot_running = document.getElementById('db-animation__stop-button') !== null;
            if (is_bot_running) {
                clear();
                stopBot();
                api_base.setIsRunning(false);
                setWebSocketState(false);
            }
        }
    }, [clear, connectionStatus, setWebSocketState, stopBot]);

    const updateTabShadowsHeight = () => {
        const botBuilderEl = document.getElementById('id-bot-builder');
        const leftShadow = document.querySelector('.tabs-shadow--left') as HTMLElement;
        const rightShadow = document.querySelector('.tabs-shadow--right') as HTMLElement;

        if (botBuilderEl && leftShadow && rightShadow) {
            const height = botBuilderEl.offsetHeight;
            leftShadow.style.height = `${height}px`;
            rightShadow.style.height = `${height}px`;
        }
    };

    React.useEffect(() => {
        let pollTimeoutId: ReturnType<typeof setTimeout> | null = null;

        if (active_tab === BOT_BUILDER) {
            requestAnimationFrame(() => {
                disableUrlParameterApplication();
                setupTradeTypeChangeListener();

                const handleTradeTypeModal = () => {
                    checkAndShowTradeTypeModal(
                        () => {
                            enableUrlParameterApplication();
                        },
                        () => {}
                    );
                };

                if (!blockly_store.is_loading) {
                    setTimeout(() => {
                        handleTradeTypeModal();
                    }, 500);
                } else {
                    let pollAttempts = 0;
                    const maxPollAttempts = 10;

                    const checkBlocklyLoaded = () => {
                        if (!blockly_store.is_loading) {
                            handleTradeTypeModal();
                            return;
                        }

                        if (pollAttempts < maxPollAttempts) {
                            pollAttempts++;
                            pollTimeoutId = setTimeout(checkBlocklyLoaded, 500);
                        } else {
                            console.warn(
                                'Blockly loading timeout after 5 seconds - proceeding without URL parameter check'
                            );
                        }
                    };

                    checkBlocklyLoaded();
                }
            });
        }

        return () => {
            if (pollTimeoutId) {
                clearTimeout(pollTimeoutId);
                pollTimeoutId = null;
            }
        };
    }, [active_tab, is_loading]);

    React.useEffect(() => {
        updateTabShadowsHeight();

        if (is_open) {
            setTourDialogVisibility(false);
        }
        if (init_render.current) {
            setActiveTab(Number(active_hash_tab));
            if (!isDesktop) handleTabChange(Number(active_hash_tab));
            init_render.current = false;
        } else {
            const currentSearch = window.location.search;
            navigate(`${currentSearch}#${hash[active_tab] || hash[0]}`);
        }
        if (active_tour !== '') {
            setActiveTour('');
        }

        const mainElement = document.querySelector('.main__container');
        if (active_tab === DBOT_TABS.TUTORIAL && !isDesktop) {
            document.body.style.overflow = 'hidden';
            if (mainElement instanceof HTMLElement) {
                mainElement.classList.add('no-scroll');
            }
        } else {
            document.body.style.overflow = '';
            if (mainElement instanceof HTMLElement) {
                mainElement.classList.remove('no-scroll');
            }
        }
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [active_tab]);

    React.useEffect(() => {
        const trashcan_init_id = setTimeout(() => {
            const blocklyWorkspace = (Blockly as any)?.derivWorkspace;
            if (active_tab === BOT_BUILDER && blocklyWorkspace?.trashcan) {
                const trashcanY = window.innerHeight - 250;
                let trashcanX;
                if (is_drawer_open) {
                    trashcanX = isDbotRTL() ? 380 : window.innerWidth - 460;
                } else {
                    trashcanX = isDbotRTL() ? 20 : window.innerWidth - 100;
                }
                blocklyWorkspace.trashcan.setTrashcanPosition(trashcanX, trashcanY);
            }
        }, 100);

        return () => {
            clearTimeout(trashcan_init_id);
        };
        //eslint-disable-next-line react-hooks/exhaustive-deps
    }, [active_tab, is_drawer_open]);

    useEffect(() => {
        let timer: ReturnType<typeof setTimeout>;
        if (dashboard_strategies.length > 0) {
            timer = setTimeout(() => {
                updateWorkspaceName();
            });
        }
        return () => {
            if (timer) clearTimeout(timer);
        };
    }, [dashboard_strategies, active_tab]);

    const handleTabChange = React.useCallback(
        (tab_index: number) => {
            setActiveTab(tab_index);
            const el_id = TAB_IDS[tab_index];
            if (el_id) {
                const el_tab = document.getElementById(typeof el_id === 'string' ? el_id : el_id.id);
                setTimeout(() => {
                    el_tab?.scrollIntoView({ behavior: 'smooth', block: 'center', inline: 'center' });
                }, 10);
            }
        },
        // eslint-disable-next-line react-hooks/exhaustive-deps
        [active_tab]
    );

    const handleLoginGeneration = async () => {
        const oauthUrl = await generateOAuthURL();
        if (oauthUrl) {
            window.location.replace(oauthUrl);
        } else {
            console.error('Failed to generate OAuth URL');
        }
    };

    return (
        <React.Fragment>
            <div className='main'>
                <div
                    className={classNames('main__container', {
                        'main__container--active': active_tour && active_tab === DASHBOARD && !isDesktop,
                    })}
                >
                    <div>
                        {!isDesktop && left_tab_shadow && <span className='tabs-shadow tabs-shadow--left' />}
                        <Tabs
                            active_index={active_tab}
                            className='main__tabs'
                            onTabItemClick={handleTabChange}
                            top
                            history={window.history}
                        >
                            <div
                                label={
                                    <>
                                        <LabelPairedObjectsColumnCaptionRegularIcon
                                            height='24px'
                                            width='24px'
                                            fill='var(--text-general)'
                                        />
                                        <Localize i18n_default_text='Dashboard' />
                                    </>
                                }
                                id='id-dashboard'
                            >
                                <Dashboard handleTabChange={handleTabChange} />
                            </div>
                            <div
                                label={
                                    <>
                                        <LabelPairedPuzzlePieceTwoCaptionBoldIcon
                                            height='24px'
                                            width='24px'
                                            fill='var(--text-general)'
                                        />
                                        <Localize i18n_default_text='Bot Builder' />
                                    </>
                                }
                                id='id-bot-builder'
                            />
                            <div
                                label={
                                    <>
                                        <LabelPairedObjectsColumnCaptionRegularIcon
                                            height='24px'
                                            width='24px'
                                            fill='var(--text-general)'
                                        />
                                        <Localize i18n_default_text='Bulk Trader' />
                                    </>
                                }
                                id='id-bulk-trader'
                            >
                                <Suspense
                                    fallback={
                                        <ChunkLoader message={localize('Please wait, loading bulk trader...')} />
                                    }
                                >
                                    <BulkTrader />
                                </Suspense>
                            </div>
                            <div
                                label={
                                    <>
                                        <LegacyGuide1pxIcon
                                            height='16px'
                                            width='16px'
                                            fill='var(--text-general)'
                                        />
                                        <Localize i18n_default_text='Freebots & strategies' />
                                    </>
                                }
                                id='id-freebots'
                            >
                                <FreebotsNative />
                            </div>
                            <div
                                label={
                                    <>
                                        <LegacyGuide1pxIcon
                                            height='16px'
                                            width='16px'
                                            fill='var(--text-general)'
                                        />
                                        <Localize i18n_default_text='Dtrader/circles' />
                                    </>
                                }
                                id='id-dtrader'
                            >
                                <DtraderNative />
                            </div>
                            <div
                                label={
                                    <>
                                        <LegacyGuide1pxIcon
                                            height='16px'
                                            width='16px'
                                            fill='var(--text-general)'
                                        />
                                        <Localize i18n_default_text='Hedging Beast' />
                                    </>
                                }
                                id='id-hedging'
                            >
                                <HedgingNative />
                            </div>
                            <div
                                label={
                                    <>
                                        <LegacyGuide1pxIcon
                                            height='16px'
                                            width='16px'
                                            fill='var(--text-general)'
                                        />
                                        <Localize i18n_default_text='More' />
                                    </>
                                }
                                id='id-more'
                            >
                                <MoreNative />
                            </div>
                            <div
                                label={
                                    <>
                                        <LabelPairedChartLineCaptionRegularIcon
                                            height='24px'
                                            width='24px'
                                            fill='var(--text-general)'
                                        />
                                        <Localize i18n_default_text='Charts' />
                                    </>
                                }
                                id={
                                    is_chart_modal_visible || is_trading_view_modal_visible
                                        ? 'id-charts--disabled'
                                        : 'id-charts'
                                }
                            >
                                <Suspense
                                    fallback={<ChunkLoader message={localize('Please wait, loading chart...')} />}
                                >
                                    <ChartWrapper show_digits_stats={false} />
                                </Suspense>
                            </div>
                            <div
                                label={
                                    <>
                                        <LabelPairedMagnifyingGlassPlusCaptionRegularIcon
                                            height='24px'
                                            width='24px'
                                            fill='var(--text-general)'
                                        />
                                        <Localize i18n_default_text='Analysis tool' />
                                    </>
                                }
                                id='id-analyzer'
                            >
                                <Suspense
                                    fallback={
                                        <ChunkLoader message={localize('Please wait, loading analyzer...')} />
                                    }
                                >
                                    <Analyzer />
                                </Suspense>
                            </div>
                        </Tabs>
                        {!isDesktop && right_tab_shadow && <span className='tabs-shadow tabs-shadow--right' />}
                    </div>
                </div>
            </div>
            <DesktopWrapper>
                <div className='main__run-strategy-wrapper'>
                    <RunStrategy />
                    <RunPanel />
                </div>
                <ChartModal />
                <TradingViewModal />
            </DesktopWrapper>
            <MobileWrapper>{!is_open && <RunPanel />}</MobileWrapper>
            <Dialog
                cancel_button_text={cancel_button_text ? String(cancel_button_text) : localize('Cancel')}
                confirm_button_text={ok_button_text ? String(ok_button_text) : localize('Ok')}
                className='dc-dialog__wrapper--fixed'
                has_close_icon
                is_mobile_full_width={false}
                is_visible={is_dialog_open}
                onCancel={onCancelButtonClick || undefined}
                onClose={onCloseDialog}
                onConfirm={onOkButtonClick || onCloseDialog}
                portal_element_id='modal_root'
                title={title}
                login={handleLoginGeneration}
                dismissable={Boolean(dismissable)}
                is_closed_on_cancel={Boolean(is_closed_on_cancel)}
            >
                {message}
            </Dialog>

            {/* Trade Type Confirmation Modal */}
            {(() => {
                const modalProps = getTradeTypeModalProps();
                return (
                    <TradeTypeConfirmationModal
                        is_visible={modalProps.is_visible}
                        trade_type_display_name={modalProps.trade_type_display_name}
                        current_trade_type={modalProps.current_trade_type}
                        current_trade_type_display_name={modalProps.current_trade_type_display_name}
                        onConfirm={modalProps.onConfirm}
                        onCancel={modalProps.onCancel}
                    />
                );
            })()}
        </React.Fragment>
    );
});

export default AppWrapper;