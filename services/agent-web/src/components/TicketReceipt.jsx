import React from 'react';
import { Printer, X } from 'lucide-react';

const BET_LABELS = {
  STRAIGHT: 'Plein', SPLIT: 'Cheval', CORNER: 'Carre', STREET: 'Transversale',
  SIX_LINE: 'Sixain', DOZEN: 'Douzaine', COLUMN: 'Colonne',
  COLOR: 'Couleur', EVEN_ODD: 'Pair/Impair', HALF: 'Manque/Passe'
};

const BET_MULTIPLIERS = {
  STRAIGHT: 36, SPLIT: 18, STREET: 12, CORNER: 9,
  SIX_LINE: 6, COLUMN: 3, DOZEN: 3, COLOR: 2, EVEN_ODD: 2, HALF: 2
};

const RED_NUMBERS = [1,3,5,7,9,12,14,16,18,19,21,23,25,27,30,32,34,36];

const getTargetLabel = (type, target) => {
  if (type === 'COLOR') return target === 'RED' ? 'Rouge' : 'Noir';
  if (type === 'EVEN_ODD') return target === 'EVEN' ? 'Pair' : 'Impair';
  if (type === 'HALF') return target === '1-18' ? 'Manque (1-18)' : 'Passe (19-36)';
  if (type === 'DOZEN') {
    if (target === '1st') return '1ere Douzaine';
    if (target === '2nd') return '2eme Douzaine';
    return '3eme Douzaine';
  }
  if (type === 'COLUMN') return `Colonne ${target}`;
  return target;
};

const getNumberColor = (n) => {
  const num = parseInt(n);
  if (num === 0) return '#10b981';
  return RED_NUMBERS.includes(num) ? '#ef4444' : '#1e293b';
};

