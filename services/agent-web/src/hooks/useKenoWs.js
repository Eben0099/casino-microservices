import { useState, useEffect, useRef } from 'react';

/**
 * useKenoWs — connects to the Keno engine WebSocket and surfaces live state.
 *
 * WS path: ws(s)://<host>/ws/keno?kiosk_id=<code>
 *
 * Implements the BACKEND.md VOLKENO protocol:
 *   - welcome        → seeds all state on (re)connect
 *   - phase_changed  → updates phase / drawId / remaining
 *   - draw_locked    → stores the 20 drawn numbers
 *   - jackpot_updated → updates global jackpot amounts
 *   - medals_updated  → updates per-kiosk medal counters
 *   - pong           → clock sync echo (no action needed beyond logging)
 *
 * Reconnect strategy: exponential backoff starting at 500 ms, capped at 15 s.
 *
 * `remaining` is computed locally every second from phaseStartedAt +
 * phaseDurationMs (both in epoch ms), mirroring exactly how the roulette
 * hook works — no server poll required.
 *
 * @param {string|null|undefined} kioskCode  — user.kiosk_code from AuthContext
 * @returns {{ phase, drawId, remaining, drawnNumbers, jackpot, medals, connected }}
 */

const BACKOFF_STEPS_MS = [500, 1000, 2000, 4000, 8000, 15000];

