import { useState, useEffect } from 'react';
import { IS_AGD, AGD_API_URL, AGD_GAME_CODE } from '../config';

/**
 * useRoulette — surfaces the live cyclic-roulette state for the cashier UI.
 *
 * Two regimes:
 *
 * 1) Standalone (Python `game-roulette-service`): opens a WebSocket on
 *    `/ws/roulette` and listens for `welcome`/`phase_changed` packets the
 *    engine emits as it transitions Betting → BetsClosing → Spinning →
 *    Result. The remaining-time counter updates locally every second.
 *
 * 2) AGD (`agd-casino-service`): the engine still runs in `cyclic` mode
 *    but pushes state changes through Redis pubsub → RMQ → Socket.IO
 *    `/casino/ws`. For the V1 we poll `GET /games/:code/current-round`
 *    once per second instead of opening Socket.IO from the front — keeps
 *    the bundle dependency-free and gives a sub-second feel for the
 *    cashier. We can swap to a Socket.IO subscription later without
 *    touching the rest of the page (the hook surface is unchanged).
 *
 * Always returns `{ phase, gameId, duration, remaining, serverTime,
 * phaseStartedAt, result }`. `gameId` is the engine round id, used as the
 * `round_id` field by `submitTicket` so the server can reject stale bets.
 */
export const useRoulette = () => {
  const [tableState, setTableState] = useState({
    phase: IS_AGD ? 'Connecting' : 'Betting',
    gameId: '...',
    duration: 30,
    remaining: 30,
    serverTime: Date.now() / 1000,
    phaseStartedAt: Date.now() / 1000,
    result: null,
  });

  useEffect(() => {
    if (IS_AGD) {
      // -- AGD mode: poll the current-round endpoint each second.
      let aborted = false;
      let timer = null;
      const url = `${AGD_API_URL}/games/${AGD_GAME_CODE}/current-round`;

      const tick = async () => {
        if (aborted) return;
        try {
          const resp = await fetch(url, {
            method: 'GET',
            credentials: 'omit',
          });
          if (resp.ok) {
            const body = await resp.json();
            const d = body?.data ?? body;
            if (d && d.roundId) {
              setTableState({
                phase: d.phase,
                gameId: d.roundId,
                duration: Math.round(d.phaseDuration ?? 0),
                // Server returns a float (e.g. 17.43s) but the UI shows
                // an integer (compatible with the standalone Math.round
                // tick). Round down so we never overshoot the actual end.
                remaining: Math.max(0, Math.floor(d.remaining ?? 0)),
                serverTime: d.serverTime,
                phaseStartedAt: d.phaseStartedAt,
                result: d.result ?? null,
              });
            }
          } else if (resp.status === 404) {
            // Engine booting — keep the previous state, label phase Connecting
            setTableState((prev) => ({ ...prev, phase: 'Connecting' }));
          }
        } catch {
          // Network blip — leave state unchanged, retry next tick.
        }
        if (!aborted) timer = window.setTimeout(tick, 1000);
      };

      tick();
      return () => {
        aborted = true;
        if (timer) window.clearTimeout(timer);
      };
    }

    // -- Standalone mode: WebSocket from the legacy Python engine.
    let ws;
    let reconnectTimer;

    const connect = () => {
      const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
      ws = new WebSocket(`${protocol}//${window.location.host}/ws/roulette`);

      ws.onmessage = (event) => {
        try {
          const data = JSON.parse(event.data);

          if (data.type === 'welcome' || data.type === 'phase_changed') {
            setTableState(prev => ({
              ...prev,
              phase: data.currentPhase || data.phase,
              gameId: data.currentGameId || data.gameId,
              duration: data.phaseDuration || data.duration,
              phaseStartedAt: data.phaseStartedAt || (Date.now() / 1000),
            }));
          }
        } catch (e) {
          console.error("WS Parse error", e);
        }
      };

      ws.onclose = () => {
        console.log("WS Déconnecté, tentative de reconnexion...");
        reconnectTimer = setTimeout(connect, 3000);
      };

      ws.onerror = () => ws.close();
    };

    connect();

    const timer = setInterval(() => {
      setTableState(prev => {
        const now = Date.now() / 1000;
        const elapsed = now - prev.phaseStartedAt;
        const remaining = Math.max(0, prev.duration - elapsed);
        return { ...prev, remaining: Math.round(remaining) };
      });
    }, 1000);

    return () => {
      if (ws) ws.close();
      clearTimeout(reconnectTimer);
      clearInterval(timer);
    };
  }, []);

  return tableState;
};
