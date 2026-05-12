import React from 'react';
import { Ticket as TicketIcon, X, Trophy } from 'lucide-react';
import { useT } from '../i18n';

const MULT = {
  STRAIGHT: 36, SPLIT: 18, CORNER: 9, STREET: 12, SIX_LINE: 6,
  SECTOR: 6, HALF_COLOR: 4, DOZEN: 3, COLUMN: 3, COLOR: 2, EVEN_ODD: 2, HALF: 2,
};

const BetSlip = ({
  bets, removeBet, clearBets, submitTicket,
  isBettingOpen, loading,
  ticketLabel,
  shopLabel,
  shopMeta,
}) => {
  const { t, fmtN } = useT();

  const getBetInfo = (bet) => {
    const mult = MULT[bet.bet_type] || 1;
    switch (bet.bet_type) {
      case 'STRAIGHT': return { label: `${t('bet.typeShort.STRAIGHT')} ${bet.bet_target}`, mult };
      case 'SPLIT':    return { label: `${t('bet.typeShort.SPLIT')} ${bet.bet_target}`, mult };
      case 'CORNER':   return { label: `${t('bet.typeShort.CORNER')} ${bet.bet_target}`, mult };
      case 'STREET':   return { label: `${t('bet.typeShort.STREET')} ${bet.bet_target}`, mult };
      case 'SIX_LINE': return { label: `${t('bet.typeShort.SIX_LINE')} ${bet.bet_target}`, mult };
      case 'DOZEN':    return { label: `${t('bet.typeShort.DOZEN')} ${bet.bet_target}`, mult };
      case 'COLUMN':   return { label: `${t('bet.typeShort.COLUMN')} ${bet.bet_target}`, mult };
      case 'COLOR':    return { label: t(`bet.color.${bet.bet_target}`), mult };
      case 'EVEN_ODD': return { label: t(`bet.parity.${bet.bet_target}`), mult };
      case 'HALF':     return { label: t(`bet.half.${bet.bet_target}`), mult };
      case 'SECTOR':   return { label: `${t('bet.sector.label')} ${bet.bet_target}`, mult };
      case 'HALF_COLOR': return { label: t(`bet.halfColor.${bet.bet_target}`), mult };
      default:         return { label: bet.bet_target, mult: 1 };
    }
  };

  const resolvedTicketLabel = ticketLabel || t('betSlip.title');
  const totalWager = bets.reduce((acc, b) => acc + b.amount, 0);
  const totalPotential = bets.reduce((acc, b) => acc + b.amount * getBetInfo(b).mult, 0);

  return (
    <div style={{
      background: 'var(--bg-surface)',
      border: '1px solid var(--border-subtle)',
      borderRadius: 12,
      display: 'flex', flexDirection: 'column',
      maxHeight: 'calc(100vh - 120px)',
    }}>
      {/* Shop header */}
      {shopLabel && (
        <div style={{
          padding: '14px 18px',
          borderBottom: '1px solid var(--border-subtle)',
          display: 'flex', alignItems: 'center', justifyContent: 'space-between',
        }}>
          <div style={{ fontSize: 14, fontWeight: 700, color: 'var(--text-primary)' }}>{shopLabel}</div>
          {shopMeta && <div style={{ fontSize: 11, color: 'var(--text-muted)' }}>{shopMeta}</div>}
        </div>
      )}

      {/* Slip header */}
      <div style={{
        padding: '12px 16px',
        borderBottom: '1px solid var(--border-subtle)',
        display: 'flex', alignItems: 'center', justifyContent: 'space-between',
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <TicketIcon size={15} style={{ color: 'var(--accent)' }} />
          <span style={{
            fontSize: 11, fontWeight: 600, letterSpacing: '0.12em',
            textTransform: 'uppercase', color: 'var(--text-muted)',
          }}>
            {resolvedTicketLabel}
          </span>
        </div>
        {bets.length > 0 && (
          <span style={{
            background: 'var(--accent)', color: 'var(--text-on-accent)',
            padding: '2px 10px', borderRadius: 999,
            fontSize: 11, fontWeight: 800,
          }}>
            {bets.length} {bets.length > 1 ? t('betSlip.bets') : t('betSlip.bet')}
          </span>
        )}
      </div>

      {/* Bets list */}
      <div style={{
        flex: 1, overflowY: 'auto', padding: '10px 12px',
        display: 'flex', flexDirection: 'column', gap: 6,
        minHeight: 220,
      }}>
        {bets.length === 0 ? (
          <div style={{
            flex: 1, display: 'flex', flexDirection: 'column',
            alignItems: 'center', justifyContent: 'center',
            color: 'var(--text-muted)', gap: 10, padding: '32px 0',
          }}>
            <TicketIcon size={32} strokeWidth={1.4} />
            <span style={{ fontSize: 12, fontWeight: 500 }}>
              {t('betSlip.emptyHint')}
            </span>
          </div>
        ) : (
          bets.map((bet, idx) => {
            const info = getBetInfo(bet);
            const accent =
              bet.bet_type === 'STRAIGHT' ? 'var(--accent)'
              : bet.bet_type === 'COLOR' && bet.bet_target === 'RED' ? '#ef4444'
              : bet.bet_type === 'COLOR' && bet.bet_target === 'BLACK' ? '#1f2937'
              : 'var(--border-strong)';
            return (
              <div key={idx} style={{
                background: 'var(--bg-tile)',
                padding: '10px 12px', borderRadius: 8,
                display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                borderLeft: `3px solid ${accent}`,
              }}>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontSize: 13, fontWeight: 700, color: 'var(--text-primary)' }}>{info.label}</div>
                  <div style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 1 }}>
                    x{info.mult} → <span style={{ color: 'var(--accent)' }}>{fmtN(bet.amount * info.mult)}</span>
                  </div>
                </div>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                  <span style={{ fontSize: 13, fontWeight: 800, color: 'var(--accent)' }}>
                    {fmtN(bet.amount)}
                  </span>
                  <button
                    onClick={() => removeBet(idx)}
                    style={{
                      background: 'transparent', border: 'none', cursor: 'pointer',
                      color: 'var(--text-muted)', padding: 2,
                      display: 'flex',
                    }}
                    onMouseEnter={(e) => (e.currentTarget.style.color = 'var(--danger)')}
                    onMouseLeave={(e) => (e.currentTarget.style.color = 'var(--text-muted)')}
                  >
                    <X size={14} />
                  </button>
                </div>
              </div>
            );
          })
        )}
      </div>

      {/* Footer */}
      <div style={{
        padding: '14px 16px',
        borderTop: '1px solid var(--border-subtle)',
        background: 'var(--bg-elevated)',
        borderBottomLeftRadius: 12, borderBottomRightRadius: 12,
      }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 4, fontSize: 12 }}>
          <span style={{ color: 'var(--text-muted)' }}>{t('betSlip.totalWager')}</span>
          <span style={{ fontWeight: 700, color: 'var(--text-primary)' }}>{fmtN(totalWager)} XAF</span>
        </div>
        {totalPotential > 0 && (
          <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 12, fontSize: 11 }}>
            <span style={{ color: 'var(--text-muted)' }}>{t('betSlip.maxGain')}</span>
            <span style={{ fontWeight: 700, color: 'var(--success)' }}>{fmtN(totalPotential)} XAF</span>
          </div>
        )}

        <div style={{ display: 'grid', gridTemplateColumns: '1fr 2.2fr', gap: 8 }}>
          <button
            onClick={clearBets}
            disabled={bets.length === 0}
            style={{
              padding: 10, fontSize: 12, fontWeight: 700, cursor: bets.length === 0 ? 'not-allowed' : 'pointer',
              background: 'transparent', color: 'var(--text-secondary)',
              border: '1px solid var(--border-subtle)', borderRadius: 8,
              opacity: bets.length === 0 ? 0.5 : 1,
            }}
          >
            {t('betSlip.clear')}
          </button>
          <button
            onClick={submitTicket}
            disabled={!isBettingOpen || bets.length === 0 || loading}
            style={{
              padding: 10, fontSize: 13, fontWeight: 800,
              background: !isBettingOpen || bets.length === 0 ? 'var(--bg-tile)' : 'var(--accent)',
              color: !isBettingOpen || bets.length === 0 ? 'var(--text-muted)' : 'var(--text-on-accent)',
              border: 'none', borderRadius: 8,
              cursor: !isBettingOpen || bets.length === 0 || loading ? 'not-allowed' : 'pointer',
              display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6,
            }}
          >
            {loading ? t('betSlip.submitting') : (
              <>
                <Trophy size={14} />
                {t('betSlip.submit')}
              </>
            )}
          </button>
        </div>
      </div>
    </div>
  );
};

export default BetSlip;
