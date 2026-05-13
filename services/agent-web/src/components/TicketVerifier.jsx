import React, { useState } from 'react';
import { Search, Loader2, AlertCircle } from 'lucide-react';
import { ticketApi } from '../api/endpoints';
import { useAuth } from '../context/AuthContext';
import { useT } from '../i18n';
import TicketReceipt from './TicketReceipt';

/**
 * Reusable ticket verifier — used inline on /jeux and as the main card on /verify.
 * Props:
 *  variant: 'inline' (compact, single row) | 'card' (full card with title)
 */
const TicketVerifier = ({ variant = 'inline' }) => {
  const [code, setCode] = useState('');
  const [ticket, setTicket] = useState(null);
  const [loading, setLoading] = useState(false);
  const [payoutLoading, setPayoutLoading] = useState(false);
  const [error, setError] = useState('');
  const { fetchBalance, user } = useAuth();
  const { t } = useT();

  const handleSearch = async (e) => {
    e.preventDefault();
    if (!code) return;
    setLoading(true); setError(''); setTicket(null);
    try {
      const res = await ticketApi.getDetails(code.trim().toUpperCase());
      setTicket(res.data);
    } catch (err) {
      setError(err.response?.data?.detail || t('verify.notFound'));
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
      setError(err.response?.data?.detail || t('verify.payoutError'));
    } finally {
      setPayoutLoading(false);
    }
  };

  // Navigation entre les tickets d'une meme chaine de re-jeu.
  // Le caissier clique sur un sibling dans la liste -> on recharge ce ticket.
  const handleSelectSibling = async (siblingCode) => {
    setLoading(true); setError('');
    try {
      const res = await ticketApi.getDetails(siblingCode);
      setTicket(res.data);
    } catch (err) {
      setError(err.response?.data?.detail || t('verify.notFound'));
    } finally {
      setLoading(false);
    }
  };

  const isInline = variant === 'inline';

  return (
    <>
      <div style={{
        background: 'var(--bg-surface)',
        border: '1px solid var(--border-subtle)',
        borderRadius: 12,
        padding: isInline ? 14 : 20,
      }}>
        {!isInline && (
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 14 }}>
            <h1 style={{ fontSize: 18, fontWeight: 700, color: 'var(--text-primary)' }}>{t('verify.title')}</h1>
            <p style={{ fontSize: 12, color: 'var(--text-muted)' }}>
              {t('verify.scannerReadyShort')}
            </p>
          </div>
        )}

        {isInline && (
          <div style={{
            display: 'flex', alignItems: 'center', gap: 8, marginBottom: 10,
            fontSize: 11, fontWeight: 600, letterSpacing: '0.12em',
            color: 'var(--text-muted)', textTransform: 'uppercase',
          }}>
            <Search size={13} style={{ color: 'var(--accent)' }} />
            {t('verify.title')}
            <span style={{ flex: 1 }} />
            <span style={{ letterSpacing: 0, textTransform: 'none', color: 'var(--text-muted)', fontWeight: 500, fontSize: 11 }}>
              {t('verify.scannerOrType')}
            </span>
          </div>
        )}

        <form onSubmit={handleSearch} style={{ display: 'flex', gap: 8, alignItems: 'stretch' }}>
          <div style={{ position: 'relative', flex: 1 }}>
            <Search size={15} style={{
              position: 'absolute', left: 12, top: '50%', transform: 'translateY(-50%)',
              color: 'var(--text-muted)',
            }} />
            <input
              type="text"
              placeholder={t('verify.placeholder')}
              value={code}
              onChange={(e) => setCode(e.target.value)}
              style={{
                width: '100%',
                padding: isInline ? '10px 12px 10px 36px' : '12px 14px 12px 40px',
                borderRadius: 8, fontSize: isInline ? 14 : 16, fontFamily: 'monospace',
                background: 'var(--bg-base)', color: 'var(--text-primary)',
                border: '1px solid var(--border-subtle)',
              }}
            />
          </div>
          <button type="submit" disabled={loading || !code}
            style={{
              padding: isInline ? '0 18px' : '0 22px',
              borderRadius: 8,
              background: 'var(--accent)', color: 'var(--text-on-accent)',
              border: 'none', fontSize: isInline ? 13 : 14, fontWeight: 800,
              cursor: loading || !code ? 'not-allowed' : 'pointer',
              opacity: loading || !code ? 0.55 : 1,
              display: 'inline-flex', alignItems: 'center', justifyContent: 'center', gap: 6,
              whiteSpace: 'nowrap',
            }}>
            {loading ? <Loader2 size={14} className="animate-spin" /> : t('verify.button')}
          </button>
        </form>

        {!isInline && (
          <p style={{ fontSize: 12, color: 'var(--text-muted)', marginTop: 10 }}>
            {t('verify.pinHint')}
          </p>
        )}

        {error && (
          <div style={{
            marginTop: 12,
            display: 'flex', alignItems: 'center', gap: 8,
            color: 'var(--danger)', fontSize: 12,
            background: 'rgba(239,68,68,0.1)', padding: '8px 12px', borderRadius: 8,
            border: '1px solid rgba(239,68,68,0.3)',
          }}>
            <AlertCircle size={14} />
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
          onSelectSibling={handleSelectSibling}
        />
      )}
    </>
  );
};

export default TicketVerifier;
