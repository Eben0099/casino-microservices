import { useState, useEffect, useRef, useCallback } from 'react';

const WS_URL = `ws://${window.location.host}/ws/roulette`;

/**
 * WebSocket hook for the admin dashboard.
 *
 * Reuses the existing /ws/roulette endpoint which now also relays admin-events
 * (ticket_created, ticket_paid, round_settled). Returns:
 *  - connected: boolean
 *  - tick: counter that increments on every relevant admin event (use as
 *    useEffect dependency to trigger a debounced re-fetch in the consumer)
 *  - lastEvent: the most recent admin event payload (or null)
 *  - eventCounts: tally per type for the current session
 *
 * The consumer is responsible for debouncing re-fetches. We do NOT push state
 * here — components reload their data from REST endpoints, which keeps things
 * simple and lets server-side filtering / pagination keep working unchanged.
 */
export function useAdminWs() {
  const [connected, setConnected] = useState(false);
  const [tick, setTick] = useState(0);
  const [lastEvent, setLastEvent] = useState(null);
  const [eventCounts, setEventCounts] = useState({});
  const wsRef = useRef(null);
  const retryRef = useRef(null);
  const retryDelay = useRef(1000);
  const mountedRef = useRef(true);

  const connect = useCallback(() => {
    if (!mountedRef.current) return;
    try {
      const ws = new WebSocket(WS_URL);
      wsRef.current = ws;

      ws.onopen = () => {
        if (!mountedRef.current) return;
        setConnected(true);
        retryDelay.current = 1000;
      };

      ws.onmessage = (event) => {
        if (!mountedRef.current) return;
        try {
          const msg = JSON.parse(event.data);
          // Only react to admin events (tickets + jackpots + settlement).
          // Roulette phase/result events are handled elsewhere via useRouletteWs.
          if (
            msg.type === 'ticket_created' ||
            msg.type === 'ticket_paid' ||
            msg.type === 'round_settled' ||
            msg.type === 'ticket_cancelled' ||
            msg.type === 'jackpot_progress' ||
            msg.type === 'jackpot_hit'
          ) {
            setLastEvent(msg);
            setTick((t) => t + 1);
            setEventCounts((c) => ({ ...c, [msg.type]: (c[msg.type] || 0) + 1 }));
          }
        } catch {}
      };

      ws.onclose = () => {
        setConnected(false);
        wsRef.current = null;
        if (!mountedRef.current) return;
        retryRef.current = setTimeout(() => {
          if (!mountedRef.current) return;
          retryDelay.current = Math.min(retryDelay.current * 2, 30000);
          connect();
        }, retryDelay.current);
      };

      ws.onerror = () => {};
    } catch {}
  }, []);

  useEffect(() => {
    mountedRef.current = true;
    connect();
    return () => {
      mountedRef.current = false;
      if (wsRef.current) {
        try { wsRef.current.close(); } catch {}
        wsRef.current = null;
      }
      if (retryRef.current) {
        clearTimeout(retryRef.current);
        retryRef.current = null;
      }
    };
  }, [connect]);

  return { connected, tick, lastEvent, eventCounts };
}

/**
 * Throttled effect: when `tick` changes, schedule `cb` to run after `delayMs`.
 * Crucially, subsequent tick changes during the wait do NOT reset the timer —
 * they just mark the batch as pending. This guarantees AT LEAST one call per
 * `delayMs` while events keep flowing, and AT MOST one call per `delayMs`.
 *
 * The naive "reset timer on every tick" debounce never fires under burst load
 * because events arrive faster than the timeout.
 */
export function useDebouncedTick(tick, cb, delayMs = 1500) {
  const timerRef = useRef(null);
  const pendingRef = useRef(false);
  const cbRef = useRef(cb);
  cbRef.current = cb;

  useEffect(() => {
    if (tick === 0) return; // skip the initial render (tick starts at 0)
    pendingRef.current = true;
    if (timerRef.current) return; // already scheduled — let it run
    timerRef.current = setTimeout(() => {
      timerRef.current = null;
      if (pendingRef.current) {
        pendingRef.current = false;
        try { cbRef.current(); } catch {}
      }
    }, delayMs);
  }, [tick, delayMs]);

  useEffect(() => () => {
    if (timerRef.current) clearTimeout(timerRef.current);
    timerRef.current = null;
  }, []);
}
