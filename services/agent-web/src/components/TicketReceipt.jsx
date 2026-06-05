import React, { useEffect } from 'react';
import { createPortal } from 'react-dom';
import { Printer, X, Repeat, Trophy } from 'lucide-react';
import { useT } from '../i18n';

const BET_MULTIPLIERS = {
  STRAIGHT: 36, SPLIT: 18, STREET: 12, CORNER: 9,
  SIX_LINE: 6, SECTOR: 6, HALF_COLOR: 4,
  COLUMN: 3, DOZEN: 3, COLOR: 2, EVEN_ODD: 2, HALF: 2,
  LINES: 2, MIRROR: 18,
};

// Max keno multiplier per spots count (1..11) — the all-match line of the
// paytable (cf. KenoGrid KENO_PAYTABLE, same generated source). Display-only
// fallback when the API doesn't serve bet.odds.
const KENO_MAX_MULTIPLIER = [
  0, 2.74, 5.03, 22.4, 99, 450, 1600, 5000, 15000, 40000, 100000, 500000,
];

/**
 * Cote affichee pour un pari : la cote servie par l'API (calculee depuis les
 * tables de reglement) prime ; sinon catalogue local roulette, ou meilleure
 * ligne keno selon le nombre de numeros coches. 0 = inconnue (pas affichee).
 */
const betMultiplier = (bet) => {
  const apiOdds = Number(bet.odds ?? 0);
  if (apiOdds > 0) return apiOdds;
  if (bet.bet_type === 'KENO') {
    const spots = String(bet.bet_target || '')
      .split(',')
      .filter((s) => s.trim() !== '').length;
    return KENO_MAX_MULTIPLIER[spots] || 0;
  }
  return BET_MULTIPLIERS[bet.bet_type] || 0;
};

const RED_NUMBERS = [1,3,5,7,9,12,14,16,18,19,21,23,25,27,30,32,34,36];

const getNumberColor = (n) => {
  const num = parseInt(n);
  if (num === 0) return '#10b981';
  return RED_NUMBERS.includes(num) ? '#ef4444' : '#1e293b';
};

const SIBLING_STATUS_BG = {
  PENDING: '#fef3c7',
  WON:     '#dcfce7',
  PAID:    '#dbeafe',
  LOST:    '#f1f5f9',
  CANCELLED:'#fee2e2',
};
const SIBLING_STATUS_FG = {
  PENDING: '#a16207',
  WON:     '#15803d',
  PAID:    '#1e40af',
  LOST:    '#475569',
  CANCELLED:'#b91c1c',
};

