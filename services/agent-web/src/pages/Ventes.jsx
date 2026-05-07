import React, { useEffect, useState } from 'react';
import api from '../api/client';
import TicketReceipt from '../components/TicketReceipt';

const fmt = (n) => Math.round(n || 0).toLocaleString('fr-FR');
const fmtTime = (d) => d ? new Date(d).toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' }) : '—';

const STATUS_LABEL = {
  PENDING: 'En attente',
  WON:     'Gagnant',
  LOST:    'Perdu',
  PAID:    'Payé',
  CANCELLED: 'Annulé',
};

const STATUS_COLOR = {
  PENDING:  'var(--text-secondary)',
  WON:      'var(--success)',
  PAID:     'var(--info)',
  LOST:     'var(--text-muted)',
  CANCELLED:'var(--danger)',
};

export const Ventes = () => {
  const [tickets, setTickets] = useState([]);
  const [loading, setLoading] = useState(true);
  const [selected, setSelected] = useState(null);

  const fetchTickets = async () => {
    try {
      const res = await api.get('/tickets/me/recent', { params: { minutes: 15, limit: 100 } });
      setTickets(res.data || []);
    } catch (err) {
      console.error('Erreur chargement ventes', err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchTickets();
    const id = setInterval(fetchTickets, 10000);
    return () => clearInterval(id);
  }, []);

  return (
    <div className="animate-fade">
      <div style={{ display: 'flex', alignItems: 'flex-end', justifyContent: 'space-between', marginBottom: 20 }}>
        <div>
          <h1 style={{ fontSize: 24, fontWeight: 700, color: 'var(--text-primary)', marginBottom: 4 }}>
            Ventes récentes
          </h1>
          <p style={{ fontSize: 13, color: 'var(--text-muted)' }}>
            15 dernières minutes — auto-actualisé
          </p>
        </div>
        <div style={{ fontSize: 14 }}>
          <span style={{ fontWeight: 800, color: 'var(--accent)', fontSize: 22 }}>{tickets.length}</span>
          <span style={{ color: 'var(--text-muted)', marginLeft: 6 }}>ticket{tickets.length !== 1 ? 's' : ''}</span>
        </div>
      </div>

      <div style={{
        background: 'var(--bg-surface)',
        border: '1px solid var(--border-subtle)',
        borderRadius: 12,
        overflow: 'hidden',
      }}>
        {loading ? (
          <div style={{ padding: 80, textAlign: 'center', color: 'var(--text-muted)', fontSize: 14 }}>
            Chargement…
          </div>
        ) : tickets.length === 0 ? (
          <div style={{ padding: 80, textAlign: 'center', color: 'var(--text-muted)', fontSize: 14, fontStyle: 'italic' }}>
            Aucune vente dans les 15 dernières minutes.
          </div>
        ) : (
          <table style={{ width: '100%', borderCollapse: 'collapse', textAlign: 'left' }}>
            <thead>
              <tr style={{ borderBottom: '1px solid var(--border-subtle)' }}>
                {['Heure', 'Code', 'Mise', 'Gain potentiel', 'Statut'].map(h => (
                  <th key={h} style={{
                    padding: '12px 16px', fontSize: 11, fontWeight: 600, letterSpacing: '0.1em',
                    color: 'var(--text-muted)', textTransform: 'uppercase',
                  }}>
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {tickets.map(t => {
                const maxGain = (t.bets || []).reduce((acc, b) => {
                  const m = ({ STRAIGHT: 36, SPLIT: 18, STREET: 12, CORNER: 9, SIX_LINE: 6, DOZEN: 3, COLUMN: 3, COLOR: 2, EVEN_ODD: 2, HALF: 2 })[b.bet_type] || 1;
                  return acc + b.amount * m;
                }, 0);
                return (
                  <tr key={t.id}
                    onClick={() => setSelected(t)}
                    style={{ borderBottom: '1px solid var(--border-subtle)', cursor: 'pointer' }}
                    onMouseEnter={(e) => (e.currentTarget.style.background = 'var(--bg-elevated)')}
                    onMouseLeave={(e) => (e.currentTarget.style.background = 'transparent')}
                  >
                    <td style={{ padding: '12px 16px', fontSize: 13, color: 'var(--text-secondary)', fontVariantNumeric: 'tabular-nums' }}>
                      {fmtTime(t.created_at)}
                    </td>
                    <td style={{ padding: '12px 16px', fontSize: 13, fontWeight: 700, color: 'var(--text-primary)', fontFamily: 'monospace' }}>
                      {t.short_code}
                    </td>
                    <td style={{ padding: '12px 16px', fontSize: 13, fontWeight: 700, color: 'var(--accent)' }}>
                      {fmt(t.total_wager)} XAF
                    </td>
                    <td style={{ padding: '12px 16px', fontSize: 13, color: 'var(--text-secondary)' }}>
                      {fmt(maxGain)} XAF
                    </td>
                    <td style={{ padding: '12px 16px' }}>
                      <span style={{
                        display: 'inline-block',
                        padding: '2px 10px', borderRadius: 999,
                        fontSize: 11, fontWeight: 700, letterSpacing: '0.05em',
                        textTransform: 'uppercase',
                        background: `${STATUS_COLOR[t.status] || 'var(--text-muted)'}20`,
                        color: STATUS_COLOR[t.status] || 'var(--text-muted)',
                      }}>
                        {STATUS_LABEL[t.status] || t.status}
                      </span>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </div>

      {selected && (
        <TicketReceipt
          ticket={selected}
          onClose={() => setSelected(null)}
        />
      )}
    </div>
  );
};

export default Ventes;
