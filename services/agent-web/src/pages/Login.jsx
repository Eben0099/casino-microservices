import React, { useState } from 'react';
import { Sun, Moon, Loader2 } from 'lucide-react';
import { useAuth } from '../context/AuthContext';
import { useTheme } from '../context/ThemeContext';

const PIN_LENGTH = 6;

export const Login = () => {
  const [shop, setShop] = useState('');
  const [pin, setPin] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const { login } = useAuth();
  const { theme, toggleTheme } = useTheme();

  const dateLabel = new Date().toLocaleDateString('fr-FR', {
    weekday: 'long', day: 'numeric', month: 'long', year: 'numeric',
  });

  const submit = async (currentPin) => {
    setLoading(true); setError('');
    try {
      await login(shop, currentPin);
    } catch (err) {
      setError(err.response?.data?.detail || "Erreur d'authentification");
      setPin('');
    } finally {
      setLoading(false);
    }
  };

  const press = (digit) => {
    if (loading) return;
    setError('');
    if (pin.length >= PIN_LENGTH) return;
    const next = pin + digit;
    setPin(next);
    if (next.length === PIN_LENGTH) submit(next);
  };

  const erase = () => {
    if (loading) return;
    setError('');
    setPin(p => p.slice(0, -1));
  };

  const validate = () => {
    if (loading) return;
    if (pin.length === PIN_LENGTH) submit(pin);
  };

  const KeypadBtn = ({ children, onClick, disabled, variant }) => (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      style={{
        height: 60,
        background: variant === 'accent' ? 'var(--accent)' : 'var(--bg-tile)',
        border: '1px solid ' + (variant === 'accent' ? 'var(--accent)' : 'var(--border-subtle)'),
        color: variant === 'accent' ? 'var(--text-on-accent)' : 'var(--text-primary)',
        borderRadius: 10,
        fontSize: 22, fontWeight: 700, cursor: disabled ? 'not-allowed' : 'pointer',
        opacity: disabled ? 0.4 : 1,
        transition: 'transform 0.08s, background-color 0.12s',
        userSelect: 'none',
        display: 'flex', alignItems: 'center', justifyContent: 'center',
      }}
      onMouseDown={(e) => { if (!disabled) e.currentTarget.style.transform = 'scale(0.97)'; }}
      onMouseUp={(e)   => { e.currentTarget.style.transform = 'scale(1)'; }}
      onMouseLeave={(e)=> { e.currentTarget.style.transform = 'scale(1)'; }}
    >
      {children}
    </button>
  );

  return (
    <div style={{
      minHeight: '100vh', background: 'var(--bg-base)',
      display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)',
      gap: 0,
    }}>
      {/* Theme toggle */}
      <button
        onClick={toggleTheme}
        style={{
          position: 'fixed', top: 16, right: 16, zIndex: 30,
          padding: 8, borderRadius: 6,
          background: 'var(--bg-surface)', color: 'var(--text-secondary)',
          border: '1px solid var(--border-subtle)', cursor: 'pointer',
        }}
      >
        {theme === 'dark' ? <Sun size={16} /> : <Moon size={16} />}
      </button>

      {/* LEFT — Brand panel */}
      <div style={{
        display: 'flex', flexDirection: 'column', justifyContent: 'space-between',
        padding: '40px 48px',
        background: 'var(--bg-topbar)', borderRight: '1px solid var(--border-subtle)',
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
          <div style={{
            width: 36, height: 36, borderRadius: 8,
            background: 'var(--accent)', color: 'var(--text-on-accent)',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            fontSize: 12, fontWeight: 900,
          }}>AG</div>
          <div>
            <p style={{ fontSize: 14, fontWeight: 800, letterSpacing: '0.18em', color: 'var(--text-primary)', fontFamily: 'Outfit' }}>
              AGDTECH CASHER
            </p>
            <p style={{ fontSize: 12, color: 'var(--text-muted)' }}>
              Plateforme de jeux & loterie
            </p>
          </div>
        </div>

        <div style={{ margin: 'auto 0', padding: '64px 0' }}>
          <h1 style={{
            fontSize: 36, fontWeight: 800, lineHeight: 1.2, color: 'var(--text-primary)',
            marginBottom: 12,
          }}>
            Point de vente <span style={{ color: 'var(--accent)' }}>multi-jeux</span>
          </h1>
          <p style={{ fontSize: 14, color: 'var(--text-secondary)', maxWidth: 420 }}>
            Roulette · Keno · Crash · Loto — pariez, vérifiez, encaissez.
            Solde caisse, paiements et fin de service en un seul écran.
          </p>
        </div>

        <p style={{ fontSize: 11, color: 'var(--text-muted)' }}>
          AGDTech © 2026 — Cameroun · {dateLabel}
        </p>
      </div>

      {/* RIGHT — Login form */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '40px 24px' }}>
        <div className="animate-fade" style={{ width: '100%', maxWidth: 400 }}>
          <div style={{ marginBottom: 24 }}>
            <h2 style={{ fontSize: 20, fontWeight: 700, color: 'var(--text-primary)', marginBottom: 4 }}>
              Connexion caissière
            </h2>
            <p style={{ fontSize: 13, color: 'var(--text-muted)' }}>
              Entrez votre code boutique puis votre PIN à 6 chiffres.
            </p>
          </div>

          {/* Shop code */}
          <div style={{ marginBottom: 18 }}>
            <label style={{
              display: 'block',
              fontSize: 12, fontWeight: 600, color: 'var(--text-muted)',
              textTransform: 'uppercase', letterSpacing: '0.1em', marginBottom: 6,
            }}>
              Code boutique / téléphone
            </label>
            <input
              type="text"
              autoFocus
              autoComplete="username"
              placeholder="MA-BOUTIQUE ou +237 6XX..."
              value={shop}
              onChange={(e) => { setShop(e.target.value); setError(''); }}
              style={{
                width: '100%', padding: '12px 14px', borderRadius: 8,
                background: 'var(--bg-surface)', color: 'var(--text-primary)',
                border: '1px solid var(--border-subtle)', fontSize: 14,
              }}
            />
          </div>

          {/* PIN visualizer */}
          <div style={{ marginBottom: 16 }}>
            <div style={{
              display: 'flex', alignItems: 'center', justifyContent: 'space-between',
              marginBottom: 8,
            }}>
              <label style={{
                fontSize: 12, fontWeight: 600, color: 'var(--text-muted)',
                textTransform: 'uppercase', letterSpacing: '0.1em',
              }}>
                Code PIN
              </label>
              <span style={{ fontSize: 11, color: 'var(--text-muted)' }}>
                {pin.length}/{PIN_LENGTH}
              </span>
            </div>
            <div style={{
              display: 'flex', justifyContent: 'center', gap: 10,
              padding: '12px 0',
            }}>
              {Array.from({ length: PIN_LENGTH }).map((_, i) => {
                const filled = i < pin.length;
                return (
                  <div key={i} style={{
                    width: 14, height: 14, borderRadius: '50%',
                    background: filled ? 'var(--accent)' : 'transparent',
                    border: '2px solid ' + (filled ? 'var(--accent)' : 'var(--border-strong)'),
                    transition: 'all 0.12s',
                  }} />
                );
              })}
            </div>
          </div>

          {error && (
            <div style={{
              marginBottom: 14, padding: '10px 12px', borderRadius: 8,
              background: 'rgba(239,68,68,0.1)', border: '1px solid rgba(239,68,68,0.3)',
              color: 'var(--danger)', fontSize: 12, fontWeight: 600,
            }}>
              {error}
            </div>
          )}

          {/* Keypad */}
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 8 }}>
            {[1,2,3,4,5,6,7,8,9].map(d => (
              <KeypadBtn key={d} onClick={() => press(String(d))} disabled={loading || !shop}>
                {d}
              </KeypadBtn>
            ))}
            <KeypadBtn onClick={erase} disabled={loading || pin.length === 0}>⌫</KeypadBtn>
            <KeypadBtn onClick={() => press('0')} disabled={loading || !shop}>0</KeypadBtn>
            <KeypadBtn variant="accent" onClick={validate} disabled={loading || pin.length !== PIN_LENGTH}>
              {loading ? <Loader2 size={20} className="animate-spin" /> : '✓'}
            </KeypadBtn>
          </div>

          <p style={{ textAlign: 'center', marginTop: 18, fontSize: 11, color: 'var(--text-muted)' }}>
            AGDTech © 2026 — Cameroun
          </p>
        </div>
      </div>
    </div>
  );
};

export default Login;
