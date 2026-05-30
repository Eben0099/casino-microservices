import React, { useState, useEffect } from 'react';
import { CircleDot, Radio, Hash } from 'lucide-react';
import { useAuth } from '../context/AuthContext';
import { useKenoWs } from '../hooks/useKenoWs';
import { useKenoJackpots } from '../hooks/useKenoJackpots';
import { ticketApi } from '../api/endpoints';
import { useT } from '../i18n';
import KenoGrid from '../components/KenoGrid';
import BetSlip from '../components/BetSlip';
import GamesSidebar from '../components/GamesSidebar';
import TicketReceipt from '../components/TicketReceipt';
import TicketVerifier from '../components/TicketVerifier';
import JackpotsBar from '../components/JackpotsBar';
import JackpotHitOverlay from '../components/JackpotHitOverlay';

// ----------------------------------------------------------------------------
// Constants
// ----------------------------------------------------------------------------

const STAKE_PRESETS = [100, 200, 500, 1000, 2000, 5000, 10000];
const SPOTS_PRESETS = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11];

// Phase → colour token (using CSS vars defined in global style)
const PHASE_COLOR = {
  idle:       'var(--accent)',
  preLaunch:  'var(--info)',
  draw:       'var(--info)',
  results:    'var(--success)',
};

// ----------------------------------------------------------------------------
// Keno page
// ----------------------------------------------------------------------------

