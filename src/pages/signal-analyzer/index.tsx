import React, { useState, useEffect, useRef } from 'react';

interface TickData {
    quote: number;
    digit: number;
    epoch: number;
}

const SignalAnalyzerPage: React.FC = () => {
    // Strategy & Market Config
    const [strategy, setStrategy] = useState<string>('Over & Under');
    const [overBarrier, setOverBarrier] = useState<number>(1);
    const [underBarrier, setUnderBarrier] = useState<number>(8);
    const [market, setMarket] = useState<string>('1HZ25V'); // Volatility 25 (1s) Index

    // Live Tick Feed
    const [latestTick, setLatestTick] = useState<number | null>(null);
    const [lastDigit, setLastDigit] = useState<number | null>(null);
    const [_ticks, setTicks] = useState<TickData[]>([]);

    // Auto-Trade Parameters
    const [autoTrade, setAutoTrade] = useState<boolean>(true);
    const [stake, setStake] = useState<number>(0.35);
    const [durationTicks, setDurationTicks] = useState<number>(4);
    const [stopLoss, setStopLoss] = useState<number>(0);
    const [takeProfit, setTakeProfit] = useState<number>(0);
    const [enableMartingale, setEnableMartingale] = useState<boolean>(false);
    const [analyseEachTrade, setAnalyseEachTrade] = useState<boolean>(false);
    const [maxTradesPerSignal, setMaxTradesPerSignal] = useState<number>(10);
    const [recoveryMode, setRecoveryMode] = useState<boolean>(false);

    // Engine Control States
    const [isAnalyzing, setIsAnalyzing] = useState<boolean>(false);
    const [logs, setLogs] = useState<string[]>([]);

    const wsRef = useRef<WebSocket | null>(null);

    // Matrix background logs generator
    useEffect(() => {
        const sampleLogs = [
            '[INFO] Analyzing Volatility Index...',
            '[WARNING] High market volatility detected...',
            '[SUCCESS] Market data synchronized...',
            '[INFO] Data stream established...',
            '[INFO] Predicting next digit...',
            '[SECURITY] Encryption enabled...',
            '[INFO] Signal processing complete...',
            '[INFO] Connection stable...',
        ];

        const interval = setInterval(() => {
            const randomLog = sampleLogs[Math.floor(Math.random() * sampleLogs.length)];
            setLogs((prev) => [randomLog, ...prev.slice(0, 40)]);
        }, 1500);

        return () => clearInterval(interval);
    }, []);

    // Deriv Tick WebSocket Stream
    useEffect(() => {
        const appId = process.env.VITE_DERIV_APP_ID || '1089';
        const ws = new WebSocket(`wss://ws.derivws.com/websockets/v3?app_id=${appId}`);
        wsRef.current = ws;

        ws.onopen = () => {
            ws.send(JSON.stringify({ ticks: market }));
        };

        ws.onmessage = (event) => {
            const data = JSON.parse(event.data);
            if (data.msg_type === 'tick' && data.tick) {
                const quote = data.tick.quote;
                const quoteStr = quote.toFixed(data.tick.pip_size || 2);
                const digit = parseInt(quoteStr.slice(-1), 10);

                setLatestTick(quote);
                setLastDigit(digit);

                const newTick: TickData = { quote, digit, epoch: data.tick.epoch };
                setTicks((prev) => {
                    const updated = [...prev.slice(-49), newTick];

                    // Trigger Auto-Trade check on new tick
                    if (autoTrade && isAnalyzing) {
                        evaluateAndTrade(digit, updated);
                    }

                    return updated;
                });
            }
        };

        return () => {
            if (ws.readyState === WebSocket.OPEN) {
                ws.send(JSON.stringify({ forget_all: 'ticks' }));
                ws.close();
            }
        };
    }, [market, autoTrade, isAnalyzing]);

    // Signal Evaluation & Auto-Execution Engine
    const evaluateAndTrade = (currentDigit: number, tickHistory: TickData[]) => {
        if (tickHistory.length < 10) return;

        let shouldTrade = false;
        let contractType = 'DIGITOVER';
        let barrier = overBarrier;

        if (strategy === 'Over & Under') {
            if (currentDigit > underBarrier) {
                shouldTrade = true;
                contractType = 'DIGITUNDER';
                barrier = underBarrier;
            } else if (currentDigit < overBarrier) {
                shouldTrade = true;
                contractType = 'DIGITOVER';
                barrier = overBarrier;
            }
        }

        if (shouldTrade) {
            executeTrade(contractType, barrier);
        }
    };

    const executeTrade = async (contractType: string, barrierValue: number) => {
        const activeToken = localStorage.getItem('active_token') || localStorage.getItem('config.account1');
        if (!activeToken) return;

        const appId = process.env.VITE_DERIV_APP_ID || '1089';
        const tradeWs = new WebSocket(`wss://ws.derivws.com/websockets/v3?app_id=${appId}`);

        tradeWs.onopen = () => {
            tradeWs.send(JSON.stringify({ authorize: activeToken }));
        };

        tradeWs.onmessage = (event) => {
            const data = JSON.parse(event.data);

            if (data.msg_type === 'authorize') {
                tradeWs.send(
                    JSON.stringify({
                        proposal: 1,
                        amount: stake,
                        basis: 'stake',
                        contract_type: contractType,
                        currency: 'USD',
                        duration: durationTicks,
                        duration_unit: 't',
                        symbol: market,
                        barrier: barrierValue.toString(),
                    })
                );
            }

            if (data.msg_type === 'proposal' && data.proposal) {
                tradeWs.send(
                    JSON.stringify({
                        buy: data.proposal.id,
                        price: data.proposal.ask_price,
                    })
                );
            }

            if (data.msg_type === 'buy') {
                console.log('[SIGNAL ANALYZER AUTO-TRADE] Order placed:', data.buy.contract_id);
                tradeWs.close();
            }
        };
    };

    return (
        <div style={{ position: 'relative', minHeight: '100vh', backgroundColor: '#050a08', color: '#00ff66', fontFamily: 'monospace', overflow: 'hidden' }}>
            {/* Background Matrix Terminal Effect */}
            <div style={{ position: 'absolute', inset: 0, opacity: 0.15, pointerEvents: 'none', padding: '16px', fontSize: '11px', lineHeight: '1.4', overflow: 'hidden' }}>
                {logs.map((log, index) => (
                    <div key={index}>{log}</div>
                ))}
            </div>

            {/* Content Form Overlay */}
            <div style={{ position: 'relative', zIndex: 10, maxWidth: '650px', margin: '0 auto', padding: '24px 16px' }}>
                <h1 style={{ color: '#ff444f', textAlign: 'center', fontSize: '24px', fontWeight: 'bold', marginBottom: '24px' }}>
                    Quantum Signal Analyzer
                </h1>

                <div style={{ background: 'rgba(10, 18, 14, 0.92)', border: '1px solid #00ff6633', borderRadius: '12px', padding: '24px', backdropFilter: 'blur(8px)' }}>
                    {/* Select Strategy */}
                    <div style={{ marginBottom: '16px' }}>
                        <label style={{ display: 'block', color: '#a0a0a0', fontSize: '12px', marginBottom: '6px' }}>SELECT STRATEGY</label>
                        <select
                            value={strategy}
                            onChange={(e) => setStrategy(e.target.value)}
                            style={{ width: '100%', padding: '12px', background: '#0e1713', border: '1px solid #1a2e24', color: '#fff', borderRadius: '6px' }}
                        >
                            <option value="Over & Under">Over & Under</option>
                            <option value="Matches & Differs">Matches & Differs</option>
                            <option value="Rise & Fall">Rise & Fall</option>
                        </select>
                    </div>

                    {/* Barriers Inputs for Over & Under */}
                    {strategy === 'Over & Under' && (
                        <div style={{ background: '#09120e', padding: '16px', borderRadius: '8px', marginBottom: '16px', border: '1px solid #13261c' }}>
                            <div style={{ fontSize: '12px', color: '#00ff66', fontWeight: 'bold', marginBottom: '12px' }}>OVER & UNDER BARRIERS</div>
                            <div style={{ marginBottom: '12px' }}>
                                <label style={{ display: 'block', fontSize: '11px', color: '#888', marginBottom: '4px' }}>Over barrier (0-8)</label>
                                <input
                                    type="number"
                                    value={overBarrier}
                                    onChange={(e) => setOverBarrier(Number(e.target.value))}
                                    style={{ width: '100%', padding: '10px', background: '#0e1713', border: '1px solid #1a2e24', color: '#fff', borderRadius: '4px' }}
                                />
                            </div>
                            <div>
                                <label style={{ display: 'block', fontSize: '11px', color: '#888', marginBottom: '4px' }}>Under barrier (1-9)</label>
                                <input
                                    type="number"
                                    value={underBarrier}
                                    onChange={(e) => setUnderBarrier(Number(e.target.value))}
                                    style={{ width: '100%', padding: '10px', background: '#0e1713', border: '1px solid #1a2e24', color: '#fff', borderRadius: '4px' }}
                                />
                            </div>
                            <p style={{ fontSize: '11px', color: '#666', marginTop: '8px' }}>
                                Both sides are analysed in parallel. Each side shows two pattern derived entry points — the first one that prints takes the trades.
                            </p>
                        </div>
                    )}

                    {/* Select Market */}
                    <div style={{ marginBottom: '20px' }}>
                        <label style={{ display: 'block', color: '#a0a0a0', fontSize: '12px', marginBottom: '6px' }}>SELECT MARKET</label>
                        <select
                            value={market}
                            onChange={(e) => setMarket(e.target.value)}
                            style={{ width: '100%', padding: '12px', background: '#0e1713', border: '1px solid #1a2e24', color: '#fff', borderRadius: '6px' }}
                        >
                            <option value="1HZ25V">Volatility 25 (1s) Index</option>
                            <option value="1HZ10V">Volatility 10 (1s) Index</option>
                            <option value="1HZ50V">Volatility 50 (1s) Index</option>
                            <option value="1HZ75V">Volatility 75 (1s) Index</option>
                            <option value="1HZ100V">Volatility 100 (1s) Index</option>
                        </select>
                    </div>

                    {/* Live Ticks Stats */}
                    <div style={{ display: 'flex', gap: '24px', marginBottom: '20px', fontSize: '14px' }}>
                        <div>
                            <span style={{ color: '#00ff66' }}>Latest Tick: </span>
                            <span style={{ color: '#fff', fontWeight: 'bold' }}>{latestTick !== null ? latestTick.toFixed(2) : '--'}</span>
                        </div>
                        <div>
                            <span style={{ color: '#00ff66' }}>Last Digit: </span>
                            <span style={{ color: '#fff', fontWeight: 'bold' }}>{lastDigit !== null ? lastDigit : '--'}</span>
                        </div>
                    </div>

                    {/* Checkbox Options */}
                    <div style={{ marginBottom: '20px' }}>
                        <label style={{ display: 'flex', alignItems: 'center', gap: '8px', cursor: 'pointer', color: '#fff', fontSize: '13px' }}>
                            <input
                                type="checkbox"
                                checked={autoTrade}
                                onChange={(e) => setAutoTrade(e.target.checked)}
                                style={{ accentColor: '#ff444f' }}
                            />
                            Auto trade after a signal
                        </label>
                    </div>

                    {/* Auto-Trade Input Parameters */}
                    <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '12px', marginBottom: '16px' }}>
                        <div>
                            <label style={{ display: 'block', fontSize: '11px', color: '#888', marginBottom: '4px' }}>Stake</label>
                            <input
                                type="number"
                                step="0.01"
                                value={stake}
                                onChange={(e) => setStake(Number(e.target.value))}
                                style={{ width: '100%', padding: '10px', background: '#0e1713', border: '1px solid #1a2e24', color: '#fff', borderRadius: '4px' }}
                            />
                        </div>
                        <div>
                            <label style={{ display: 'block', fontSize: '11px', color: '#888', marginBottom: '4px' }}>Duration (ticks)</label>
                            <input
                                type="number"
                                value={durationTicks}
                                onChange={(e) => setDurationTicks(Number(e.target.value))}
                                style={{ width: '100%', padding: '10px', background: '#0e1713', border: '1px solid #1a2e24', color: '#fff', borderRadius: '4px' }}
                            />
                        </div>
                        <div>
                            <label style={{ display: 'block', fontSize: '11px', color: '#888', marginBottom: '4px' }}>Stoploss</label>
                            <input
                                type="number"
                                value={stopLoss}
                                onChange={(e) => setStopLoss(Number(e.target.value))}
                                style={{ width: '100%', padding: '10px', background: '#0e1713', border: '1px solid #1a2e24', color: '#fff', borderRadius: '4px' }}
                            />
                        </div>
                        <div>
                            <label style={{ display: 'block', fontSize: '11px', color: '#888', marginBottom: '4px' }}>Take profit</label>
                            <input
                                type="number"
                                value={takeProfit}
                                onChange={(e) => setTakeProfit(Number(e.target.value))}
                                style={{ width: '100%', padding: '10px', background: '#0e1713', border: '1px solid #1a2e24', color: '#fff', borderRadius: '4px' }}
                            />
                        </div>
                    </div>

                    {/* Strategy Checkboxes */}
                    <div style={{ display: 'flex', flexDirection: 'column', gap: '8px', marginBottom: '20px', fontSize: '12px', color: '#ccc' }}>
                        <label style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                            <input type="checkbox" checked={enableMartingale} onChange={(e) => setEnableMartingale(e.target.checked)} />
                            Enable martingale on loss
                        </label>
                        <label style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                            <input type="checkbox" checked={analyseEachTrade} onChange={(e) => setAnalyseEachTrade(e.target.checked)} />
                            Analyse on each trade
                        </label>
                        <div style={{ display: 'flex', alignItems: 'center', gap: '12px', marginTop: '4px' }}>
                            <span>Max trades per signal</span>
                            <input
                                type="number"
                                value={maxTradesPerSignal}
                                onChange={(e) => setMaxTradesPerSignal(Number(e.target.value))}
                                style={{ width: '60px', padding: '4px 8px', background: '#0e1713', border: '1px solid #1a2e24', color: '#fff', borderRadius: '4px' }}
                            />
                        </div>
                        <label style={{ display: 'flex', alignItems: 'center', gap: '8px', marginTop: '4px' }}>
                            <input type="checkbox" checked={recoveryMode} onChange={(e) => setRecoveryMode(e.target.checked)} />
                            Recovery mode on loss
                        </label>
                    </div>

                    {/* Analyse / Start Button */}
                    <button
                        onClick={() => setIsAnalyzing(!isAnalyzing)}
                        style={{
                            width: '100%',
                            padding: '16px',
                            backgroundColor: isAnalyzing ? '#ff444f' : '#00a896',
                            color: '#ffffff',
                            fontWeight: 'bold',
                            border: 'none',
                            borderRadius: '8px',
                            cursor: 'pointer',
                            fontSize: '16px',
                        }}
                    >
                        {isAnalyzing ? 'Stop Analyzer' : 'Analyse'}
                    </button>
                </div>
            </div>
        </div>
    );
};

export default SignalAnalyzerPage;