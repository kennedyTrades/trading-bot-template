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
const SIDE_THRESHOLD = 45;

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

// ─────────────────────────────────────────────────────────
//  TYPES
// ─────────────────────────────────────────────────────────
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
    // trade hints
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

// ─────────────────────────────────────────────────────────
//  HELPERS
// ─────────────────────────────────────────────────────────
const getLastDigit = (price: number, symbol: string) => {
    const decimals = SUPPORTED_MARKETS[symbol]?.decimals ?? 2;
    return Number(Number(price).toFixed(decimals).slice(-1));
};

const formatPrice = (price: number, symbol: string) => {
    const decimals = SUPPORTED_MARKETS[symbol]?.decimals ?? 2;
    return Number(price).toFixed(decimals);
};

const playBeep = (audioCtxRef: React.MutableRefObject<AudioContext | null>) => {
    try {
        if (!audioCtxRef.current) {
            const AudioCtx = window.AudioContext || (window as any).webkitAudioContext;
            if (!AudioCtx) return;
            audioCtxRef.current = new AudioCtx();
        }
        const ctx = audioCtxRef.current;
        if (ctx.state === 'suspended') ctx.resume();

        const osc = ctx.createOscillator();
        const gain = ctx.createGain();
        osc.type = 'sine';
        osc.frequency.setValueAtTime(880, ctx.currentTime);
        osc.frequency.setValueAtTime(1200, ctx.currentTime + 0.1);
        gain.gain.setValueAtTime(0.15, ctx.currentTime);
        gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.3);
        osc.connect(gain);
        gain.connect(ctx.destination);
        osc.start(ctx.currentTime);
        osc.stop(ctx.currentTime + 0.3);
    } catch (e) {
        console.warn('Beep failed:', e);
    }
};

