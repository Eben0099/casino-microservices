import { useEffect, useRef, useState } from 'react';
import api from '../api/client';

const POLL_MS = 5000;
const KENO_GAME_LABEL = 'Keno';

/**
 * Periodically fetches Keno jackpots for this kiosk from the engine's
 * public endpoint:  GET /keno/jackpots?kiosk_id=<code>
 *
 * The engine (game-keno-service) returns:
 *   {
 *     jackpot: { generalAmount, volkenoAmount, currency, lastHitDrawId },
 *     medals:  { bronze, silver, gold },   // per-kiosk counters
 *     kiosk_id: "<code>"
 *   }
 *
 * This hook normalises those into the pot-card shape consumed by
 * <JackpotsBar>:
 *
 *   [
 *     { id, scope: 'GLOBAL'|'GAME'|'LOCAL', tier?, current_amount, game_id? }
 *   ]
 *
 * Mapping:
 *   generalAmount  → Grand Jackpot   (scope = GLOBAL)
 *   volkenoAmount  → Game Jackpot    (scope = GAME, game_id = 'Keno')
 *   bronze (> 0)   → Local Bronze    (scope = LOCAL, tier = BRONZE)
 *   silver (> 0)   → Local Argent    (scope = LOCAL, tier = SILVER)
 *   gold   (> 0)   → Local Or        (scope = LOCAL, tier = GOLD)
 *
 * Medal counters are integer counts, not XAF amounts.  They are still
 * stored in current_amount so JackpotsBar can display the number without
 * any change to that component.
 *
 * No fetch if kioskCode is absent.
 *
 * @param {string|null|undefined} kioskCode
 * @returns {{ pots: Array, loading: boolean, error: Error|null, refresh: () => void }}
 */

const toPotCards = (data, kioskCode) => {
  if (!data) return [];
  const { jackpot, medals } = data;
  const out = [];

  if (jackpot) {
    if (typeof jackpot.generalAmount === 'number') {
      out.push({
        id: 'keno-general',
        scope: 'GLOBAL',
        current_amount: jackpot.generalAmount,
      });
    }
    if (typeof jackpot.volkenoAmount === 'number') {
      out.push({
        id: 'keno-volkeno',
        scope: 'GAME',
        game_id: KENO_GAME_LABEL,
        current_amount: jackpot.volkenoAmount,
      });
    }
  }

  if (medals && kioskCode) {
    if (typeof medals.bronze === 'number' && medals.bronze > 0) {
      out.push({
        id: `keno-bronze-${kioskCode}`,
        scope: 'LOCAL',
        tier: 'BRONZE',
        current_amount: medals.bronze,
      });
    }
    if (typeof medals.silver === 'number' && medals.silver > 0) {
      out.push({
        id: `keno-silver-${kioskCode}`,
        scope: 'LOCAL',
        tier: 'SILVER',
        current_amount: medals.silver,
      });
    }
    if (typeof medals.gold === 'number' && medals.gold > 0) {
      out.push({
        id: `keno-gold-${kioskCode}`,
        scope: 'LOCAL',
        tier: 'GOLD',
        current_amount: medals.gold,
      });
    }
  }

  return out;
};

export const useKenoJackpots = (kioskCode) => {
  const [pots, setPots] = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const aliveRef = useRef(true);

  const fetchPots = async () => {
    if (!kioskCode) return;
    try {
      setError(null);
      const params = { kiosk_id: kioskCode };
      const res = await api.get('/keno/jackpots', { params });
      if (!aliveRef.current) return;
      setPots(toPotCards(res.data, kioskCode));
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

export default useKenoJackpots;
