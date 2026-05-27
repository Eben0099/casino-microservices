import React, { useState, useEffect } from 'react';
import { CircleDot, Radio } from 'lucide-react';
import { useAuth } from '../context/AuthContext';
import { useRoulette } from '../hooks/useRoulette';
import { ticketApi } from '../api/endpoints';
import { useT } from '../i18n';
import BettingGrid from '../components/BettingGrid';
import BetSlip from '../components/BetSlip';
import GamesSidebar from '../components/GamesSidebar';
import TicketReceipt from '../components/TicketReceipt';
import OddsTable from '../components/OddsTable';
import TicketVerifier from '../components/TicketVerifier';
import JackpotsBar from '../components/JackpotsBar';
import JackpotHitOverlay from '../components/JackpotHitOverlay';
import { useKioskJackpots } from '../hooks/useKioskJackpots';

const STAKE_PRESETS = [100, 200, 500, 1000, 2000, 5000, 10000];

const PHASE_COLOR = {
  Betting:     'var(--accent)',
  BetsClosing: 'var(--accent)',
  Spinning:    'var(--info)',
  Result:      'var(--success)',
  Maintenance: 'var(--text-muted)',
};

export const Jeux = () => {
  const { user, balance, fetchBalance } = useAuth();
  const { phase, remaining, gameId } = useRoulette();
  const { t } = useT();
  const [bets, setBets] = useState([]);
  const [selectedStake, setSelectedStake] = useState(500);
  const [betMode, setBetMode] = useState(null); // null = Tous; sinon STRAIGHT, COLOR, etc.
  const [loading, setLoading] = useState(false);
  const [lastTicket, setLastTicket] = useState(null);
  const [error, setError] = useState('');
  const [jackpotHit, setJackpotHit] = useState(null);
  const [replayRounds, setReplayRounds] = useState(1);

  const { pots: jackpotPots, refresh: refreshJackpots } = useKioskJackpots(user?.kiosk_code);

  const isBettingOpen = phase === 'Betting';
  const phaseInfo = phase && PHASE_COLOR[phase]
    ? { label: t(`phase.${phase}`), color: PHASE_COLOR[phase] }
    : { label: t('phase.connecting'), color: 'var(--text-muted)' };

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
    const totalDebit = totalWager * Math.max(1, Math.min(10, replayRounds));
    if (totalDebit > balance) {
      setError(t('jeux.insufficientBalance'));
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
        replay_rounds: replayRounds,
      });
      setLastTicket(res.data);
      setBets([]);
      setReplayRounds(1);
      await fetchBalance(user.id);

      // Detection HIT : status WON juste apres creation = jackpot attache au ticket.
      // (Le settlement roulette n'a pas pu tourner deja, le ticket vient d'etre vendu.)
      if (res.data?.status === 'WON' && (res.data?.total_payout || 0) > 0) {
        setJackpotHit({ amount: res.data.total_payout, ticketCode: res.data.short_code });
        refreshJackpots();
      }
    } catch (err) {
      // AGD wraps errors as { error: { message, code, ... } }; standalone uses { detail }
      const apiErr = err.response?.data;
      const msg =
        apiErr?.error?.message ||
        apiErr?.detail ||
        apiErr?.message ||
        t('jeux.ticketCreationError');
      setError(Array.isArray(msg) ? msg.join(' / ') : msg);
      setTimeout(() => setError(''), 5000);
    } finally {
      setLoading(false);
    }
  };

  // Live-poll a PENDING ticket until it resolves (cyclic AGD path).
  // Every 2 seconds we refetch by short_code and update the open receipt
  // so the cashier sees PENDING → WON|LOST without closing the modal. The
  // poll stops on the first non-PENDING status or when the modal closes.
  useEffect(() => {
    if (!lastTicket || lastTicket.status !== 'PENDING') return;
    const code = lastTicket.short_code;
    if (!code) return;
    let cancelled = false;
    const tick = async () => {
      try {
        const res = await ticketApi.getDetails(code);
        if (cancelled) return;
        if (res?.data && res.data.status !== 'PENDING') {
          setLastTicket(res.data);
          if (res.data.status === 'WON' && (res.data.total_payout || 0) > 0) {
            // Jackpot or bet win — refresh wallet so the badge reflects the credit
            await fetchBalance(user?.id);
            refreshJackpots?.();
          }
          return; // settled — stop polling
        }
      } catch {
        /* network blip: retry next tick */
      }
      if (!cancelled) timer = window.setTimeout(tick, 2000);
    };
    let timer = window.setTimeout(tick, 2000);
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [lastTicket, fetchBalance, refreshJackpots, user?.id]);

  return (
    <div className="animate-fade" style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
      {jackpotHit && (
        <JackpotHitOverlay
          amount={jackpotHit.amount}
          ticketCode={jackpotHit.ticketCode}
          onClose={() => setJackpotHit(null)}
        />
      )}

      <JackpotsBar pots={jackpotPots} />

    <div style={{ display: 'grid', gap: 16, gridTemplateColumns: 'minmax(108px, 116px) minmax(200px, 230px) 1fr minmax(290px, 340px)' }}>
      {/* LEFT — Game switcher (shared, route-aware) */}
      <GamesSidebar />

      {/* ODDS TABLE */}
      <aside>
        <OddsTable value={betMode} onChange={setBetMode} />
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
              {gameId ? t('phase.live') : t('phase.connecting')}
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
            {t('jeux.stakePerBet')}
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

        {/* Betting Grid (verrouille les zones selon betMode) */}
        <BettingGrid addBet={addBet} isBettingOpen={isBettingOpen} betMode={betMode} />

        {/* Ticket verifier inline (sous le tapis) */}
        <TicketVerifier variant="inline" />
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
          ticketLabel={t('betSlip.titleWith', { game: 'Spin & Win' })}
          shopLabel={user?.kiosk_name || user?.name || t('betSlip.shopFallback')}
          shopMeta={gameId ? `→ ${gameId}` : null}
          replayRounds={replayRounds}
          onReplayChange={setReplayRounds}
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
    </div>
  );
};

export default Jeux;
