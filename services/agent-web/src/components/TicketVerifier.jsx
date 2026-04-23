// services/agent-web/src/components/TicketVerifier.jsx
import React, { useState } from 'react';
import { ticketApi } from '../api/endpoints';
import { Search, Loader2, CheckCircle, XCircle, AlertCircle, Banknote } from 'lucide-react';
import { useAuth } from '../context/AuthContext';

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
      // Refresh ticket state
      const res = await ticketApi.getDetails(ticket.short_code);
      setTicket(res.data);
      // Refresh global balance
      await fetchBalance(user.id);
      alert("Paiement effectué avec succès !");
    } catch (err) {
      alert(err.response?.data?.detail || "Erreur lors du paiement");
    } finally {
      setPayoutLoading(false);
    }
  };

  const getStatusBadge = (status) => {
    switch (status) {
      case 'WON': return <span style={{ color: 'var(--success)', fontWeight: 'bold' }}>GAGNANT</span>;
      case 'LOST': return <span style={{ color: 'var(--danger)' }}>PERDANT</span>;
      case 'PAID': return <span style={{ color: 'var(--text-muted)' }}>PAYÉ</span>;
      case 'PENDING': return <span style={{ color: 'var(--accent-primary)' }}>EN ATTENTE</span>;
      default: return status;
    }
  };

  return (
    <div className="glass-panel" style={{ padding: '1.5rem', display: 'flex', flexDirection: 'column', gap: '1.5rem' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
        <Search size={20} color="var(--accent-primary)" />
        <h3 style={{ fontSize: '1.1rem', fontWeight: '600' }}>Vérifier un Ticket</h3>
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
          {loading ? <Loader2 size={18} className="animate-spin" /> : "Vérifier"}
        </button>
      </form>

      {error && (
        <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', color: 'var(--danger)', fontSize: '0.9rem', background: 'rgba(244, 63, 94, 0.1)', padding: '0.75rem', borderRadius: '0.5rem' }}>
          <AlertCircle size={16} />
          {error}
        </div>
      )}

      {ticket && (
        <div style={{ background: 'rgba(255,255,255,0.03)', borderRadius: '0.75rem', overflow: 'hidden', border: '1px solid var(--glass-border)' }}>
          <div style={{ padding: '1rem', borderBottom: '1px solid var(--glass-border)', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <div style={{ display: 'flex', flexDirection: 'column' }}>
              <span style={{ fontWeight: '700', fontSize: '1rem' }}>{ticket.short_code}</span>
              <span style={{ fontSize: '0.75rem', opacity: 0.6 }}>{ticket.round_id}</span>
            </div>
            {getStatusBadge(ticket.status)}
          </div>
          
          <div style={{ padding: '1rem', display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
            {ticket.winning_number && (
              <div style={{ background: 'var(--accent-primary)', color: '#000', padding: '0.5rem', borderRadius: '0.5rem', display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.5rem' }}>
                <span style={{ fontWeight: '600', fontSize: '0.8rem' }}>RÉSULTAT DU TOUR :</span>
                <span style={{ fontWeight: '900', fontSize: '1.25rem' }}>{ticket.winning_number}</span>
              </div>
            )}

            <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
              <p style={{ fontSize: '0.75rem', fontWeight: '700', opacity: 0.5, textTransform: 'uppercase' }}>Détail des paris</p>
              {ticket.bets.map((bet, idx) => (
                <div key={idx} style={{ 
                  display: 'flex', 
                  justifyContent: 'space-between', 
                  alignItems: 'center',
                  background: 'rgba(255,255,255,0.02)',
                  padding: '0.6rem',
                  borderRadius: '0.5rem',
                  borderLeft: `3px solid ${bet.is_winning ? 'var(--success)' : 'transparent'}`
                }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                    {ticket.status !== 'PENDING' && (
                      bet.is_winning ? <CheckCircle size={14} color="var(--success)" /> : <XCircle size={14} color="var(--danger)" />
                    )}
                    <div style={{ display: 'flex', flexDirection: 'column' }}>
                      <span style={{ fontSize: '0.85rem', fontWeight: '600' }}>{bet.bet_type} {bet.bet_target}</span>
                      <span style={{ fontSize: '0.7rem', opacity: 0.6 }}>Mise: {(bet.amount || 0).toLocaleString()}</span>
                    </div>
                  </div>
                  {bet.is_winning && (
                    <span style={{ color: 'var(--success)', fontWeight: '700', fontSize: '0.85rem' }}>+{(bet.payout || 0).toLocaleString()}</span>
                  )}
                </div>
              ))}
            </div>

            <div style={{ marginTop: '0.5rem', borderTop: '1px solid var(--glass-border)', paddingTop: '1rem' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.9rem', marginBottom: '0.5rem' }}>
                <span style={{ color: 'var(--text-muted)' }}>Mise totale:</span>
                <span>{(ticket.total_wager || 0).toLocaleString()} XAF</span>
              </div>
              
              {(ticket.status === 'WON' || ticket.status === 'PAID') && (
                <div style={{ background: 'rgba(16, 185, 129, 0.15)', padding: '1rem', borderRadius: '0.5rem', border: '1px solid var(--success)', textAlign: 'center', marginBottom: '1rem' }}>
                  <p style={{ fontSize: '0.8rem', color: 'var(--success)', fontWeight: '700', textTransform: 'uppercase', marginBottom: '0.25rem' }}>Montant à Payer</p>
                  <p style={{ fontSize: '2rem', fontWeight: '900', color: 'var(--success)' }}>{(ticket.total_payout || 0).toLocaleString()} XAF</p>
                </div>
              )}

              {ticket.status === 'LOST' && (
                <div style={{ textAlign: 'center', padding: '0.5rem', opacity: 0.5 }}>
                  <p style={{ fontSize: '1.25rem', fontWeight: '700' }}>TICKET PERDANT</p>
                </div>
              )}
            </div>

            {ticket.status === 'WON' && (
              <button 
                onClick={handlePayout}
                disabled={payoutLoading}
                className="btn-primary" 
                style={{ marginTop: '0.5rem', background: 'var(--success)', border: 'none', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '0.5rem' }}
              >
                {payoutLoading ? <Loader2 size={18} className="animate-spin" /> : <Banknote size={18} />}
                Payer le client
              </button>
            )}

            {ticket.status === 'PAID' && (
              <div style={{ textAlign: 'center', color: 'var(--success)', fontSize: '0.9rem', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '0.5rem', marginTop: '0.5rem', background: 'rgba(16, 185, 129, 0.1)', padding: '0.75rem', borderRadius: '0.5rem' }}>
                <CheckCircle size={18} />
                Paiement déjà effectué
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
};

export default TicketVerifier;
