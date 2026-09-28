
const FreebotsPage = () => {
    const botList = [
        { id: 1, name: 'Quantum Signal Bot', type: 'Digits', desc: 'Matches & Differs auto-trader.' },
        { id: 2, name: 'Hedging Beast Bot', type: 'Rise/Fall', desc: 'Auto recovery hedging strategy.' },
        { id: 3, name: 'Tick Pattern Master', type: 'Analysis', desc: 'High probability tick pattern detector.' },
    ];

    return (
        <div style={{ padding: '24px', color: 'var(--text-general)' }}>
            <h2 style={{ marginBottom: '16px' }}>Inbuilt Freebots & Strategies</h2>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))', gap: '16px' }}>
                {botList.map(bot => (
                    <div 
                        key={bot.id} 
                        style={{
                            border: '1px solid var(--border-normal)',
                            borderRadius: '8px',
                            padding: '16px',
                            background: 'var(--general-section-1)',
                        }}
                    >
                        <h3>{bot.name}</h3>
                        <span style={{ fontSize: '12px', color: 'var(--text-less-prominent)' }}>{bot.type}</span>
                        <p style={{ marginTop: '8px', fontSize: '14px' }}>{bot.desc}</p>
                        <button 
                            style={{
                                marginTop: '16px',
                                width: '100%',
                                padding: '10px',
                                background: 'var(--button-primary-default)',
                                color: '#ffffff',
                                border: 'none',
                                borderRadius: '4px',
                                cursor: 'pointer',
                                fontWeight: 'bold',
                            }}
                        >
                            Load Strategy
                        </button>
                    </div>
                ))}
            </div>
        </div>
    );
};

export default FreebotsPage;