// ─────────────────────────────────────────────────────────
//  COMPONENT
// ─────────────────────────────────────────────────────────
const Analyzer: React.FC = () => {
    const [symbol, setSymbol] = useState('1HZ100V');
    const [strategy, setStrategy] = useState<StrategyKey>('matches_differs');
    const [ticks, setTicks] = useState<Tick[]>([]);
    const [frozenSignal, setFrozenSignal] = useState<Signal | null>(null);
    const [showModal, setShowModal] = useState(false);
    const [connectionStatus, setConnectionStatus] = useState<'connecting' | 'connected' | 'error'>('connecting');
    const [authStatus, setAuthStatus] = useState<'idle' | 'authorizing' | 'authorized' | 'error'>('idle');
    const [balance, setBalance] = useState<{ amount: number; currency: string } | null>(null);

    const [soundEnabled, setSoundEnabled] = useState(true);
    const [theme, setTheme] = useState<'dark' | 'light'>('light');

    // ── Auto-trade state ──
    const [showTradePanel, setShowTradePanel] = useState(false);
    const [apiToken, setApiToken] = useState('');
    const [autoTradeEnabled, setAutoTradeEnabled] = useState(false);
    const [stake, setStake] = useState('0.35');
    const [duration, setDuration] = useState(1);
    const [durationUnit, setDurationUnit] = useState<'t' | 's' | 'm'>('t');
    const [currency, setCurrency] = useState('USD');
    const [trades, setTrades] = useState<TradeRecord[]>([]);
    const [lastTradeError, setLastTradeError] = useState<string | null>(null);

    const wsRef = useRef<WebSocket | null>(null);
    const authWsRef = useRef<WebSocket | null>(null);
    const tickHistoryRef = useRef<Tick[]>([]);
    const symbolRef = useRef(symbol);
    const socketGenerationRef = useRef(0);
    const soundEnabledRef = useRef(soundEnabled);
    const audioCtxRef = useRef<AudioContext | null>(null);

    // Refs used to avoid stale closures in WS handlers
    const autoTradeRef = useRef(autoTradeEnabled);
    const stakeRef = useRef(stake);
    const durationRef = useRef(duration);
    const durationUnitRef = useRef(durationUnit);
    const currencyRef = useRef(currency);
    const strategyRef = useRef(strategy);
    const authWsReadyRef = useRef(false);
    const pendingReqIdRef = useRef(1);
    const tradesRef = useRef<TradeRecord[]>([]);
    const lastSignalKeyRef = useRef<string>('');

    useEffect(() => { symbolRef.current = symbol; }, [symbol]);
    useEffect(() => { soundEnabledRef.current = soundEnabled; }, [soundEnabled]);
    useEffect(() => { autoTradeRef.current = autoTradeEnabled; }, [autoTradeEnabled]);
    useEffect(() => { stakeRef.current = stake; }, [stake]);
    useEffect(() => { durationRef.current = duration; }, [duration]);
    useEffect(() => { durationUnitRef.current = durationUnit; }, [durationUnit]);
    useEffect(() => { currencyRef.current = currency; }, [currency]);
    useEffect(() => { strategyRef.current = strategy; }, [strategy]);
    useEffect(() => { tradesRef.current = trades; }, [trades]);

    // ─────────────────────────────────────────
    //  STRATEGY ENGINE
    // ─────────────────────────────────────────
    const calculateSignal = (_currentDigit: number, strategyKey: StrategyKey): Signal => {
        const history = tickHistoryRef.current;
        const total = history.length;

        if (total < MIN_SAMPLES) {
            return { ok: false, message: `Need at least ${MIN_SAMPLES} ticks` };
        }

        const counts = Array(10).fill(0);
        for (const t of history) counts[t.digit]++;

        const percents = counts.map(c => (c / total) * 100);
        const sortedDigits = [...Array(10).keys()].sort((a, b) => percents[a] - percents[b]);

        // ═══════════════════════════════════════════════
        //  STRATEGY 1: MATCHES & DIFFERS
        // ═══════════════════════════════════════════════
        if (strategyKey === 'matches_differs') {
            const rareDigits = sortedDigits.filter(d => percents[d] < RARE_THRESHOLD);

            if (rareDigits.length >= 2) {
                const predicted = rareDigits[0];
                const entries = rareDigits.slice(1, 3).map(String);
                return {
                    ok: true,
                    strategy: 'Cold Digit — Matches & Differs',
                    confidence: percents[predicted] < 8.5 ? 'HIGH' : 'MEDIUM',
                    predicted: `DIFFER ${predicted}`,
                    entries,
                    reason: `Digit ${predicted} at ${percents[predicted].toFixed(1)}% is the rarest. DIFFER this digit. Enter on: ${entries.join(' or ')}.`,
                    // trade hints
                    contractType: 'DIGITDIFF',
                    barrier: String(predicted),
                    prediction: predicted,
                };
            }

            if (rareDigits.length === 1) {
                const predicted = rareDigits[0];
                const last10 = history.slice(-10).map(t => t.digit);
                const recentUnique = [...new Set(last10)].filter(d => d !== predicted);
                if (recentUnique.length > 0) {
                    const entries = recentUnique.slice(0, 2).map(String);
                    return {
                        ok: true,
                        strategy: 'Single Cold Digit',
                        confidence: percents[predicted] < 8.5 ? 'MEDIUM' : 'LOW',
                        predicted: `DIFFER ${predicted}`,
                        entries,
                        reason: `Digit ${predicted} at ${percents[predicted].toFixed(1)}% is the only rare digit. Enter on: ${entries.join(' or ')}.`,
                        contractType: 'DIGITDIFF',
                        barrier: String(predicted),
                        prediction: predicted,
                    };
                }
            }

            return {
                ok: false,
                message: `Rarest digit is ${sortedDigits[0]} at ${percents[sortedDigits[0]].toFixed(1)}% — not rare enough`,
                rarestInfo: { digit: sortedDigits[0], pct: percents[sortedDigits[0]] },
            };
        }

        // ═══════════════════════════════════════════════
        //  STRATEGY 2: EVEN & ODD
        // ═══════════════════════════════════════════════
        if (strategyKey === 'even_odd') {
            const evenDigits = [0, 2, 4, 6, 8];
            const oddDigits = [1, 3, 5, 7, 9];

            const evenCount = evenDigits.reduce((sum, d) => sum + counts[d], 0);
            const oddCount = oddDigits.reduce((sum, d) => sum + counts[d], 0);

            const evenPct = (evenCount / total) * 100;
            const oddPct = (oddCount / total) * 100;

            if (evenPct < SIDE_THRESHOLD) {
                return {
                    ok: true,
                    strategy: 'Even & Odd',
                    confidence: evenPct < 40 ? 'HIGH' : 'MEDIUM',
                    predicted: 'EVEN',
                    entries: [],
                    reason: `Even digits appeared only ${evenPct.toFixed(1)}% — market favours EVEN. Buy EVEN contract on next tick.`,
                    contractType: 'DIGITEVEN',
                };
            }

            if (oddPct < SIDE_THRESHOLD) {
                return {
                    ok: true,
                    strategy: 'Even & Odd',
                    confidence: oddPct < 40 ? 'HIGH' : 'MEDIUM',
                    predicted: 'ODD',
                    entries: [],
                    reason: `Odd digits appeared only ${oddPct.toFixed(1)}% — market favours ODD. Buy ODD contract on next tick.`,
                    contractType: 'DIGITODD',
                };
            }

            return {
                ok: false,
                message: `Even ${evenPct.toFixed(1)}% / Odd ${oddPct.toFixed(1)}% — balanced, no edge`,
                rarestInfo: { digit: 0, pct: Math.min(evenPct, oddPct) },
            };
        }

        // ═══════════════════════════════════════════════
        //  STRATEGY 3: OVER & UNDER
        // ═══════════════════════════════════════════════
        if (strategyKey === 'over_under') {
            const underDigits = [0, 1, 2, 3, 4];
            const overDigits = [5, 6, 7, 8, 9];

            const underCount = underDigits.reduce((sum, d) => sum + counts[d], 0);
            const overCount = overDigits.reduce((sum, d) => sum + counts[d], 0);

            const underPct = (underCount / total) * 100;
            const overPct = (overCount / total) * 100;

            if (underPct < SIDE_THRESHOLD) {
                return {
                    ok: true,
                    strategy: 'Over & Under',
                    confidence: underPct < 40 ? 'HIGH' : 'MEDIUM',
                    predicted: 'UNDER 5',
                    entries: [],
                    reason: `Digits 0-4 appeared only ${underPct.toFixed(1)}% — market favours UNDER. Buy UNDER 5 contract on next tick.`,
                    contractType: 'DIGITUNDER',
                    barrier: '5',
                };
            }
               if (underPct < SIDE_THRESHOLD) {
                return {
                    ok: true,
                    strategy: 'Over & Under',
                    confidence: underPct < 80 ? 'HIGH' : 'MEDIUM',
                    predicted: 'UNDER 8',
                    entries: [],
                    reason: `Digits 0-4 appeared only ${underPct.toFixed(1)}% — market favours UNDER. Buy UNDER 8 contract on next tick.`,
                    contractType: 'DIGITUNDER',
                    barrier: '8',
                };
            }

            if (overPct < SIDE_THRESHOLD) {
                return {
                    ok: true,
                    strategy: 'Over & Under',
                    confidence: overPct < 40 ? 'HIGH' : 'MEDIUM',
                    predicted: 'OVER 4',
                    entries: [],
                    reason: `Digits 5-9 appeared only ${overPct.toFixed(1)}% — market favours OVER. Buy OVER 4 contract on next tick.`,
                    contractType: 'DIGITOVER',
                    barrier: '4',
                };
            }

            return {
                ok: false,
                message: `Under ${underPct.toFixed(1)}% / Over ${overPct.toFixed(1)}% — balanced, no edge`,
                rarestInfo: { digit: 5, pct: Math.min(underPct, overPct) },
            };
        }

        return { ok: false, message: 'Unknown strategy' };
    };

    // ─────────────────────────────────────────
    //  CONNECT TO DERIV (public feed)
    // ─────────────────────────────────────────
    useEffect(() => {
        socketGenerationRef.current += 1;
        const myGeneration = socketGenerationRef.current;

        tickHistoryRef.current = [];
        setTicks([]);
        setFrozenSignal(null);
        setConnectionStatus('connecting');

        if (wsRef.current) {
            try { wsRef.current.close(); } catch (e) { /* ignore */ }
            wsRef.current = null;
        }

        const ws = new WebSocket(WS_URL);
        wsRef.current = ws;

        ws.onopen = () => {
            if (myGeneration !== socketGenerationRef.current) return;
            setConnectionStatus('connected');

            ws.send(JSON.stringify({
                ticks_history: symbol,
                adjust_start_time: 1,
                count: 1000,
                end: 'latest',
                start: 1,
                style: 'ticks',
                req_id: 1,
            }));

            ws.send(JSON.stringify({
                ticks: symbol,
                subscribe: 1,
                req_id: 2,
            }));
        };

        ws.onmessage = (event) => {
            if (myGeneration !== socketGenerationRef.current) return;

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
                if (data.tick.symbol && data.tick.symbol !== symbolRef.current) return;

                const price = data.tick.quote;
                const epoch = data.tick.epoch;
                const digit = getLastDigit(price, symbolRef.current);
                const formattedPrice = formatPrice(price, symbolRef.current);
                const time = new Date(epoch * 1000).toLocaleTimeString();

                tickHistoryRef.current.push({ price: formattedPrice, digit, epoch, time });
                if (tickHistoryRef.current.length > HISTORY_SIZE) {
                    tickHistoryRef.current.shift();
                }
                setTicks([...tickHistoryRef.current]);

                // ═══ AUTO-TRADE TRIGGER ═══
                if (autoTradeRef.current && authWsReadyRef.current && tickHistoryRef.current.length >= MIN_SAMPLES) {
                    const signal = calculateSignal(digit, strategyRef.current);
                    if (signal.ok && signal.contractType) {
                        const sigKey = `${signal.contractType}_${signal.barrier ?? ''}_${signal.prediction ?? ''}`;
                        if (sigKey !== lastSignalKeyRef.current) {
                            lastSignalKeyRef.current = sigKey;
                            placeTrade(signal);
                        }
                    } else if (!signal.ok) {
                        // reset key so a future valid signal can fire
                        lastSignalKeyRef.current = '';
                    }
                }
            }
        };

        ws.onerror = () => {
            if (myGeneration !== socketGenerationRef.current) return;
            setConnectionStatus('error');
        };

        ws.onclose = () => {
            if (myGeneration !== socketGenerationRef.current) return;
        };

        return () => {
            socketGenerationRef.current += 1;
            if (ws && ws.readyState === WebSocket.OPEN) ws.close();
        };
    }, [symbol]);

    // ─────────────────────────────────────────
    //  AUTHORIZED WS (for trading)
    // ─────────────────────────────────────────
    const connectAuthorized = (token: string) => {
        return new Promise<void>((resolve, reject) => {
            setAuthStatus('authorizing');
            setLastTradeError(null);

            if (authWsRef.current) {
                try { authWsRef.current.close(); } catch { /* ignore */ }
                authWsRef.current = null;
            }
            authWsReadyRef.current = false;

            const ws = new WebSocket(WS_AUTH_URL);
            authWsRef.current = ws;
            const timeout = setTimeout(() => {
                try { ws.close(); } catch { /* ignore */ }
                setAuthStatus('error');
                reject(new Error('Authorization timed out'));
            }, 15000);

            ws.onopen = () => {
                ws.send(JSON.stringify({ authorize: token, req_id: 1 }));
            };

            ws.onmessage = (event) => {
                let data;
                try { data = JSON.parse(event.data); } catch { return; }

                // Authorize response
                if (data.msg_type === 'authorize') {
                    clearTimeout(timeout);
                    if (data.error) {
                        setAuthStatus('error');
                        setLastTradeError(data.error.message || 'Authorization failed');
                        reject(new Error(data.error.message || 'Authorization failed'));
                        return;
                    }
                    authWsReadyRef.current = true;
                    setAuthStatus('authorized');
                    const bal = data.authorize?.balance;
                    if (bal) setBalance({ amount: bal, currency: data.authorize.currency });
                    resolve();
                    return;
                }

                // Balance updates
                if (data.msg_type === 'balance' && data.balance) {
                    setBalance({ amount: data.balance.balance, currency: data.balance.currency });
                    return;
                }

                // Proposal → buy
                if (data.msg_type === 'proposal' && data.proposal) {
                    const proposalId = data.proposal.id;
                    const askPrice = data.proposal.ask_price;
                    const payout = data.proposal.payout;
                    const reqId = data.echo_req?.req_id;
                    if (reqId) {
                        const trade = tradesRef.current.find(t => t.id === String(reqId));
                        if (trade) {
                            trade.buyPrice = askPrice;
                            trade.payout = payout;
                        }
                    }
                    // send buy
                    const buyReqId = ++pendingReqIdRef.current;
                    ws.send(JSON.stringify({
                        buy: proposalId,
                        price: askPrice,
                        req_id: buyReqId,
                    }));
                    return;
                }

                // Buy response
                if (data.msg_type === 'buy') {
                    const reqId = data.echo_req?.req_id;
                    if (data.error) {
                        setLastTradeError(data.error.message || 'Buy failed');
                        if (reqId) updateTradeByReqId(reqId, { status: 'error', error: data.error.message });
                        return;
                    }
                    const contractId = data.buy?.contract_id;
                    const buyPrice = data.buy?.buy_price;
                    // find pending trade via req_id
                    if (reqId) {
                        updateTradeByReqId(reqId, {
                            status: 'open',
                            contractId,
                            buyPrice,
                        });
                    }
                    // Subscribe to contract updates
                    if (contractId) {
                        ws.send(JSON.stringify({
                            proposal_open_contract: 1,
                            contract_id: contractId,
                            subscribe: 1,
                            req_id: ++pendingReqIdRef.current,
                        }));
                    }
                    return;
                }

                // Proposal open contract updates
                if (data.msg_type === 'proposal_open_contract' && data.proposal_open_contract) {
                    const c = data.proposal_open_contract;
                    const contractId = c.contract_id;
                    const status = c.status; // 'open' | 'won' | 'lost'
                    const profit = c.profit;
                    const entrySpot = c.entry_spot;
                    if (contractId) {
                        updateTradeByContractId(contractId, {
                            status: status === 'open' ? 'open' : status === 'won' ? 'won' : 'lost',
                            profit,
                            entrySpot,
                            entryTime: c.entry_tick_time ? c.entry_tick_time * 1000 : Date.now(),
                        });
                    }
                    return;
                }
            };

            ws.onerror = () => {
                clearTimeout(timeout);
                setAuthStatus('error');
                reject(new Error('WebSocket error'));
            };

            ws.onclose = () => {
                authWsReadyRef.current = false;
            };
        });
    };

    const updateTradeByReqId = (reqId: number, patch: Partial<TradeRecord>) => {
        setTrades(prev => prev.map(t => t.id === String(reqId) ? { ...t, ...patch } : t));
    };

    const updateTradeByContractId = (contractId: number, patch: Partial<TradeRecord>) => {
        setTrades(prev => prev.map(t => t.contractId === contractId ? { ...t, ...patch } : t));
    };

    // ─────────────────────────────────────────
    //  PLACE TRADE
    // ─────────────────────────────────────────
    const placeTrade = (signal: Signal) => {
        const ws = authWsRef.current;
        if (!ws || ws.readyState !== WebSocket.OPEN || !authWsReadyRef.current) {
            setLastTradeError('Not authorized for trading');
            return;
        }
        if (!signal.contractType) return;

        const reqId = ++pendingReqIdRef.current;
        const newTrade: TradeRecord = {
            id: String(reqId),
            symbol: symbolRef.current,
            contractType: signal.contractType,
            stake: stakeRef.current,
            barrier: signal.barrier,
            prediction: signal.prediction,
            status: 'pending',
            entryTime: Date.now(),
        };

        setTrades(prev => [newTrade, ...prev].slice(0, 50));
        setLastTradeError(null);

        const proposalReq: any = {
            proposal: 1,
            amount: Number(stakeRef.current),
            basis: 'stake',
            contract_type: signal.contractType,
            currency: currencyRef.current,
            duration: Number(durationRef.current),
            duration_unit: durationUnitRef.current,
            symbol: symbolRef.current,
            req_id: reqId,
        };
        if (signal.barrier !== undefined) {
            proposalReq.barrier = signal.barrier;
        }

        ws.send(JSON.stringify(proposalReq));
    };

    // ─────────────────────────────────────────
    //  DERIVED DATA
    // ─────────────────────────────────────────
    const subset = ticks.slice(-1000);
    const counts = Array(10).fill(0);
    subset.forEach(t => counts[t.digit]++);
    const total = subset.length;
    const maxCount = total > 0 ? Math.max(...counts) : 0;
    const minCount = total > 0 ? Math.min(...counts) : 0;
    const last10 = ticks.slice(-10);
    const latestTick = ticks[ticks.length - 1];

    // ─────────────────────────────────────────
    //  HANDLERS
    // ─────────────────────────────────────────
    const handleAnalyse = () => {
        if (tickHistoryRef.current.length < MIN_SAMPLES) return;

        const currentDigit = tickHistoryRef.current[tickHistoryRef.current.length - 1].digit;
        const signal = calculateSignal(currentDigit, strategy);

        setFrozenSignal({ ...signal });

        if (signal.ok && soundEnabledRef.current) {
            playBeep(audioCtxRef);
        }

        setShowModal(true);
    };

    const closeModal = () => setShowModal(false);
    const toggleSound = () => setSoundEnabled(prev => !prev);
    const toggleTheme = () => setTheme(prev => (prev === 'dark' ? 'light' : 'dark'));

    const handleAuthorize = async () => {
        if (!apiToken.trim()) {
            setLastTradeError('Please enter an API token');
            return;
        }
        try {
            localStorage.setItem('deriv_api_token', apiToken.trim());
            await connectAuthorized(apiToken.trim());
        } catch (e: any) {
            setLastTradeError(e.message || 'Authorization failed');
        }
    };

    const handleLogout = () => {
        if (authWsRef.current) {
            try { authWsRef.current.close(); } catch { /* ignore */ }
            authWsRef.current = null;
        }
        authWsReadyRef.current = false;
        setAuthStatus('idle');
        setBalance(null);
        setAutoTradeEnabled(false);
        localStorage.removeItem('deriv_api_token');
    };

    // Auto-restore token on mount
    useEffect(() => {
        const saved = localStorage.getItem('deriv_api_token');
        if (saved) {
            setApiToken(saved);
        }
    }, []);

    // ─────────────────────────────────────────
    //  RENDER
    // ─────────────────────────────────────────
    return (
        <div className={`analyzer analyzer--${theme}`}>
            <div className='analyzer__header'>
                <div>
                    <div className='analyzer__title'>Optimus Trades Scanner</div>
                    <div className='analyzer__subtitle'>Live digit analysis and signal detection</div>
                </div>
                <div className='analyzer__header-right'>
                    <div className='analyzer__theme-toggle' onClick={toggleTheme} title='Toggle theme'>
                        {theme === 'dark' ? '☀️' : '🌙'}
                    </div>
                    <div className={`analyzer__status analyzer__status--${connectionStatus}`}>
                        <span className='analyzer__status-dot' />
                        {connectionStatus === 'connected' ? 'Connected' :
                         connectionStatus === 'connecting' ? 'Connecting...' : 'Error'}
                    </div>
                </div>
            </div>

            <div className='analyzer__market-row'>
                <label className='analyzer__label'>Select Market</label>
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

            <div className='analyzer__market-row'>
                <label className='analyzer__label'>Select Strategy</label>
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

            <div className='analyzer__live-row'>
                <div className='analyzer__live-item'>
                    <span className='analyzer__live-label'>Latest Tick:</span>
                    <span className='analyzer__live-value'>{latestTick?.price ?? '--'}</span>
                </div>
                <div className='analyzer__live-item'>
                    <span className='analyzer__live-label'>Last Digit:</span>
                    <span className='analyzer__live-value'>{latestTick?.digit ?? '--'}</span>
                </div>
            </div>

            <div className='analyzer__section'>
                <div className='analyzer__section-title'>
                    Digit distribution (last {total} ticks)
                </div>
                <div className='analyzer__digit-grid'>
                    {Array.from({ length: 10 }).map((_, d) => {
                        const pct = total > 0 ? (counts[d] / total) * 100 : 0;
                        const isHighest = total >= 30 && counts[d] === maxCount && maxCount > 0;
                        const isLowest = total >= 30 && counts[d] === minCount;
                        return (
                            <div
                                key={d}
                                className={`analyzer__digit-cell ${
                                    isHighest ? 'analyzer__digit-cell--highest' :
                                    isLowest ? 'analyzer__digit-cell--lowest' : ''
                                }`}
                            >
                                <div className='analyzer__digit-num'>{d}</div>
                                <div className='analyzer__digit-pct'>{pct.toFixed(1)}%</div>
                            </div>
                        );
                    })}
                </div>
            </div>

            <div className='analyzer__section'>
                <div className='analyzer__section-title'>Last 10 digits</div>
                <div className='analyzer__last-digits'>
                    {last10.map((t, i) => (
                        <div
                            key={`${t.epoch}-${i}`}
                            className={`analyzer__chip ${i === last10.length - 1 ? 'analyzer__chip--newest' : ''}`}
                        >
                            {t.digit}
                        </div>
                    ))}
                </div>
            </div>

            <div className='analyzer__actions'>
                <button
                    className={`analyzer__sound-btn ${soundEnabled ? 'analyzer__sound-btn--on' : ''}`}
                    onClick={toggleSound}
                >
                    {soundEnabled ? '🔊' : '🔇'} Sound: {soundEnabled ? 'ON' : 'OFF'}
                </button>

                <button
                    className={`analyzer__sound-btn ${showTradePanel ? 'analyzer__sound-btn--on' : ''}`}
                    onClick={() => setShowTradePanel(v => !v)}
                >
                    {showTradePanel ? '▼' : '▶'} Auto-Trade
                </button>

                <button
                    className='analyzer__btn'
                    onClick={handleAnalyse}
                    disabled={tickHistoryRef.current.length < MIN_SAMPLES}
                >
                    {tickHistoryRef.current.length < MIN_SAMPLES
                        ? `Collecting ticks... (${tickHistoryRef.current.length}/${MIN_SAMPLES})`
                        : 'Analyse'}
                </button>
            </div>

            {/* ─── Auto-Trade Panel ─── */}
            {showTradePanel && (
                <div className='analyzer__trade-panel'>
                    <div className='analyzer__trade-header'>
                        <span>🤖 Automated Trading</span>
                        {balance && (
                            <span className='analyzer__balance'>
                                Balance: {balance.amount.toFixed(2)} {balance.currency}
                            </span>
                        )}
                    </div>

                    {authStatus !== 'authorized' ? (
                        <div className='analyzer__trade-auth'>
                            <label className='analyzer__label'>Deriv API Token (Trade scope)</label>
                            <input
                                type='password'
                                className='analyzer__input'
                                value={apiToken}
                                onChange={e => setApiToken(e.target.value)}
                                placeholder='Paste your API token'
                                autoComplete='off'
                            />
                            <div className='analyzer__trade-hint'>
                                Generate at{' '}
                                <a href='https://app.deriv.com/account/api-token' target='_blank' rel='noreferrer'>
                                    app.deriv.com/account/api-token
                                </a>{' '}
                                with <strong>Read</strong> + <strong>Trade</strong> scopes.
                            </div>
                            <button
                                className='analyzer__btn'
                                onClick={handleAuthorize}
                                disabled={authStatus === 'authorizing'}
                            >
                                {authStatus === 'authorizing' ? 'Authorizing…' : 'Connect & Authorize'}
                            </button>
                            {lastTradeError && (
                                <div className='analyzer__trade-error'>{lastTradeError}</div>
                            )}
                        </div>
                    ) : (
                        <>
                            <div className='analyzer__trade-row'>
                                <span className='analyzer__trade-badge analyzer__trade-badge--ok'>
                                    ✅ Authorized
                                </span>
                                <button className='analyzer__trade-link' onClick={handleLogout}>
                                    Disconnect
                                </button>
                            </div>

                            <div className='analyzer__trade-grid'>
                                <div>
                                    <label className='analyzer__label'>Stake ({currency})</label>
                                    <input
                                        type='number'
                                        min='0.35'
                                        step='0.01'
                                        className='analyzer__input'
                                        value={stake}
                                        onChange={e => setStake(e.target.value)}
                                    />
                                </div>
                                <div>
                                    <label className='analyzer__label'>Duration</label>
                                    <input
                                        type='number'
                                        min='1'
                                        className='analyzer__input'
                                        value={duration}
                                        onChange={e => setDuration(Number(e.target.value))}
                                    />
                                </div>
                                <div>
                                    <label className='analyzer__label'>Unit</label>
                                    <select
                                        className='analyzer__input'
                                        value={durationUnit}
                                        onChange={e => setDurationUnit(e.target.value as any)}
                                    >
                                        <option value='t'>Ticks</option>
                                        <option value='s'>Seconds</option>
                                        <option value='m'>Minutes</option>
                                    </select>
                                </div>
                                <div>
                                    <label className='analyzer__label'>Currency</label>
                                    <select
                                        className='analyzer__input'
                                        value={currency}
                                        onChange={e => setCurrency(e.target.value)}
                                    >
                                        <option value='USD'>USD</option>
                                        <option value='EUR'>EUR</option>
                                        <option value='GBP'>GBP</option>
                                        <option value='AUD'>AUD</option>
                                    </select>
                                </div>
                            </div>

                            <label className='analyzer__trade-toggle'>
                                <input
                                    type='checkbox'
                                    checked={autoTradeEnabled}
                                    onChange={e => {
                                        setAutoTradeEnabled(e.target.checked);
                                        if (e.target.checked) lastSignalKeyRef.current = '';
                                    }}
                                />
                                <span>
                                    <strong>Enable Auto-Trade</strong> — will place a contract the moment a
                                    qualifying signal appears
                                </span>
                            </label>

                            <div className='analyzer__trade-hint'>
                                ⚠️ Uses <strong>real funds</strong> when connected to a live account. Test on a
                                Demo token first. Auto-trade fires once per unique signal state.
                            </div>

                            {lastTradeError && (
                                <div className='analyzer__trade-error'>{lastTradeError}</div>
                            )}
                        </>
                    )}

                    {trades.length > 0 && (
                        <div className='analyzer__trade-log'>
                            <div className='analyzer__trade-log-title'>Trade Log</div>
                            <div className='analyzer__trade-log-body'>
                                {trades.map(t => (
                                    <div key={t.id} className='analyzer__trade-log-item'>
                                        <span className='analyzer__trade-log-type'>{t.contractType}</span>
                                        {t.barrier !== undefined && (
                                            <span className='analyzer__trade-log-barrier'>[{t.barrier}]</span>
                                        )}
                                        <span className='analyzer__trade-log-stake'>{t.stake} {currency}</span>
                                        <span className={`analyzer__trade-log-status analyzer__trade-log-status--${t.status}`}>
                                            {t.status}
                                            {t.profit !== undefined && t.status !== 'open' && t.status !== 'pending'
                                                ? ` (${t.profit >= 0 ? '+' : ''}${t.profit.toFixed(2)})`
                                                : ''}
                                        </span>
                                    </div>
                                ))}
                            </div>
                        </div>
                    )}
                </div>
            )}

            {showModal && frozenSignal && (
                <div className='analyzer__modal-overlay' onClick={closeModal}>
                    <div className='analyzer__modal' onClick={e => e.stopPropagation()}>
                        <button className='analyzer__modal-close' onClick={closeModal}>×</button>
                        <div className='analyzer__modal-title'>
                            Scanner — {SUPPORTED_MARKETS[symbol]?.label}
                        </div>
                        <div className='analyzer__modal-strategy'>
                            Strategy: {STRATEGIES[strategy]}
                        </div>

                        {frozenSignal.ok ? (
                            <>
                                <div className='analyzer__modal-status'>
                                    Analysis Complete! {frozenSignal.confidence === 'HIGH' ? '🟢' :
                                                        frozenSignal.confidence === 'MEDIUM' ? '🟡' : '🔴'}{' '}
                                    {frozenSignal.confidence} confidence
                                </div>
                                <div className='analyzer__modal-action'>
                                    Market will {frozenSignal.predicted}
                                </div>

                                {frozenSignal.entries && frozenSignal.entries.length > 0 && (
                                    <div className='analyzer__modal-entry'>
                                        Entry Point: Enter when the last digit is{' '}
                                        <strong>{frozenSignal.entries.join(' or ')}</strong>
                                    </div>
                                )}

                                <div className='analyzer__modal-detail'>
                                    <em>{frozenSignal.strategy}</em>
                                    <br />
                                    {frozenSignal.reason}
                                </div>

                                <div className='analyzer__modal-running'>
                                    Signal captured — click Analyse again for a fresh scan
                                </div>
                            </>
                        ) : (
                            <>
                                <div className='analyzer__modal-status analyzer__modal-status--warn'>
                                    No strong signal detected.
                                </div>
                                <div className='analyzer__modal-action'>Market is currently balanced</div>
                                <div className='analyzer__modal-entry'>
                                    {frozenSignal?.rarestInfo
                                        ? `Rarest digit is only ${frozenSignal.rarestInfo.pct.toFixed(1)}% — not enough edge`
                                        : (frozenSignal?.message || 'Waiting for better setup')}
                                </div>
                                <div className='analyzer__modal-running analyzer__modal-running--warn'>
                                    Recommend waiting for a better setup
                                </div>
                            </>
                        )}
                    </div>
                </div>
            )}
        </div>
    );
};

export default Analyzer;