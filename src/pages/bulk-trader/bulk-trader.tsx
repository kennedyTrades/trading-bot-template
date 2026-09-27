 import React, { useEffect, useState, useRef } from 'react';
// @ts-ignore
import './bulk-trader.scss';

const APP_ID = '34qhZIGY0FBtndHACGXrA';
const WS_URL = `wss://api.derivws.com/trading/v1/options/ws/public?app_id=${APP_ID}`;

const SUPPORTED_MARKETS: Record<string, { label: string; decimals: number }> = {
    '1HZ100V': { label: 'Volatility 100 (1s) Index', decimals: 2 },
    '1HZ75V': { label: 'Volatility 75 (1s) Index', decimals: 2 },
    '1HZ50V': { label: 'Volatility 50 (1s) Index', decimals: 2 },
    '1HZ25V': { label: 'Volatility 25 (1s) Index', decimals: 2 },
    '1HZ10V': { label: 'Volatility 10 (1s) Index', decimals: 2 },
    R_100: { label: 'Volatility 100 Index', decimals: 3 },
    R_75: { label: 'Volatility 75 Index', decimals: 3 },
    R_50: { label: 'Volatility 50 Index', decimals: 3 },
    R_25: { label: 'Volatility 25 Index', decimals: 3 },
    R_10: { label: 'Volatility 10 Index', decimals: 3 },
};

