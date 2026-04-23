import React, { useState } from 'react';
import { useAuth } from '../context/AuthContext';
import { useRoulette } from '../hooks/useRoulette';
import { ticketApi } from '../api/endpoints';
import { LogOut, Wallet, Ticket as TicketIcon, Clock, Search } from 'lucide-react';
import BettingGrid from '../components/BettingGrid';
import TicketVerifier from '../components/TicketVerifier';

const ROULETTE_NUMBERS = Array.from({ length: 37 }, (_, i) => i);

export const Dashboard = () => {
  const { user, balance, logout, fetchBalance } = useAuth();
  const { phase, remaining, gameId } = useRoulette();
  const [bets, setBets] = useState([]);
  const [selectedStake, setSelectedStake] = useState(500);
  const [loading, setLoading] = useState(false);
  const [lastTicket, setLastTicket] = useState(null);

  const STAKE_PRESETS = [100, 200, 500, 1000, 2000, 5000, 10000];

  const addBet = (type, target) => {
    if (phase !== 'Betting') return;
    const amount = selectedStake;
    
    // On vérifie si ce pari existe déjà pour l'incrémenter ou on l'ajoute
    const existingIdx = bets.findIndex(b => b.bet_type === type && b.bet_target === target);
    if (existingIdx > -1) {
      const newBets = [...bets];
      newBets[existingIdx].amount += amount;
      setBets(newBets);
    } else {
      setBets([...bets, { bet_type: type, bet_target: target, amount }]);
    }
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
      alert(err.response?.data?.detail || "Erreur lors de la création du ticket");
    } finally {
      setLoading(false);
    }
  };

  const isBettingOpen = phase === 'Betting';

  // Helper pour afficher le nom du pari et son multiplicateur
  const getBetInfo = (bet) => {
    switch(bet.bet_type) {
      case 'STRAIGHT': return { label: `Plein ${bet.bet_target}`, mult: 36 };
      case 'SPLIT': return { label: `Cheval ${bet.bet_target}`, mult: 18 };
      case 'CORNER': return { label: `Carré ${bet.bet_target}`, mult: 9 };
      case 'STREET': return { label: `Transv. ${bet.bet_target}`, mult: 12 };
      case 'SIX_LINE': return { label: `Sixain ${bet.bet_target}`, mult: 6 };
      case 'DOZEN': return { label: `Douz. ${bet.bet_target}`, mult: 3 };
      case 'COLUMN': return { label: `Col. ${bet.bet_target}`, mult: 3 };
      case 'COLOR': return { label: bet.bet_target === 'RED' ? 'Rouge' : 'Noir', mult: 2 };
      case 'EVEN_ODD': return { label: bet.bet_target === 'EVEN' ? 'Pair' : 'Impair', mult: 2 };
      case 'HALF': return { label: bet.bet_target === '1-18' ? 'Manque' : 'Passe', mult: 2 };
      default: return { label: bet.bet_target, mult: 1 };
    }
  };

  return (
    <div style={{ padding: '1.5rem', maxWidth: '1400px', margin: '0 auto', display: 'flex', flexDirection: 'column', gap: '1.5rem' }}>
      {/* Header */}
      <header className="glass-panel" style={{ padding: '1rem 2rem', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '1rem' }}>
          <div style={{ background: 'var(--accent-primary)', color: '#000', padding: '0.5rem', borderRadius: '0.5rem' }}>
            <Wallet size={20} />
          </div>
          <div>
            <p style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>Solde Caisse</p>
            <p style={{ fontWeight: '700', fontSize: '1.25rem' }}>{balance.toLocaleString()} XAF</p>
          </div>
        </div>
        
        <div style={{ textAlign: 'center' }}>
          <h2 className="neon-text" style={{ fontSize: '1.5rem' }}>{user?.name}</h2>
          <p style={{ fontSize: '0.7rem', opacity: 0.6 }}>AGENT ID: {user?.id?.split('-')[0]}...</p>
        </div>

        <button onClick={logout} style={{ background: 'none', border: '1px solid var(--glass-border)', color: 'var(--text-muted)', padding: '0.5rem 1rem', borderRadius: '0.5rem', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
          <LogOut size={18} />
          Quitter
        </button>
      </header>

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 350px', gap: '1.5rem', alignItems: 'start' }}>
        {/* Betting Area */}
        <div className="glass-panel" style={{ padding: '1.5rem' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1.5rem' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
              <div style={{ width: '12px', height: '12px', borderRadius: '50%', background: isBettingOpen ? 'var(--success)' : 'var(--danger)', boxShadow: isBettingOpen ? '0 0 10px var(--success)' : 'none' }} />
              <h3 style={{ fontSize: '1.1rem', fontWeight: '600' }}>
                TABLE 1 - {isBettingOpen ? "PARIS OUVERTS" : "ENTRÉE DES RÉSULTATS..."}
              </h3>
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: '1rem', background: 'rgba(0,0,0,0.3)', padding: '0.4rem 1.2rem', borderRadius: '2rem', border: '1px solid var(--border-glow)' }}>
              <Clock size={16} color={remaining < 10 ? 'var(--danger)' : 'var(--accent-primary)'} />
              <span style={{ fontSize: '1.25rem', fontWeight: '700', fontFamily: 'monospace', color: remaining < 10 ? 'var(--danger)' : 'var(--accent-primary)' }}>
                {remaining}s
              </span>
            </div>
          </div>

          {/* Sélecteur de mise */}
          <div style={{ display: 'flex', alignItems: 'center', gap: '1rem', marginBottom: '1.5rem', padding: '0.75rem', background: 'rgba(255,255,255,0.03)', borderRadius: '0.8rem', border: '1px solid var(--glass-border)' }}>
            <span style={{ fontSize: '0.75rem', fontWeight: '800', opacity: 0.5, textTransform: 'uppercase', letterSpacing: '0.05em' }}>Mise actuelle :</span>
            <div style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap' }}>
              {STAKE_PRESETS.map(stake => (
                <button
                  key={stake}
                  onClick={() => setSelectedStake(stake)}
                  style={{
                    padding: '0.4rem 1rem',
                    borderRadius: '0.5rem',
                    border: '1px solid var(--glass-border)',
                    background: selectedStake === stake ? 'var(--accent-primary)' : 'rgba(255,255,255,0.05)',
                    color: selectedStake === stake ? '#000' : '#fff',
                    fontWeight: '800',
                    cursor: 'pointer',
                    transition: 'all 0.1s ease',
                    fontSize: '0.85rem',
                    boxShadow: selectedStake === stake ? '0 0 15px rgba(251, 191, 36, 0.3)' : 'none',
                    transform: selectedStake === stake ? 'scale(1.05)' : 'scale(1)'
                  }}
                >
                  {stake.toLocaleString()}
                </button>
              ))}
            </div>
          </div>

          <BettingGrid addBet={addBet} isBettingOpen={isBettingOpen} />
        </div>

        {/* Bet Slip */}
        <div className="glass-panel" style={{ padding: '1.5rem', height: '600px', display: 'flex', flexDirection: 'column' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', borderBottom: '1px solid var(--glass-border)', paddingBottom: '1rem', marginBottom: '1rem' }}>
            <TicketIcon size={20} color="var(--accent-primary)" />
            <h3 style={{ fontSize: '1.1rem', fontWeight: '600' }}>Ticket en cours</h3>
          </div>

          <div style={{ flex: 1, overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: '0.5rem', paddingRight: '0.5rem' }}>
            {bets.length === 0 ? (
              <div style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', opacity: 0.3 }}>
                <TicketIcon size={48} style={{ marginBottom: '1rem' }} />
                <p>Aucun pari</p>
              </div>
            ) : (
              bets.map((bet, idx) => {
                const info = getBetInfo(bet);
                return (
                  <div key={idx} style={{ 
                    background: 'rgba(255,255,255,0.03)', 
                    padding: '0.75rem', 
                    borderRadius: '0.6rem', 
                    display: 'flex', 
                    justifyContent: 'space-between',
                    borderLeft: `4px solid ${bet.bet_type === 'STRAIGHT' ? 'var(--accent-primary)' : 'rgba(255,255,255,0.2)'}`
                  }}>
                    <div style={{ display: 'flex', flexDirection: 'column' }}>
                      <span style={{ fontWeight: '700', fontSize: '0.9rem' }}>{info.label}</span>
                      <span style={{ fontSize: '0.7rem', color: 'var(--text-muted)' }}>Potentiel: { ((bet.amount * info.mult) || 0).toLocaleString() }</span>
                    </div>
                    <span style={{ fontWeight: '800', color: 'var(--accent-primary)' }}>{(bet.amount || 0).toLocaleString()}</span>
                  </div>
                );
              })
            )}
          </div>

          <div style={{ borderTop: '1px solid var(--glass-border)', paddingTop: '1rem', marginTop: '1rem' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '1rem', fontSize: '1.1rem', fontWeight: '700' }}>
              <span>Total Mise</span>
              <span style={{ color: 'var(--accent-primary)' }}>{bets.reduce((acc, b) => acc + b.amount, 0).toLocaleString()} XAF</span>
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 2fr', gap: '0.5rem' }}>
              <button onClick={clearBets} className="btn-secondary" style={{ padding: '0.8rem', fontSize: '0.9rem' }}>Vider</button>
              <button 
                onClick={submitTicket}
                disabled={!isBettingOpen || bets.length === 0 || loading} 
                className="btn-primary"
                style={{ padding: '0.8rem', fontSize: '0.9rem' }}
              >
                {loading ? "Calcul..." : "Imprimer Ticket"}
              </button>
            </div>
          </div>
        </div>

        <TicketVerifier />
      </div>

      {lastTicket && (
        <div className="glass-panel" style={{ padding: '1.5rem', border: '2px solid var(--success)', background: 'rgba(16, 185, 129, 0.1)', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '1.5rem' }}>
            <div style={{ background: 'var(--success)', color: '#fff', padding: '0.75rem', borderRadius: '50%' }}>
              <TicketIcon size={24} />
            </div>
            <div>
              <p style={{ color: 'var(--success)', fontWeight: '700', fontSize: '1.1rem' }}>TICKET VALIDÉ !</p>
              <div style={{ display: 'flex', gap: '1.5rem', marginTop: '0.25rem' }}>
                <span style={{ fontSize: '0.9rem' }}>CODE: <strong style={{ fontSize: '1.1rem' }}>{lastTicket.short_code}</strong></span>
                <span style={{ fontSize: '0.9rem' }}>MISE: <strong>{(lastTicket.total_wager || 0).toLocaleString()} XAF</strong></span>
                <span style={{ fontSize: '0.9rem', color: 'var(--accent-primary)' }}>GAIN MAX: <strong>{
                  lastTicket.bets.reduce((acc, b) => acc + (b.amount * getBetInfo(b).mult), 0).toLocaleString()
                } XAF</strong></span>
              </div>
            </div>
          </div>
          <button onClick={() => setLastTicket(null)} className="btn-primary" style={{ padding: '0.7rem 2rem' }}>OK</button>
        </div>
      )}
    </div>
  );
};
