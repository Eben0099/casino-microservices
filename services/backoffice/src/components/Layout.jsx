import React, { useEffect, useState } from 'react';
import { Outlet, NavLink, useNavigate } from 'react-router-dom';
import axios from 'axios';
import { Sun, Moon, LogOut } from 'lucide-react';
import { useTheme } from '../contexts/ThemeContext';

const NAV_ITEMS = [
  { label: "Vue d'ensemble", path: '/dashboard'    },
  { label: 'Roulette',       path: '/roulette'     },
  { label: 'Keno',           path: '/keno'         },
  { label: 'Jackpots',       path: '/jackpots'     },
  { label: 'Caissiers',      path: '/agents'       },
  { label: 'Betslip',        path: '/transactions' },
  { label: 'Paramètres',     path: '/parametres'   },
];

const useClock = () => {
  const [now, setNow] = useState(new Date());
  useEffect(() => {
    const id = setInterval(() => setNow(new Date()), 1000);
    return () => clearInterval(id);
  }, []);
  return now;
};

const useGlobalKpis = () => {
  const [kpis, setKpis] = useState({ wager: 0, ggr: 0 });
  useEffect(() => {
    let cancelled = false;
    const fetch = async () => {
      const adminKey = localStorage.getItem('admin_key');
      if (!adminKey) return;
      try {
        const { data } = await axios.get('/api/tickets/admin/stats', { headers: { 'x-api-key': adminKey } });
        if (cancelled) return;
        const wager = data.total_wager || 0;
        const payout = data.total_payout || 0;
        setKpis({ wager, ggr: wager - payout });
      } catch {}
    };
    fetch();
    const id = setInterval(fetch, 30000);
    return () => { cancelled = true; clearInterval(id); };
  }, []);
  return kpis;
};

const fmt = (n) => Math.round(n).toLocaleString('fr-FR');

const Layout = () => {
  const navigate = useNavigate();
  const { theme, toggleTheme } = useTheme();
  const now = useClock();
  const { wager, ggr } = useGlobalKpis();

  const handleLogout = () => {
    localStorage.removeItem('admin_key');
    navigate('/login');
  };

  return (
    <div className="min-h-screen flex flex-col" style={{ background: 'var(--bg-base)' }}>
      {/* TOP NAV */}
      <header
        className="sticky top-0 z-30"
        style={{ background: 'var(--bg-topbar)', borderBottom: '1px solid var(--border-subtle)' }}
      >
        <div className="px-6 h-[64px] flex items-center gap-6">
          {/* Brand */}
          <NavLink to="/dashboard" className="flex items-center gap-2.5 shrink-0">
            <div
              className="w-8 h-8 rounded-md flex items-center justify-center text-[10px] font-black"
              style={{ background: 'var(--accent)', color: 'var(--text-on-accent)' }}
            >
              AG
            </div>
            <span
              className="text-[15px] font-bold tracking-[0.18em]"
              style={{ color: 'var(--text-primary)', fontFamily: 'Raleway' }}
            >
              ADMIN
            </span>
          </NavLink>

          {/* Nav links */}
          <nav className="flex items-center gap-1">
            {NAV_ITEMS.map((item) => (
              <NavLink
                key={item.path}
                to={item.path}
                className={({ isActive }) =>
                  `px-4 h-9 rounded-md inline-flex items-center text-sm font-medium transition-colors`
                }
                style={({ isActive }) => ({
                  background: isActive ? 'var(--bg-elevated)' : 'transparent',
                  color: isActive ? 'var(--text-primary)' : 'var(--text-secondary)',
                  border: isActive ? '1px solid var(--border-subtle)' : '1px solid transparent',
                })}
              >
                {item.label}
              </NavLink>
            ))}
          </nav>

          <div className="flex-1" />

          {/* Right cluster: KPI pill, clock, user, theme, logout */}
          <div className="flex items-center gap-4">
            {/* KPI pill */}
            <div
              className="hidden md:flex items-stretch rounded-md overflow-hidden"
              style={{ border: '1px solid var(--border-subtle)' }}
            >
              <div className="px-3 py-1.5 flex flex-col leading-tight" style={{ borderRight: '1px solid var(--border-subtle)' }}>
                <span className="text-[10px] font-semibold tracking-wider uppercase" style={{ color: 'var(--text-muted)' }}>
                  CA
                </span>
                <span className="text-[13px] font-bold" style={{ color: 'var(--accent)' }}>
                  {fmt(wager)} <span className="text-[10px] opacity-70">XAF</span>
                </span>
              </div>
              <div className="px-3 py-1.5 flex flex-col leading-tight">
                <span className="text-[10px] font-semibold tracking-wider uppercase" style={{ color: 'var(--text-muted)' }}>
                  GGR
                </span>
                <span className="text-[13px] font-bold" style={{ color: ggr >= 0 ? 'var(--green)' : 'var(--red)' }}>
                  {fmt(ggr)} <span className="text-[10px] opacity-70">XAF</span>
                </span>
              </div>
            </div>

            {/* Clock */}
            <div className="hidden lg:block tabular-nums text-[15px] font-medium tracking-wider" style={{ color: 'var(--text-primary)' }}>
              {now.toLocaleTimeString('fr-FR', { hour12: false })}
            </div>

            {/* User */}
            <div className="hidden md:block text-right leading-tight">
              <p className="text-[13px] font-bold" style={{ color: 'var(--text-primary)' }}>Super Admin</p>
              <p className="text-[11px]" style={{ color: 'var(--text-muted)' }}>Backoffice</p>
            </div>

            {/* Theme */}
            <button
              onClick={toggleTheme}
              title="Basculer le thème"
              className="p-2 rounded-md transition-colors"
              style={{ background: 'transparent', color: 'var(--text-secondary)', border: '1px solid var(--border-subtle)' }}
            >
              {theme === 'dark' ? <Sun size={16} /> : <Moon size={16} />}
            </button>

            {/* Logout */}
            <button
              onClick={handleLogout}
              className="px-3.5 h-9 rounded-md text-sm font-semibold transition-colors inline-flex items-center gap-2"
              style={{ background: 'transparent', color: 'var(--text-primary)', border: '1px solid var(--border-subtle)' }}
            >
              <LogOut size={14} />
              <span className="hidden sm:inline">Déconnexion</span>
            </button>
          </div>
        </div>
      </header>

      {/* PAGE CONTENT */}
      <main className="flex-1 px-6 py-6">
        <Outlet />
      </main>
    </div>
  );
};

export default Layout;