const BulkTrader: React.FC = () => {
    const [market, setMarket] = useState<string>('1HZ100V');
    const [currentTick, setCurrentTick] = useState<number | null>(null);
    const [recentDigits, setRecentDigits] = useState<number[]>([]);
    const [digitCounts, setDigitCounts] = useState<number[]>(new Array(10).fill(0));
    const [selectedBarrier, setSelectedBarrier] = useState<number>(5);
    const [stake, setStake] = useState<number>(0.5);
    const [numberOfBulkTrades, setNumberOfBulkTrades] = useState<number>(10);
    const [isConnected, setIsConnected] = useState<boolean>(false);

    const wsRef = useRef<WebSocket | null>(null);

    useEffect(() => {
        const ws = new WebSocket(WS_URL);
        wsRef.current = ws;

        ws.onopen = () => {
            setIsConnected(true);
            ws.send(
                JSON.stringify({
                    ticks: market,
                    subscribe: 1,
                })
            );
            ws.send(
                JSON.stringify({
                    ticks_history: market,
                    count: 1000,
                    end: 'latest',
                })
            );
        };

        ws.onmessage = (event) => {
            const data = JSON.parse(event.data);
            const decimals = SUPPORTED_MARKETS[market]?.decimals || 2;

            if (data.msg_type === 'history') {
                const prices: number[] = data.history.prices || [];
                const digits = prices.map((price) => Number(price.toFixed(decimals).slice(-1)));
                calculateDigitStats(digits);
            }

            if (data.msg_type === 'tick') {
                const tickValue = data.tick.quote;
                const lastDigit = Number(tickValue.toFixed(decimals).slice(-1));

                setCurrentTick(tickValue);
                setRecentDigits((prev) => [lastDigit, ...prev.slice(0, 9)]);

                setDigitCounts((prevCounts) => {
                    const updated = [...prevCounts];
                    updated[lastDigit] += 1;
                    return updated;
                });
            }
        };

        ws.onclose = () => setIsConnected(false);

        return () => {
            if (wsRef.current) {
                wsRef.current.close();
            }
        };
    }, [market]);

    const calculateDigitStats = (digits: number[]) => {
        const counts = new Array(10).fill(0);
        digits.forEach((digit) => {
            if (digit >= 0 && digit <= 9) {
                counts[digit] += 1;
            }
        });
        setDigitCounts(counts);
    };

    const totalDigitsCount = digitCounts.reduce((a, b) => a + b, 0) || 1;

    const handlePlaceBulkTrade = (tradeType: 'MATCH' | 'DIFF') => {
        if (!wsRef.current || wsRef.current.readyState !== WebSocket.OPEN) return;

        for (let i = 0; i < numberOfBulkTrades; i++) {
            wsRef.current.send(
                JSON.stringify({
                    proposal: 1,
                    amount: stake,
                    basis: 'stake',
                    currency: 'USD',
                    symbol: market,
                    duration: 1,
                    duration_unit: 't',
                    contract_type: tradeType === 'MATCH' ? 'DIGITMATCH' : 'DIGITDIFF',
                    barrier: selectedBarrier.toString(),
                })
            );
        }
    };

    return (
        <div className="bulk-trader-page">
            <div className="bulk-trader-header-bar">
                <h3>Bulk Trader</h3>
                <span className={`connection-badge ${isConnected ? 'connected' : ''}`}>
                    {isConnected ? 'Connected' : 'Connecting...'}
                </span>
            </div>

            <div className="bulk-trader-content">
                <div className="bulk-trader-header">
                    <div className="control-group">
                        <label>SELECT MARKET</label>
                        <select value={market} onChange={(e) => setMarket(e.target.value)}>
                            {Object.entries(SUPPORTED_MARKETS).map(([key, info]) => (
                                <option key={key} value={key}>
                                    {info.label}
                                </option>
                            ))}
                        </select>
                    </div>

                    <div className="control-group">
                        <label>TRADE TYPE</label>
                        <select defaultValue="Matches/Differs">
                            <option value="Matches/Differs">Matches & Differs</option>
                            <option value="Even/Odd">Even & Odd</option>
                            <option value="Over/Under">Over & Under</option>
                        </select>
                    </div>
                </div>

                <div className="tick-info-box">
                    <div className="tick-col">
                        <span className="tick-label">NUMBER OF TICKS</span>
                        <span className="tick-count">1000</span>
                    </div>
                    <div className="tick-col">
                        <span className="tick-label">CURRENT TICK</span>
                        <span className="tick-value">
                            {currentTick !== null
                                ? currentTick.toFixed(SUPPORTED_MARKETS[market]?.decimals || 2)
                                : '...'}
                        </span>
                    </div>
                </div>

                <div className="barrier-instruction">Tap a digit below to set barrier: {selectedBarrier}</div>

                <div className="digit-circles-row">
                    {digitCounts.map((count, digit) => {
                        const percentage = ((count / totalDigitsCount) * 100).toFixed(1);
                        const isSelected = selectedBarrier === digit;

                        return (
                            <button
                                key={digit}
                                className={`digit-circle-btn ${isSelected ? 'selected' : ''}`}
                                onClick={() => setSelectedBarrier(digit)}
                            >
                                <span className="digit-num">{digit}</span>
                                <span className="digit-pct">{percentage}%</span>
                            </button>
                        );
                    })}
                </div>

                <div className="recent-digits-row">
                    {recentDigits.map((digit, index) => (
                        <span
                            key={index}
                            className={`recent-digit-badge ${digit % 2 === 0 ? 'even' : 'odd'}`}
                        >
                            {digit}
                        </span>
                    ))}
                </div>

                <div className="bulk-inputs-row">
                    <div className="control-group">
                        <label>TICKS</label>
                        <input type="number" value={1} disabled />
                    </div>
                    <div className="control-group">
                        <label>STAKE</label>
                        <input
                            type="number"
                            value={stake}
                            step={0.1}
                            onChange={(e) => setStake(Number(e.target.value))}
                        />
                    </div>
                    <div className="control-group">
                        <label>NO. OF BULK TRADES</label>
                        <input
                            type="number"
                            value={numberOfBulkTrades}
                            onChange={(e) => setNumberOfBulkTrades(Number(e.target.value))}
                        />
                    </div>
                </div>

                <div className="action-buttons-row">
                    <button className="btn-match" onClick={() => handlePlaceBulkTrade('MATCH')}>
                        Match {selectedBarrier}
                    </button>
                    <button className="btn-differs" onClick={() => handlePlaceBulkTrade('DIFF')}>
                        Differs {selectedBarrier}
                    </button>
                </div>
            </div>
        </div>
    );
};

export default BulkTrader;