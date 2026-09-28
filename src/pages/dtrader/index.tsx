 import { useState } from 'react';

const DtraderPage = () => {
    const [strategy, setStrategy] = useState('Matches & Differs');
    const [market, setMarket] = useState('Volatility 10 (1s) Index');

    return (
        <div style={{ padding: '32px 16px', maxWidth: '700px', margin: '0 auto', color: 'var(--text-general)' }}>
            <div style={{
                border: '1px solid var(--border-normal)',
                borderRadius: '12px',
                padding: '24px',
                background: 'var(--general-section-1)',
                boxShadow: '0 4px 12px rgba(0,0,0,0.05)'
            }}>
                <h2 style={{ color: '#ff444f', textAlign: 'center', marginBottom: '24px' }}>
                    Quantum Signal Analyzer
                </h2>

                <div style={{ marginBottom: '16px' }}>
                    <label style={{ display: 'block', marginBottom: '8px', fontWeight: 'bold' }}>SELECT STRATEGY</label>
                    <select 
                        value={strategy}
                        onChange={(e) => setStrategy(e.target.value)}
                        style={{
                            width: '100%',
                            padding: '12px',
                            borderRadius: '6px',
                            border: '1px solid var(--border-normal)',
                            background: 'var(--general-main)',
                            color: 'var(--text-general)',
                        }}
                    >
                        <option value="Matches & Differs">Matches & Differs</option>
                        <option value="Over / Under">Over / Under</option>
                        <option value="Rise / Fall">Rise / Fall</option>
                    </select>
                </div>

                <div style={{ marginBottom: '24px' }}>
                    <label style={{ display: 'block', marginBottom: '8px', fontWeight: 'bold' }}>SELECT MARKET</label>
                    <select 
                        value={market}
                        onChange={(e) => setMarket(e.target.value)}
                        style={{
                            width: '100%',
                            padding: '12px',
                            borderRadius: '6px',
                            border: '1px solid var(--border-normal)',
                            background: 'var(--general-main)',
                            color: 'var(--text-general)',
                        }}
                    >
                        <option value="Volatility 10 (1s) Index">Volatility 10 (1s) Index</option>
                        <option value="Volatility 100 Index">Volatility 100 Index</option>
                        <option value="Volatility 75 Index">Volatility 75 Index</option>
                    </select>
                </div>

                <div style={{
                    padding: '20px',
                    background: 'var(--general-main)',
                    borderRadius: '8px',
                    textAlign: 'center',
                    border: '1px solid var(--border-normal)'
                }}>
                    <h4>Active Signal Status</h4>
                    <p style={{ fontSize: '22px', fontWeight: 'bold', color: '#4bb543', margin: '12px 0' }}>
                        SIGNAL: READY
                    </p>
                    <p style={{ fontSize: '12px', color: 'var(--text-less-prominent)' }}>
                        Connected to live market ticks for {market}
                    </p>
                </div>
            </div>
        </div>
    );
};

export default DtraderPage;