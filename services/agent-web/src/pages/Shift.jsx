import React, { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { RefreshCw, AlertTriangle } from 'lucide-react';
import api from '../api/client';
import { useAuth } from '../context/AuthContext';
import { useT } from '../i18n';

export const Shift = () => {
  const { logout } = useAuth();
  const { t, fmtN, locale } = useT();
  const navigate = useNavigate();
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [openedAt] = useState(() => {
    const stored = localStorage.getItem('agent_shift_started_at');
    if (stored) return new Date(stored);
    const now = new Date();
    localStorage.setItem('agent_shift_started_at', now.toISOString());
    return now;
  });

  const fetchSummary = async () => {
    setLoading(true);
    try {
      const res = await api.get('/tickets/me/shift', { params: { minutes: 720 } });
      setData(res.data);
    } catch (err) {
      console.error(t('shift.loadError'), err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { fetchSummary(); }, []);

  const closeSession = () => {
    localStorage.removeItem('agent_shift_started_at');
    logout();
    navigate('/login');
  };

  const fmtOpened = openedAt.toLocaleString(locale, {
    day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit',
  });

  const stat = (label, value, unit, color) => (
    <div style={{
      padding: '16px 20px',
      background: 'var(--bg-surface)',
      border: '1px solid var(--border-subtle)',
      borderRadius: 12,
    }}>
      <div style={{
        fontSize: 11, fontWeight: 700, letterSpacing: '0.12em',
        color: 'var(--text-muted)', textTransform: 'uppercase', marginBottom: 8,
      }}>
        {label}
      </div>
      <div style={{ display: 'flex', alignItems: 'baseline', gap: 6 }}>
        <span style={{ fontSize: 28, fontWeight: 800, color: color || 'var(--text-primary)' }}>
          {value}
        </span>
        {unit && <span style={{ fontSize: 13, fontWeight: 500, color: 'var(--text-muted)' }}>{unit}</span>}
      </div>
    </div>
  );

  return (
    <div className="animate-fade">
      <div style={{ display: 'flex', alignItems: 'flex-end', justifyContent: 'space-between', marginBottom: 20 }}>
        <div>
          <h1 style={{ fontSize: 24, fontWeight: 700, color: 'var(--text-primary)', marginBottom: 4 }}>
            {t('shift.title')}
          </h1>
          <p style={{ fontSize: 13, color: 'var(--text-muted)' }}>
            {t('shift.openedSince', { date: fmtOpened })}
          </p>
        </div>
        <button onClick={fetchSummary}
          style={{
            display: 'inline-flex', alignItems: 'center', gap: 6,
            padding: '8px 14px', borderRadius: 8, fontSize: 13, fontWeight: 600,
            background: 'transparent', color: 'var(--text-primary)',
            border: '1px solid var(--border-subtle)', cursor: 'pointer',
          }}>
          <RefreshCw size={13} /> {t('common.refresh')}
        </button>
      </div>

      {/* KPIs */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 16, marginBottom: 16 }}>
        {stat(t('shift.sold'),     loading ? '…' : fmtN(data?.tickets),     '',    'var(--accent)')}
        {stat(t('shift.cashedIn'), loading ? '…' : fmtN(data?.total_wager), 'XAF', 'var(--success)')}
        {stat(t('shift.paidOut'),  loading ? '…' : fmtN(data?.total_payout),'XAF', 'var(--info)')}
      </div>

      {/* Répartition par statut */}
      <div style={{
        padding: '16px 20px',
        background: 'var(--bg-surface)',
        border: '1px solid var(--border-subtle)',
        borderRadius: 12,
        marginBottom: 24,
      }}>
        <div style={{
          fontSize: 11, fontWeight: 700, letterSpacing: '0.12em',
          color: 'var(--text-muted)', textTransform: 'uppercase', marginBottom: 12,
        }}>
          {t('shift.byStatus')}
        </div>
        {loading ? (
          <p style={{ fontSize: 13, color: 'var(--text-muted)', fontStyle: 'italic' }}>{t('common.loading')}</p>
        ) : (!data?.by_status || Object.keys(data.by_status).length === 0) ? (
          <p style={{ fontSize: 13, color: 'var(--text-muted)', fontStyle: 'italic' }}>{t('shift.noTickets')}</p>
        ) : (
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 12 }}>
            {Object.entries(data.by_status).map(([status, count]) => (
              <div key={status} style={{
                padding: '8px 14px',
                background: 'var(--bg-tile)',
                border: '1px solid var(--border-subtle)',
                borderRadius: 999, display: 'flex', alignItems: 'center', gap: 8,
              }}>
                <span style={{ fontSize: 12, color: 'var(--text-secondary)' }}>{t(`status.${status}`)}</span>
                <span style={{ fontSize: 14, fontWeight: 800, color: 'var(--text-primary)' }}>{count}</span>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Cloture */}
      <div style={{
        padding: 24, borderRadius: 12,
        background: 'var(--bg-surface)',
        border: '1px solid rgba(239,68,68,0.4)',
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8 }}>
          <AlertTriangle size={18} style={{ color: 'var(--danger)' }} />
          <h3 style={{ fontSize: 16, fontWeight: 700, color: 'var(--danger)' }}>{t('shift.closeSectionTitle')}</h3>
        </div>
        <p style={{ fontSize: 13, color: 'var(--text-secondary)', marginBottom: 16 }}>
          {t('shift.closeSectionBody')}
        </p>
        <button onClick={closeSession}
          style={{
            width: '100%', padding: 14, borderRadius: 10,
            background: 'var(--danger)', color: '#fff',
            border: 'none', fontSize: 14, fontWeight: 800, cursor: 'pointer',
          }}>
          {t('shift.closeButton')}
        </button>
      </div>
    </div>
  );
};

export default Shift;
