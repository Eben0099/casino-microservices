import React, { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { RefreshCw, AlertTriangle } from 'lucide-react';
import api from '../api/client';
import { useAuth } from '../context/AuthContext';

const fmt = (n) => Math.round(n || 0).toLocaleString('fr-FR');

const STATUS_LABEL = {
  PENDING: 'En attente',
  WON: 'Gagnant',
  LOST: 'Perdu',
  PAID: 'Payé',
  CANCELLED: 'Annulé',
};

export const Shift = () => {
  const { logout } = useAuth();
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

  const fetch = async () => {
    setLoading(true);
    try {
      const res = await api.get('/tickets/me/shift', { params: { minutes: 720 } });
      setData(res.data);
    } catch (err) {
      console.error('Erreur résumé service', err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { fetch(); }, []);

  const closeSession = () => {
    localStorage.removeItem('agent_shift_started_at');
    logout();
    navigate('/login');
  };

  const fmtOpened = openedAt.toLocaleString('fr-FR', {
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
            Fin de service
          </h1>
          <p style={{ fontSize: 13, color: 'var(--text-muted)' }}>
            Service ouvert depuis le {fmtOpened}
          </p>
        </div>
        <button onClick={fetch}
          style={{
            display: 'inline-flex', alignItems: 'center', gap: 6,
            padding: '8px 14px', borderRadius: 8, fontSize: 13, fontWeight: 600,
            background: 'transparent', color: 'var(--text-primary)',
            border: '1px solid var(--border-subtle)', cursor: 'pointer',
          }}>
          <RefreshCw size={13} /> Actualiser
        </button>
      </div>

      {/* KPIs */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 16, marginBottom: 16 }}>
        {stat('Tickets vendus', loading ? '…' : fmt(data?.tickets), '', 'var(--accent)')}
        {stat('Total encaissé', loading ? '…' : fmt(data?.total_wager), 'XAF', 'var(--success)')}
        {stat('Total payé',     loading ? '…' : fmt(data?.total_payout), 'XAF', 'var(--info)')}
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
          Répartition par statut
        </div>
        {loading ? (
          <p style={{ fontSize: 13, color: 'var(--text-muted)', fontStyle: 'italic' }}>Chargement…</p>
        ) : (!data?.by_status || Object.keys(data.by_status).length === 0) ? (
          <p style={{ fontSize: 13, color: 'var(--text-muted)', fontStyle: 'italic' }}>Aucun ticket en cours.</p>
        ) : (
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 12 }}>
            {Object.entries(data.by_status).map(([status, count]) => (
              <div key={status} style={{
                padding: '8px 14px',
                background: 'var(--bg-tile)',
                border: '1px solid var(--border-subtle)',
                borderRadius: 999, display: 'flex', alignItems: 'center', gap: 8,
              }}>
                <span style={{ fontSize: 12, color: 'var(--text-secondary)' }}>{STATUS_LABEL[status] || status}</span>
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
          <h3 style={{ fontSize: 16, fontWeight: 700, color: 'var(--danger)' }}>Clôturer la session</h3>
        </div>
        <p style={{ fontSize: 13, color: 'var(--text-secondary)', marginBottom: 16 }}>
          La déconnexion enregistre la fin de service. Le résumé reste consultable dans le back-office par votre responsable.
        </p>
        <button onClick={closeSession}
          style={{
            width: '100%', padding: 14, borderRadius: 10,
            background: 'var(--danger)', color: '#fff',
            border: 'none', fontSize: 14, fontWeight: 800, cursor: 'pointer',
          }}>
          Clôturer ma session
        </button>
      </div>
    </div>
  );
};

export default Shift;
