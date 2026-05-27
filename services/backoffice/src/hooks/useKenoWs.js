import { useState, useEffect, useRef, useCallback } from 'react';

// Admin global view — no kiosk_id query param (engine allows absent kiosk_id).
const WS_URL = `ws://${window.location.host}/ws/keno`;

export function useKenoWs() {
  const [connected, setConnected] = useState(false);
  const [phase, setPhase] = useState(null);
  const [drawId, setDrawId] = useState(null);
  const [drawnNumbers, setDrawnNumbers] = useState(null);   // int[20] or null
  const [stats, setStats] = useState(null);                  // StatsSnapshot (BACKEND.md §3)
  const [jackpot, setJackpot] = useState(null);              // {generalAmount, volkenoAmount, currency, lastHitDrawId}
  const [medals, setMedals] = useState(null);                // {bronze, silver, gold}

  const wsRef = useRef(null);
  const retryRef = useRef(null);
  const retryDelay = useRef(500);  // start at 0.5 s, cap at 15 s

  const connect = useCallback(() => {
    try {
      const ws = new WebSocket(WS_URL);
      wsRef.current = ws;

      ws.onopen = () => {
        setConnected(true);
        retryDelay.current = 500;
      };

      ws.onmessage = (event) => {
        try {
          const msg = JSON.parse(event.data);
          switch (msg.type) {

            case 'welcome':
              // Restore full visual state on (re)connect — BACKEND.md §1.
              setPhase(msg.phase);
              setDrawId(msg.currentDrawId);
              setDrawnNumbers(msg.drawnNumbers ?? null);
              if (msg.stats)   setStats(msg.stats);
              if (msg.jackpot) setJackpot(msg.jackpot);
              if (msg.medals)  setMedals(msg.medals);
              break;

            case 'phase_changed':
              // drawId bumps only on idle entry (BACKEND.md §2).
              setPhase(msg.phase);
              setDrawId(msg.drawId);
              // Clear drawn numbers when we enter idle (new round not drawn yet)
              if (msg.phase === 'idle') setDrawnNumbers(null);
              break;

            case 'draw_locked':
              // 20 unique numbers in reveal order — BACKEND.md §3.
              setDrawnNumbers(msg.numbers ?? null);
              break;

            case 'stats_updated':
              // Full replace semantics — client does NOT merge (BACKEND.md §4).
              if (msg.snapshot) setStats(msg.snapshot);
              break;

            case 'jackpot_updated':
              // Global jackpot — same for every kiosk (BACKEND.md §5).
              if (msg.jackpot) setJackpot(msg.jackpot);
              break;

            case 'medals_updated':
              // Per-kiosk; admin socket has kiosk_id=absent → zeros (BACKEND.md §6).
              if (msg.medals) setMedals(msg.medals);
              break;

            default:
              break;
          }
        } catch {
          // Malformed frame — ignore silently.
        }
      };

      ws.onclose = () => {
        setConnected(false);
        wsRef.current = null;
        // Exponential backoff: 0.5→1→2→4→8→15 s (BACKEND.md reconnect spec)
        retryRef.current = setTimeout(() => {
          retryDelay.current = Math.min(retryDelay.current * 2, 15000);
          connect();
        }, retryDelay.current);
      };

      ws.onerror = () => {
        // onclose fires immediately after onerror — reconnect logic lives there.
      };
    } catch {
      // If the WebSocket constructor itself throws (e.g. bad URL), retry.
      retryRef.current = setTimeout(() => {
        retryDelay.current = Math.min(retryDelay.current * 2, 15000);
        connect();
      }, retryDelay.current);
    }
  }, []);

  useEffect(() => {
    connect();
    return () => {
      if (wsRef.current) {
        wsRef.current.onclose = null; // suppress reconnect on intentional unmount
        wsRef.current.close();
      }
      if (retryRef.current) clearTimeout(retryRef.current);
    };
  }, [connect]);

  return { connected, phase, drawId, drawnNumbers, stats, jackpot, medals };
}
