 import React, { useEffect, useRef, useState } from 'react';
import './analyzer.scss';

// ─────────────────────────────────────────────────────────
//  CONFIG
// ─────────────────────────────────────────────────────────
const APP_ID = '34qhZIGY0FBtndHACGXrA';
const WS_URL = `wss://api.derivws.com/trading/v1/options/ws/public?app_id=${APP_ID}`;
const WS_AUTH_URL = `wss://api.derivws.com/trading/v1/options/ws/authenticated?app_id=${APP_ID}`;

const HISTORY_SIZE = 1000;
const MIN_SAMPLES = 500;
const RARE_THRESHOLD = 9.2;

const SUPPORTED_MARKETS: Record<string, { label: string; decimals: number }> = {
    '1HZ10V': { label: 'Volatility 10 (1s) Index', decimals: 2 },
    '1HZ25V': { label: 'Volatility 25 (1s) Index', decimals: 2 },
    '1HZ50V': { label: 'Volatility 50 (1s) Index', decimals: 2 },
    '1HZ75V': { label: 'Volatility 75 (1s) Index', decimals: 2 },
    '1HZ100V': { label: 'Volatility 100 (1s) Index', decimals: 2 },
    R_10: { label: 'Volatility 10 Index', decimals: 3 },
    R_25: { label: 'Volatility 25 Index', decimals: 3 },
    R_50: { label: 'Volatility 50 Index', decimals: 3 },
    R_75: { label: 'Volatility 75 Index', decimals: 3 },
    R_100: { label: 'Volatility 100 Index', decimals: 3 },
};

const STRATEGIES = {
    matches_differs: 'Matches & Differs',
    even_odd: 'Even & Odd',
    over_under: 'Over & Under',
} as const;

type StrategyKey = keyof typeof STRATEGIES;

interface Tick {
    price: string;
    digit: number;
    epoch: number;
    time: string;
}

interface Signal {
    ok: boolean;
    strategy?: string;
    confidence?: string;
    predicted?: string;
    entries?: string[];
    reason?: string;
    message?: string;
    rarestInfo?: { digit: number; pct: number };
    contractType?: string;
    barrier?: string;
    prediction?: number;
}

interface TradeRecord {
    id: string;
    contractId?: number;
    symbol: string;
    contractType: string;
    stake: string;
    barrier?: string;
    prediction?: number;
    status: 'pending' | 'open' | 'won' | 'lost' | 'error';
    profit?: number;
    entrySpot?: number;
    entryTime: number;
    buyPrice?: number;
    payout?: number;
    error?: string;
}

const getLastDigit = (price: number, symbol: string) => {
    const decimals = SUPPORTED_MARKETS[symbol]?.decimals ?? 2;
    return Number(Number(price).toFixed(decimals).slice(-1));
};

const formatPrice = (price: number, symbol: string) => {
    const decimals = SUPPORTED_MARKETS[symbol]?.decimals ?? 2;
    return Number(price).toFixed(decimals);
};

