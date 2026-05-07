import React, { useState } from 'react';
import { ticketApi } from '../api/endpoints';
import { Search, Loader2, AlertCircle } from 'lucide-react';
import { useAuth } from '../context/AuthContext';
import TicketReceipt from './TicketReceipt';

const TicketVerifier = () => {
  const [code, setCode] = useState('');
  const [ticket, setTicket] = useState(null);
  const [loading, setLoading] = useState(false);
  const [payoutLoading, setPayoutLoading] = useState(false);
  const [error, setError] = useState('');
  const { fetchBalance, user } = useAuth();

  const handleSearch = async (e) => {
    e.preventDefault();
    if (!code) return;
    setLoading(true);
    setError('');
    setTicket(null);
    try {
      const res = await ticketApi.getDetails(code);
      setTicket(res.data);
    } catch (err) {
      setError("Ticket introuvable ou erreur serveur.");
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
      alert(err.response?.data?.detail || "Erreur lors du paiement");
    } finally {
      setPayoutLoading(false);
    }
  };

  return (
    <>
      <div className="glass-panel" style={{ padding: '1.5rem', display: 'flex', flexDirection: 'column', gap: '1.5rem' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
          <Search size={20} color="var(--accent-primary)" />
          <h3 style={{ fontSize: '1.1rem', fontWeight: '600' }}>Verifier un Ticket</h3>
        </div>

        <form onSubmit={handleSearch} style={{ display: 'flex', gap: '0.5rem' }}>
          <input
            type="text"
            placeholder="Ex: TK-2026..."
            value={code}
            onChange={(e) => setCode(e.target.value.toUpperCase())}
            style={{ flex: 1 }}
          />
          <button type="submit" className="btn-primary" disabled={loading} style={{ padding: '0 1.5rem' }}>
            {loading ? <Loader2 size={18} className="animate-spin" /> : "Verifier"}
          </button>
        </form>

        {error && (
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', color: 'var(--danger)', fontSize: '0.9rem', background: 'rgba(244, 63, 94, 0.1)', padding: '0.75rem', borderRadius: '0.5rem' }}>
            <AlertCircle size={16} />
            {error}
          </div>
        )}
      </div>

      {ticket && (
        <TicketReceipt
          ticket={ticket}
          onClose={() => setTicket(null)}
          onPayout={ticket.status === 'WON' ? handlePayout : null}
          payoutLoading={payoutLoading}
        />
      )}
    </>
  );
};

export default TicketVerifier;
