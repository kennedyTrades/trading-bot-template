import React, { useState } from 'react';

const RiskCalculator: React.FC = () => {
    const [balance, setBalance] = useState<number>(1000);
    const [riskPercent, setRiskPercent] = useState<number>(2);

    const riskAmount = (balance * riskPercent) / 100;

    return (
        <div className="risk-calculator-container" style={{ padding: '2rem' }}>
            <h2>Risk & Stake Calculator</h2>
            <div>
                <label>Account Balance ($): </label>
                <input
                    type="number"
                    value={balance}
                    onChange={(e) => setBalance(Number(e.target.value))}
                />
            </div>
            <div>
                <label>Risk Per Trade (%): </label>
                <input
                    type="number"
                    value={riskPercent}
                    onChange={(e) => setRiskPercent(Number(e.target.value))}
                />
            </div>
            <h3>Recommended Max Stake: ${riskAmount.toFixed(2)}</h3>
        </div>
    );
};

export default RiskCalculator;