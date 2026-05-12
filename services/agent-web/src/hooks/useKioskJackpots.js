import { useEffect, useRef, useState } from 'react';
import api from '../api/client';

const POLL_MS = 5000;

/**
 * Recupere periodiquement les pots actifs alimentes par les tickets de ce kiosque.
 * Retourne `{ pots, loading, error, refresh }`.
 * Pas d'appel si `kioskCode` est absent.
 */
export const useKioskJackpots = (kioskCode) => {
  const [pots, setPots] = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const aliveRef = useRef(true);

  const fetchPots = async () => {
    if (!kioskCode) return;
    try {
      setError(null);
      const res = await api.get(`/tickets/jackpots/by-kiosk/${kioskCode}`);
      if (!aliveRef.current) return;
      setPots(res.data?.pots || []);
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
