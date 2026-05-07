import React, { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Lock, Sun, Moon } from 'lucide-react';
import { useTheme } from '../contexts/ThemeContext';

function Login() {
  const [apiKey, setApiKey] = useState('');
  const [error, setError] = useState('');
  const navigate = useNavigate();
  const { theme, toggleTheme } = useTheme();

  const handleLogin = (e) => {
    e.preventDefault();
    if (apiKey === 'CleSuperSecreteBackoffice2026') {
      localStorage.setItem('admin_key', apiKey);
      navigate('/dashboard');
    } else {
      setError('Clé API invalide');
    }
  };

  const dateLabel = new Date().toLocaleDateString('fr-FR', {
    weekday: 'long', day: 'numeric', month: 'long', year: 'numeric'
  });

  return (
    <div className="min-h-screen grid lg:grid-cols-2" style={{ background: 'var(--bg-base)' }}>
      {/* Theme toggle */}
      <button
        onClick={toggleTheme}
        className="fixed top-4 right-4 z-30 p-2 rounded-md transition-colors"
        style={{ background: 'var(--bg-surface)', border: '1px solid var(--border-subtle)', color: 'var(--text-secondary)' }}
      >
        {theme === 'dark' ? <Sun size={16} /> : <Moon size={16} />}
      </button>

      {/* LEFT — Brand panel */}
      <div className="flex flex-col justify-between p-10 lg:p-12" style={{ background: 'var(--bg-topbar)', borderRight: '1px solid var(--border-subtle)' }}>
        <div className="flex items-center gap-3">
          <div className="w-9 h-9 rounded-md flex items-center justify-center text-xs font-black" style={{ background: 'var(--accent)', color: 'var(--text-on-accent)' }}>
            AG
          </div>
          <div>
            <p className="text-sm font-bold tracking-[0.2em]" style={{ color: 'var(--text-primary)', fontFamily: 'Raleway' }}>AGDTECH ADMIN</p>
            <p className="text-xs" style={{ color: 'var(--text-muted)' }}>Plateforme de jeux & loterie</p>
          </div>
        </div>

        <div className="my-auto py-12">
          <h1 className="text-3xl lg:text-4xl font-bold leading-tight mb-3" style={{ color: 'var(--text-primary)' }}>
            Backoffice <span style={{ color: 'var(--accent)' }}>AGDTech</span>
          </h1>
          <p className="text-sm max-w-md" style={{ color: 'var(--text-secondary)' }}>
            Pilotez vos kiosques, suivez les ventes en temps réel, configurez vos jeux et supervisez vos caissiers depuis un seul tableau de bord.
          </p>
        </div>

        <p className="text-xs" style={{ color: 'var(--text-muted)' }}>
          AGDTech © 2026 — Cameroun · {dateLabel}
        </p>
      </div>

      {/* RIGHT — Login form */}
      <div className="flex items-center justify-center p-6 lg:p-12">
        <div className="w-full max-w-sm animate-fade">
          <div className="mb-6">
            <h2 className="text-xl font-bold mb-1" style={{ color: 'var(--text-primary)' }}>Connexion administrateur</h2>
            <p className="text-sm" style={{ color: 'var(--text-muted)' }}>Saisissez votre clé d'accès pour ouvrir le backoffice.</p>
          </div>

          <div className="rounded-lg p-6"
            style={{ background: 'var(--bg-surface)', border: '1px solid var(--border-subtle)', boxShadow: 'var(--shadow-md)' }}>
            <form onSubmit={handleLogin} className="space-y-4">
              <div>
                <label className="block text-xs font-semibold uppercase tracking-wider mb-2" style={{ color: 'var(--text-muted)' }}>
                  Clé API administrateur
                </label>
                <div className="relative">
                  <Lock size={15} className="absolute left-3 top-1/2 -translate-y-1/2" style={{ color: 'var(--text-muted)' }} />
                  <input
                    type="password"
                    value={apiKey}
                    onChange={(e) => { setApiKey(e.target.value); setError(''); }}
                    placeholder="Saisissez votre clé secrète…"
                    autoFocus
                    required
                    className="w-full pl-10 pr-4 py-2.5 rounded-md text-sm outline-none"
                    style={{ background: 'var(--bg-base)', border: '1px solid var(--border-subtle)', color: 'var(--text-primary)' }}
                  />
                </div>
              </div>

              {error && (
                <div className="px-3 py-2 rounded-md text-xs font-medium"
                  style={{ background: 'rgba(239,68,68,0.1)', color: 'var(--red)', border: '1px solid rgba(239,68,68,0.3)' }}>
                  {error}
                </div>
              )}

              <button
                type="submit"
                className="w-full py-2.5 rounded-md font-bold text-sm transition-all"
                style={{ background: 'var(--accent)', color: 'var(--text-on-accent)' }}
              >
                Se connecter
              </button>
            </form>
          </div>

          <p className="text-center mt-6 text-xs" style={{ color: 'var(--text-muted)' }}>
            Accès réservé au personnel autorisé
          </p>
        </div>
      </div>
    </div>
  );
}

export default Login;