const Analyzer: React.FC = () => {
    const [symbol, setSymbol] = useState('1HZ25V');
    const [strategy, setStrategy] = useState<StrategyKey>('matches_differs');
    const [, setTicks] = useState<Tick[]>([]);
    const [authStatus, setAuthStatus] = useState<'idle' | 'authorizing' | 'authorized' | 'error'>('idle');
    const [balance, setBalance] = useState<{ amount: number; currency: string } | null>(null);

    // Matrix background simulation logs
    const [matrixLogs, setMatrixLogs] = useState<string[]>([]);

    // ── Auto-trade & Analyzer parameters ──
    const [autoTradeEnabled, setAutoTradeEnabled] = useState(true);
    const [stake, setStake] = useState('0.35');
    const [duration, setDuration] = useState(4);
    const [stopLoss, setStopLoss] = useState('0');
    const [takeProfit, setTakeProfit] = useState('0');
    const [enableMartingale, setEnableMartingale] = useState(false);
    const [analyseEachTrade, setAnalyseEachTrade] = useState(false);
    const [maxTradesPerSignal, setMaxTradesPerSignal] = useState('10');
    const [recoveryMode, setRecoveryMode] = useState(false);

    const [apiToken, setApiToken] = useState('');
    const [trades, setTrades] = useState<TradeRecord[]>([]);
    const [lastTradeError] = useState<string | null>(null);
    const [isAnalyzing, setIsAnalyzing] = useState(false);

    const wsRef = useRef<WebSocket | null>(null);
    const authWsRef = useRef<WebSocket | null>(null);
    const tickHistoryRef = useRef<Tick[]>([]);
    const symbolRef = useRef(symbol);
    const socketGenerationRef = useRef(0);

    const autoTradeRef = useRef(autoTradeEnabled);
    const stakeRef = useRef(stake);
    const durationRef = useRef(duration);
    const currencyRef = useRef('USD');
    const strategyRef = useRef(strategy);
    const authWsReadyRef = useRef(false);
    const pendingReqIdRef = useRef(1);
    const tradesRef = useRef<TradeRecord[]>([]);
    const lastSignalKeyRef = useRef<string>('');

    useEffect(() => { symbolRef.current = symbol; }, [symbol]);
    useEffect(() => { autoTradeRef.current = autoTradeEnabled; }, [autoTradeEnabled]);
    useEffect(() => { stakeRef.current = stake; }, [stake]);
    useEffect(() => { durationRef.current = duration; }, [duration]);
    useEffect(() => { strategyRef.current = strategy; }, [strategy]);
    useEffect(() => { tradesRef.current = trades; }, [trades]);

    // Matrix background log generator stream
    useEffect(() => {
        const dummyLogs = [
            '[INFO] Analyzing Volatility Index...',
            '[WARNING] High market volatility detected...',
            '[SUCCESS] Market data synchronized...',
            '[INFO] Data stream established...',
            '[INFO] Predicting next digit...',
            '[SECURITY] Encryption enabled...',
            '[INFO] Signal processing complete...',
            '[ERROR] Connection timeout. Retrying...',
            '[INFO] Compiling results...',
            '[WARNING] High frequency detected...',
        ];
        const timer = setInterval(() => {
            const randomLog = dummyLogs[Math.floor(Math.random() * dummyLogs.length)];
            setMatrixLogs(prev => [randomLog, ...prev.slice(0, 35)]);
        }, 1200);
        return () => clearInterval(timer);
    }, []);

    const calculateSignal = (_currentDigit: number, strategyKey: StrategyKey): Signal => {
        const history = tickHistoryRef.current;
        const total = history.length;
        if (total < MIN_SAMPLES) return { ok: false, message: `Need ${MIN_SAMPLES} ticks` };

        const counts = Array(10).fill(0);
        for (const t of history) counts[t.digit]++;
        const percents = counts.map(c => (c / total) * 100);
        const sortedDigits = [...Array(10).keys()].sort((a, b) => percents[a] - percents[b]);

        if (strategyKey === 'matches_differs') {
            const rareDigits = sortedDigits.filter(d => percents[d] < RARE_THRESHOLD);
            if (rareDigits.length >= 1) {
                const predicted = rareDigits[0];
                return {
                    ok: true,
                    strategy: 'Cold Digit',
                    confidence: 'HIGH',
                    predicted: `DIFFER ${predicted}`,
                    contractType: 'DIGITDIFF',
                    barrier: String(predicted),
                    prediction: predicted,
                };
            }
        }
        return { ok: false, message: 'Balanced' };
    };

    // Connect to Deriv Ticks Stream
    useEffect(() => {
        socketGenerationRef.current += 1;
        const myGen = socketGenerationRef.current;
        tickHistoryRef.current = [];
        setTicks([]);

        if (wsRef.current) {
            try { wsRef.current.close(); } catch {}
        }

        const ws = new WebSocket(WS_URL);
        wsRef.current = ws;

        ws.onopen = () => {
            if (myGen !== socketGenerationRef.current) return;
            ws.send(JSON.stringify({ ticks_history: symbol, count: 1000, end: 'latest', style: 'ticks', req_id: 1 }));
            ws.send(JSON.stringify({ ticks: symbol, subscribe: 1, req_id: 2 }));
        };

        ws.onmessage = (event) => {
            if (myGen !== socketGenerationRef.current) return;
            let data;
            try { data = JSON.parse(event.data); } catch { return; }

            if (data.msg_type === 'history' && data.history) {
                const { prices, times } = data.history;
                tickHistoryRef.current = prices.map((price: number, i: number) => ({
                    price: formatPrice(price, symbol),
                    digit: getLastDigit(price, symbol),
                    epoch: times[i],
                    time: new Date(times[i] * 1000).toLocaleTimeString(),
                }));
                setTicks([...tickHistoryRef.current]);
                return;
            }

            if (data.msg_type === 'tick' && data.tick) {
                const price = data.tick.quote;
                const epoch = data.tick.epoch;
                const digit = getLastDigit(price, symbol);
                const formattedPrice = formatPrice(price, symbol);
                const time = new Date(epoch * 1000).toLocaleTimeString();

                tickHistoryRef.current.push({ price: formattedPrice, digit, epoch, time });
                if (tickHistoryRef.current.length > HISTORY_SIZE) tickHistoryRef.current.shift();
                setTicks([...tickHistoryRef.current]);

                // Auto-trade execution when analyser is active
                if (isAnalyzing && autoTradeRef.current && authWsReadyRef.current && tickHistoryRef.current.length >= MIN_SAMPLES) {
                    const signal = calculateSignal(digit, strategyRef.current);
                    if (signal.ok && signal.contractType) {
                        const sigKey = `${signal.contractType}_${signal.barrier ?? ''}`;
                        if (sigKey !== lastSignalKeyRef.current) {
                            lastSignalKeyRef.current = sigKey;
                            placeTrade(signal);
                        }
                    }
                }
            }
        };

        return () => {
            socketGenerationRef.current += 1;
            if (ws && ws.readyState === WebSocket.OPEN) ws.close();
        };
    }, [symbol, isAnalyzing]);

    const connectAuthorized = (token: string) => {
        return new Promise<void>((resolve, reject) => {
            setAuthStatus('authorizing');
            if (authWsRef.current) {
                try { authWsRef.current.close(); } catch {}
            }
            const ws = new WebSocket(WS_AUTH_URL);
            authWsRef.current = ws;

            ws.onopen = () => ws.send(JSON.stringify({ authorize: token, req_id: 1 }));
            ws.onmessage = (event) => {
                let data;
                try { data = JSON.parse(event.data); } catch { return; }
                if (data.msg_type === 'authorize') {
                    if (data.error) {
                        setAuthStatus('error');
                        reject(new Error(data.error.message));
                        return;
                    }
                    authWsReadyRef.current = true;
                    setAuthStatus('authorized');
                    if (data.authorize?.balance) {
                        setBalance({ amount: data.authorize.balance, currency: data.authorize.currency });
                    }
                    resolve();
                }
            };
        });
    };

    const placeTrade = (signal: Signal) => {
        const ws = authWsRef.current;
        if (!ws || ws.readyState !== WebSocket.OPEN || !authWsReadyRef.current || !signal.contractType) return;

        const reqId = ++pendingReqIdRef.current;
        const newTrade: TradeRecord = {
            id: String(reqId),
            symbol: symbolRef.current,
            contractType: signal.contractType,
            stake: stakeRef.current,
            barrier: signal.barrier,
            status: 'pending',
            entryTime: Date.now(),
        };
        setTrades(prev => [newTrade, ...prev].slice(0, 30));

        ws.send(JSON.stringify({
            proposal: 1,
            amount: Number(stakeRef.current),
            basis: 'stake',
            contract_type: signal.contractType,
            currency: currencyRef.current,
            duration: Number(durationRef.current),
            duration_unit: 't',
            symbol: symbolRef.current,
            barrier: signal.barrier,
            req_id: reqId,
        }));
    };

    const latestTick = tickHistoryRef.current[tickHistoryRef.current.length - 1];

    return (
        <div className='analyzer analyzer--dark'>
            {/* Matrix Terminal Background Stream */}
            <div className='analyzer__matrix-bg'>
                {matrixLogs.map((log, idx) => (
                    <div key={idx}>{log}</div>
                ))}
            </div>

            {/* Central Quantum Signal Analyzer Container */}
            <div className='analyzer__card'>
                <div className='analyzer__title'>Quantum Signal Analyzer</div>

                <div className='analyzer__field-group'>
                    <label className='analyzer__label'>SELECT STRATEGY</label>
                    <select
                        className='analyzer__select'
                        value={strategy}
                        onChange={e => setStrategy(e.target.value as StrategyKey)}
                    >
                        {Object.entries(STRATEGIES).map(([key, label]) => (
                            <option key={key} value={key}>{label}</option>
                        ))}
                    </select>
                </div>

                <div className='analyzer__field-group'>
                    <label className='analyzer__label'>SELECT MARKET</label>
                    <select
                        className='analyzer__select'
                        value={symbol}
                        onChange={e => setSymbol(e.target.value)}
                    >
                        {Object.entries(SUPPORTED_MARKETS).map(([sym, info]) => (
                            <option key={sym} value={sym}>{info.label}</option>
                        ))}
                    </select>
                </div>

                <div className='analyzer__tick-box'>
                    <div className='analyzer__tick-item'>
                        Latest Tick: <span>{latestTick?.price ?? '--'}</span>
                    </div>
                    <div className='analyzer__tick-item'>
                        Last Digit: <span className='analyzer__highlight-digit'>{latestTick?.digit ?? '--'}</span>
                    </div>
                </div>

                <div className='analyzer__checkbox-row'>
                    <label className='analyzer__checkbox-label'>
                        <input
                            type='checkbox'
                            checked={autoTradeEnabled}
                            onChange={e => setAutoTradeEnabled(e.target.checked)}
                        />
                        Auto trade after a signal
                    </label>
                </div>

                <div className='analyzer__grid-2x2'>
                    <div>
                        <label className='analyzer__label'>Stake</label>
                        <input
                            type='number'
                            step='0.01'
                            className='analyzer__input'
                            value={stake}
                            onChange={e => setStake(e.target.value)}
                        />
                    </div>
                    <div>
                        <label className='analyzer__label'>Duration (ticks)</label>
                        <input
                            type='number'
                            className='analyzer__input'
                            value={duration}
                            onChange={e => setDuration(Number(e.target.value))}
                        />
                    </div>
                    <div>
                        <label className='analyzer__label'>Stoploss</label>
                        <input
                            type='number'
                            className='analyzer__input'
                            value={stopLoss}
                            onChange={e => setStopLoss(e.target.value)}
                        />
                    </div>
                    <div>
                        <label className='analyzer__label'>Take profit</label>
                        <input
                            type='number'
                            className='analyzer__input'
                            value={takeProfit}
                            onChange={e => setTakeProfit(e.target.value)}
                        />
                    </div>
                </div>

                <div className='analyzer__toggles-stack'>
                    <label className='analyzer__checkbox-label'>
                        <input
                            type='checkbox'
                            checked={enableMartingale}
                            onChange={e => setEnableMartingale(e.target.checked)}
                        />
                        Enable martingale on loss
                    </label>
                    <label className='analyzer__checkbox-label'>
                        <input
                            type='checkbox'
                            checked={analyseEachTrade}
                            onChange={e => setAnalyseEachTrade(e.target.checked)}
                        />
                        Analyse on each trade
                    </label>
                    <div className='analyzer__inline-input'>
                        <span>Max trades per signal</span>
                        <input
                            type='number'
                            className='analyzer__input analyzer__input--small'
                            value={maxTradesPerSignal}
                            onChange={e => setMaxTradesPerSignal(e.target.value)}
                        />
                    </div>
                    <label className='analyzer__checkbox-label'>
                        <input
                            type='checkbox'
                            checked={recoveryMode}
                            onChange={e => setRecoveryMode(e.target.checked)}
                        />
                        Recovery mode on loss
                    </label>
                </div>

                {authStatus !== 'authorized' && (
                    <div className='analyzer__auth-box'>
                        <input
                            type='password'
                            className='analyzer__input'
                            placeholder='Deriv API Token (Trade Scope)'
                            value={apiToken}
                            onChange={e => setApiToken(e.target.value)}
                        />
                        <button
                            className='analyzer__btn analyzer__btn--sub'
                            onClick={() => connectAuthorized(apiToken)}
                        >
                            {authStatus === 'authorizing' ? 'Connecting...' : 'Authorize Trading'}
                        </button>
                        {lastTradeError && <div className='analyzer__error'>{lastTradeError}</div>}
                    </div>
                )}

                {authStatus === 'authorized' && balance && (
                    <div className='analyzer__balance-info'>
                        Connected | Balance: <strong>{balance.amount.toFixed(2)} {balance.currency}</strong>
                    </div>
                )}

                <button
                    className={`analyzer__btn ${isAnalyzing ? 'analyzer__btn--stop' : ''}`}
                    onClick={() => setIsAnalyzing(prev => !prev)}
                >
                    {isAnalyzing ? 'Stop Analyzer' : 'Analyse'}
                </button>
            </div>
        </div>
    );
};

export default Analyzer;