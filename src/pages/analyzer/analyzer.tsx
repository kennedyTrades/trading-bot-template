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
//  COMPONENT
// ─────────────────────────────────────────────────────────
const Analyzer: React.FC = () => {
    const [symbol, setSymbol] = useState('1HZ100V');
    const [ticks, setTicks] = useState<Tick[]>([]);
    const [latestSignal, setLatestSignal] = useState<Signal | null>(null);
    const [stats, setStats] = useState<Stats>({ totalSignals: 0, wins: 0, losses: 0 });
    const [showModal, setShowModal] = useState(false);
    const [connectionStatus, setConnectionStatus] = useState<'connecting' | 'connected' | 'error'>('connecting');

    // Refs (avoid re-renders)
    const wsRef = useRef<WebSocket | null>(null);
    const tickHistoryRef = useRef<Tick[]>([]);
    const pendingSignalRef = useRef<{ digit: number; firedAtIndex: number } | null>(null);
    const statsRef = useRef<Stats>({ totalSignals: 0, wins: 0, losses: 0 });
    const lastSignalRef = useRef<Signal | null>(null);
    const symbolRef = useRef(symbol);
    const socketGenerationRef = useRef(0);

    // Keep symbolRef in sync
    useEffect(() => {
        symbolRef.current = symbol;
    }, [symbol]);

    // ─────────────────────────────────────────
    //  3-STRATEGY ENGINE (ported from index.js)
    // ─────────────────────────────────────────
    const fireSignal = useCallback((opts: {
        strategy: string;
        confidence: string;
        predicted: number;
        entries: number[];
        percents: number[];
        reason: string;
    }) => {
        const currentSymbol = symbolRef.current;
        const signal: Signal = {
            ok: true,
            strategy: opts.strategy,
            confidence: opts.confidence,
            predicted: opts.predicted,
            entries: opts.entries,
            reason: opts.reason,
            result: null,
            resultDigit: null,
            firedAtIndex: tickHistoryRef.current.length,
        };
        lastSignalRef.current = signal;
        setLatestSignal({ ...signal });

        if (!pendingSignalRef.current) {
            pendingSignalRef.current = {
                digit: opts.predicted,
                firedAtIndex: tickHistoryRef.current.length,
            };
            console.log(
                `🔮 SIGNAL [${opts.confidence}] via "${opts.strategy}" | DIFFER ${opts.predicted}, Entry: ${opts.entries.join(' or ')}`
            );
        }
    }, []);

    const evaluateStrategies = useCallback((currentDigit: number) => {
        const history = tickHistoryRef.current;
        const total = history.length;

        if (total < MIN_SAMPLES) {
            lastSignalRef.current = {
                ok: false,
                message: `Need at least ${MIN_SAMPLES} ticks`,
            };
            setLatestSignal({ ...lastSignalRef.current });
            return;
        }

        const counts = Array(10).fill(0);
        for (const t of history) counts[t.digit]++;

        const percents = counts.map(c => (c / total) * 100);
        const sortedDigits = [...Array(10).keys()].sort((a, b) => percents[a] - percents[b]);
        const rareDigits = sortedDigits.filter(d => percents[d] < RARE_THRESHOLD);

        const last50 = history.slice(-50).map(t => t.digit);
        const recentCounts = Array(10).fill(0);
        last50.forEach(d => recentCounts[d]++);

        // Strategy 1: Cold Digit Under 9.2%
        if (rareDigits.length >= 2) {
            const predicted = rareDigits[0];
            const entries = rareDigits.slice(1, 3);
            if (entries.length > 0) {
                return fireSignal({
                    strategy: 'Cold Digit Under 9.2%',
                    confidence: percents[predicted] < 8.5 ? 'HIGH' : 'MEDIUM',
                    predicted,
                    entries,
                    percents,
                    reason: `Digit ${predicted} at ${percents[predicted].toFixed(1)}% is the rarest`,
                });
            }
        }

        // Strategy 2: Single Cold Digit + Recent Entry
        if (rareDigits.length === 1) {
            const predicted = rareDigits[0];
            const last10 = history.slice(-10).map(t => t.digit);
            const recentUnique = [...new Set(last10)].filter(d => d !== predicted);
            if (recentUnique.length > 0) {
                const entries = recentUnique.slice(0, 2);
                return fireSignal({
                    strategy: 'Single Cold Digit + Recent Entry',
                    confidence: percents[predicted] < 8.5 ? 'MEDIUM' : 'LOW',
                    predicted,
                    entries,
                    percents,
                    reason: `Digit ${predicted} at ${percents[predicted].toFixed(1)}% is the only rare digit`,
                });
            }
        }

        // Strategy 3: Recent Drought
        const last30 = history.slice(-30).map(t => t.digit);
        const inLast30 = new Set(last30);
        const droughtDigits = [...Array(10).keys()].filter(d => !inLast30.has(d));
        if (droughtDigits.length > 0 && recentCounts[currentDigit] >= 2) {
            const predicted = droughtDigits[0];
            const entries = [currentDigit];
            return fireSignal({
                strategy: 'Recent Drought',
                confidence: 'LOW',
                predicted,
                entries,
                percents,
                reason: `Digit ${predicted} hasn't appeared in 30 ticks`,
            });
        }

        // No strategy matched
        lastSignalRef.current = {
            ok: false,
            message: `Rarest digit is ${sortedDigits[0]} at ${percents[sortedDigits[0]].toFixed(1)}% — not rare enough`,
            rarestInfo: { digit: sortedDigits[0], pct: percents[sortedDigits[0]] },
        };
        setLatestSignal({ ...lastSignalRef.current });
    }, [fireSignal]);

    // ─────────────────────────────────────────
    //  PROCESS LIVE TICK (ported from index.js)
    // ─────────────────────────────────────────
    const processTick = useCallback((price: number, epoch: number) => {
        const currentSymbol = symbolRef.current;
        const digit = getLastDigit(price, currentSymbol);
        const formattedPrice = formatPrice(price, currentSymbol);
        const time = new Date(epoch * 1000).toLocaleTimeString();

        // Evaluate pending signal
        if (pendingSignalRef.current) {
            const won = digit !== pendingSignalRef.current.digit;
            statsRef.current = {
                totalSignals: statsRef.current.totalSignals + 1,
                wins: statsRef.current.wins + (won ? 1 : 0),
                losses: statsRef.current.losses + (won ? 0 : 1),
            };
            setStats({ ...statsRef.current });

            if (lastSignalRef.current && lastSignalRef.current.firedAtIndex === pendingSignalRef.current.firedAtIndex) {
                lastSignalRef.current.result = won ? 'WIN' : 'LOSS';
                lastSignalRef.current.resultDigit = digit;
                setLatestSignal({ ...lastSignalRef.current });
            }
            pendingSignalRef.current = null;
        }

        const newTick: Tick = { price: formattedPrice, digit, epoch, time };
        tickHistoryRef.current.push(newTick);
        if (tickHistoryRef.current.length > HISTORY_SIZE) {
            tickHistoryRef.current.shift();
        }

        setTicks([...tickHistoryRef.current]);

        // Evaluate strategies on every tick
        if (tickHistoryRef.current.length >= MIN_SAMPLES) {
            evaluateStrategies(digit);
        }
    }, [evaluateStrategies]);

    // ─────────────────────────────────────────
    //  CONNECT TO DERIV (runs when symbol changes)
    // ─────────────────────────────────────────
    useEffect(() => {
        socketGenerationRef.current += 1;
        const myGeneration = socketGenerationRef.current;

        // Reset state for new market
        tickHistoryRef.current = [];
        pendingSignalRef.current = null;
        lastSignalRef.current = null;
        statsRef.current = { totalSignals: 0, wins: 0, losses: 0 };
        setTicks([]);
        setLatestSignal(null);
        setStats({ totalSignals: 0, wins: 0, losses: 0 });
        setConnectionStatus('connecting');

        // Close old socket
        if (wsRef.current) {
            try { wsRef.current.close(); } catch (e) { /* ignore */ }
            wsRef.current = null;
        }

        // Open new socket
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

            // History response
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

            // Live tick
            if (data.msg_type === 'tick' && data.tick) {
                if (data.tick.symbol && data.tick.symbol !== symbolRef.current) return;
                processTick(data.tick.quote, data.tick.epoch);
            }
        };

        ws.onerror = () => {
            if (myGeneration !== socketGenerationRef.current) return;
            setConnectionStatus('error');
        };

        ws.onclose = () => {
            if (myGeneration !== socketGenerationRef.current) return;
            console.log(`Disconnected from ${symbol}`);
        };

        return () => {
            socketGenerationRef.current += 1;
            if (ws && ws.readyState === WebSocket.OPEN) {
                ws.close();
            }
        };
    }, [symbol, processTick]);

    // ─────────────────────────────────────────
    //  DERIVED DATA FOR RENDERING
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
        // Ensure we have a signal
        if (tickHistoryRef.current.length >= MIN_SAMPLES) {
            evaluateStrategies(tickHistoryRef.current[tickHistoryRef.current.length - 1].digit);
        }
        setShowModal(true);
    };

    const closeModal = () => setShowModal(false);

    // ─────────────────────────────────────────
    //  RENDER
    // ─────────────────────────────────────────
    return (
        <div className='analyzer'>
            <div className='analyzer__header'>
                <div>
                    <div className='analyzer__title'>Optimus Trades Analyzer</div>
                    <div className='analyzer__subtitle'>Live digit analysis and signal detection</div>
                </div>
                <div className={`analyzer__status analyzer__status--${connectionStatus}`}>
                    <span className='analyzer__status-dot' />
                    {connectionStatus === 'connected' ? 'Connected' :
                     connectionStatus === 'connecting' ? 'Connecting...' : 'Error'}
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

            <button
                className='analyzer__btn'
                onClick={handleAnalyse}
                disabled={tickHistoryRef.current.length < MIN_SAMPLES}
            >
                {tickHistoryRef.current.length < MIN_SAMPLES
                    ? `Collecting ticks... (${tickHistoryRef.current.length}/${MIN_SAMPLES})`
                    : 'Analyse'}
            </button>

            {showModal && (
                <div className='analyzer__modal-overlay' onClick={closeModal}>
                    <div className='analyzer__modal' onClick={e => e.stopPropagation()}>
                        <button className='analyzer__modal-close' onClick={closeModal}>×</button>
                        <div className='analyzer__modal-title'>
                            Analysis Dashboard — {SUPPORTED_MARKETS[symbol]?.label}
                        </div>

                        {latestSignal?.ok ? (
                            <>
                                <div className='analyzer__modal-status'>
                                    Analysis Complete! {latestSignal.confidence === 'HIGH' ? '🟢' :
                                                        latestSignal.confidence === 'MEDIUM' ? '🟡' : '🔴'}{' '}
                                    {latestSignal.confidence} confidence
                                </div>
                                <div className='analyzer__modal-action'>
                                    Market will DIFFER {latestSignal.predicted}
                                </div>
                                <div className='analyzer__modal-entry'>
                                    Entry Point: Enter when the last digit is{' '}
                                    <strong>{latestSignal.entries?.join(' or ')}</strong>
                                    <div className='analyzer__modal-detail'>
                                        <em>Strategy: {latestSignal.strategy}</em>
                                        <br />
                                        {latestSignal.reason}
                                    </div>
                                </div>
                                {latestSignal.result ? (
                                    <div className={`analyzer__modal-running analyzer__modal-running--${latestSignal.result.toLowerCase()}`}>
                                        {latestSignal.result === 'WIN' ? '✅' : '❌'} Previous signal: {latestSignal.result} (next digit was {latestSignal.resultDigit})
                                    </div>
                                ) : (
                                    <div className='analyzer__modal-running'>
                                        Running bot... waiting for next tick to evaluate
                                    </div>
                                )}
                            </>
                        ) : (
                            <>
                                <div className='analyzer__modal-status analyzer__modal-status--warn'>
                                    No strong signal detected.
                                </div>
                                <div className='analyzer__modal-action'>Market is currently balanced</div>
                                <div className='analyzer__modal-entry'>
                                    {latestSignal?.rarestInfo
                                        ? `Rarest digit ${latestSignal.rarestInfo.digit} is only ${latestSignal.rarestInfo.pct.toFixed(1)}% — not rare enough`
                                        : (latestSignal?.message || 'Waiting for better setup')}
                                </div>
                                <div className='analyzer__modal-running analyzer__modal-running--warn'>
                                    Recommend waiting for a better setup
                                </div>
                            </>
                        )}

                        <div className='analyzer__modal-stats'>
                            <div>Wins: <span>{stats.wins}</span></div>
                            <div>Losses: <span>{stats.losses}</span></div>
                            <div>Win Rate: <span>
                                {stats.totalSignals > 0
                                    ? ((stats.wins / stats.totalSignals) * 100).toFixed(1) + '%'
                                    : '0%'}
                            </span></div>
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
};

export default Analyzer;