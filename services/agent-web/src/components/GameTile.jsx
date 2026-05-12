import React from 'react';
import { useT } from '../i18n';

const GameTile = ({ code, label, active, available, onClick }) => {
  const { t } = useT();
  const styleActive = {
    background: 'var(--accent)',
    color: 'var(--text-on-accent)',
    border: '1px solid var(--accent)',
    boxShadow: '0 0 0 3px rgba(245,158,11,0.18)',
  };
  const styleIdle = {
    background: 'var(--bg-tile)',
    color: 'var(--text-secondary)',
    border: '1px solid var(--border-subtle)',
    cursor: available ? 'pointer' : 'not-allowed',
    opacity: available ? 1 : 0.55,
  };

  return (
    <div
      onClick={available && !active ? onClick : undefined}
      style={{
        borderRadius: 12,
        padding: '14px 10px',
        display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 4,
        textAlign: 'center', userSelect: 'none',
        transition: 'all 0.12s',
        ...(active ? styleActive : styleIdle),
      }}
    >
      <span style={{
        fontSize: 18, fontWeight: 900, letterSpacing: '0.04em',
        fontFamily: 'Outfit',
      }}>
        {code}
      </span>
      <span style={{ fontSize: 12, fontWeight: 600 }}>
        {label}
      </span>
      {!available && (
        <span style={{
          fontSize: 9, fontWeight: 700, letterSpacing: '0.15em',
          marginTop: 4, padding: '2px 6px', borderRadius: 4,
          background: 'var(--bg-elevated)', color: 'var(--text-muted)',
        }}>
          {t('jeux.soonBadge')}
        </span>
      )}
    </div>
  );
};

export default GameTile;
