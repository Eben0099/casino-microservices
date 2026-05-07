import React, { useState } from 'react';
import { CircleDot, Radio } from 'lucide-react';
import { useAuth } from '../context/AuthContext';
import { useRoulette } from '../hooks/useRoulette';
import { ticketApi } from '../api/endpoints';
import BettingGrid from '../components/BettingGrid';
import BetSlip from '../components/BetSlip';
import GameTile from '../components/GameTile';
import TicketReceipt from '../components/TicketReceipt';

const STAKE_PRESETS = [100, 200, 500, 1000, 2000, 5000, 10000];

const GAMES = [
  { code: 'SW', label: 'Spin & Win', active: true,  available: true  },
  { code: 'VK', label: 'VolKeno',    active: false, available: false },
  { code: 'S3', label: 'Super 3',    active: false, available: false },
  { code: 'CR', label: 'Crash',      active: false, available: false },
  { code: 'LO', label: 'Loto',       active: false, available: false },
];

const phaseMap = {
  Betting:     { label: 'Mise en cours',       color: 'var(--accent)'  },
  BetsClosing: { label: 'Fermeture des mises', color: 'var(--accent)'  },
  Spinning:    { label: 'Tirage…',             color: 'var(--info)'    },
  Result:      { label: 'Résultat',            color: 'var(--success)' },
  Maintenance: { label: 'Maintenance',         color: 'var(--text-muted)' },
};

export const Jeux = () => {
  const { user, balance, fetchBalance } = useAuth();
  const { phase, remaining, gameId } = useRoulette();
  const [bets, setBets] = useState([]);
  const [selectedStake, setSelectedStake] = useState(500);
  const [loading, setLoading] = useState(false);
  const [lastTicket, setLastTicket] = useState(null);
  const [error, setError] = useState('');

  const isBettingOpen = phase === 'Betting';
  const phaseInfo = phaseMap[phase] || { label: 'Connexion…', color: 'var(--text-muted)' };

  const addBet = (type, target) => {
    if (!isBettingOpen) return;
    const idx = bets.findIndex(b => b.bet_type === type && b.bet_target === target);
    if (idx > -1) {
      const next = [...bets];
      next[idx].amount += selectedStake;
      setBets(next);
    } else {
      setBets([...bets, { bet_type: type, bet_target: target, amount: selectedStake }]);
    }
  };

  const removeBet = (idx) => setBets(bets.filter((_, i) => i !== idx));
  const clearBets = () => setBets([]);

  const submitTicket = async () => {
    if (bets.length === 0 || !isBettingOpen) return;
    const totalWager = bets.reduce((acc, b) => acc + b.amount, 0);
    if (totalWager > balance) {
      setError('Solde insuffisant dans la caisse !');
      setTimeout(() => setError(''), 4000);
      return;
    }
    setLoading(true);
    try {
      const res = await ticketApi.create({
        agent_id: user.id,
        game_id: 'ROULETTE-TBL1',
        round_id: gameId,
        bets,
      });
      setLastTicket(res.data);
      setBets([]);
      await fetchBalance(user.id);
    } catch (err) {
      setError(err.response?.data?.detail || 'Erreur lors de la création du ticket');
      setTimeout(() => setError(''), 4000);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="animate-fade" style={{ display: 'grid', gap: 20, gridTemplateColumns: 'minmax(120px, 132px) 1fr minmax(300px, 360px)' }}>
      {/* LEFT — Game tiles */}
      <aside style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
        {GAMES.map((g) => <GameTile key={g.code} {...g} />)}
      </aside>

      {/* CENTER — Phase + Stake selector + Roulette table */}
      <section style={{ display: 'flex', flexDirection: 'column', gap: 16, minWidth: 0 }}>
        {/* Phase status */}
        <div style={{
          display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12,
          padding: '14px 18px', borderRadius: 12,
          background: 'var(--bg-surface)', border: '1px solid var(--border-subtle)',
        }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
            <div style={{
              display: 'flex', alignItems: 'center', gap: 8,
              padding: '6px 12px', borderRadius: 999,
              background: `${phaseInfo.color}1A`, color: phaseInfo.color,
              border: `1px solid ${phaseInfo.color}33`,
              fontSize: 12, fontWeight: 700,
            }}>
              <span className={phase === 'Spinning' ? 'pulse-dot' : ''} style={{
                width: 6, height: 6, borderRadius: 999, background: phaseInfo.color,
              }} />
              {phaseInfo.label}
            </div>
            <div style={{
              display: 'flex', alignItems: 'center', gap: 6,
              fontSize: 11, fontWeight: 700, letterSpacing: '0.1em',
              textTransform: 'uppercase',
              color: gameId ? 'var(--success)' : 'var(--text-muted)',
            }}>
              <Radio size={12} />
              {gameId ? 'En direct' : 'Connexion…'}
            </div>
          </div>
          {remaining != null && (
            <div style={{
              padding: '4px 14px', borderRadius: 999,
              background: `${phaseInfo.color}22`, border: `1px solid ${phaseInfo.color}44`,
              fontSize: 18, fontWeight: 900, fontFamily: 'monospace',
              color: remaining < 10 ? 'var(--danger)' : phaseInfo.color,
            }}>
              {remaining}s
            </div>
          )}
        </div>

        {/* Stake selector */}
        <div style={{
          display: 'flex', alignItems: 'center', gap: 10,
          padding: '10px 16px', borderRadius: 10,
          background: 'var(--bg-surface)', border: '1px solid var(--border-subtle)',
        }}>
          <CircleDot size={14} style={{ color: 'var(--accent)' }} />
          <span style={{
            fontSize: 11, fontWeight: 700, letterSpacing: '0.12em',
            color: 'var(--text-muted)', textTransform: 'uppercase', whiteSpace: 'nowrap',
          }}>
            Mise / pari
          </span>
          <div style={{ display: 'flex', gap: 4, flex: 1, justifyContent: 'center' }}>
            {STAKE_PRESETS.map(stake => {
              const active = selectedStake === stake;
              return (
                <button key={stake} onClick={() => setSelectedStake(stake)}
                  style={{
                    padding: '6px 12px', borderRadius: 6,
                    border: active ? '1.5px solid var(--accent)' : '1px solid var(--border-subtle)',
                    background: active ? 'var(--accent)' : 'var(--bg-tile)',
                    color: active ? 'var(--text-on-accent)' : 'var(--text-secondary)',
                    fontWeight: 800, fontSize: 12, cursor: 'pointer',
                    transition: 'all 0.12s',
                  }}>
                  {stake >= 1000 ? `${stake / 1000}k` : stake}
                </button>
              );
            })}
          </div>
        </div>

        {error && (
          <div style={{
            padding: '10px 14px', borderRadius: 8,
            background: 'rgba(239,68,68,0.1)', border: '1px solid rgba(239,68,68,0.3)',
            color: 'var(--danger)', fontSize: 13, fontWeight: 600,
          }}>
            {error}
          </div>
        )}

        {/* Betting Grid */}
        <BettingGrid addBet={addBet} isBettingOpen={isBettingOpen} />
      </section>

      {/* RIGHT — Bet slip */}
      <aside>
        <BetSlip
          bets={bets}
          removeBet={removeBet}
          clearBets={clearBets}
          submitTicket={submitTicket}
          isBettingOpen={isBettingOpen}
          loading={loading}
          ticketLabel={`Ticket Spin & Win`}
          shopLabel={user?.kiosk_name || user?.name || 'Caisse'}
          shopMeta={gameId ? `→ ${gameId}` : null}
        />
      </aside>

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

export default Jeux;
