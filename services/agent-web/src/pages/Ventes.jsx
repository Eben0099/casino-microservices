import React, { useEffect, useState } from 'react';
import api from '../api/client';
import TicketReceipt from '../components/TicketReceipt';
import { useT } from '../i18n';

const STATUS_COLOR = {
  PENDING:  'var(--text-secondary)',
  WON:      'var(--success)',
  PAID:     'var(--info)',
  LOST:     'var(--text-muted)',
  CANCELLED:'var(--danger)',
};

export const Ventes = () => {
  const { t, fmtN, locale } = useT();
  const [tickets, setTickets] = useState([]);
  const [loading, setLoading] = useState(true);
  const [selected, setSelected] = useState(null);

  const fmtTime = (d) => d ? new Date(d).toLocaleTimeString(locale, { hour: '2-digit', minute: '2-digit' }) : '—';

  const fetchTickets = async () => {
    try {
      const res = await api.get('/tickets/me/recent', { params: { minutes: 15, limit: 100 } });
      setTickets(res.data || []);
    } catch (err) {
      console.error(t('ventes.loadError'), err);
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
            {t('ventes.title')}
          </h1>
          <p style={{ fontSize: 13, color: 'var(--text-muted)' }}>
            {t('ventes.subtitle')}
          </p>
        </div>
        <div style={{ fontSize: 14 }}>
          <span style={{ fontWeight: 800, color: 'var(--accent)', fontSize: 22 }}>{tickets.length}</span>
          <span style={{ color: 'var(--text-muted)', marginLeft: 6 }}>
            {tickets.length === 1 ? t('ventes.ticket') : t('ventes.tickets')}
          </span>
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
            {t('common.loading')}
          </div>
        ) : tickets.length === 0 ? (
          <div style={{ padding: 80, textAlign: 'center', color: 'var(--text-muted)', fontSize: 14, fontStyle: 'italic' }}>
            {t('ventes.empty')}
          </div>
        ) : (
          <table style={{ width: '100%', borderCollapse: 'collapse', textAlign: 'left' }}>
            <thead>
              <tr style={{ borderBottom: '1px solid var(--border-subtle)' }}>
                {[
                  t('ventes.headers.time'),
                  t('ventes.headers.code'),
                  t('ventes.headers.wager'),
                  t('ventes.headers.maxPayout'),
                  t('ventes.headers.status'),
                ].map(h => (
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
              {tickets.map(tk => {
                const maxGain = (tk.bets || []).reduce((acc, b) => {
                  const m = ({ STRAIGHT: 36, SPLIT: 18, STREET: 12, CORNER: 9, SIX_LINE: 6, SECTOR: 6, HALF_COLOR: 4, DOZEN: 3, COLUMN: 3, COLOR: 2, EVEN_ODD: 2, HALF: 2 })[b.bet_type] || 1;
                  return acc + b.amount * m;
                }, 0);
                return (
                  <tr key={tk.id}
                    onClick={() => setSelected(tk)}
                    style={{ borderBottom: '1px solid var(--border-subtle)', cursor: 'pointer' }}
                    onMouseEnter={(e) => (e.currentTarget.style.background = 'var(--bg-elevated)')}
                    onMouseLeave={(e) => (e.currentTarget.style.background = 'transparent')}
                  >
                    <td style={{ padding: '12px 16px', fontSize: 13, color: 'var(--text-secondary)', fontVariantNumeric: 'tabular-nums' }}>
                      {fmtTime(tk.created_at)}
                    </td>
                    <td style={{ padding: '12px 16px', fontSize: 13, fontWeight: 700, color: 'var(--text-primary)', fontFamily: 'monospace' }}>
                      {tk.short_code}
                    </td>
                    <td style={{ padding: '12px 16px', fontSize: 13, fontWeight: 700, color: 'var(--accent)' }}>
                      {fmtN(tk.total_wager)} XAF
                    </td>
                    <td style={{ padding: '12px 16px', fontSize: 13, color: 'var(--text-secondary)' }}>
                      {fmtN(maxGain)} XAF
                    </td>
                    <td style={{ padding: '12px 16px' }}>
                      <span style={{
                        display: 'inline-block',
                        padding: '2px 10px', borderRadius: 999,
                        fontSize: 11, fontWeight: 700, letterSpacing: '0.05em',
                        textTransform: 'uppercase',
                        background: `${STATUS_COLOR[tk.status] || 'var(--text-muted)'}20`,
                        color: STATUS_COLOR[tk.status] || 'var(--text-muted)',
                      }}>
                        {t(`status.${tk.status}`)}
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