export const useKenoWs = (kioskCode) => {
  const [state, setState] = useState({
    phase: 'idle',
    drawId: 0,
    remaining: 0,
    duration: 30000,         // phaseDurationMs (ms)
    phaseStartedAt: 0,       // epoch ms
    drawnNumbers: null,
    jackpot: {
      generalAmount: 0,
      volkenoAmount: 0,
      currency: 'XAF',
      lastHitDrawId: null,
    },
    medals: { bronze: 0, silver: 0, gold: 0 },
    // Latest backend `jackpot_hit` (one-shot win signal), or null. Deduped by
    // hitId so a reconnect/replay doesn't re-fire the win overlay.
    lastJackpotHit: null,
    connected: false,
  });

  const stateRef = useRef(state);
  stateRef.current = state;

  useEffect(() => {
    let ws = null;
    let reconnectTimer = null;
    let tickTimer = null;
    let backoffIndex = 0;
    let alive = true;

    // ------------------------------------------------------------------
    // Local countdown tick (1 s) — derives `remaining` from server clocks
    // ------------------------------------------------------------------
    const startTick = () => {
      if (tickTimer) clearInterval(tickTimer);
      tickTimer = setInterval(() => {
        if (!alive) return;
        setState((prev) => {
          const nowMs = Date.now();
          const elapsedMs = nowMs - prev.phaseStartedAt;
          const remainingMs = Math.max(0, prev.duration - elapsedMs);
          const remainingSec = Math.round(remainingMs / 1000);
          return { ...prev, remaining: remainingSec };
        });
      }, 1000);
    };

    // ------------------------------------------------------------------
    // WebSocket connect
    // ------------------------------------------------------------------
    const connect = () => {
      if (!alive) return;

      const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
      const kid = kioskCode ? `?kiosk_id=${encodeURIComponent(kioskCode)}` : '';
      const url = `${protocol}//${window.location.host}/ws/keno${kid}`;

      try {
        ws = new WebSocket(url);
      } catch (err) {
        console.warn('[useKenoWs] WebSocket constructor failed:', err);
        scheduleReconnect();
        return;
      }

      ws.onopen = () => {
        if (!alive) return;
        backoffIndex = 0; // reset backoff on successful connection
      };

      ws.onmessage = (event) => {
        if (!alive) return;
        let msg;
        try {
          msg = JSON.parse(event.data);
        } catch {
          return;
        }

        switch (msg.type) {
          case 'welcome': {
            // phaseStartedAt and phaseDurationMs are epoch ms per BACKEND.md v1.1
            const started = msg.phaseStartedAt || Date.now();
            const duration = msg.phaseDurationMs || 30000;
            const nowMs = Date.now();
            const remainingSec = Math.round(Math.max(0, started + duration - nowMs) / 1000);

            setState((prev) => ({
              ...prev,
              phase: msg.phase || 'idle',
              drawId: msg.currentDrawId ?? prev.drawId,
              duration,
              phaseStartedAt: started,
              remaining: remainingSec,
              drawnNumbers: msg.drawnNumbers ?? null,
              jackpot: msg.jackpot ?? prev.jackpot,
              medals: msg.medals ?? prev.medals,
              connected: true,
            }));
            startTick();
            break;
          }

          case 'phase_changed': {
            // phase_changed carries: drawId, phase, startedAt (epoch ms), durationMs
            const started = msg.startedAt || Date.now();
            const duration = msg.durationMs || 30000;
            const nowMs = Date.now();
            const remainingSec = Math.round(Math.max(0, started + duration - nowMs) / 1000);

            setState((prev) => ({
              ...prev,
              phase: msg.phase || prev.phase,
              drawId: msg.drawId ?? prev.drawId,
              duration,
              phaseStartedAt: started,
              remaining: remainingSec,
              // Clear drawnNumbers when entering idle/preLaunch
              drawnNumbers:
                msg.phase === 'idle' || msg.phase === 'preLaunch'
                  ? null
                  : prev.drawnNumbers,
            }));
            break;
          }

          case 'draw_locked': {
            setState((prev) => ({
              ...prev,
              drawnNumbers: msg.numbers ?? prev.drawnNumbers,
            }));
            break;
          }

          case 'jackpot_updated': {
            setState((prev) => ({
              ...prev,
              jackpot: msg.jackpot ?? prev.jackpot,
            }));
            break;
          }

          case 'medals_updated': {
            setState((prev) => ({
              ...prev,
              medals: msg.medals ?? prev.medals,
            }));
            break;
          }

          case 'jackpot_hit': {
            // One-shot win signal relayed from jackpot-service. Dedupe on hitId
            // (Redis pub/sub is at-least-once across reconnects).
            setState((prev) => {
              if (prev.lastJackpotHit?.hitId === msg.hitId) return prev;
              return {
                ...prev,
                lastJackpotHit: {
                  hitId: msg.hitId,
                  scope: msg.scope,
                  tier: msg.tier ?? null,
                  amount: msg.amount ?? 0,
                  durationMs: msg.celebrationDurationMs ?? 10000,
                  ticketCode: msg.winnerTicketCode ?? null,
                },
              };
            });
            break;
          }

          // pong — no state change needed; keep-alive is handled by onmessage activity
          case 'pong':
          default:
            break;
        }
      };

      ws.onerror = () => {
        // onerror is always followed by onclose; close() handles cleanup
        if (ws) ws.close();
      };

      ws.onclose = () => {
        if (!alive) return;
        setState((prev) => ({ ...prev, connected: false }));
        scheduleReconnect();
      };

      // Send ping every 20 s to keep the connection alive and sync clock
      const pingInterval = setInterval(() => {
        if (ws && ws.readyState === WebSocket.OPEN) {
          ws.send(JSON.stringify({ type: 'ping', clientTime: Date.now() }));
        }
      }, 20000);

      // Attach cleanup ref so ws.onclose can clear it
      ws._pingInterval = pingInterval;
    };

    const scheduleReconnect = () => {
      if (!alive) return;
      const delay = BACKOFF_STEPS_MS[Math.min(backoffIndex, BACKOFF_STEPS_MS.length - 1)];
      backoffIndex = Math.min(backoffIndex + 1, BACKOFF_STEPS_MS.length - 1);
      console.log(`[useKenoWs] reconnecting in ${delay}ms (attempt ${backoffIndex})`);
      reconnectTimer = setTimeout(connect, delay);
    };

    // Initial connection
    connect();

    return () => {
      alive = false;
      if (reconnectTimer) clearTimeout(reconnectTimer);
      if (tickTimer) clearInterval(tickTimer);
      if (ws) {
        if (ws._pingInterval) clearInterval(ws._pingInterval);
        try { ws.close(); } catch { /* ignore */ }
      }
    };
    // kioskCode intentionally in the dep array — reconnect when kiosk changes
  }, [kioskCode]);

  // Progressive reveal: during the `draw` phase the 20 numbers (delivered all
  // at once by draw_locked) are surfaced one-by-one, paced over the phase
  // duration. Recomputed on each countdown tick. Full set during `results`,
  // null on idle. `drawnNumbers` (full) stays available for callers that need it.
  const { phase, drawnNumbers, phaseStartedAt, duration } = state;
  let revealedNumbers = drawnNumbers;
  if (drawnNumbers && drawnNumbers.length && phase === 'draw') {
    const total = drawnNumbers.length;
    const perBall = Math.max(250, (duration || 67000) / total);
    const c = Math.max(0, Math.min(total, Math.floor((Date.now() - phaseStartedAt) / perBall) + 1));
    revealedNumbers = drawnNumbers.slice(0, c);
  }

  return { ...state, revealedNumbers };
};

export default useKenoWs;
