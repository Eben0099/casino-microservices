import { useState, useEffect, useRef, useCallback } from 'react';

const WS_URL = `ws://${window.location.host}/ws/roulette`;

export function useRouletteWs() {
  const [connected, setConnected] = useState(false);
  const [phase, setPhase] = useState(null);
  const [lastNumber, setLastNumber] = useState(null);
  const [stats, setStats] = useState(null);
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
          switch (msg.type) {
            case 'welcome':
              setPhase(msg.currentPhase);
              if (msg.result) setLastNumber(msg.result.number);
              break;
            case 'phase_changed':
              setPhase(msg.phase);
              break;
            case 'result_revealed':
              setLastNumber(msg.result?.number);
              break;
            case 'stats_updated':
              setStats(msg.stats);
              break;
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

  return { connected, phase, lastNumber, stats };
}
