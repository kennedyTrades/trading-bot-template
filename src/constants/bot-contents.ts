type TTabsTitle = {
    [key: string]: string | number;
};

type TDashboardTabIndex = {
    [key: string]: number;
};

export const tabs_title: TTabsTitle = Object.freeze({
    WORKSPACE: 'Workspace',
    CHART: 'Chart',
});

export const DBOT_TABS: TDashboardTabIndex = Object.freeze({
    DASHBOARD: 0,
    BOT_BUILDER: 1,
    OPTIMUS_PRIME: 2,
    RISK_CALCULATOR: 3,
    BULK_TRADER: 4,
    FREEBOTS: 5,
    DTRADER: 6,
    HEDGING: 7,
    MORE: 8,
    CHART: 9,
    ANALYZER: 10,
});

export const MAX_STRATEGIES = 10;

export const TAB_IDS = [
    { id: 'id-dashboard', title: 'Dashboard', icon: 'ic-dashboard' },
    { id: 'id-bot-builder', title: 'Bot Builder', icon: 'ic-bot-builder' },
    { id: 'id-optimus-prime', title: 'Optimus Prime', icon: 'ic-optimus-prime' },
    { id: 'id-risk-calculator', title: 'Risk Calculator', icon: 'ic-risk-calculator' },
    { id: 'id-bulk-trader', title: 'Bulk Trader', icon: 'ic-bulk-trader' },
    { id: 'id-freebots', title: 'Freebots & strategies', icon: 'ic-star' },
    { id: 'id-dtrader', title: 'Dtrader/circles', icon: 'ic-circle' },
    { id: 'id-hedging', title: 'Hedging Beast', icon: 'ic-hedging', badge: 'NEW' },
    { id: 'id-more', title: 'More', icon: 'ic-chevron-down' },
    { id: 'id-charts', title: 'Charts', icon: 'ic-charts' },
    { id: 'id-analyzer', title: 'Analysis tool', icon: 'ic-radar' },
];

export const DEBOUNCE_INTERVAL_TIME = 500;