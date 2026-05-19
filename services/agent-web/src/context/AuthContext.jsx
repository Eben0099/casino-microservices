import React, { createContext, useContext, useEffect, useRef, useState } from 'react';
import { agentApi } from '../api/endpoints';
import { getAdapter } from '../api/adapters';
import {
  INITIAL_TOKEN_FROM_URL,
  IS_AGD,
  IS_EMBED,
} from '../config';

const AuthContext = createContext();

const TOKEN_KEY = 'agent_token';
const USER_KEY = 'agent_user';

/**
 * Tries to decode the userId out of a JWT without verifying signature.
 * Used only when the embed handshake hands us a fresh token but no
 * user payload — we still need an id to query the wallet balance.
 */
function readUserIdFromJwt(token) {
  if (!token) return null;
  try {
    const part = token.split('.')[1].replace(/-/g, '+').replace(/_/g, '/');
    // Base64 requires a length multiple of 4. Compute exactly how many '='
    // chars to append (0..3). Naively appending '===' breaks atob() when
    // the natural length is already aligned.
    const padding = '==='.slice((part.length + 3) % 4);
    const payload = JSON.parse(atob(part + padding));
    return payload.userId || payload.user_id || payload.sub || null;
  } catch {
    return null;
  }
}

export const AuthProvider = ({ children }) => {
  const [user, setUser] = useState(null);
  const [balance, setBalance] = useState(0);
  const [loading, setLoading] = useState(true);
  const bootstrapped = useRef(false);

  const fetchBalance = async (agentId) => {
    if (!agentId) return;
    try {
      const res = await agentApi.getDetails(agentId);
      setBalance(res.data.caisse.balance);
      const a = res.data.agent || {};
      setUser((prev) => {
        if (!prev) return prev;
        if (prev.kiosk_code === a.kiosk_code && prev.kiosk_name === a.kiosk_name)
          return prev;
        const next = { ...prev, kiosk_code: a.kiosk_code, kiosk_name: a.kiosk_name };
        localStorage.setItem(USER_KEY, JSON.stringify(next));
        return next;
      });
    } catch (err) {
      console.error('Erreur balance:', err);
    }
  };

  // -- Embed handshake ----------------------------------------------------
  // When the page is opened with ?embed=1, the parent webview is
  // expected to either:
  //   a) include the JWT in the URL as ?token=<JWT>, OR
  //   b) postMessage({ type: 'agd:auth', token, user? }) after the
  //      iframe signals readiness via { type: 'agd:ready' }.
  // Either path persists the token + user under the same localStorage
  // keys the rest of the app already uses, so downstream pages don't
  // need to know about embed at all.
  // One-time bootstrap of the persisted session. Guarded by `bootstrapped`
  // so React's StrictMode double-effect doesn't double-fetch.
  useEffect(() => {
    if (bootstrapped.current) return;
    bootstrapped.current = true;

    if (IS_EMBED && INITIAL_TOKEN_FROM_URL) {
      localStorage.setItem(TOKEN_KEY, INITIAL_TOKEN_FROM_URL);
      const userId = readUserIdFromJwt(INITIAL_TOKEN_FROM_URL);
      if (userId) {
        const synthetic = {
          id: userId,
          name: '',
          phone: null,
          kiosk_code: null,
          kiosk_name: null,
        };
        localStorage.setItem(USER_KEY, JSON.stringify(synthetic));
        setUser(synthetic);
        fetchBalance(userId);
      }
    }

    const savedUser = localStorage.getItem(USER_KEY);
    if (savedUser) {
      try {
        const parsedUser = JSON.parse(savedUser);
        setUser(parsedUser);
        fetchBalance(parsedUser.id);
      } catch {
        localStorage.removeItem(USER_KEY);
      }
    }
    setLoading(false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // PostMessage handshake with the parent webview (agd_terminal_web_app).
  // NOTE: this effect MUST register the listener every time the component
  // mounts. React StrictMode mounts effects twice in dev; if we tied the
  // listener to the `bootstrapped` guard above, the StrictMode cleanup
  // would tear down the listener and the second mount would skip past
  // re-registering it (because bootstrapped.current is already true),
  // leaving the iframe deaf to subsequent agd:auth messages.
  useEffect(() => {
    if (!IS_EMBED) return;

    const handler = (event) => {
      const msg = event?.data;
      if (!msg || typeof msg !== 'object') return;
      if (msg.type === 'agd:auth' && msg.token) {
        localStorage.setItem(TOKEN_KEY, msg.token);
        const id = msg.user?.id || readUserIdFromJwt(msg.token);
        const u = {
          id,
          name: msg.user?.name ?? '',
          phone: msg.user?.phone ?? null,
          kiosk_code: msg.user?.kiosk_code ?? null,
          kiosk_name: msg.user?.kiosk_name ?? null,
          email: msg.user?.email ?? null,
        };
        localStorage.setItem(USER_KEY, JSON.stringify(u));
        setUser(u);
        if (id) fetchBalance(id);
      } else if (msg.type === 'agd:logout') {
        logoutInternal();
      }
    };

    window.addEventListener('message', handler);

    try {
      window.parent?.postMessage(
        { type: 'agd:ready', mode: IS_AGD ? 'agd' : 'standalone' },
        '*',
      );
    } catch {
      /* cross-origin sandbox can forbid postMessage; safe to ignore */
    }

    return () => window.removeEventListener('message', handler);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const logoutInternal = () => {
    localStorage.removeItem(TOKEN_KEY);
    localStorage.removeItem(USER_KEY);
    setUser(null);
    setBalance(0);
    try {
      getAdapter().closePlayContext?.('logout');
    } catch {
      /* best-effort */
    }
  };

  const login = async (phoneOrEmail, password) => {
    const res = await agentApi.login(phoneOrEmail, password);
    const { access_token, agent_id, agent_name, kiosk_code, kiosk_name } =
      res.data;
    const userData = {
      id: agent_id,
      name: agent_name,
      phone: phoneOrEmail,
      kiosk_code,
      kiosk_name,
    };
    localStorage.setItem(TOKEN_KEY, access_token);
    localStorage.setItem(USER_KEY, JSON.stringify(userData));
    setUser(userData);
    await fetchBalance(agent_id);
  };

  const logout = () => {
    logoutInternal();
    if (IS_EMBED) {
      try {
        window.parent?.postMessage({ type: 'agd:logout' }, '*');
      } catch {
        /* ignore */
      }
    }
  };

  return (
    <AuthContext.Provider
      value={{ user, balance, login, logout, fetchBalance, loading }}
    >
      {children}
    </AuthContext.Provider>
  );
};

export const useAuth = () => useContext(AuthContext);
