import React, { useState } from 'react';
import { useAuth } from '../context/AuthContext';
import { User, Lock, Loader2 } from 'lucide-react';

export const Login = () => {
  const [phone, setPhone] = useState('');
  const [password, setPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const { login } = useAuth();

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
      height: '100vh', 
      display: 'flex', 
      alignItems: 'center', 
      justifyContent: 'center',
      padding: '1rem' 
    }}>
      <div className="glass-panel animate-fade" style={{ 
        width: '100%', 
        maxWidth: '400px', 
        padding: '3rem 2rem',
        display: 'flex',
        flexDirection: 'column',
        gap: '2rem'
      }}>
        <div style={{ textAlign: 'center' }}>
          <h1 className="neon-text" style={{ fontSize: '2.5rem', marginBottom: '0.5rem' }}>ROISBET</h1>
          <p style={{ color: 'var(--text-muted)' }}>Portail Agent & Caisse</p>
        </div>

        {error && (
          <div style={{ 
            background: 'rgba(244, 63, 94, 0.1)', 
            color: 'var(--danger)', 
            padding: '1rem', 
            borderRadius: '0.75rem',
            fontSize: '0.9rem',
            border: '1px solid rgba(244, 63, 94, 0.2)'
          }}>
            {error}
          </div>
        )}

        <form onSubmit={handleSubmit} style={{ display: 'flex', flexDirection: 'column', gap: '1.25rem' }}>
          <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
            <label style={{ fontSize: '0.875rem', fontWeight: '500' }}>Numéro de téléphone</label>
            <div style={{ position: 'relative' }}>
              <User size={18} style={{ position: 'absolute', left: '1rem', top: '50%', transform: 'translateY(-50%)', color: 'var(--text-muted)' }} />
              <input 
                type="text" 
                placeholder="Ex: 690123456" 
                value={phone}
                onChange={(e) => setPhone(e.target.value)}
                style={{ width: '100%', paddingLeft: '3rem' }}
                required
              />
            </div>
          </div>

          <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
            <label style={{ fontSize: '0.875rem', fontWeight: '500' }}>Mot de passe</label>
            <div style={{ position: 'relative' }}>
              <Lock size={18} style={{ position: 'absolute', left: '1rem', top: '50%', transform: 'translateY(-50%)', color: 'var(--text-muted)' }} />
              <input 
                type="password" 
                placeholder="••••••••" 
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                style={{ width: '100%', paddingLeft: '3rem' }}
                required
              />
            </div>
          </div>

          <button className="btn-primary" type="submit" disabled={loading} style={{ marginTop: '1rem', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '0.5rem' }}>
            {loading ? <Loader2 size={20} className="animate-spin" /> : "Se connecter"}
          </button>
        </form>
      </div>
    </div>
  );
};
