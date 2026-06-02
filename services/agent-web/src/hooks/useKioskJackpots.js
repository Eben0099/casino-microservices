import { useEffect, useRef, useState } from 'react';
import api from '../api/client';
import { IS_AGD, AGD_GAME_CODE } from '../config';
import { getAdapter } from '../api/adapters';
import { agdPotsToCards } from './agdJackpots';

const POLL_MS = 5000;

/**
 * Récupère périodiquement les 5 jackpots roulette pour ce kiosque
 * via `GET /roulette/jackpots?kiosk_id={code}` et les normalise au format
 * attendu par `<JackpotsBar pots={[...]} />` :
 *
 *   [
 *     { id, scope: 'GLOBAL'|'GAME'|'LOCAL', tier?: 'BRONZE'|'SILVER'|'GOLD',
 *       current_amount, game_id? }
 *   ]
 *
 * Mapping :
 *   general  -> Grand Jackpot   (scope = GLOBAL)
 *   spin2win -> Game Jackpot    (scope = GAME, game_id = 'Roulette')
 *   bronze   -> Local Bronze    (scope = LOCAL, tier = BRONZE)
 *   silver   -> Local Argent    (scope = LOCAL, tier = SILVER)
 *   gold     -> Local Or        (scope = LOCAL, tier = GOLD)
 *
 * Pas d'appel si `kioskCode` est absent.
 */

const ROULETTE_GAME_LABEL = 'Roulette';

const toPotCards = (jackpots, kioskCode) => {
  if (!jackpots) return [];
  const j = jackpots;
  const out = [];
  if (typeof j.general === 'number') {
    out.push({ id: 'general', scope: 'GLOBAL', current_amount: j.general });
  }
  if (typeof j.spin2win === 'number') {
    out.push({ id: 'spin2win', scope: 'GAME', game_id: ROULETTE_GAME_LABEL, current_amount: j.spin2win });
  }
  if (typeof j.bronze === 'number' && j.bronze > 0) {
    out.push({ id: `bronze-${kioskCode}`, scope: 'LOCAL', tier: 'BRONZE', current_amount: j.bronze });
  }
  if (typeof j.silver === 'number' && j.silver > 0) {
    out.push({ id: `silver-${kioskCode}`, scope: 'LOCAL', tier: 'SILVER', current_amount: j.silver });
  }
  if (typeof j.gold === 'number' && j.gold > 0) {
    out.push({ id: `gold-${kioskCode}`, scope: 'LOCAL', tier: 'GOLD', current_amount: j.gold });
  }
  return out;
};

export const useKioskJackpots = (kioskCode) => {
  const [pots, setPots] = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const aliveRef = useRef(true);

  const fetchPots = async () => {
    if (!kioskCode) return;
    try {
      setError(null);
      if (IS_AGD) {
        // AGD: read the unified pots from agd-casino-service (game-agnostic
        // endpoint), keep GLOBAL + roulette pots.
        const pots = await getAdapter().listJackpotsForKiosk(kioskCode);
        if (!aliveRef.current) return;
        setPots(agdPotsToCards(pots, AGD_GAME_CODE, ROULETTE_GAME_LABEL));
        return;
      }
      const res = await api.get(`/roulette/jackpots`, { params: { kiosk_id: kioskCode } });
      if (!aliveRef.current) return;
      setPots(toPotCards(res.data?.jackpots, kioskCode));
    } catch (err) {
      if (!aliveRef.current) return;
      setError(err);
    } finally {
      if (aliveRef.current) setLoading(false);
    }
  };

  useEffect(() => {
    aliveRef.current = true;
    if (!kioskCode) {
      setPots([]);
      return undefined;
    }
    setLoading(true);
    fetchPots();
    const id = setInterval(fetchPots, POLL_MS);
    return () => {
      aliveRef.current = false;
      clearInterval(id);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [kioskCode]);

  return { pots, loading, error, refresh: fetchPots };
};
