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
    'id-dashboard',
    'id-bot-builder',
    'id-bulk-trader',
    'id-freebots',
    'id-dtrader',
    'id-hedging',
    'id-more',
    'id-charts',
    'id-analyzer',
];

export const DEBOUNCE_INTERVAL_TIME = 500;