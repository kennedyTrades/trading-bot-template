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
    BULK_TRADER: 2,
    FREEBOTS: 3,
    DTRADER: 4,
    HEDGING: 5,
    MORE: 6,
    CHART: 7,
    ANALYZER: 8,
});

export const MAX_STRATEGIES = 10;

export const TAB_IDS = [
    { id: 'id-dashboard', title: 'Dashboard', icon: 'ic-dashboard' },
    { id: 'id-bot-builder', title: 'Bot Builder', icon: 'ic-bot-builder' },
    { id: 'id-bulk-trader', title: 'Bulk Trader', icon: 'ic-bulk-trader' },
    { id: 'id-freebots', title: 'Freebots & strategies', icon: 'ic-star' },
    { id: 'id-dtrader', title: 'Dtrader/circles', icon: 'ic-circle' },
    { id: 'id-hedging', title: 'Hedging Beast', icon: 'ic-hedging', badge: 'NEW' },
    { id: 'id-more', title: 'More', icon: 'ic-chevron-down' },
    { id: 'id-charts', title: 'Charts', icon: 'ic-charts' },
    { id: 'id-analyzer', title: 'Analysis tool', icon: 'ic-radar' },
];

export const DEBOUNCE_INTERVAL_TIME = 500;