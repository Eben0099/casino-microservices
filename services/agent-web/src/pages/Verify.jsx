import React from 'react';
import TicketVerifier from '../components/TicketVerifier';

export const Verify = () => (
  <div className="animate-fade" style={{ maxWidth: 720, margin: '40px auto 0' }}>
    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 16 }}>
      <h1 style={{ fontSize: 22, fontWeight: 700, color: 'var(--text-primary)' }}>Vérifier un ticket</h1>
      <p style={{ fontSize: 13, color: 'var(--text-muted)' }}>
        Scanner prêt — scannez le code-barres ou QR
      </p>
    </div>
    <TicketVerifier variant="card" />
  </div>
);

export default Verify;
