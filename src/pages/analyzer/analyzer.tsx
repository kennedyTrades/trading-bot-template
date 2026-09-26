 import React, { useEffect, useRef, useState } from 'react';
import './analyzer.scss';

// ─────────────────────────────────────────────────────────
//  CONFIG
// ─────────────────────────────────────────────────────────
const APP_ID = '34qhZIGY0FBtndHACGXrA';
const WS_URL = `wss://api.derivws.com/trading/v1/options/ws/public?app_id=${APP_ID}`;

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

    const [soundEnabled, setSoundEnabled] = useState(true);
    const [theme, setTheme] = useState<'dark' | 'light'>('light');

    const wsRef = useRef<WebSocket | null>(null);
    const tickHistoryRef = useRef<Tick[]>([]);
    const symbolRef = useRef(symbol);
    const socketGenerationRef = useRef(0);
    const soundEnabledRef = useRef(soundEnabled);
    const audioCtxRef = useRef<AudioContext | null>(null);

    useEffect(() => { symbolRef.current = symbol; }, [symbol]);
    useEffect(() => { soundEnabledRef.current = soundEnabled; }, [soundEnabled]);

    // ─────────────────────────────────────────
    //  STRATEGY ENGINE
    // ─────────────────────────────────────────
    const calculateSignal = (currentDigit: number, strategyKey: StrategyKey): Signal => {
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
                    predicted: String(predicted),
                    entries,
                    reason: `Digit ${predicted} at ${percents[predicted].toFixed(1)}% is the rarest. DIFFER this digit. Enter on: ${entries.join(' or ')}.`,
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
                        predicted: String(predicted),
                        entries,
                        reason: `Digit ${predicted} at ${percents[predicted].toFixed(1)}% is the only rare digit. Enter on: ${entries.join(' or ')}.`,
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

            // If EVEN is under threshold (meaning ODD is over) → predict EVEN
            // If ODD is under threshold (meaning EVEN is over) → predict ODD
            if (evenPct < SIDE_THRESHOLD) {
                return {
                    ok: true,
                    strategy: 'Even & Odd',
                    confidence: evenPct < 40 ? 'HIGH' : 'MEDIUM',
                    predicted: 'EVEN',
                    entries: [],
                    reason: `Even digits appeared only ${evenPct.toFixed(1)}% — market favours EVEN. Buy EVEN contract on next tick.`,
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
            const underDigits = [0, 1, 2, 3, 4];  // 0-4
            const overDigits = [5, 6, 7, 8, 9];   // 5-9

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
    //  CONNECT TO DERIV
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
                    className='analyzer__btn'
                    onClick={handleAnalyse}
                    disabled={tickHistoryRef.current.length < MIN_SAMPLES}
                >
                    {tickHistoryRef.current.length < MIN_SAMPLES
                        ? `Collecting ticks... (${tickHistoryRef.current.length}/${MIN_SAMPLES})`
                        : 'Analyse'}
                </button>
            </div>

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