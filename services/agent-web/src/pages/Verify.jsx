import React from 'react';
import TicketVerifier from '../components/TicketVerifier';
import { useT } from '../i18n';

export const Verify = () => {
  const { t } = useT();
  return (
    <div className="animate-fade" style={{ maxWidth: 720, margin: '40px auto 0' }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 16 }}>
        <h1 style={{ fontSize: 22, fontWeight: 700, color: 'var(--text-primary)' }}>{t('verify.title')}</h1>
        <p style={{ fontSize: 13, color: 'var(--text-muted)' }}>
          {t('verify.scannerReady')}
        </p>
      </div>
      <TicketVerifier variant="card" />
    </div>
  );
};

export default Verify;