const TicketReceipt = ({ ticket, onClose, onPayout, payoutLoading, showMaxGain = false }) => {
  if (!ticket) return null;

  const isResolved = ticket.status !== 'PENDING';
  const isWon = ticket.status === 'WON';
  const isPaid = ticket.status === 'PAID';
  const isLost = ticket.status === 'LOST';
  const createdAt = ticket.created_at ? new Date(ticket.created_at) : null;

  const maxGain = ticket.bets.reduce((acc, b) => {
    const mult = BET_MULTIPLIERS[b.bet_type] || 1;
    return acc + (b.amount * mult);
  }, 0);

  const handlePrint = () => window.print();

  // Barcode-like visual from short_code
  const barcodeChars = (ticket.short_code || '').replace(/[^A-Z0-9]/g, '');

  return (
    <div style={{
      position: 'fixed', inset: 0, zIndex: 1000,
      display: 'flex', alignItems: 'center', justifyContent: 'center',
      background: 'rgba(0,0,0,0.7)', backdropFilter: 'blur(8px)'
    }}>
      <div className="animate-fade" style={{ position: 'relative', width: '380px', maxHeight: '90vh', overflowY: 'auto' }}>
        {/* Close button */}
        <button onClick={onClose} style={{
          position: 'absolute', top: '-12px', right: '-12px', zIndex: 10,
          background: '#334155', border: 'none', borderRadius: '50%',
          width: '32px', height: '32px', display: 'flex', alignItems: 'center', justifyContent: 'center',
          cursor: 'pointer', color: '#fff'
        }}>
          <X size={16} />
        </button>

        {/* Ticket receipt */}
        <div id="ticket-receipt" style={{
          background: '#faf9f6', color: '#1a1a1a', borderRadius: '12px',
          overflow: 'hidden', fontFamily: "'Inter', monospace",
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
              Ticket de Pari Officiel
            </div>
            <div style={{ fontSize: '10px', color: '#94a3b8', marginTop: '4px' }}>
              Table Roulette 1
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
              <span>Round: {ticket.round_id?.replace('ROUND-', '#')}</span>
              <span>{createdAt ? createdAt.toLocaleString('fr-FR', { day: '2-digit', month: '2-digit', year: '2-digit', hour: '2-digit', minute: '2-digit' }) : ''}</span>
            </div>
          </div>

          {/* Winning number (if resolved) */}
          {isResolved && ticket.winning_number != null && (
            <div style={{ padding: '12px 24px', borderBottom: '1px dashed #e2e8f0', textAlign: 'center' }}>
              <div style={{ fontSize: '10px', fontWeight: '700', color: '#64748b', letterSpacing: '2px', marginBottom: '6px', textTransform: 'uppercase' }}>
                Numero Gagnant
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
              Detail des paris ({ticket.bets.length})
            </div>

            {ticket.bets.map((bet, idx) => {
              const label = BET_LABELS[bet.bet_type] || bet.bet_type;
              const target = getTargetLabel(bet.bet_type, bet.bet_target);
              const mult = BET_MULTIPLIERS[bet.bet_type] || 1;
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
                      <span style={{ fontSize: '11px', color: '#94a3b8' }}>x{mult}</span>
                    </div>
                    <div style={{ fontSize: '11px', color: '#64748b', marginTop: '1px', marginLeft: isResolved ? '22px' : 0 }}>
                      {target}
                    </div>
                  </div>
                  <div style={{ textAlign: 'right' }}>
                    <div style={{ fontSize: '13px', fontWeight: '700' }}>{bet.amount.toLocaleString()}</div>
                    {bet.is_winning && bet.payout > 0 && (
                      <div style={{ fontSize: '12px', fontWeight: '800', color: '#16a34a' }}>+{bet.payout.toLocaleString()}</div>
                    )}
                  </div>
                </div>
              );
            })}
          </div>

          {/* Totals */}
          <div style={{ padding: '14px 24px' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '6px', fontSize: '12px', color: '#64748b' }}>
              <span>Mise totale</span>
              <span style={{ fontWeight: '700', color: '#1a1a1a' }}>{(ticket.total_wager || 0).toLocaleString()} XAF</span>
            </div>

            {!isResolved && showMaxGain && (
              <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '6px', fontSize: '12px', color: '#64748b' }}>
                <span>Gain potentiel max</span>
                <span style={{ fontWeight: '700', color: '#f59e0b' }}>{maxGain.toLocaleString()} XAF</span>
              </div>
            )}

            {isResolved && (
              <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '12px', color: '#64748b' }}>
                <span>Gains</span>
                <span style={{ fontWeight: '700', color: (isWon || isPaid) ? '#16a34a' : '#1a1a1a' }}>
                  {(ticket.total_payout || 0).toLocaleString()} XAF
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
              {isWon ? 'GAGNANT' : isPaid ? 'DEJA PAYE' : 'PERDANT'}
              {(isWon || isPaid) && ticket.total_payout > 0 && (
                <div style={{ fontSize: '24px', marginTop: '4px' }}>
                  {ticket.total_payout.toLocaleString()} XAF
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
              EN ATTENTE DU TIRAGE
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
                {payoutLoading ? 'PAIEMENT EN COURS...' : 'PAYER LE CLIENT'}
              </button>
            </div>
          )}

          {/* Footer */}
          <div style={{
            padding: '12px 24px', textAlign: 'center',
            borderTop: '2px dashed #d1d5db', fontSize: '10px', color: '#94a3b8'
          }}>
            <div>Merci pour votre confiance</div>
            <div style={{ marginTop: '2px' }}>Conservez ce ticket pour toute reclamation</div>
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

        {/* Print button below ticket */}
        <div style={{ display: 'flex', gap: '8px', marginTop: '12px', justifyContent: 'center' }}>
          <button onClick={handlePrint} style={{
            background: 'rgba(255,255,255,0.1)', border: '1px solid rgba(255,255,255,0.2)',
            color: '#fff', padding: '10px 24px', borderRadius: '8px', cursor: 'pointer',
            display: 'flex', alignItems: 'center', gap: '8px', fontSize: '13px', fontWeight: '600'
          }}>
            <Printer size={16} /> Imprimer
          </button>
        </div>
      </div>
    </div>
  );
};

export default TicketReceipt;
