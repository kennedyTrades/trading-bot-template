 import React, { useEffect, useRef, useState, useCallback } from 'react';
import './analyzer.scss';

// ─────────────────────────────────────────────────────────
//  CONFIG
// ─────────────────────────────────────────────────────────
const APP_ID = '34qhZIGY0FBtndHACGXrA';
const WS_URL = `wss://api.derivws.com/trading/v1/options/ws/public?app_id=${APP_ID}`;

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
    predicted?: number;
    entries?: number[];
    reason?: string;
    message?: string;
    rarestInfo?: { digit: number; pct: number };
    result?: 'WIN' | 'LOSS' | null;
    resultDigit?: number | null;
    firedAtIndex?: number;
}

interface Stats {
    totalSignals: number;
    wins: number;
    losses: number;
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

// ─────────────────────────────────────────────────────────
//  BEEP (single beep)
// ─────────────────────────────────────────────────────────
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
    const [ticks, setTicks] = useState<Tick[]>([]);
    const [frozenSignal, setFrozenSignal] = useState<Signal | null>(null);
    const [showModal, setShowModal] = useState(false);
    const [connectionStatus, setConnectionStatus] = useState<'connecting' | 'connected' | 'error'>('connecting');

    const [soundEnabled, setSoundEnabled] = useState(true);
    const [theme, setTheme] = useState<'dark' | 'light'>('light');  // ← default LIGHT

    // Refs
    const wsRef = useRef<WebSocket | null>(null);
    const tickHistoryRef = useRef<Tick[]>([]);
    const symbolRef = useRef(symbol);
    const socketGenerationRef = useRef(0);
    const soundEnabledRef = useRef(soundEnabled);
    const audioCtxRef = useRef<AudioContext | null>(null);

    useEffect(() => { symbolRef.current = symbol; }, [symbol]);
    useEffect(() => { soundEnabledRef.current = soundEnabled; }, [soundEnabled]);

    // ─────────────────────────────────────────
    //  3-STRATEGY ENGINE — returns a signal, does NOT set state
    // ─────────────────────────────────────────
    const calculateSignal = (currentDigit: number): Signal => {
        const history = tickHistoryRef.current;
        const total = history.length;

        if (total < MIN_SAMPLES) {
            return { ok: false, message: `Need at least ${MIN_SAMPLES} ticks` };
        }

        const counts = Array(10).fill(0);
        for (const t of history) counts[t.digit]++;

        const percents = counts.map(c => (c / total) * 100);
        const sortedDigits = [...Array(10).keys()].sort((a, b) => percents[a] - percents[b]);
        const rareDigits = sortedDigits.filter(d => percents[d] < RARE_THRESHOLD);

        const last50 = history.slice(-50).map(t => t.digit);
        const recentCounts = Array(10).fill(0);
        last50.forEach(d => recentCounts[d]++);

        // Strategy 1
        if (rareDigits.length >= 2) {
            const predicted = rareDigits[0];
            const entries = rareDigits.slice(1, 3);
            if (entries.length > 0) {
                return {
                    ok: true,
                    strategy: 'Cold Digit Under 9.2%',
                    confidence: percents[predicted] < 8.5 ? 'HIGH' : 'MEDIUM',
                    predicted,
                    entries,
                    reason: `Digit ${predicted} at ${percents[predicted].toFixed(1)}% is the rarest`,
                };
            }
        }

        // Strategy 2
        if (rareDigits.length === 1) {
            const predicted = rareDigits[0];
            const last10 = history.slice(-10).map(t => t.digit);
            const recentUnique = [...new Set(last10)].filter(d => d !== predicted);
            if (recentUnique.length > 0) {
                const entries = recentUnique.slice(0, 2);
                return {
                    ok: true,
                    strategy: 'Single Cold Digit + Recent Entry',
                    confidence: percents[predicted] < 8.5 ? 'MEDIUM' : 'LOW',
                    predicted,
                    entries,
                    reason: `Digit ${predicted} at ${percents[predicted].toFixed(1)}% is the only rare digit`,
                };
            }
        }

        // Strategy 3
        const last30 = history.slice(-30).map(t => t.digit);
        const inLast30 = new Set(last30);
        const droughtDigits = [...Array(10).keys()].filter(d => !inLast30.has(d));
        if (droughtDigits.length > 0 && recentCounts[currentDigit] >= 2) {
            const predicted = droughtDigits[0];
            const entries = [currentDigit];
            return {
                ok: true,
                strategy: 'Recent Drought',
                confidence: 'LOW',
                predicted,
                entries,
                reason: `Digit ${predicted} hasn't appeared in 30 ticks`,
            };
        }

        return {
            ok: false,
            message: `Rarest digit is ${sortedDigits[0]} at ${percents[sortedDigits[0]].toFixed(1)}% — not rare enough`,
            rarestInfo: { digit: sortedDigits[0], pct: percents[sortedDigits[0]] },
        };
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
        const signal = calculateSignal(currentDigit);

        // Freeze the signal — do NOT update until next Analyse click
        setFrozenSignal({ ...signal, result: null, resultDigit: null });

        // 🔊 Beep ONCE, only if a real signal fired
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
                    <div
                        className='analyzer__theme-toggle'
                        onClick={toggleTheme}
                        title='Toggle theme'
                        role='button'
                        tabIndex={0}
                    >
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
                <label className='analyzer__label'>Market</label>
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
                    title={soundEnabled ? 'Sound alerts ON' : 'Sound alerts OFF'}
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
                            Scanner Dashboard — {SUPPORTED_MARKETS[symbol]?.label}
                        </div>

                        {frozenSignal.ok ? (
                            <>
                                <div className='analyzer__modal-status'>
                                    Analysis Complete! {frozenSignal.confidence === 'HIGH' ? '🟢' :
                                                        frozenSignal.confidence === 'MEDIUM' ? '🟡' : '🔴'}{' '}
                                    {frozenSignal.confidence} confidence
                                </div>
                                <div className='analyzer__modal-action'>
                                    Market will DIFFER {frozenSignal.predicted}
                                </div>
                                <div className='analyzer__modal-entry'>
                                    Entry Point: Enter when the last digit is{' '}
                                    <strong>{frozenSignal.entries?.join(' or ')}</strong>
                                    <div className='analyzer__modal-detail'>
                                        <em>Strategy: {frozenSignal.strategy}</em>
                                        <br />
                                        {frozenSignal.reason}
                                    </div>
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
                                        ? `Rarest digit ${frozenSignal.rarestInfo.digit} is only ${frozenSignal.rarestInfo.pct.toFixed(1)}% — not rare enough`
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