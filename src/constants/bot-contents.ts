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
    ANALYZER: 2,
    CHART: 3,
    TUTORIAL: 4,
     
});

export const MAX_STRATEGIES = 10;

 export const DBOT_TABS = [
    { id: 'id-dashboard', title: 'Dashboard', icon: 'ic-dashboard' },
    { id: 'id-bot-builder', title: 'Bot Builder', icon: 'ic-bot-builder' },
    { id: 'id-freebots', title: 'Freebots & strategies', icon: 'ic-star' },
    { id: 'id-dtrader', title: 'Dtrader/circles', icon: 'ic-circle' },
    { id: 'id-hedging', title: 'Hedging Beast', icon: 'ic-hedging', badge: 'NEW' },
    { id: 'id-more', title: 'More', icon: 'ic-chevron-down' },
    { id: 'id-charts', title: 'Charts', icon: 'ic-charts' },
    { id: 'id-analyzer', title: 'Analysis tool', icon: 'ic-radar' },
];

export const DEBOUNCE_INTERVAL_TIME = 500;