const TicketReceipt = ({ ticket, onClose, onPayout, payoutLoading, showMaxGain = true, onSelectSibling }) => {
  const { t, fmtN, locale } = useT();

  const getTargetLabel = (type, target) => {
    if (type === 'COLOR') return t(`bet.color.${target}`);
    if (type === 'EVEN_ODD') return t(`bet.parity.${target}`);
    if (type === 'HALF') return t(target === '1-18' ? 'bet.half.lowLong' : 'bet.half.highLong');
    if (type === 'DOZEN') return t(`bet.dozen.${target}`);
    if (type === 'COLUMN') return `${t('bet.type.COLUMN')} ${target}`;
    if (type === 'SECTOR') return `${t('bet.sector.label')} ${target}`;
    if (type === 'HALF_COLOR') return t(`bet.halfColor.${target}`);
    return target;
  };
  // ESC ferme le modal
  useEffect(() => {
    if (!ticket || !onClose) return;
    const onKey = (e) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [ticket, onClose]);

  if (!ticket) return null;

  const isResolved = ticket.status !== 'PENDING';
  const isWon = ticket.status === 'WON';
  const isPaid = ticket.status === 'PAID';
  const isLost = ticket.status === 'LOST';
  const createdAt = ticket.created_at ? new Date(ticket.created_at) : null;

  // Max payout servi par l'API (somme des amount x odds des bets non-VOID) ;
  // fallback local pour les tickets standalone / reponses anterieures au champ.
  const maxGain = Number(ticket.max_payout) > 0
    ? Number(ticket.max_payout)
    : ticket.bets.reduce((acc, b) => {
        const potential = Number(b.potential_payout ?? 0);
        if (potential > 0) return acc + potential;
        return acc + Math.floor(b.amount * betMultiplier(b));
      }, 0);

  const handlePrint = () => window.print();

  // Barcode-like visual from short_code
  const barcodeChars = (ticket.short_code || '').replace(/[^A-Z0-9]/g, '');

  return createPortal(
    <div
      onClick={onClose}
      style={{
        position: 'fixed', inset: 0, zIndex: 1000,
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        background: 'rgba(0,0,0,0.75)', backdropFilter: 'blur(8px)',
        padding: '5vh 16px',
      }}
    >
      {/* Close button — fixed top-right of the viewport, always reachable */}
      <button
        onClick={(e) => { e.stopPropagation(); onClose && onClose(); }}
        title={t('ticket.closeTitle')}
        aria-label={t('ticket.closeAria')}
        style={{
          position: 'fixed', top: 16, right: 16, zIndex: 1100,
          background: 'var(--accent)', color: 'var(--text-on-accent)',
          border: 'none', borderRadius: '50%',
          width: 44, height: 44,
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          cursor: 'pointer',
          boxShadow: '0 6px 18px rgba(0,0,0,0.4)',
          fontWeight: 700,
        }}
      >
        <X size={22} strokeWidth={2.5} />
      </button>

      <div
        className="animate-fade"
        onClick={(e) => e.stopPropagation()}
        style={{
          position: 'relative',
          width: 'min(420px, 100%)',
          height: '90vh',
          maxHeight: '90vh',
          display: 'flex', flexDirection: 'column', gap: 12,
        }}
      >
        {/* Ticket receipt */}
        <div id="ticket-receipt" style={{
          flex: '1 1 auto',
          minHeight: 0,
          overflowY: 'auto',
          background: '#faf9f6', color: '#1a1a1a', borderRadius: '12px',
          fontFamily: "'Inter', monospace",
          boxShadow: '0 25px 50px rgba(0,0,0,0.5)'
        }}>
          {/* Top zigzag edge */}
          <div style={{
            height: '12px',
            background: `linear-gradient(135deg, #faf9f6 33.33%, transparent 33.33%) 0 0,
                         linear-gradient(225deg, #faf9f6 33.33%, transparent 33.33%) 0 0`,
            backgroundSize: '12px 12px', backgroundColor: 'transparent',
            marginTop: '-1px'
          }} />

          {/* Header */}
          <div style={{ textAlign: 'center', padding: '16px 24px 12px', borderBottom: '2px dashed #d1d5db' }}>
            <div style={{ fontSize: '22px', fontWeight: '800', letterSpacing: '4px', fontFamily: 'Outfit, sans-serif', color: '#0f172a' }}>
              AGDTECH
            </div>
            <div style={{ fontSize: '10px', color: '#64748b', marginTop: '2px', letterSpacing: '2px', textTransform: 'uppercase' }}>
              {t('ticket.officialLabel')}
            </div>
            <div style={{ fontSize: '10px', color: '#94a3b8', marginTop: '4px' }}>
              {t('ticket.tableName')}
            </div>
          </div>

          {/* Code + meta */}
          <div style={{ padding: '14px 24px', borderBottom: '1px dashed #e2e8f0' }}>
            <div style={{ textAlign: 'center', marginBottom: '10px' }}>
              {/* Barcode visual */}
              <div style={{ display: 'flex', justifyContent: 'center', gap: '1px', marginBottom: '6px' }}>
                {barcodeChars.split('').map((c, i) => (
                  <div key={i} style={{
                    width: c.charCodeAt(0) % 2 === 0 ? '3px' : '2px',
                    height: '32px',
                    background: i % 3 === 0 ? '#0f172a' : i % 3 === 1 ? '#475569' : '#0f172a',
                    borderRadius: '1px'
                  }} />
                ))}
              </div>
              <div style={{ fontSize: '16px', fontWeight: '800', letterSpacing: '2px', fontFamily: 'monospace' }}>
                {ticket.short_code}
              </div>
            </div>

            <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '11px', color: '#64748b' }}>
              <span>{t('ticket.round')}: {ticket.round_id?.replace('ROUND-', '#')}</span>
              <span>{createdAt ? createdAt.toLocaleString(locale, { day: '2-digit', month: '2-digit', year: '2-digit', hour: '2-digit', minute: '2-digit' }) : ''}</span>
            </div>
          </div>

          {/* Replay chain banner — visible si ce ticket fait partie d'une serie recurrente */}
          {ticket.replay_chain && (
            <div style={{
              padding: '12px 24px', borderBottom: '2px dashed #d1d5db',
              background: 'linear-gradient(135deg, #fef9c3 0%, #fef3c7 100%)',
            }}>
              <div style={{
                display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '8px',
              }}>
                <Repeat size={14} style={{ color: '#a16207' }} />
                <span style={{
                  fontSize: '11px', fontWeight: '900', letterSpacing: '0.2em',
                  textTransform: 'uppercase', color: '#a16207',
                }}>
                  {t('ticket.recurring.title')}
                </span>
                <span style={{
                  marginLeft: 'auto', fontSize: '11px', fontWeight: '800',
                  padding: '2px 8px', borderRadius: '10px',
                  background: '#a16207', color: '#fff',
                }}>
                  {ticket.replay_chain.rounds_played}/{ticket.replay_chain.rounds_total}
                </span>
              </div>

              <div style={{
                display: 'flex', flexDirection: 'column', gap: '4px', marginBottom: '8px',
              }}>
                {ticket.replay_chain.siblings.map(s => (
                  <button
                    key={s.short_code}
                    onClick={onSelectSibling && !s.is_current ? () => onSelectSibling(s.short_code) : undefined}
                    disabled={s.is_current || !onSelectSibling}
                    style={{
                      display: 'flex', alignItems: 'center', gap: '8px',
                      padding: '6px 10px', borderRadius: '6px',
                      background: s.is_current ? '#fef3c7' : '#fff',
                      border: s.is_current ? '2px solid #a16207' : '1px solid #e5d8a8',
                      cursor: !s.is_current && onSelectSibling ? 'pointer' : 'default',
                      fontFamily: "'Inter', monospace",
                      textAlign: 'left', width: '100%',
                    }}
                  >
                    <span style={{
                      width: '20px', height: '20px', borderRadius: '50%',
                      background: '#a16207', color: '#fff',
                      display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
                      fontSize: '10px', fontWeight: '900',
                    }}>
                      {s.round_index}
                    </span>
                    <span style={{ flex: 1, fontSize: '11px', fontFamily: 'monospace', color: '#1a1a1a', fontWeight: 700 }}>
                      {s.short_code}
                    </span>
                    {s.total_payout > 0 && (
                      <span style={{ fontSize: '11px', fontWeight: '800', color: '#15803d' }}>
                        +{fmtN(s.total_payout)}
                      </span>
                    )}
                    <span style={{
                      padding: '2px 8px', borderRadius: '8px',
                      fontSize: '9px', fontWeight: '800', letterSpacing: '0.1em', textTransform: 'uppercase',
                      background: SIBLING_STATUS_BG[s.status] || '#f1f5f9',
                      color: SIBLING_STATUS_FG[s.status] || '#475569',
                    }}>
                      {t(`status.${s.status}`)}
                    </span>
                  </button>
                ))}
              </div>

              <div style={{ fontSize: '10px', color: '#92400e', fontStyle: 'italic', textAlign: 'center' }}>
                {ticket.replay_chain.rounds_remaining > 0
                  ? t('ticket.recurring.keepHint', { n: ticket.replay_chain.rounds_remaining })
                  : t('ticket.recurring.completed')}
              </div>
            </div>
          )}

          {/* Winning number (if resolved) */}
          {isResolved && ticket.winning_number != null && (
            <div style={{ padding: '12px 24px', borderBottom: '1px dashed #e2e8f0', textAlign: 'center' }}>
              <div style={{ fontSize: '10px', fontWeight: '700', color: '#64748b', letterSpacing: '2px', marginBottom: '6px', textTransform: 'uppercase' }}>
                {t('ticket.winningNumber')}
              </div>
              <div style={{
                display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
                width: '52px', height: '52px', borderRadius: '50%',
                background: getNumberColor(ticket.winning_number),
                color: '#fff', fontSize: '22px', fontWeight: '900',
                boxShadow: `0 4px 15px ${getNumberColor(ticket.winning_number)}66`
              }}>
                {ticket.winning_number}
              </div>
            </div>
          )}

          {/* Bets detail */}
          <div style={{ padding: '14px 24px', borderBottom: '2px dashed #d1d5db' }}>
            <div style={{ fontSize: '10px', fontWeight: '700', color: '#64748b', letterSpacing: '2px', marginBottom: '10px', textTransform: 'uppercase' }}>
              {t('ticket.betsDetail', { count: ticket.bets.length })}
            </div>

            {ticket.bets.map((bet, idx) => {
              const label = t(`bet.typeShort.${bet.bet_type}`);
              const target = getTargetLabel(bet.bet_type, bet.bet_target);
              const mult = betMultiplier(bet);
              return (
                <div key={idx} style={{
                  display: 'flex', justifyContent: 'space-between', alignItems: 'center',
                  padding: '8px 0',
                  borderBottom: idx < ticket.bets.length - 1 ? '1px solid #f1f5f9' : 'none'
                }}>
                  <div style={{ flex: 1 }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                      {isResolved && (
                        <span style={{
                          width: '16px', height: '16px', borderRadius: '50%', display: 'inline-flex',
                          alignItems: 'center', justifyContent: 'center', fontSize: '10px', fontWeight: '800',
                          background: bet.is_winning ? '#dcfce7' : '#fee2e2',
                          color: bet.is_winning ? '#16a34a' : '#dc2626'
                        }}>
                          {bet.is_winning ? '\u2713' : '\u2717'}
                        </span>
                      )}
                      <span style={{ fontSize: '13px', fontWeight: '600' }}>{label}</span>
                      {mult > 0 && (
                        <span style={{ fontSize: '11px', color: '#94a3b8' }}>x{fmtN(mult)}</span>
                      )}
                    </div>
                    <div style={{ fontSize: '11px', color: '#64748b', marginTop: '1px', marginLeft: isResolved ? '22px' : 0 }}>
                      {target}
                    </div>
                  </div>
                  <div style={{ textAlign: 'right' }}>
                    <div style={{ fontSize: '13px', fontWeight: '700' }}>{fmtN(bet.amount)}</div>
                    {bet.is_winning && bet.payout > 0 && (
                      <div style={{ fontSize: '12px', fontWeight: '800', color: '#16a34a' }}>+{fmtN(bet.payout)}</div>
                    )}
                  </div>
                </div>
              );
            })}
          </div>

          {/* Totals */}
          <div style={{ padding: '14px 24px' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '6px', fontSize: '12px', color: '#64748b' }}>
              <span>{t('ticket.totalWager')}</span>
              <span style={{ fontWeight: '700', color: '#1a1a1a' }}>{fmtN(ticket.total_wager || 0)} XAF</span>
            </div>

            {!isResolved && showMaxGain && (
              <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '6px', fontSize: '12px', color: '#64748b' }}>
                <span>{t('ticket.maxPotentialGain')}</span>
                <span style={{ fontWeight: '700', color: '#f59e0b' }}>{fmtN(maxGain)} XAF</span>
              </div>
            )}

            {isResolved && (
              <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '12px', color: '#64748b' }}>
                <span>{t('ticket.gains')}</span>
                <span style={{ fontWeight: '700', color: (isWon || isPaid) ? '#16a34a' : '#1a1a1a' }}>
                  {fmtN(ticket.total_payout || 0)} XAF
                </span>
              </div>
            )}
          </div>

          {/* Status banner */}
          {isResolved && (
            <div style={{
              margin: '0 24px 16px',
              padding: '14px',
              borderRadius: '8px',
              textAlign: 'center',
              fontWeight: '900',
              fontSize: '18px',
              letterSpacing: '3px',
              ...(isWon ? {
                background: 'linear-gradient(135deg, #dcfce7, #bbf7d0)',
                color: '#15803d',
                border: '2px solid #86efac'
              } : isPaid ? {
                background: 'linear-gradient(135deg, #dbeafe, #bfdbfe)',
                color: '#1d4ed8',
                border: '2px solid #93c5fd'
              } : {
                background: '#fef2f2',
                color: '#b91c1c',
                border: '2px solid #fca5a5'
              })
            }}>
              {isWon ? t('ticket.won') : isPaid ? t('ticket.paid') : t('ticket.lost')}
              {(isWon || isPaid) && ticket.total_payout > 0 && (
                <div style={{ fontSize: '24px', marginTop: '4px' }}>
                  {fmtN(ticket.total_payout)} XAF
                </div>
              )}
            </div>
          )}

          {!isResolved && (
            <div style={{
              margin: '0 24px 16px', padding: '12px', borderRadius: '8px',
              textAlign: 'center', fontWeight: '700', fontSize: '13px',
              background: '#fef3c7', color: '#92400e', border: '2px solid #fcd34d',
              letterSpacing: '2px'
            }}>
              {t('ticket.pendingDraw')}
            </div>
          )}

          {/* Payout action */}
          {isWon && onPayout && (
            <div style={{ padding: '0 24px 16px' }}>
              <button onClick={onPayout} disabled={payoutLoading} style={{
                width: '100%', padding: '14px', borderRadius: '10px', border: 'none',
                background: '#16a34a', color: '#fff', fontSize: '15px', fontWeight: '800',
                cursor: payoutLoading ? 'not-allowed' : 'pointer', letterSpacing: '1px',
                opacity: payoutLoading ? 0.6 : 1,
                boxShadow: '0 4px 15px rgba(22, 163, 74, 0.4)'
              }}>
                {payoutLoading ? t('ticket.paying') : t('ticket.payClient')}
              </button>
            </div>
          )}

          {/* Footer */}
          <div style={{
            padding: '12px 24px', textAlign: 'center',
            borderTop: '2px dashed #d1d5db', fontSize: '10px', color: '#94a3b8'
          }}>
            <div>{t('ticket.thanks')}</div>
            <div style={{ marginTop: '2px' }}>{t('ticket.keepReceipt')}</div>
            <div style={{ marginTop: '4px', fontWeight: '600', letterSpacing: '1px' }}>www.agdtech.com</div>
          </div>

          {/* Bottom zigzag edge */}
          <div style={{
            height: '12px',
            background: `linear-gradient(315deg, #faf9f6 33.33%, transparent 33.33%) 0 0,
                         linear-gradient(45deg, #faf9f6 33.33%, transparent 33.33%) 0 0`,
            backgroundSize: '12px 12px', backgroundColor: 'transparent'
          }} />
        </div>

        {/* Action bar below ticket — flex-shrink: 0 pour ne pas etre pousse hors viewport */}
        <div style={{
          flexShrink: 0,
          display: 'flex', gap: 8, justifyContent: 'center',
        }}>
          <button onClick={handlePrint} style={{
            background: 'rgba(255,255,255,0.1)', border: '1px solid rgba(255,255,255,0.25)',
            color: '#fff', padding: '12px 22px', borderRadius: 8, cursor: 'pointer',
            display: 'inline-flex', alignItems: 'center', gap: 8, fontSize: 13, fontWeight: 600,
          }}>
            <Printer size={16} /> {t('common.print')}
          </button>
          <button onClick={onClose} style={{
            background: 'var(--accent)', border: 'none',
            color: 'var(--text-on-accent)', padding: '12px 28px', borderRadius: 8, cursor: 'pointer',
            display: 'inline-flex', alignItems: 'center', gap: 8, fontSize: 13, fontWeight: 800,
          }}>
            <X size={16} /> {t('common.close')}
          </button>
        </div>
      </div>
    </div>,
    document.body
  );
};

export default TicketReceipt;
