import React from 'react';
import { useNavigate, useLocation } from 'react-router-dom';
import { LayoutDashboard, CircleDot, Users, Receipt, Settings, LogOut, Sun, Moon } from 'lucide-react';
import { useTheme } from '../contexts/ThemeContext';

const NAV_ITEMS = [
  { id: 'dashboard', label: "Vue d'ensemble", icon: LayoutDashboard, path: '/dashboard' },
  {
    id: 'jeux', label: 'JEUX', type: 'group',
    children: [
      { id: 'roulette', label: 'Roulette', icon: CircleDot, path: '/roulette' },
    ],
  },
  {
    id: 'operations', label: 'OPERATIONS', type: 'group',
    children: [
      { id: 'agents', label: 'Caissiers', icon: Users, path: '/agents' },
      { id: 'transactions', label: 'Transactions', icon: Receipt, path: '/transactions' },
    ],
  },
  { id: 'parametres', label: 'Parametres', icon: Settings, path: '/parametres' },
];

const NavItem = ({ item, active, onClick }) => (
  <button
    onClick={onClick}
    className={`w-full flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm font-medium transition-all duration-150 ${
      active
        ? 'text-white bg-[var(--bg-sidebar-active)] border-l-2 border-[var(--accent)]'
        : 'text-slate-400 hover:text-slate-200 hover:bg-[var(--bg-sidebar-hover)] border-l-2 border-transparent'
    }`}
  >
    <item.icon size={18} strokeWidth={active ? 2.5 : 1.8} />
    <span>{item.label}</span>
  </button>
);

const Sidebar = () => {
  const navigate = useNavigate();
  const { pathname } = useLocation();
  const { theme, toggleTheme } = useTheme();

  const handleLogout = () => {
    localStorage.removeItem('admin_key');
    navigate('/login');
  };

  return (
    <aside
      className="fixed top-0 left-0 h-screen flex flex-col"
      style={{ width: 'var(--sidebar-w)', background: 'var(--bg-sidebar)', borderRight: '1px solid var(--border-subtle)' }}
    >
      {/* Logo */}
      <div className="px-5 py-5 border-b" style={{ borderColor: 'rgba(255,255,255,0.06)' }}>
        <div className="flex items-center gap-2.5">
          <div className="w-8 h-8 rounded-lg flex items-center justify-center font-black text-xs" style={{ background: 'var(--accent)', color: '#000' }}>
            AG
          </div>
          <div>
            <div className="text-white font-bold text-sm tracking-wide" style={{ fontFamily: 'Raleway' }}>AGD ADMIN</div>
            <div className="text-[10px] text-slate-500 tracking-wider">BACKOFFICE</div>
          </div>
        </div>
      </div>

      {/* Navigation */}
      <nav className="flex-1 px-3 py-4 space-y-1 overflow-y-auto">
        {NAV_ITEMS.map(item => {
          if (item.type === 'group') {
            return (
              <div key={item.id} className="mt-5 mb-1">
                <div className="px-3 mb-2 text-[10px] font-semibold tracking-[0.15em] text-slate-500 uppercase">
                  {item.label}
                </div>
                <div className="space-y-0.5">
                  {item.children.map(child => (
                    <NavItem
                      key={child.id}
                      item={child}
                      active={pathname === child.path}
                      onClick={() => navigate(child.path)}
                    />
                  ))}
                </div>
              </div>
            );
          }
          return (
            <NavItem
              key={item.id}
              item={item}
              active={pathname === item.path}
              onClick={() => navigate(item.path)}
            />
          );
        })}
      </nav>

      {/* Bottom actions */}
      <div className="px-3 py-4 space-y-1 border-t" style={{ borderColor: 'rgba(255,255,255,0.06)' }}>
        <button
          onClick={toggleTheme}
          className="w-full flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm text-slate-400 hover:text-slate-200 hover:bg-[var(--bg-sidebar-hover)] transition-all duration-150"
        >
          {theme === 'dark' ? <Sun size={18} /> : <Moon size={18} />}
          <span>{theme === 'dark' ? 'Mode clair' : 'Mode sombre'}</span>
        </button>
        <button
          onClick={handleLogout}
          className="w-full flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm text-slate-400 hover:text-red-400 hover:bg-red-500/10 transition-all duration-150"
        >
          <LogOut size={18} />
          <span>Deconnexion</span>
        </button>
      </div>
    </aside>
  );
};

export default Sidebar;
