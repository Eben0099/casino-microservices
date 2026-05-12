import React, { createContext, useContext, useCallback, useMemo, useState } from 'react';
import { fr } from './locales/fr';
import { en } from './locales/en';

const DICTS = { fr, en };
const STORAGE_KEY = 'agent_lang';
const DEFAULT_LANG = 'fr';

const I18nContext = createContext(null);

const resolve = (dict, key) => {
  const parts = key.split('.');
  let value = dict;
  for (const p of parts) {
    if (value && typeof value === 'object' && p in value) value = value[p];
    else return undefined;
  }
  return value;
};

const interpolate = (str, vars) => {
  if (!vars) return str;
  return str.replace(/\{(\w+)\}/g, (_, k) => (vars[k] != null ? String(vars[k]) : `{${k}}`));
};

export const I18nProvider = ({ children }) => {
  const [lang, setLangState] = useState(() => {
    try {
      const stored = localStorage.getItem(STORAGE_KEY);
      if (stored && DICTS[stored]) return stored;
    } catch (_) { /* ignore */ }
    return DEFAULT_LANG;
  });

  const setLang = useCallback((l) => {
    if (!DICTS[l]) return;
    try { localStorage.setItem(STORAGE_KEY, l); } catch (_) { /* ignore */ }
    setLangState(l);
    document.documentElement.lang = l;
  }, []);

  const t = useCallback((key, vars) => {
    const value = resolve(DICTS[lang], key);
    if (typeof value === 'string') return interpolate(value, vars);
    // Fallback to FR if missing in current language
    const fallback = resolve(DICTS.fr, key);
    if (typeof fallback === 'string') return interpolate(fallback, vars);
    return key;
  }, [lang]);

  // Locale-aware number formatter
  const fmtN = useCallback((n) => {
    const locale = resolve(DICTS[lang], 'intl.locale') || 'en-US';
    return Math.round(n || 0).toLocaleString(locale);
  }, [lang]);

  const locale = useMemo(() => resolve(DICTS[lang], 'intl.locale') || 'en-US', [lang]);

  const value = useMemo(
    () => ({ lang, setLang, t, fmtN, locale }),
    [lang, setLang, t, fmtN, locale],
  );

  return <I18nContext.Provider value={value}>{children}</I18nContext.Provider>;
};

export const useT = () => {
  const ctx = useContext(I18nContext);
  if (!ctx) throw new Error('useT must be used within I18nProvider');
  return ctx;
};

export const LanguageToggle = ({ compact = false }) => {
  const { lang, setLang, t } = useT();
  const btn = (code) => {
    const active = lang === code;
    return (
      <button
        key={code}
        type="button"
        onClick={() => setLang(code)}
        aria-pressed={active}
        aria-label={t('common.languageToggle')}
        style={{
          padding: compact ? '4px 8px' : '6px 10px',
          fontSize: 11,
          fontWeight: 800,
          letterSpacing: '0.08em',
          fontFamily: 'Inter, system-ui, sans-serif',
          background: active ? 'var(--accent)' : 'transparent',
          color: active ? 'var(--text-on-accent)' : 'var(--text-secondary)',
          border: 'none',
          cursor: active ? 'default' : 'pointer',
          transition: 'background-color 0.15s, color 0.15s',
        }}
      >
        {code.toUpperCase()}
      </button>
    );
  };
  return (
    <div
      role="group"
      aria-label={t('common.languageToggle')}
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        border: '1px solid var(--border-subtle)',
        borderRadius: 6,
        overflow: 'hidden',
        background: 'var(--bg-surface)',
      }}
    >
      {btn('fr')}
      <span style={{ width: 1, alignSelf: 'stretch', background: 'var(--border-subtle)' }} />
      {btn('en')}
    </div>
  );
};

export default I18nProvider;
