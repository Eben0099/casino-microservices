import { useState, useEffect } from 'react';

export const useRoulette = () => {
  const [tableState, setTableState] = useState({
    phase: 'Betting',
    gameId: '...',
    duration: 30,
    remaining: 30,
    serverTime: Date.now() / 1000,
    phaseStartedAt: Date.now() / 1000,
  });

  useEffect(() => {
    let ws;
    let reconnectTimer;

    const connect = () => {
      const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
      ws = new WebSocket(`${protocol}//${window.location.host}/api/display/ws/roulette`);

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
