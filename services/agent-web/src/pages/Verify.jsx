import React, { useState } from 'react';
import { Search, Loader2, AlertCircle } from 'lucide-react';
import { ticketApi } from '../api/endpoints';
import { useAuth } from '../context/AuthContext';
import TicketReceipt from '../components/TicketReceipt';

export const Verify = () => {
  const [code, setCode] = useState('');
  const [ticket, setTicket] = useState(null);
  const [loading, setLoading] = useState(false);
  const [payoutLoading, setPayoutLoading] = useState(false);
  const [error, setError] = useState('');
  const { fetchBalance, user } = useAuth();

  const handleSearch = async (e) => {
    e.preventDefault();
    if (!code) return;
    setLoading(true); setError(''); setTicket(null);
    try {
      const res = await ticketApi.getDetails(code.trim().toUpperCase());
      setTicket(res.data);
    } catch (err) {
      setError(err.response?.data?.detail || 'Ticket introuvable.');
    } finally {
      setLoading(false);
    }
  };

  const handlePayout = async () => {
    if (!ticket || ticket.status !== 'WON') return;
    setPayoutLoading(true);
    try {
      await ticketApi.payout(ticket.short_code);
      const res = await ticketApi.getDetails(ticket.short_code);
      setTicket(res.data);
      await fetchBalance(user.id);
    } catch (err) {
      setError(err.response?.data?.detail || 'Erreur lors du paiement');
    } finally {
      setPayoutLoading(false);
    }
  };

  return (
    <div className="animate-fade" style={{ maxWidth: 720, margin: '40px auto 0' }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 16 }}>
        <h1 style={{ fontSize: 22, fontWeight: 700, color: 'var(--text-primary)' }}>Vérifier un ticket</h1>
        <p style={{ fontSize: 13, color: 'var(--text-muted)' }}>
          Scanner prêt — scannez le code-barres ou QR
        </p>
      </div>

      <div style={{
        background: 'var(--bg-surface)',
        border: '1px solid var(--border-subtle)',
        borderRadius: 12,
        padding: 20,
      }}>
        <form onSubmit={handleSearch}>
          <label style={{
            display: 'block',
            fontSize: 13, color: 'var(--text-secondary)', marginBottom: 8,
          }}>
            Numéro de série (scan ou saisie)
          </label>
          <div style={{ position: 'relative', marginBottom: 12 }}>
            <Search size={16} style={{ position: 'absolute', left: 14, top: '50%', transform: 'translateY(-50%)', color: 'var(--text-muted)' }} />
            <input
              type="text"
              autoFocus
              placeholder="TK-2026…"
              value={code}
              onChange={(e) => setCode(e.target.value)}
              style={{
                width: '100%', padding: '12px 14px 12px 40px',
                borderRadius: 10, fontSize: 16, fontFamily: 'monospace',
                background: 'var(--bg-base)', color: 'var(--text-primary)',
                border: '1px solid var(--accent)',
              }}
            />
          </div>
          <p style={{ fontSize: 12, color: 'var(--text-muted)', marginBottom: 14 }}>
            Le PIN ne sera demandé qu'au moment du décaissement.
          </p>

          <button type="submit" disabled={loading || !code}
            style={{
              width: '100%', padding: 14, borderRadius: 10,
              background: 'var(--accent)', color: 'var(--text-on-accent)',
              border: 'none', fontSize: 14, fontWeight: 800, cursor: 'pointer',
              opacity: loading || !code ? 0.6 : 1,
              display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8,
            }}>
            {loading ? <Loader2 size={16} className="animate-spin" /> : 'Vérifier'}
          </button>
        </form>

        {error && (
          <div style={{
            marginTop: 14,
            display: 'flex', alignItems: 'center', gap: 8,
            color: 'var(--danger)', fontSize: 13,
            background: 'rgba(239,68,68,0.1)', padding: '10px 14px', borderRadius: 8,
            border: '1px solid rgba(239,68,68,0.3)',
          }}>
            <AlertCircle size={15} />
            {error}
          </div>
        )}
      </div>

      {ticket && (
        <TicketReceipt
          ticket={ticket}
          onClose={() => { setTicket(null); setCode(''); }}
          onPayout={ticket.status === 'WON' ? handlePayout : null}
          payoutLoading={payoutLoading}
        />
      )}
    </div>
  );
};

export default Verify;
