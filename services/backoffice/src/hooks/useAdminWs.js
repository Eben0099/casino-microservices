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

  const connect = useCallback(() => {
    try {
      const ws = new WebSocket(WS_URL);
      wsRef.current = ws;

      ws.onopen = () => {
        setConnected(true);
        retryDelay.current = 1000;
      };

      ws.onmessage = (event) => {
        try {
          const msg = JSON.parse(event.data);
          // Only react to admin events (created/paid/settled). Roulette
          // phase/result events are handled elsewhere via useRouletteWs.
          if (msg.type === 'ticket_created' || msg.type === 'ticket_paid' || msg.type === 'round_settled' || msg.type === 'ticket_cancelled') {
            setLastEvent(msg);
            setTick((t) => t + 1);
            setEventCounts((c) => ({ ...c, [msg.type]: (c[msg.type] || 0) + 1 }));
          }
        } catch {}
      };

      ws.onclose = () => {
        setConnected(false);
        wsRef.current = null;
        retryRef.current = setTimeout(() => {
          retryDelay.current = Math.min(retryDelay.current * 2, 30000);
          connect();
        }, retryDelay.current);
      };

      ws.onerror = () => {};
    } catch {}
  }, []);

  useEffect(() => {
    connect();
    return () => {
      if (wsRef.current) wsRef.current.close();
      if (retryRef.current) clearTimeout(retryRef.current);
    };
  }, [connect]);

  return { connected, tick, lastEvent, eventCounts };
}

/**
 * Helper: debounced effect that re-runs `cb` whenever `tick` changes,
 * but at most once every `delayMs`. Also fires an initial call.
 */
export function useDebouncedTick(tick, cb, delayMs = 1500) {
  const timerRef = useRef(null);
  const cbRef = useRef(cb);
  cbRef.current = cb;

  useEffect(() => {
    if (timerRef.current) {
      clearTimeout(timerRef.current);
    }
    timerRef.current = setTimeout(() => {
      try { cbRef.current(); } catch {}
    }, delayMs);
    return () => { if (timerRef.current) clearTimeout(timerRef.current); };
  }, [tick, delayMs]);
}
