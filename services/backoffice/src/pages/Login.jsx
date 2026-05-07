import React, { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Lock, Sun, Moon } from 'lucide-react';
import { useTheme } from '../contexts/ThemeContext';

function Login() {
  const [apiKey, setApiKey] = useState('');
  const navigate = useNavigate();
  const { theme, toggleTheme } = useTheme();

  const handleLogin = (e) => {
    e.preventDefault();
    if (apiKey === 'CleSuperSecreteBackoffice2026') {
      localStorage.setItem('admin_key', apiKey);
      navigate('/dashboard');
    } else {
      alert('Cle API invalide');
    }
  };

  return (
    <div className="min-h-screen flex items-center justify-center p-4" style={{ background: 'var(--bg-base)' }}>
      {/* Theme toggle */}
      <button
        onClick={toggleTheme}
        className="fixed top-4 right-4 p-2.5 rounded-lg transition-colors"
        style={{ background: 'var(--bg-surface)', border: '1px solid var(--border-subtle)', color: 'var(--text-muted)' }}
      >
        {theme === 'dark' ? <Sun size={18} /> : <Moon size={18} />}
      </button>

      <div className="w-full max-w-sm animate-fade">
        {/* Logo */}
        <div className="text-center mb-8">
          <div className="inline-flex items-center gap-2 mb-3">
            <div className="w-10 h-10 rounded-xl flex items-center justify-center font-black text-sm" style={{ background: 'var(--accent)', color: '#000' }}>
              AG
            </div>
            <span className="text-xl font-bold font-title" style={{ color: 'var(--text-primary)' }}>AGD ADMIN</span>
          </div>
          <p className="text-sm" style={{ color: 'var(--text-muted)' }}>Connectez-vous a votre espace d'administration</p>
        </div>

        {/* Card */}
        <div className="rounded-xl p-6" style={{ background: 'var(--bg-surface)', border: '1px solid var(--border-subtle)', boxShadow: 'var(--shadow-md)' }}>
          <form onSubmit={handleLogin} className="space-y-5">
            <div>
              <label className="block text-xs font-semibold uppercase tracking-wider mb-2" style={{ color: 'var(--text-muted)' }}>
                Cle API Administrateur
              </label>
              <div className="relative">
                <Lock size={16} className="absolute left-3 top-1/2 -translate-y-1/2" style={{ color: 'var(--text-muted)' }} />
                <input
                  type="password"
                  value={apiKey}
                  onChange={(e) => setApiKey(e.target.value)}
                  placeholder="Saisissez votre cle secrete..."
                  required
                  className="w-full pl-10 pr-4 py-3 rounded-lg text-sm"
                  style={{ background: 'var(--bg-base)', border: '1px solid var(--border-subtle)', color: 'var(--text-primary)' }}
                />
              </div>
            </div>

            <button
              type="submit"
              className="w-full py-3 rounded-lg font-bold text-sm transition-all duration-200 hover:-translate-y-0.5"
              style={{ background: 'var(--accent)', color: '#000', boxShadow: 'var(--shadow-sm)' }}
            >
              Se connecter
            </button>
          </form>
        </div>

        <p className="text-center mt-6 text-xs" style={{ color: 'var(--text-muted)' }}>
          Acces reserve au personnel autorise &middot; AGDTech 2026
        </p>
      </div>
    </div>
  );
}

export default Login;
