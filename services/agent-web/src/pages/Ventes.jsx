import React, { useEffect, useState } from 'react';
import { Repeat, StopCircle } from 'lucide-react';
import api from '../api/client';
import TicketReceipt from '../components/TicketReceipt';
import { ticketApi } from '../api/endpoints';
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
  const [plans, setPlans] = useState([]);
  const [loading, setLoading] = useState(true);
  const [selected, setSelected] = useState(null);

  const fmtTime = (d) => d ? new Date(d).toLocaleTimeString(locale, { hour: '2-digit', minute: '2-digit' }) : '—';

  const fetchTickets = async () => {
    try {
      const [resT, resP] = await Promise.all([
        api.get('/tickets/me/recent', { params: { minutes: 15, limit: 100 } }),
        api.get('/tickets/plans/active'),
      ]);
      setTickets(resT.data || []);
      setPlans(resP.data || []);
    } catch (err) {
      console.error(t('ventes.loadError'), err);
    } finally {
      setLoading(false);
    }
  };

  // Ouvre le ticket avec sa chain : on refetch pour garantir replay_chain a jour
  const openTicket = async (shortCode) => {
    try {
      const res = await ticketApi.getDetails(shortCode);
      setSelected(res.data);
    } catch {
      setSelected(null);
    }
  };

  const cancelPlan = async (planId) => {
    if (!window.confirm(t('ventes.confirmCancelPlan'))) return;
    try {
      await api.post(`/tickets/plans/${planId}/cancel`);
      fetchTickets();
    } catch (err) {
      alert(err.response?.data?.detail || 'Error');
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

      {/* Active replay plans */}
      {plans.length > 0 && (
        <div style={{
          background: 'var(--bg-surface)',
          border: '1px solid var(--accent)44',
          borderRadius: 12, padding: '12px 16px', marginBottom: 16,
        }}>
          <div style={{
            display: 'flex', alignItems: 'center', gap: 8, marginBottom: 10,
            fontSize: 11, fontWeight: 700, letterSpacing: '0.1em',
            textTransform: 'uppercase', color: 'var(--accent)',
          }}>
            <Repeat size={14} /> {t('ventes.activePlans')} · {plans.length}
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
            {plans.map(p => {
              const progress = p.rounds_played / p.rounds_total;
              return (
                <div key={p.id} style={{
                  display: 'flex', alignItems: 'center', gap: 12,
                  padding: '10px 12px', borderRadius: 8,
                  background: 'var(--bg-tile)',
                  border: '1px solid var(--border-subtle)',
                }}>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontSize: 13, fontWeight: 700, color: 'var(--text-primary)' }}>
                      {p.bets.map(b => `${b.bet_type} ${b.bet_target || ''}`).join(' · ')}
                    </div>
                    <div style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 2 }}>
                      {fmtN(p.total_wager_per_round)} XAF / {t('ventes.round')} ·{' '}
                      <span style={{ color: 'var(--accent)', fontWeight: 700 }}>
                        {p.rounds_played}/{p.rounds_total}
                      </span> {t('ventes.roundsPlayed')}
                    </div>
                    <div style={{
                      marginTop: 6, height: 4, borderRadius: 4,
                      background: 'var(--bg-elevated)', overflow: 'hidden',
                    }}>
                      <div style={{
                        width: `${progress * 100}%`, height: '100%',
                        background: 'var(--accent)',
                        transition: 'width 0.4s',
                      }} />
                    </div>
                  </div>
                  <div style={{ fontSize: 11, color: 'var(--text-muted)', whiteSpace: 'nowrap' }}>
                    {t('ventes.refundIfStop')}:{' '}
                    <span style={{ color: 'var(--text-primary)', fontWeight: 700 }}>
                      {fmtN(p.rounds_remaining * p.total_wager_per_round)} XAF
                    </span>
                  </div>
                  <button
                    onClick={() => cancelPlan(p.id)}
                    title={t('ventes.stopReplay')}
                    style={{
                      display: 'flex', alignItems: 'center', gap: 6,
                      padding: '6px 12px', borderRadius: 8,
                      background: 'transparent', color: 'var(--danger)',
                      border: '1px solid var(--danger)44', cursor: 'pointer',
                      fontSize: 11, fontWeight: 700,
                    }}>
                    <StopCircle size={13} /> {t('ventes.stopReplay')}
                  </button>
                </div>
              );
            })}
          </div>
        </div>
      )}

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
                    onClick={() => openTicket(tk.short_code)}
                    style={{ borderBottom: '1px solid var(--border-subtle)', cursor: 'pointer' }}
                    onMouseEnter={(e) => (e.currentTarget.style.background = 'var(--bg-elevated)')}
                    onMouseLeave={(e) => (e.currentTarget.style.background = 'transparent')}
                  >
                    <td style={{ padding: '12px 16px', fontSize: 13, color: 'var(--text-secondary)', fontVariantNumeric: 'tabular-nums' }}>
                      {fmtTime(tk.created_at)}
                    </td>
                    <td style={{ padding: '12px 16px', fontSize: 13, fontWeight: 700, color: 'var(--text-primary)', fontFamily: 'monospace' }}>
                      <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
                        {tk.short_code}
                        {tk.plan_id && (
                          <span title={t('ventes.recurringTag')}
                            style={{
                              display: 'inline-flex', alignItems: 'center', gap: 3,
                              padding: '1px 6px', borderRadius: 999,
                              background: 'var(--accent)1F', color: 'var(--accent)',
                              fontSize: 9, fontWeight: 800, letterSpacing: '0.06em',
                            }}>
                            <Repeat size={9} /> {t('ventes.recurringTag')}
                          </span>
                        )}
                      </span>
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
          onSelectSibling={openTicket}
        />
      )}
    </div>
  );
};

export default Ventes;