export const Keno = () => {
  const { user, balance, fetchBalance } = useAuth();
  const { t } = useT();

  // Live WS state
  const {
    phase,
    drawId,
    remaining,
    drawnNumbers,
    revealedNumbers,
    jackpot,
    medals,
    connected,
    lastJackpotHit,
  } = useKenoWs(user?.kiosk_code);

  // REST jackpot poll (for JackpotsBar)
  const { pots: jackpotPots, refresh: refreshJackpots } = useKenoJackpots(user?.kiosk_code);

  // ---- Local UI state -------------------------------------------------------
  const [picks, setPicks] = useState([]);
  const [maxSpots, setMaxSpots] = useState(5);    // default spots selection
  const [selectedStake, setSelectedStake] = useState(500);
  const [bets, setBets] = useState([]);
  const [loading, setLoading] = useState(false);
  const [lastTicket, setLastTicket] = useState(null);
  const [error, setError] = useState('');
  const [jackpotHit, setJackpotHit] = useState(null);
  const [replayRounds, setReplayRounds] = useState(1);

  const isBettingOpen = phase === 'idle';

  const phaseInfo = PHASE_COLOR[phase]
    ? { label: t(`phase.${phase}`), color: PHASE_COLOR[phase] }
    : { label: t('phase.connecting'), color: 'var(--text-muted)' };

  // ---- Grid interaction -----------------------------------------------------

  const handleToggle = (n) => {
    setPicks((prev) => {
      if (prev.includes(n)) return prev.filter((p) => p !== n);
      if (prev.length >= maxSpots) return prev;
      return [...prev, n];
    });
  };

  const handleSpotsChange = (s) => {
    setMaxSpots(s);
    // Trim picks if the new max is smaller
    setPicks((prev) => prev.slice(0, s));
  };

  const clearPicks = () => setPicks([]);

  // ---- Add to slip ----------------------------------------------------------

  const addToSlip = () => {
    if (picks.length === 0 || !isBettingOpen) return;
    const sorted = [...picks].sort((a, b) => a - b);
    const target = sorted.join(',');
    const existing = bets.findIndex(
      (b) => b.bet_type === 'KENO' && b.bet_target === target
    );
    if (existing > -1) {
      // Stack the stake if the same pick set is already in the slip
      setBets((prev) =>
        prev.map((b, i) =>
          i === existing ? { ...b, amount: b.amount + selectedStake } : b
        )
      );
    } else {
      setBets((prev) => [
        ...prev,
        { bet_type: 'KENO', bet_target: target, amount: selectedStake },
      ]);
    }
    setPicks([]); // clear picks after adding to slip
  };

  const removeBet = (idx) => setBets((prev) => prev.filter((_, i) => i !== idx));
  const clearBets = () => setBets([]);

  // ---- Ticket submission ----------------------------------------------------

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
        game_id: 'KENO-DRAW1',
        round_id: String(drawId),
        bets,
        replay_rounds: replayRounds,
      });
      setLastTicket(res.data);
      setBets([]);
      setReplayRounds(1);
      await fetchBalance(user.id);

      if (res.data?.status === 'WON' && (res.data?.total_payout || 0) > 0) {
        setJackpotHit({ amount: res.data.total_payout, ticketCode: res.data.short_code });
        refreshJackpots();
      }
    } catch (err) {
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

  // ---- Backend jackpot_hit → win overlay -----------------------------------
  // Fires the overlay for ANY jackpot hit visible to this kiosk (e.g. a GLOBAL
  // hit, or a LOCAL win by another terminal at the same kiosk). The ticket-WON
  // path below remains authoritative for "you sold the winning ticket" (it
  // carries the real short_code), so suppress this when a local WON ticket is
  // already on screen to avoid a double overlay.
  useEffect(() => {
    if (!lastJackpotHit?.hitId) return;
    if (lastTicket?.status === 'WON') return;
    setJackpotHit({
      amount: lastJackpotHit.amount,
      ticketCode: lastJackpotHit.ticketCode || undefined,
      scope: lastJackpotHit.scope,
      tier: lastJackpotHit.tier,
      durationMs: lastJackpotHit.durationMs,
    });
    refreshJackpots();
    // Keyed on hitId so each distinct hit fires exactly once.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [lastJackpotHit?.hitId]);

  // ---- Design preview (no real jackpot needed) -----------------------------
  // Pin the win overlay so its design can be edited live:
  //   • URL:     ?previewJackpot=bronze  (general|volkeno|bronze|silver|gold)
  //   • Console: window.__kenoCelebrate('bronze')         (persists ~1h)
  //              window.__kenoCelebrate('bronze', 10000)  (auto-hide 10s)
  useEffect(() => {
    const POT = {
      general: { scope: 'GLOBAL', tier: null,     amount: 12500000 },
      volkeno: { scope: 'GAME',   tier: null,     amount: 4200000 },
      bronze:  { scope: 'LOCAL',  tier: 'BRONZE', amount: 850000 },
      silver:  { scope: 'LOCAL',  tier: 'SILVER', amount: 3100000 },
      gold:    { scope: 'LOCAL',  tier: 'GOLD',   amount: 9400000 },
    };
    const show = (pot, ms = 3600000) => {
      const p = POT[pot];
      if (!p) return;
      setJackpotHit({
        amount: p.amount, ticketCode: 'TK-20260530-AB12CD',
        scope: p.scope, tier: p.tier, durationMs: ms,
      });
    };
    window.__kenoCelebrate = show;
    const pv = new URLSearchParams(window.location.search).get('previewJackpot');
    if (pv) show(pv);
    return () => { delete window.__kenoCelebrate; };
  }, []);

  // ---- PENDING → WON/LOST polling ------------------------------------------
  // Mirrors the polling effect from Jeux.jsx exactly.

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
            await fetchBalance(user?.id);
            refreshJackpots?.();
          }
          return; // settled
        }
      } catch {
        /* network blip — retry */
      }
      if (!cancelled) timer = window.setTimeout(tick, 2000);
    };
    let timer = window.setTimeout(tick, 2000);
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [lastTicket, fetchBalance, refreshJackpots, user?.id]);

  // ---- Render ---------------------------------------------------------------

  return (
    <div className="animate-fade" style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
      {jackpotHit && (
        <JackpotHitOverlay
          amount={jackpotHit.amount}
          ticketCode={jackpotHit.ticketCode}
          scope={jackpotHit.scope}
          tier={jackpotHit.tier}
          durationMs={jackpotHit.durationMs}
          onClose={() => setJackpotHit(null)}
        />
      )}

      <JackpotsBar pots={jackpotPots} />

      <div style={{
        display: 'grid',
        gap: 16,
        gridTemplateColumns: 'minmax(108px, 116px) 1fr minmax(290px, 340px)',
      }}>
        {/* LEFT — Game switcher (shared, route-aware) */}
        <GamesSidebar />

        {/* CENTER column */}
        <section style={{ display: 'flex', flexDirection: 'column', gap: 14, minWidth: 0 }}>

          {/* Phase status bar */}
          <div style={{
            display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12,
            padding: '14px 18px', borderRadius: 12,
            background: 'var(--bg-surface)', border: '1px solid var(--border-subtle)',
          }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
              {/* Phase pill */}
              <div style={{
                display: 'flex', alignItems: 'center', gap: 8,
                padding: '6px 12px', borderRadius: 999,
                background: `${phaseInfo.color}1A`, color: phaseInfo.color,
                border: `1px solid ${phaseInfo.color}33`,
                fontSize: 12, fontWeight: 700,
              }}>
                <span
                  className={phase === 'draw' ? 'pulse-dot' : ''}
                  style={{
                    width: 6, height: 6, borderRadius: 999, background: phaseInfo.color,
                  }}
                />
                {phaseInfo.label}
              </div>

              {/* Live / Connecting indicator */}
              <div style={{
                display: 'flex', alignItems: 'center', gap: 6,
                fontSize: 11, fontWeight: 700, letterSpacing: '0.1em',
                textTransform: 'uppercase',
                color: connected ? 'var(--success)' : 'var(--text-muted)',
              }}>
                <Radio size={12} />
                {connected ? t('phase.live') : t('phase.connecting')}
              </div>

              {/* Draw ID badge */}
              {drawId > 0 && (
                <div style={{
                  display: 'flex', alignItems: 'center', gap: 4,
                  fontSize: 11, fontWeight: 700, color: 'var(--text-muted)',
                }}>
                  <Hash size={11} />
                  {drawId}
                </div>
              )}
            </div>

            {/* Countdown */}
            {remaining != null && remaining > 0 && (
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

          {/* Spots selector */}
          <div style={{
            display: 'flex', alignItems: 'center', gap: 10,
            padding: '10px 16px', borderRadius: 10,
            background: 'var(--bg-surface)', border: '1px solid var(--border-subtle)',
          }}>
            <Hash size={14} style={{ color: 'var(--accent)' }} />
            <span style={{
              fontSize: 11, fontWeight: 700, letterSpacing: '0.12em',
              color: 'var(--text-muted)', textTransform: 'uppercase', whiteSpace: 'nowrap',
            }}>
              {t('keno.spots')}
            </span>
            <div style={{ display: 'flex', gap: 4, flex: 1, justifyContent: 'center', flexWrap: 'wrap' }}>
              {SPOTS_PRESETS.map((s) => {
                const active = maxSpots === s;
                return (
                  <button
                    key={s}
                    onClick={() => handleSpotsChange(s)}
                    style={{
                      padding: '6px 11px', borderRadius: 6,
                      border: active ? '1.5px solid var(--accent)' : '1px solid var(--border-subtle)',
                      background: active ? 'var(--accent)' : 'var(--bg-tile)',
                      color: active ? 'var(--text-on-accent)' : 'var(--text-secondary)',
                      fontWeight: 800, fontSize: 12, cursor: 'pointer',
                      transition: 'all 0.12s',
                    }}
                  >
                    {s}
                  </button>
                );
              })}
            </div>
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
              {STAKE_PRESETS.map((stake) => {
                const active = selectedStake === stake;
                return (
                  <button
                    key={stake}
                    onClick={() => setSelectedStake(stake)}
                    style={{
                      padding: '6px 12px', borderRadius: 6,
                      border: active ? '1.5px solid var(--accent)' : '1px solid var(--border-subtle)',
                      background: active ? 'var(--accent)' : 'var(--bg-tile)',
                      color: active ? 'var(--text-on-accent)' : 'var(--text-secondary)',
                      fontWeight: 800, fontSize: 12, cursor: 'pointer',
                      transition: 'all 0.12s',
                    }}
                  >
                    {stake >= 1000 ? `${stake / 1000}k` : stake}
                  </button>
                );
              })}
            </div>
          </div>

          {/* Error banner */}
          {error && (
            <div style={{
              padding: '10px 14px', borderRadius: 8,
              background: 'rgba(239,68,68,0.1)', border: '1px solid rgba(239,68,68,0.3)',
              color: 'var(--danger)', fontSize: 13, fontWeight: 600,
            }}>
              {error}
            </div>
          )}

          {/* Keno grid */}
          <KenoGrid
            picks={picks}
            onToggle={handleToggle}
            maxSpots={maxSpots}
            isBettingOpen={isBettingOpen}
            drawnNumbers={revealedNumbers}
          />

          {/* Add-to-slip action row */}
          {isBettingOpen && (
            <div style={{
              display: 'flex', gap: 8, alignItems: 'center',
            }}>
              <button
                onClick={clearPicks}
                disabled={picks.length === 0}
                style={{
                  padding: '10px 18px', borderRadius: 8, fontSize: 13, fontWeight: 700,
                  border: '1px solid var(--border-subtle)', background: 'transparent',
                  color: 'var(--text-secondary)',
                  cursor: picks.length === 0 ? 'not-allowed' : 'pointer',
                  opacity: picks.length === 0 ? 0.5 : 1,
                }}
              >
                {t('keno.clearPicks')}
              </button>
              <button
                onClick={addToSlip}
                disabled={picks.length === 0}
                style={{
                  flex: 1, padding: '10px 18px', borderRadius: 8, fontSize: 13, fontWeight: 800,
                  border: 'none',
                  background: picks.length === 0 ? 'var(--bg-tile)' : 'var(--accent)',
                  color: picks.length === 0 ? 'var(--text-muted)' : 'var(--text-on-accent)',
                  cursor: picks.length === 0 ? 'not-allowed' : 'pointer',
                  transition: 'background 0.15s',
                }}
              >
                {t('keno.addToSlip')} ({picks.length}/{maxSpots})
              </button>
            </div>
          )}

          {/* Inline ticket verifier */}
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
            ticketLabel={t('betSlip.titleWith', { game: t('keno.title') })}
            shopLabel={user?.kiosk_name || user?.name || t('betSlip.shopFallback')}
            shopMeta={drawId > 0 ? `→ #${drawId}` : null}
            replayRounds={replayRounds}
            onReplayChange={setReplayRounds}
          />

          {lastTicket && (
            <TicketReceipt
              ticket={lastTicket}
              onClose={() => setLastTicket(null)}
              showMaxGain={true}
            />
          )}
        </aside>
      </div>
    </div>
  );
};

export default Keno;
