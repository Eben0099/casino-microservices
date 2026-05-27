import React from 'react';
import { useNavigate, useLocation } from 'react-router-dom';
import GameTile from './GameTile';

// Shared game switcher shown on every game page so the cashier can jump
// between games from any of them. `route` is where an available tile
// navigates; the active tile is derived from the current path so the right
// one is always highlighted (no per-page hardcoding).
const GAMES = [
  { code: 'SW', label: 'Spin & Win', available: true,  route: '/jeux' },
  { code: 'VK', label: 'VolKeno',    available: true,  route: '/keno' },
  { code: 'S3', label: 'Super 3',    available: false, route: null    },
  { code: 'CR', label: 'Crash',      available: false, route: null    },
  { code: 'LO', label: 'Loto',       available: false, route: null    },
];

const GamesSidebar = () => {
  const navigate = useNavigate();
  const { pathname } = useLocation();
  const activeCode = pathname.includes('/keno') ? 'VK' : 'SW';

  return (
    <aside style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
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
