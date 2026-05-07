import React, { useState, useEffect } from 'react';
import { RefreshCw, ArrowUpCircle, ArrowDownCircle } from 'lucide-react';
import axios from 'axios';

function Transactions() {
  const adminKey = localStorage.getItem('admin_key');
  const config = { headers: { 'x-api-key': adminKey } };
  const [transactions, setTransactions] = useState([]);
  const [loading, setLoading] = useState(true);

  const fetchTransactions = async () => {
    setLoading(true);
    try { const res = await axios.get('/api/agents/admin/transactions?limit=100', config); setTransactions(res.data); }
    catch (err) { console.error(err); }
    finally { setLoading(false); }
  };

  useEffect(() => { fetchTransactions(); }, []);

  const txBadge = (type) => {
    const m = {
      PROVISION: ['var(--blue)', 'Provision'], BET_RECEIVED: ['var(--green)', 'Pari Recu'],
      PAYOUT: ['var(--red)', 'Paiement'], REVERSAL: ['var(--accent)', 'Annulation'],
      ADJUSTMENT: ['var(--purple)', 'Ajustement'], COMMISSION: ['var(--accent)', 'Commission']
    };
    const [c, l] = m[type] || ['var(--text-muted)', type];
    return <span className="text-[10px] font-semibold px-2 py-0.5 rounded-full uppercase" style={{ background: `${c}15`, color: c }}>{l}</span>;
  };

  const fmtDate = (d) => d ? new Date(d).toLocaleDateString('fr-FR', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' }) : '-';

  return (
    <div className="animate-fade max-w-[1400px] mx-auto">
      <div className="flex justify-between items-center mb-6">
        <div>
          <h1 className="text-2xl font-bold" style={{ color: 'var(--text-primary)' }}>Transactions</h1>
          <p className="text-sm" style={{ color: 'var(--text-muted)' }}>Historique des mouvements de caisse</p>
        </div>
        <button onClick={fetchTransactions}
          className="flex items-center gap-2 px-4 py-2.5 rounded-lg text-sm font-medium transition-colors"
          style={{ background: 'var(--bg-surface)', border: '1px solid var(--border-subtle)', color: 'var(--text-secondary)' }}>
          <RefreshCw size={15} /> Actualiser
        </button>
      </div>

      <div className="rounded-xl overflow-hidden" style={{ background: 'var(--bg-surface)', border: '1px solid var(--border-subtle)', boxShadow: 'var(--shadow-sm)' }}>
        <table className="w-full text-left">
          <thead>
            <tr style={{ borderBottom: '1px solid var(--border-subtle)' }}>
              {['Date', 'Agent', 'Type', 'Montant', 'Solde Apres', 'Reference', 'Description'].map(h => (
                <th key={h} className="px-6 py-3 text-xs font-semibold uppercase tracking-wider" style={{ color: 'var(--text-muted)' }}>{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <tr><td colSpan="7" className="px-6 py-10 text-center text-sm" style={{ color: 'var(--text-muted)' }}>Chargement...</td></tr>
            ) : transactions.length === 0 ? (
              <tr><td colSpan="7" className="px-6 py-10 text-center text-sm" style={{ color: 'var(--text-muted)' }}>Aucune transaction.</td></tr>
            ) : transactions.map(tx => (
              <tr key={tx.id} className="transition-colors" style={{ borderBottom: '1px solid var(--border-subtle)' }}
                onMouseEnter={e => e.currentTarget.style.background = 'var(--bg-elevated)'}
                onMouseLeave={e => e.currentTarget.style.background = 'transparent'}>
                <td className="px-6 py-3.5 text-sm whitespace-nowrap" style={{ color: 'var(--text-secondary)' }}>{fmtDate(tx.created_at)}</td>
                <td className="px-6 py-3.5 text-sm font-semibold" style={{ color: 'var(--text-primary)' }}>{tx.agent_name}</td>
                <td className="px-6 py-3.5">{txBadge(tx.tx_type)}</td>
                <td className="px-6 py-3.5">
                  <div className="flex items-center gap-1.5">
                    {tx.amount >= 0 ? <ArrowUpCircle size={13} style={{ color: 'var(--green)' }} /> : <ArrowDownCircle size={13} style={{ color: 'var(--red)' }} />}
                    <span className="text-sm font-bold" style={{ color: tx.amount >= 0 ? 'var(--green)' : 'var(--red)' }}>
                      {tx.amount >= 0 ? '+' : ''}{tx.amount.toLocaleString('fr-FR')} XAF
                    </span>
                  </div>
                </td>
                <td className="px-6 py-3.5 text-sm font-mono" style={{ color: 'var(--text-secondary)' }}>{tx.balance_after?.toLocaleString('fr-FR')} XAF</td>
                <td className="px-6 py-3.5 text-xs font-mono" style={{ color: 'var(--text-muted)' }}>{tx.reference || '-'}</td>
                <td className="px-6 py-3.5 text-sm" style={{ color: 'var(--text-muted)' }}>{tx.description || '-'}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

export default Transactions;
