import React from 'react';

const BulkTrader = () => {
    return (
        <div style={{ width: '100%', height: '100vh', border: 'none' }}>
            <iframe
                src={`https://legacyprime.live/app#bulk_trader?app_id=68688`} // replace with your app id
                title="Bulk Trader"
                style={{ width: '100%', height: '100%', border: 'none' }}
            />
        </div>
    );
};

export default BulkTrader;