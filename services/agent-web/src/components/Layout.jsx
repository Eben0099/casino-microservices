import React, { useEffect, useState } from 'react';
import { Outlet, NavLink, useNavigate } from 'react-router-dom';
import { Sun, Moon, LogOut } from 'lucide-react';
import { useAuth } from '../context/AuthContext';
import { useTheme } from '../context/ThemeContext';
import { useT, LanguageToggle } from '../i18n';
import { IS_EMBED } from '../config';

const NAV_KEYS = [
  { key: 'nav.games',  path: '/jeux'    },
  { key: 'nav.sales',  path: '/ventes'  },
  { key: 'nav.verify', path: '/verify'  },
  { key: 'nav.shift',  path: '/shift'   },
];

const useClock = () => {
  const [now, setNow] = useState(new Date());
  useEffect(() => {
    const id = setInterval(() => setNow(new Date()), 1000);
    return () => clearInterval(id);
  }, []);
  return now;
};

const Layout = () => {
  const { user, balance, logout } = useAuth();
  const { theme, toggleTheme } = useTheme();
  const { t, fmtN, locale } = useT();
  const navigate = useNavigate();
  const now = useClock();

  const handleLogout = () => { logout(); navigate('/login'); };

  // Embed mode (parent webview AGD assumes auth + chrome): render the
  // page surface without the top nav so the host page controls layout.
  if (IS_EMBED) {
    return (
      <div className="agd-shell agd-shell-embed" style={{ minHeight: '100vh', background: 'var(--bg-base)' }}>
        <main style={{ padding: '12px', width: '100%' }}>
          <Outlet />
        </main>
      </div>
    );
  }

  return (
    <div className="agd-shell" style={{ minHeight: '100vh', background: 'var(--bg-base)', display: 'flex', flexDirection: 'column' }}>
      {/* TOP NAV */}
      <header
        style={{
          position: 'sticky', top: 0, zIndex: 30,
          background: 'var(--bg-topbar)',
          borderBottom: '1px solid var(--border-subtle)',
        }}
      >
        <div style={{
          display: 'flex', alignItems: 'center', gap: '24px',
          padding: '0 24px', height: 64,
        }}>
          {/* Brand */}
          <NavLink to="/jeux" style={{ display: 'flex', alignItems: 'center', gap: 10, textDecoration: 'none', flexShrink: 0 }}>
            <span style={{
              fontSize: 15, fontWeight: 800, letterSpacing: '0.22em',
              color: 'var(--text-primary)', fontFamily: 'Outfit',
            }}>
              {t('layout.brand')}
            </span>
          </NavLink>

          {/* Nav links */}
          <nav style={{ display: 'flex', gap: 4 }}>
            {NAV_KEYS.map((item) => (
              <NavLink
                key={item.path}
                to={item.path}
                style={({ isActive }) => ({
                  padding: '0 16px', height: 36, display: 'inline-flex', alignItems: 'center',
                  borderRadius: 6, fontSize: 14, fontWeight: 500,
                  textDecoration: 'none',
                  background: isActive ? 'var(--bg-elevated)' : 'transparent',
                  color: isActive ? 'var(--text-primary)' : 'var(--text-secondary)',
                  border: isActive ? '1px solid var(--border-subtle)' : '1px solid transparent',
                  transition: 'background-color 0.15s, color 0.15s',
                })}
              >
                {t(item.key)}
              </NavLink>
            ))}
          </nav>

          <div style={{ flex: 1 }} />

          {/* Right cluster: balance pill, clock, user, theme, logout */}
          <div style={{ display: 'flex', alignItems: 'center', gap: 16 }}>
            {/* Balance pill */}
            <div style={{
              display: 'flex', alignItems: 'stretch',
              borderRadius: 6, overflow: 'hidden',
              border: '1px solid var(--border-subtle)',
            }}>
              <div style={{
                padding: '6px 12px', display: 'flex', flexDirection: 'column', lineHeight: 1.1,
                borderRight: '1px solid var(--border-subtle)',
              }}>
                <span style={{
                  fontSize: 10, fontWeight: 600, letterSpacing: '0.08em',
                  textTransform: 'uppercase', color: 'var(--text-muted)',
                }}>
                  {t('layout.balance')}
                </span>
                <span style={{ fontSize: 13, fontWeight: 800, color: 'var(--accent)' }}>
                  {fmtN(balance)} <span style={{ fontSize: 10, opacity: 0.7 }}>XAF</span>
                </span>
              </div>
              <div style={{ padding: '6px 12px', display: 'flex', flexDirection: 'column', lineHeight: 1.1 }}>
                <span style={{
                  fontSize: 10, fontWeight: 600, letterSpacing: '0.08em',
                  textTransform: 'uppercase', color: 'var(--text-muted)',
                }}>
                  {t('layout.cash')}
                </span>
                <span style={{ fontSize: 13, fontWeight: 800, color: 'var(--success)' }}>
                  0 <span style={{ fontSize: 10, opacity: 0.7 }}>XAF</span>
                </span>
              </div>
            </div>

            {/* Clock */}
            <div style={{
              fontSize: 15, fontWeight: 500, letterSpacing: '0.06em',
              color: 'var(--text-primary)', fontVariantNumeric: 'tabular-nums',
            }}>
              {now.toLocaleTimeString(locale, { hour12: false })}
            </div>

            {/* Kiosk code badge */}
            {user?.kiosk_code && (
              <div
                title={t('layout.kioskCodeTooltip')}
                style={{
                  display: 'flex', alignItems: 'center', gap: 8,
                  padding: '6px 12px', borderRadius: 6,
                  border: '1px solid var(--border-subtle)',
                  background: 'var(--bg-elevated)',
                  lineHeight: 1.1,
                }}
              >
                <span style={{
                  fontSize: 9, fontWeight: 700, letterSpacing: '0.1em',
                  textTransform: 'uppercase', color: 'var(--text-muted)',
                }}>
                  {t('layout.kioskCode')}
                </span>
                <span style={{
                  fontSize: 14, fontWeight: 800, color: 'var(--accent)',
                  fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace',
                  letterSpacing: '0.15em',
                }}>
                  {user.kiosk_code}
                </span>
              </div>
            )}

            {/* User */}
            <div style={{ textAlign: 'right', lineHeight: 1.15 }}>
              <p style={{ fontSize: 13, fontWeight: 700, color: 'var(--text-primary)' }}>
                {user?.kiosk_name || user?.name || t('layout.cashierFallback')}
              </p>
              <p style={{ fontSize: 11, color: 'var(--text-muted)' }}>
                {user?.name ? `${t('layout.cashierPrefix')} ${user.name.split(' ')[0]}` : t('common.connected')}
              </p>
            </div>

            {/* Language */}
            <LanguageToggle />

            {/* Theme */}
            <button
              onClick={toggleTheme}
              title={t('common.themeToggle')}
              style={{
                background: 'transparent', cursor: 'pointer',
                color: 'var(--text-secondary)',
                border: '1px solid var(--border-subtle)',
                borderRadius: 6, padding: 8,
                display: 'flex', alignItems: 'center', justifyContent: 'center',
              }}
            >
              {theme === 'dark' ? <Sun size={16} /> : <Moon size={16} />}
            </button>

            {/* Logout */}
            <button
              onClick={handleLogout}
              style={{
                padding: '0 14px', height: 36, fontSize: 14, fontWeight: 600,
                background: 'transparent', cursor: 'pointer',
                color: 'var(--text-primary)',
                border: '1px solid var(--border-subtle)',
                borderRadius: 6,
                display: 'inline-flex', alignItems: 'center', gap: 8,
              }}
            >
              <LogOut size={14} />
              {t('common.logout')}
            </button>
          </div>
        </div>
      </header>

      {/* PAGE */}
      <main style={{ flex: 1, padding: '24px', width: '100%' }}>
        <Outlet />
      </main>
    </div>
  );
};

export default Layout;
