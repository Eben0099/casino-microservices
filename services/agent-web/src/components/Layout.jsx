import React, { useEffect, useState } from 'react';
import { Outlet, NavLink, useNavigate } from 'react-router-dom';
import { Sun, Moon, LogOut } from 'lucide-react';
import { useAuth } from '../context/AuthContext';
import { useTheme } from '../context/ThemeContext';

const NAV_ITEMS = [
  { label: 'Jeux',     path: '/jeux'    },
  { label: 'Ventes',   path: '/ventes'  },
  { label: 'Vérifier', path: '/verify'  },
  { label: 'Service',  path: '/shift'   },
];

const useClock = () => {
  const [now, setNow] = useState(new Date());
  useEffect(() => {
    const id = setInterval(() => setNow(new Date()), 1000);
    return () => clearInterval(id);
  }, []);
  return now;
};

const fmt = (n) => Math.round(n || 0).toLocaleString('fr-FR');

const Layout = () => {
  const { user, balance, logout } = useAuth();
  const { theme, toggleTheme } = useTheme();
  const navigate = useNavigate();
  const now = useClock();

  const handleLogout = () => { logout(); navigate('/login'); };

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
              CAISSE
            </span>
          </NavLink>

          {/* Nav links */}
          <nav style={{ display: 'flex', gap: 4 }}>
            {NAV_ITEMS.map((item) => (
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
                {item.label}
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
                  SOLDE
                </span>
                <span style={{ fontSize: 13, fontWeight: 800, color: 'var(--accent)' }}>
                  {fmt(balance)} <span style={{ fontSize: 10, opacity: 0.7 }}>XAF</span>
                </span>
              </div>
              <div style={{ padding: '6px 12px', display: 'flex', flexDirection: 'column', lineHeight: 1.1 }}>
                <span style={{
                  fontSize: 10, fontWeight: 600, letterSpacing: '0.08em',
                  textTransform: 'uppercase', color: 'var(--text-muted)',
                }}>
                  CASH (0)
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
              {now.toLocaleTimeString('fr-FR', { hour12: false })}
            </div>

            {/* User */}
            <div style={{ textAlign: 'right', lineHeight: 1.15 }}>
              <p style={{ fontSize: 13, fontWeight: 700, color: 'var(--text-primary)' }}>
                {user?.kiosk_name || user?.name || 'Caissière'}
              </p>
              <p style={{ fontSize: 11, color: 'var(--text-muted)' }}>
                {user?.name ? `Caissière ${user.name.split(' ')[0]}` : 'Connectée'}
              </p>
            </div>

            {/* Theme */}
            <button
              onClick={toggleTheme}
              title="Basculer le thème"
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
              Déconnexion
            </button>
          </div>
        </div>
      </header>

      {/* PAGE */}
      <main style={{ flex: 1, padding: '24px', maxWidth: 1440, margin: '0 auto', width: '100%' }}>
        <Outlet />
      </main>
    </div>
  );
};

export default Layout;
