import React, { useState } from 'react';
import { useAuth } from '../context/AuthContext';
import { User, Lock, Loader2, Sun, Moon } from 'lucide-react';
import { useTheme } from '../context/ThemeContext';

export const Login = () => {
  const [phone, setPhone] = useState('');
  const [password, setPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const { login } = useAuth();
  const { theme, toggleTheme } = useTheme();
  const isDark = theme === 'dark';

  const handleSubmit = async (e) => {
    e.preventDefault();
    setLoading(true);
    setError('');
    try {
      await login(phone, password);
    } catch (err) {
      setError(err.response?.data?.detail || "Erreur d'authentification");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div style={{
      height: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center',
      padding: '1rem', position: 'relative', overflow: 'hidden'
    }}>
      {/* Background glow */}
      <div style={{
        position: 'absolute', top: '30%', left: '50%', transform: 'translate(-50%, -50%)',
        width: '500px', height: '500px', borderRadius: '50%',
        background: 'radial-gradient(circle, rgba(251,191,36,0.06) 0%, transparent 70%)',
        pointerEvents: 'none'
      }} />

      <div className="animate-fade" style={{
        width: '100%', maxWidth: '400px', position: 'relative', zIndex: 1
      }}>
        {/* Logo */}
        <div style={{ textAlign: 'center', marginBottom: '2rem' }}>
          <div style={{
            display: 'inline-flex', alignItems: 'center', gap: '10px',
            background: 'linear-gradient(135deg, #fbbf24, #f59e0b)',
            padding: '10px 22px', borderRadius: '14px',
            boxShadow: '0 4px 20px rgba(251,191,36,0.3)',
            marginBottom: '16px'
          }}>
            <span style={{ color: '#000', fontWeight: '900', fontSize: '1.4rem', letterSpacing: '3px', fontFamily: 'Outfit' }}>AGDTECH</span>
          </div>
          <p style={{ color: 'var(--text-muted)', fontSize: '0.85rem', letterSpacing: '1px' }}>Portail Agent & Caisse</p>
        </div>

        {/* Theme toggle */}
        <div style={{ display: 'flex', justifyContent: 'center', marginBottom: '1.5rem' }}>
          <button onClick={toggleTheme} style={{
            background: 'var(--bg-hover)', border: '1px solid var(--glass-border)',
            color: 'var(--accent-primary)', padding: '8px 16px', borderRadius: '2rem',
            cursor: 'pointer', display: 'flex', alignItems: 'center', gap: '8px',
            fontSize: '0.75rem', fontWeight: '600', transition: 'all 0.2s'
          }}>
            {isDark ? <Sun size={16} /> : <Moon size={16} />}
            {isDark ? 'Mode clair' : 'Mode sombre'}
          </button>
        </div>

        {/* Card */}
        <div style={{
          background: 'var(--glass-bg)',
          backdropFilter: 'blur(16px)',
          border: '1px solid var(--glass-border)',
          borderRadius: '1.25rem', padding: '2rem 1.75rem',
          boxShadow: 'var(--shadow-card)'
        }}>
          {error && (
            <div style={{
              background: 'rgba(244, 63, 94, 0.1)',
              color: 'var(--danger)', padding: '0.85rem 1rem',
              borderRadius: '0.75rem', fontSize: '0.85rem',
              border: '1px solid rgba(244, 63, 94, 0.2)',
              marginBottom: '1.25rem'
            }}>{error}</div>
          )}

          <form onSubmit={handleSubmit} style={{ display: 'flex', flexDirection: 'column', gap: '1.25rem' }}>
            <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
              <label style={{ fontSize: '0.75rem', fontWeight: '600', color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '1.5px' }}>
                Telephone
              </label>
              <div style={{ position: 'relative' }}>
                <User size={16} style={{ position: 'absolute', left: '14px', top: '50%', transform: 'translateY(-50%)', color: 'var(--text-muted)' }} />
                <input
                  type="text" placeholder="Ex: +237 6XX XXX XXX"
                  value={phone} onChange={(e) => setPhone(e.target.value)}
                  style={{ width: '100%', paddingLeft: '2.75rem', padding: '12px 12px 12px 2.75rem', borderRadius: '10px', fontSize: '0.95rem' }}
                  required
                />
              </div>
            </div>

            <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
              <label style={{ fontSize: '0.75rem', fontWeight: '600', color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '1.5px' }}>
                Mot de passe
              </label>
              <div style={{ position: 'relative' }}>
                <Lock size={16} style={{ position: 'absolute', left: '14px', top: '50%', transform: 'translateY(-50%)', color: 'var(--text-muted)' }} />
                <input
                  type="password" placeholder="Votre mot de passe"
                  value={password} onChange={(e) => setPassword(e.target.value)}
                  style={{ width: '100%', paddingLeft: '2.75rem', padding: '12px 12px 12px 2.75rem', borderRadius: '10px', fontSize: '0.95rem' }}
                  required
                />
              </div>
            </div>

            <button type="submit" disabled={loading} style={{
              marginTop: '0.5rem', padding: '14px',
              background: loading ? 'var(--bg-hover)' : 'linear-gradient(135deg, var(--accent-primary), var(--accent-secondary))',
              border: 'none', borderRadius: '12px',
              color: 'var(--text-inverse)', fontWeight: '800', fontSize: '0.9rem',
              cursor: loading ? 'not-allowed' : 'pointer',
              display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '8px',
              letterSpacing: '1px',
              boxShadow: '0 4px 18px rgba(251,191,36,0.3)',
              transition: 'all 0.15s'
            }}>
              {loading ? <Loader2 size={18} className="animate-spin" /> : 'Se connecter'}
            </button>
          </form>
        </div>

        <p style={{ textAlign: 'center', color: 'rgba(255,255,255,0.15)', fontSize: '0.65rem', marginTop: '1.5rem', letterSpacing: '2px' }}>
          AGDTech &copy; 2026
        </p>
      </div>
    </div>
  );
};
