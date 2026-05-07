import React, { useState } from 'react';
import { useAuth } from '../context/AuthContext';
import { useRoulette } from '../hooks/useRoulette';
import { ticketApi } from '../api/endpoints';
import { LogOut, Wallet, Ticket as TicketIcon, Clock, Search, CircleDot, Trophy, X, Sun, Moon } from 'lucide-react';
import { useTheme } from '../context/ThemeContext';
import BettingGrid from '../components/BettingGrid';
import TicketVerifier from '../components/TicketVerifier';
import TicketReceipt from '../components/TicketReceipt';

export const Dashboard = () => {
  const { user, balance, logout, fetchBalance } = useAuth();
  const { phase, remaining, gameId } = useRoulette();
  const { theme, toggleTheme } = useTheme();
  const isDark = theme === 'dark';
  const [bets, setBets] = useState([]);
  const [selectedStake, setSelectedStake] = useState(500);
  const [loading, setLoading] = useState(false);
  const [lastTicket, setLastTicket] = useState(null);

  const STAKE_PRESETS = [100, 200, 500, 1000, 2000, 5000, 10000];

  const addBet = (type, target) => {
    if (phase !== 'Betting') return;
    const amount = selectedStake;
    const existingIdx = bets.findIndex(b => b.bet_type === type && b.bet_target === target);
    if (existingIdx > -1) {
      const newBets = [...bets];
      newBets[existingIdx].amount += amount;
      setBets(newBets);
    } else {
      setBets([...bets, { bet_type: type, bet_target: target, amount }]);
    }
  };

  const removeBet = (idx) => {
    setBets(bets.filter((_, i) => i !== idx));
  };

  const clearBets = () => setBets([]);

  const submitTicket = async () => {
    if (bets.length === 0 || phase !== 'Betting') return;
    const totalWager = bets.reduce((acc, b) => acc + b.amount, 0);
    if (totalWager > balance) {
      alert("Solde insuffisant dans la caisse !");
      return;
    }
    setLoading(true);
    try {
      const res = await ticketApi.create({
        agent_id: user.id,
        game_id: "ROULETTE-TBL1",
        round_id: gameId,
        bets: bets
      });
      setLastTicket(res.data);
      setBets([]);
      await fetchBalance(user.id);
    } catch (err) {
      alert(err.response?.data?.detail || "Erreur lors de la creation du ticket");
    } finally {
      setLoading(false);
    }
  };

  const isBettingOpen = phase === 'Betting';
  const totalWager = bets.reduce((acc, b) => acc + b.amount, 0);
  const totalPotential = bets.reduce((acc, b) => acc + (b.amount * getBetInfo(b).mult), 0);

  const phaseLabel = {
    'Betting': 'PARIS OUVERTS',
    'BetsClosing': 'FERMETURE...',
    'Spinning': 'TIRAGE EN COURS',
    'Result': 'RESULTAT'
  }[phase] || phase || 'CONNEXION...';

  const phaseColor = isBettingOpen ? '#10b981' : phase === 'Spinning' ? '#f59e0b' : '#ef4444';

  return (
    <div style={{ minHeight: '100vh', background: 'var(--bg-deep)', padding: '0.75rem 1rem', maxWidth: '1440px', margin: '0 auto' }}>

      {/* ========== TOP BAR ========== */}
      <header style={{
        display: 'flex', justifyContent: 'space-between', alignItems: 'center',
        padding: '0.75rem 1.5rem', marginBottom: '0.75rem',
        background: 'var(--bg-header)',
        backdropFilter: 'blur(12px)', borderRadius: '1rem',
        border: '1px solid var(--glass-border)',
        boxShadow: 'var(--shadow-card)'
      }}>
        {/* Brand + Balance */}
        <div style={{ display: 'flex', alignItems: 'center', gap: '1.25rem' }}>
          <div style={{
            background: 'linear-gradient(135deg, #fbbf24, #f59e0b)',
            padding: '8px 14px', borderRadius: '10px',
            display: 'flex', alignItems: 'center', gap: '6px',
            boxShadow: '0 2px 12px rgba(251,191,36,0.3)'
          }}>
            <span style={{ color: '#000', fontWeight: '900', fontSize: '0.8rem', letterSpacing: '2px', fontFamily: 'Outfit' }}>AGD</span>
          </div>
          <div>
            <div style={{ fontSize: '0.65rem', color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '1.5px', fontWeight: '600' }}>Caisse</div>
            <div style={{ fontWeight: '800', fontSize: '1.3rem', fontFamily: 'Outfit', letterSpacing: '-0.5px' }}>
              {balance.toLocaleString()} <span style={{ fontSize: '0.75rem', color: 'var(--text-muted)', fontWeight: '500' }}>XAF</span>
            </div>
          </div>
        </div>

        {/* Phase indicator - center */}
        <div style={{
          display: 'flex', alignItems: 'center', gap: '12px',
          background: 'var(--phase-badge-bg)', padding: '8px 20px', borderRadius: '2rem',
          border: `1px solid ${phaseColor}33`
        }}>
          <div style={{
            width: 10, height: 10, borderRadius: '50%',
            background: phaseColor,
            boxShadow: `0 0 8px ${phaseColor}`,
            animation: isBettingOpen ? 'none' : 'pulse 1.5s infinite'
          }} />
          <span style={{ fontSize: '0.75rem', fontWeight: '700', letterSpacing: '2px', color: phaseColor, textTransform: 'uppercase' }}>
            {phaseLabel}
          </span>
          <div style={{
            background: `${phaseColor}22`, padding: '4px 12px', borderRadius: '1rem',
            border: `1px solid ${phaseColor}44`
          }}>
            <span style={{
              fontSize: '1.1rem', fontWeight: '900', fontFamily: 'monospace',
              color: remaining < 10 ? '#ef4444' : phaseColor
            }}>
              {remaining}s
            </span>
          </div>
        </div>

        {/* User + Theme Toggle + Logout */}
        <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
          <div style={{ textAlign: 'right' }}>
            <div style={{ fontWeight: '700', fontSize: '0.9rem' }}>{user?.name}</div>
            <div style={{ fontSize: '0.6rem', color: 'var(--text-muted)', letterSpacing: '1px' }}>ID: {user?.id?.split('-')[0]}</div>
          </div>
          <button onClick={toggleTheme} title={isDark ? 'Mode clair' : 'Mode sombre'} style={{
            background: 'var(--bg-hover)', border: '1px solid var(--glass-border)',
            color: 'var(--accent-primary)', padding: '8px', borderRadius: '10px', cursor: 'pointer',
            transition: 'all 0.15s', display: 'flex', alignItems: 'center'
          }}>
            {isDark ? <Sun size={18} /> : <Moon size={18} />}
          </button>
          <button onClick={logout} style={{
            background: 'var(--bg-hover)', border: '1px solid var(--glass-border)',
            color: 'var(--text-muted)', padding: '8px', borderRadius: '10px', cursor: 'pointer',
            transition: 'all 0.15s', display: 'flex', alignItems: 'center'
          }}>
            <LogOut size={18} />
          </button>
        </div>
      </header>

      {/* ========== MAIN GRID ========== */}
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 320px', gap: '0.75rem', alignItems: 'start' }}>

        {/* LEFT: Table + Stakes */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>

          {/* Stake selector */}
          <div style={{
            display: 'flex', alignItems: 'center', gap: '10px',
            padding: '10px 16px',
            background: 'var(--glass-bg)', backdropFilter: 'blur(8px)',
            borderRadius: '12px', border: '1px solid var(--glass-border)'
          }}>
            <CircleDot size={14} color="var(--accent-primary)" />
            <span style={{ fontSize: '0.7rem', fontWeight: '700', color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '1.5px', whiteSpace: 'nowrap' }}>
              Mise :
            </span>
            <div style={{ display: 'flex', gap: '4px', flex: 1, justifyContent: 'center' }}>
              {STAKE_PRESETS.map(stake => {
                const active = selectedStake === stake;
                return (
                  <button key={stake} onClick={() => setSelectedStake(stake)}
                    style={{
                      padding: '6px 12px', borderRadius: '8px',
                      border: active ? '1.5px solid var(--accent-primary)' : '1px solid var(--glass-border)',
                      background: active ? 'linear-gradient(135deg, var(--accent-primary), var(--accent-secondary))' : 'var(--bg-input)',
                      color: active ? 'var(--text-inverse)' : 'var(--text-main)',
                      fontWeight: '800', fontSize: '0.78rem', cursor: 'pointer',
                      transition: 'all 0.12s',
                      boxShadow: active ? '0 0 12px rgba(251,191,36,0.35)' : 'none',
                      transform: active ? 'scale(1.06)' : 'scale(1)'
                    }}
                  >{stake >= 1000 ? `${stake / 1000}k` : stake}</button>
                );
              })}
            </div>
          </div>

          {/* Betting Grid */}
          <BettingGrid addBet={addBet} isBettingOpen={isBettingOpen} />

          {/* Ticket Verifier */}
          <TicketVerifier />
        </div>

        {/* RIGHT: Bet Slip */}
        <div style={{
          background: 'var(--bet-slip-bg)',
          backdropFilter: 'blur(12px)',
          borderRadius: '1rem',
          border: '1px solid var(--glass-border)',
          display: 'flex', flexDirection: 'column',
          maxHeight: 'calc(100vh - 100px)',
          boxShadow: 'var(--shadow-card)'
        }}>

          {/* Slip header */}
          <div style={{
            padding: '14px 18px', display: 'flex', justifyContent: 'space-between', alignItems: 'center',
            borderBottom: '1px solid var(--glass-border)',
            background: 'var(--bg-hover)'
          }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
              <TicketIcon size={18} color="var(--accent-primary)" />
              <span style={{ fontWeight: '700', fontSize: '0.9rem', fontFamily: 'Outfit' }}>Ticket</span>
            </div>
            {bets.length > 0 && (
              <span style={{
                background: 'var(--accent-primary)', color: '#000',
                padding: '2px 10px', borderRadius: '1rem', fontSize: '0.7rem', fontWeight: '800'
              }}>{bets.length} pari{bets.length > 1 ? 's' : ''}</span>
            )}
          </div>

          {/* Bets list */}
          <div style={{
            flex: 1, overflowY: 'auto', padding: '10px 12px',
            display: 'flex', flexDirection: 'column', gap: '6px',
            minHeight: '200px'
          }}>
            {bets.length === 0 ? (
              <div style={{
                flex: 1, display: 'flex', flexDirection: 'column',
                alignItems: 'center', justifyContent: 'center', gap: '12px',
                opacity: 0.25, padding: '2rem 0'
              }}>
                <TicketIcon size={36} strokeWidth={1} />
                <span style={{ fontSize: '0.8rem', fontWeight: '500' }}>Cliquez sur la table pour parier</span>
              </div>
            ) : (
              bets.map((bet, idx) => {
                const info = getBetInfo(bet);
                const betColor = bet.bet_type === 'STRAIGHT' ? 'var(--accent-primary)'
                  : bet.bet_type === 'COLOR' && bet.bet_target === 'RED' ? '#ef4444'
                  : bet.bet_type === 'COLOR' && bet.bet_target === 'BLACK' ? '#6b7280'
                  : 'rgba(255,255,255,0.15)';
                return (
                  <div key={idx} style={{
                    background: 'var(--bet-row-bg)',
                    padding: '10px 12px', borderRadius: '10px',
                    display: 'flex', justifyContent: 'space-between', alignItems: 'center',
                    borderLeft: `3px solid ${betColor}`,
                    transition: 'background 0.1s'
                  }}
                    onMouseEnter={e => e.currentTarget.style.background = 'var(--bet-row-hover)'}
                    onMouseLeave={e => e.currentTarget.style.background = 'var(--bet-row-bg)'}
                  >
                    <div style={{ flex: 1 }}>
                      <div style={{ fontWeight: '700', fontSize: '0.85rem' }}>{info.label}</div>
                      <div style={{ fontSize: '0.65rem', color: 'var(--text-muted)', marginTop: '1px' }}>
                        x{info.mult} &rarr; <span style={{ color: 'var(--accent-primary)' }}>{(bet.amount * info.mult).toLocaleString()}</span>
                      </div>
                    </div>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                      <span style={{ fontWeight: '800', fontSize: '0.9rem', color: 'var(--accent-primary)' }}>
                        {bet.amount.toLocaleString()}
                      </span>
                      <button onClick={() => removeBet(idx)} style={{
                        background: 'none', border: 'none', cursor: 'pointer',
                        color: 'rgba(255,255,255,0.2)', padding: '2px', display: 'flex',
                        transition: 'color 0.1s'
                      }}
                        onMouseEnter={e => e.currentTarget.style.color = '#ef4444'}
                        onMouseLeave={e => e.currentTarget.style.color = 'rgba(255,255,255,0.2)'}
                      >
                        <X size={14} />
                      </button>
                    </div>
                  </div>
                );
              })
            )}
          </div>

          {/* Slip footer */}
          <div style={{
            padding: '14px 16px',
            borderTop: '1px solid var(--glass-border)',
            background: 'var(--bet-slip-footer)'
          }}>
            {/* Totals */}
            <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '4px', fontSize: '0.8rem' }}>
              <span style={{ color: 'var(--text-muted)' }}>Total mise</span>
              <span style={{ fontWeight: '700' }}>{totalWager.toLocaleString()} XAF</span>
            </div>
            {totalPotential > 0 && (
              <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '12px', fontSize: '0.75rem' }}>
                <span style={{ color: 'var(--text-muted)' }}>Gain potentiel</span>
                <span style={{ fontWeight: '700', color: '#10b981' }}>{totalPotential.toLocaleString()} XAF</span>
              </div>
            )}

            {/* Buttons */}
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 2.5fr', gap: '8px' }}>
              <button onClick={clearBets} style={{
                padding: '12px', fontSize: '0.8rem', fontWeight: '700',
                background: 'var(--bg-hover)', border: '1px solid var(--glass-border)',
                color: 'var(--text-main)', borderRadius: '10px', cursor: 'pointer',
                transition: 'all 0.12s'
              }}>Vider</button>
              <button
                onClick={submitTicket}
                disabled={!isBettingOpen || bets.length === 0 || loading}
                style={{
                  padding: '12px', fontSize: '0.85rem', fontWeight: '800',
                  background: (!isBettingOpen || bets.length === 0)
                    ? 'var(--bg-hover)'
                    : 'linear-gradient(135deg, var(--accent-primary), var(--accent-secondary))',
                  border: 'none',
                  color: (!isBettingOpen || bets.length === 0) ? 'var(--text-muted)' : 'var(--text-inverse)',
                  borderRadius: '10px',
                  cursor: (!isBettingOpen || bets.length === 0) ? 'not-allowed' : 'pointer',
                  transition: 'all 0.15s',
                  boxShadow: (isBettingOpen && bets.length > 0) ? '0 4px 15px rgba(251,191,36,0.3)' : 'none',
                  display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '8px',
                  letterSpacing: '0.5px'
                }}
              >
                {loading ? 'Validation...' : (
                  <>
                    <Trophy size={16} />
                    Valider le Ticket
                  </>
                )}
              </button>
            </div>
          </div>
        </div>
      </div>

      {/* Pulse animation for phase indicator */}
      <style>{`
        @keyframes pulse {
          0%, 100% { opacity: 1; }
          50% { opacity: 0.4; }
        }
      `}</style>

      {/* Ticket Receipt Modal */}
      {lastTicket && (
        <TicketReceipt
          ticket={lastTicket}
          onClose={() => setLastTicket(null)}
          showMaxGain={true}
        />
      )}
    </div>
  );
};

function getBetInfo(bet) {
  switch (bet.bet_type) {
    case 'STRAIGHT': return { label: `Plein ${bet.bet_target}`, mult: 36 };
    case 'SPLIT': return { label: `Cheval ${bet.bet_target}`, mult: 18 };
    case 'CORNER': return { label: `Carre ${bet.bet_target}`, mult: 9 };
    case 'STREET': return { label: `Transv. ${bet.bet_target}`, mult: 12 };
    case 'SIX_LINE': return { label: `Sixain ${bet.bet_target}`, mult: 6 };
    case 'DOZEN': return { label: `Douz. ${bet.bet_target}`, mult: 3 };
    case 'COLUMN': return { label: `Col. ${bet.bet_target}`, mult: 3 };
    case 'COLOR': return { label: bet.bet_target === 'RED' ? 'Rouge' : 'Noir', mult: 2 };
    case 'EVEN_ODD': return { label: bet.bet_target === 'EVEN' ? 'Pair' : 'Impair', mult: 2 };
    case 'HALF': return { label: bet.bet_target === '1-18' ? 'Manque' : 'Passe', mult: 2 };
    default: return { label: bet.bet_target, mult: 1 };
  }
}
