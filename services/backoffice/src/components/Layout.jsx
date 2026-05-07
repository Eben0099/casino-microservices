import React from 'react';
import { Outlet } from 'react-router-dom';
import Sidebar from './Sidebar';

const Layout = () => {
  return (
    <div className="min-h-screen" style={{ background: 'var(--bg-base)' }}>
      <Sidebar />
      <div style={{ marginLeft: 'var(--sidebar-w)' }}>
        {/* Topbar */}
        <header
          className="sticky top-0 z-20 flex items-center justify-between px-8 py-4"
          style={{
            background: 'var(--bg-surface)',
            borderBottom: '1px solid var(--border-subtle)',
            backdropFilter: 'blur(8px)'
          }}
        >
          <div>
            <p className="text-xs font-medium" style={{ color: 'var(--text-muted)' }}>
              {new Date().toLocaleDateString('fr-FR', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' })}
            </p>
          </div>
          <div className="flex items-center gap-3">
            <div className="text-right">
              <p className="text-sm font-semibold" style={{ color: 'var(--text-primary)' }}>Super Admin</p>
              <p className="text-xs" style={{ color: 'var(--text-muted)' }}>Connecte</p>
            </div>
            <div
              className="w-9 h-9 rounded-full flex items-center justify-center text-xs font-bold"
              style={{ background: 'var(--accent)', color: '#000' }}
            >
              SA
            </div>
          </div>
        </header>

        {/* Page content */}
        <main className="p-8">
          <Outlet />
        </main>
      </div>
    </div>
  );
};

export default Layout;
