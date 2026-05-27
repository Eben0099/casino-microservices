import React from 'react';
import { useNavigate, useLocation } from 'react-router-dom';

// Shared game switcher for the admin game pages (Roulette, Keno…). Persistent
// and route-aware: the active tile is derived from the current path, and an
// available tile navigates to its game page. Mirrors the cashier GamesSidebar.
const GAMES = [
  { code: 'SW', label: 'Spin & Win', available: true,  route: '/roulette' },
  { code: 'VK', label: 'VolKeno',    available: true,  route: '/keno' },
  { code: 'S3', label: 'Super 3',    available: false, route: null },
  { code: 'CR', label: 'Crash',      available: false, route: null },
  { code: 'LO', label: 'Loto',       available: false, route: null },
];

const GameTile = ({ code, label, active, available, onClick }) => {
  const base = 'rounded-xl px-3 py-4 flex flex-col items-center gap-1 select-none transition-colors text-center';
  const styleActive = {
    background: 'var(--accent)',
    color: 'var(--text-on-accent)',
    border: '1px solid var(--accent)',
    boxShadow: '0 0 0 3px rgba(245,158,11,0.18)',
  };
  const styleIdle = {
    background: 'var(--bg-tile)',
    color: 'var(--text-secondary)',
    border: '1px solid var(--border-subtle)',
    cursor: available ? 'pointer' : 'not-allowed',
    opacity: available ? 1 : 0.55,
  };
  return (
    <div
      className={base}
      style={active ? styleActive : styleIdle}
      onClick={available && !active ? onClick : undefined}
    >
      <span className="text-lg font-black tracking-wide" style={{ fontFamily: 'Raleway' }}>{code}</span>
      <span className="text-[12px] font-semibold">{label}</span>
      {!available && (
        <span className="text-[9px] font-bold tracking-widest mt-1 px-1.5 py-0.5 rounded"
          style={{ background: 'var(--bg-elevated)', color: 'var(--text-muted)' }}>
          BIENTÔT
        </span>
      )}
    </div>
  );
};

const GamesSidebar = () => {
  const navigate = useNavigate();
  const { pathname } = useLocation();
  const activeCode = pathname.includes('/keno') ? 'VK' : 'SW';

  return (
    <aside className="space-y-2">
      {GAMES.map((g) => (
        <GameTile
          key={g.code}
          code={g.code}
          label={g.label}
          available={g.available}
          active={g.code === activeCode}
          onClick={g.route ? () => navigate(g.route) : undefined}
        />
      ))}
    </aside>
  );
};

export default GamesSidebar;
