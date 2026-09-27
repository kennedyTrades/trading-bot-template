 import React, { useEffect, useState, useRef } from 'react';
// @ts-ignore
import './bulk-trader.scss';

const APP_ID = '34tiGc8Yj3dRAmJxD5llQ';

const BulkTrader: React.FC = () => {
    const [market, setMarket] = useState<string>('R_100');
    const [numberOfTicks] = useState<number>(1000);
    const [currentTick, setCurrentTick] = useState<number | null>(null);
    const [recentDigits, setRecentDigits] = useState<number[]>([]);
    const [digitCounts, setDigitCounts] = useState<number[]>(new Array(10).fill(0));
    const [selectedBarrier, setSelectedBarrier] = useState<number>(5);
    const [stake, setStake] = useState<number>(0.5);
    const [numberOfBulkTrades, setNumberOfBulkTrades] = useState<number>(10);

    const wsRef = useRef<WebSocket | null>(null);

    useEffect(() => {
        const ws = new WebSocket(`wss://ws.derivws.com/websockets/v3?app_id=${APP_ID}`);
        wsRef.current = ws;

        ws.onopen = () => {
            ws.send(
                JSON.stringify({
                    ticks: market,
                    subscribe: 1,
                })
            );
            ws.send(
                JSON.stringify({
                    ticks_history: market,
                    count: numberOfTicks,
                    end: 'latest',
                })
            );
        };

        ws.onmessage = (event) => {
            const data = JSON.parse(event.data);

            if (data.msg_type === 'history') {
                const prices: number[] = data.history.prices || [];
                const digits = prices.map((price) => Number(price.toFixed(2).slice(-1)));
                calculateDigitStats(digits);
            }

            if (data.msg_type === 'tick') {
                const tickValue = data.tick.quote;
                const lastDigit = Number(tickValue.toFixed(2).slice(-1));

                setCurrentTick(tickValue);
                setRecentDigits((prev) => [lastDigit, ...prev.slice(0, 9)]);

                setDigitCounts((prevCounts) => {
                    const updated = [...prevCounts];
                    updated[lastDigit] += 1;
                    return updated;
                });
            }
        };

        return () => {
            if (wsRef.current) {
                wsRef.current.close();
            }
        };
    }, [market, numberOfTicks]);

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
        <div className="bulk-trader-container">
            <div className="bulk-trader-header">
                <div className="control-group">
                    <label>MARKET</label>
                    <select value={market} onChange={(e) => setMarket(e.target.value)}>
                        <option value="R_100">Volatility 100 Index</option>
                        <option value="R_75">Volatility 75 Index</option>
                        <option value="R_50">Volatility 50 Index</option>
                        <option value="R_25">Volatility 25 Index</option>
                        <option value="R_10">Volatility 10 Index</option>
                    </select>
                </div>

                <div className="control-group">
                    <label>TRADE TYPE</label>
                    <select defaultValue="Matches/Differs">
                        <option value="Matches/Differs">Matches/Differs</option>
                        <option value="Even/Odd">Even/Odd</option>
                        <option value="Over/Under">Over/Under</option>
                    </select>
                </div>
            </div>

            <div className="current-tick-section">
                <div className="tick-label">NUMBER OF TICKS</div>
                <div className="tick-value">{numberOfTicks}</div>
                <div className="tick-label" style={{ marginTop: '10px' }}>CURRENT TICK</div>
                <div className="tick-quote">{currentTick !== null ? currentTick.toFixed(2) : 'Connecting...'}</div>
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
                    <span key={index} className={`recent-digit ${digit % 2 === 0 ? 'even' : 'odd'}`}>
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
    );
};

export default BulkTrader;