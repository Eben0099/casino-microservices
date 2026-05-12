import React, { useState, useEffect, useMemo } from 'react';
import { RefreshCw, ArrowUpCircle, ArrowDownCircle, Receipt, Coins, Ban, Wallet, Percent, Layers, Search, X, ChevronLeft, ChevronRight } from 'lucide-react';
import axios from 'axios';
import TicketReceipt from '../components/TicketReceipt';

const PAGE_SIZE = 10;

const TICKET_RE = /^TK-\d{8}-[A-Z0-9]+$/i;
const TICKET_INLINE_RE = /TK-\d{8}-[A-Z0-9]+/i;

const extractTicketCode = (tx) => {
  if (tx.reference && TICKET_RE.test(tx.reference)) return tx.reference;
  const m = (tx.description || '').match(TICKET_INLINE_RE);
  return m ? m[0] : null;
};

const fmt = (n) => Math.round(n || 0).toLocaleString('fr-FR');

const TABS = [
  { id: 'all',         label: 'Tous',         icon: Layers,  types: null,                      tone: 'var(--text-secondary)' },
  { id: 'bets',        label: 'Paris reçus',  icon: Receipt, types: ['BET_RECEIVED'],          tone: 'var(--green)'  },
  { id: 'payouts',     label: 'Paiements',    icon: Coins,   types: ['PAYOUT'],                tone: 'var(--red)'    },
  { id: 'reversals',   label: 'Annulations',  icon: Ban,     types: ['REVERSAL'],              tone: 'var(--accent)' },
  { id: 'provisions',  label: 'Provisions',   icon: Wallet,  types: ['PROVISION', 'ADJUSTMENT'], tone: 'var(--blue)' },
  { id: 'commissions', label: 'Commissions',  icon: Percent, types: ['COMMISSION'],            tone: 'var(--purple)' },
];

const TX_LABEL = {
  PROVISION: 'Provision',
  BET_RECEIVED: 'Pari reçu',
  PAYOUT: 'Paiement',
  REVERSAL: 'Annulation',
  ADJUSTMENT: 'Ajustement',
  COMMISSION: 'Commission',
};

const TX_COLOR = {
  PROVISION: 'var(--blue)',
  BET_RECEIVED: 'var(--green)',
  PAYOUT: 'var(--red)',
  REVERSAL: 'var(--accent)',
  ADJUSTMENT: 'var(--purple)',
  COMMISSION: 'var(--purple)',
};

const fmtDate = (d) =>
  d ? new Date(d).toLocaleDateString('fr-FR', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' }) : '-';

function Transactions() {
  const adminKey = localStorage.getItem('admin_key');
  const config = { headers: { 'x-api-key': adminKey } };
  const [transactions, setTransactions] = useState([]);
  const [globalStats, setGlobalStats] = useState({ total_wager: 0, total_payout: 0, tickets_validated: 0 });
  const [loading, setLoading] = useState(true);
  const [ticket, setTicket] = useState(null);
  const [ticketError, setTicketError] = useState('');
  const [activeTab, setActiveTab] = useState('all');

  // Filters
  const [qAgent, setQAgent] = useState('');
  const [qTicket, setQTicket] = useState('');
  const [qRef, setQRef] = useState('');
  const [dateFrom, setDateFrom] = useState('');
  const [dateTo, setDateTo] = useState('');
  const [page, setPage] = useState(1);

  const clearFilters = () => {
    setQAgent(''); setQTicket(''); setQRef(''); setDateFrom(''); setDateTo('');
  };
  const hasFilters = !!(qAgent || qTicket || qRef || dateFrom || dateTo);

  const fetchAll = async () => {
    setLoading(true);
    try {
      const [txRes, statsRes] = await Promise.all([
        axios.get('/api/agents/admin/transactions?limit=200', config),
        axios.get('/api/tickets/admin/stats', config),
      ]);
      setTransactions(txRes.data);
      setGlobalStats(statsRes.data);
    } catch (err) { console.error(err); }
    finally { setLoading(false); }
  };

  useEffect(() => { fetchAll(); }, []);

  const openTicket = async (code) => {
    if (!code) return;
    setTicketError('');
    try {
      const res = await axios.get(`/api/tickets/admin/${code}`, config);
      setTicket(res.data);
    } catch (err) {
      setTicketError(err.response?.data?.detail || "Ticket introuvable.");
      setTimeout(() => setTicketError(''), 4000);
    }
  };

  // Apply text/date filters first, then per-tab type filter
  const matchesFilters = (tx) => {
    if (qAgent && !(tx.agent_name || '').toLowerCase().includes(qAgent.toLowerCase())) return false;
    if (qTicket) {
      const code = extractTicketCode(tx);
      if (!code || !code.toLowerCase().includes(qTicket.toLowerCase())) return false;
    }
    if (qRef) {
      const blob = `${tx.reference || ''} ${tx.description || ''}`.toLowerCase();
      if (!blob.includes(qRef.toLowerCase())) return false;
    }
    if (dateFrom) {
      const d = new Date(tx.created_at);
      if (d < new Date(dateFrom)) return false;
    }
    if (dateTo) {
      const d = new Date(tx.created_at);
      const end = new Date(dateTo); end.setHours(23, 59, 59, 999);
      if (d > end) return false;
    }
    return true;
  };

  const baseFiltered = useMemo(
    () => transactions.filter(matchesFilters),
    [transactions, qAgent, qTicket, qRef, dateFrom, dateTo],
  );

  // Per-tab stats — counts respect text/date filters so the badges stay coherent
  const tabStats = useMemo(() => {
    const map = {};
    for (const t of TABS) {
      const filtered = t.types == null ? baseFiltered : baseFiltered.filter(tx => t.types.includes(tx.tx_type));
      map[t.id] = {
        count: filtered.length,
        sum: filtered.reduce((acc, tx) => acc + (tx.amount || 0), 0),
      };
    }
    return map;
  }, [baseFiltered]);

  // KPI top-strip — meme source que la navbar pour eviter les divergences
  const summary = useMemo(() => {
    const totalIn  = globalStats.total_wager || 0;
    const totalOut = globalStats.total_payout || 0;
    return {
      tickets: globalStats.tickets_validated || 0,
      totalIn, totalOut, ggr: totalIn - totalOut,
    };
  }, [globalStats]);

  const activeTabDef = TABS.find(t => t.id === activeTab);
  const filteredTx = activeTabDef.types == null
    ? baseFiltered
    : baseFiltered.filter(tx => activeTabDef.types.includes(tx.tx_type));

  // Pagination
  const totalPages = Math.max(1, Math.ceil(filteredTx.length / PAGE_SIZE));
  const safePage = Math.min(page, totalPages);
  const pageStart = (safePage - 1) * PAGE_SIZE;
  const pageTx = filteredTx.slice(pageStart, pageStart + PAGE_SIZE);

  useEffect(() => { setPage(1); }, [activeTab, qAgent, qTicket, qRef, dateFrom, dateTo]);

  const txBadge = (type) => {
    const c = TX_COLOR[type] || 'var(--text-muted)';
    const l = TX_LABEL[type] || type;
    return (
      <span className="text-[10px] font-semibold px-2 py-0.5 rounded-full uppercase"
        style={{ background: `${c}15`, color: c }}>
        {l}
      </span>
    );
  };

  return (
    <div className="animate-fade w-full">
      {/* Header */}
      <div className="flex justify-between items-center mb-5">
        <div>
          <h1 className="text-2xl font-bold" style={{ color: 'var(--text-primary)' }}>Betslip</h1>
          <p className="text-sm" style={{ color: 'var(--text-muted)' }}>Historique des mouvements de caisse</p>
        </div>
        <button onClick={fetchAll}
          className="flex items-center gap-2 px-4 py-2.5 rounded-lg text-sm font-medium transition-colors"
          style={{ background: 'var(--bg-surface)', border: '1px solid var(--border-subtle)', color: 'var(--text-secondary)' }}>
          <RefreshCw size={15} /> Actualiser
        </button>
      </div>

      {/* KPI strip */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 mb-5">
        <KpiCard label="Tickets vendus" value={fmt(summary.tickets)} accent="var(--accent)" />
        <KpiCard label="Total encaissé" value={`${fmt(summary.totalIn)} XAF`}  accent="var(--green)" />
        <KpiCard label="Total payé"     value={`${fmt(summary.totalOut)} XAF`} accent="var(--red)"   />
        <KpiCard label="GGR"            value={`${fmt(summary.ggr)} XAF`}      accent={summary.ggr >= 0 ? 'var(--green)' : 'var(--red)'} />
      </div>

      {/* Filters */}
      <div className="rounded-xl p-3 mb-4"
        style={{ background: 'var(--bg-surface)', border: '1px solid var(--border-subtle)' }}>
        <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-5 gap-2 items-end">
          <FilterInput icon={Search} placeholder="Caissier / agent" value={qAgent} onChange={setQAgent} />
          <FilterInput icon={Search} placeholder="Code ticket (TK-...)" value={qTicket} onChange={setQTicket} />
          <FilterInput icon={Search} placeholder="Référence / description" value={qRef} onChange={setQRef} />
          <FilterDate label="Du" value={dateFrom} onChange={setDateFrom} />
          <FilterDate label="Au" value={dateTo}   onChange={setDateTo} />
        </div>
        {hasFilters && (
          <div className="flex items-center justify-between mt-2 pt-2"
            style={{ borderTop: '1px dashed var(--border-subtle)' }}>
            <span className="text-xs" style={{ color: 'var(--text-muted)' }}>
              {filteredTx.length} mouvement{filteredTx.length > 1 ? 's' : ''} après filtrage
            </span>
            <button onClick={clearFilters}
              className="flex items-center gap-1 text-xs font-medium px-2.5 py-1 rounded-md"
              style={{ background: 'var(--bg-elevated)', color: 'var(--text-secondary)', border: '1px solid var(--border-subtle)' }}>
              <X size={11} /> Effacer les filtres
            </button>
          </div>
        )}
      </div>

      {/* Tabs */}
      <div className="flex gap-1 mb-4 overflow-x-auto pb-1">
        {TABS.map(({ id, label, icon: Icon, tone }) => {
          const active = activeTab === id;
          const stat = tabStats[id];
          return (
            <button
              key={id}
              onClick={() => setActiveTab(id)}
              className="flex items-center gap-2 px-4 py-2.5 rounded-lg text-sm font-medium transition-all whitespace-nowrap"
              style={{
                background: active ? 'var(--bg-surface)' : 'transparent',
                color: active ? 'var(--text-primary)' : 'var(--text-secondary)',
                border: '1px solid ' + (active ? 'var(--border-subtle)' : 'transparent'),
                borderBottom: active ? `2px solid ${tone}` : '2px solid transparent',
                paddingBottom: 9,
              }}
            >
              <Icon size={14} style={{ color: active ? tone : 'var(--text-muted)' }} />
              <span>{label}</span>
              <span className="text-[11px] font-bold px-2 py-0.5 rounded-full"
                style={{
                  background: active ? `${tone}1F` : 'var(--bg-elevated)',
                  color: active ? tone : 'var(--text-muted)',
                }}>
                {stat?.count || 0}
              </span>
            </button>
          );
        })}
      </div>

      {/* Table */}
      <div className="rounded-xl overflow-hidden"
        style={{ background: 'var(--bg-surface)', border: '1px solid var(--border-subtle)', boxShadow: 'var(--shadow-sm)' }}>
        <table className="w-full text-left">
          <thead>
            <tr style={{ borderBottom: '1px solid var(--border-subtle)' }}>
              {['Date', 'Agent', 'Type', 'Montant', 'Solde après', 'Référence', 'Description'].map(h => (
                <th key={h} className="px-6 py-3 text-xs font-semibold uppercase tracking-wider" style={{ color: 'var(--text-muted)' }}>{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <tr><td colSpan="7" className="px-6 py-10 text-center text-sm" style={{ color: 'var(--text-muted)' }}>Chargement…</td></tr>
            ) : filteredTx.length === 0 ? (
              <tr><td colSpan="7" className="px-6 py-10 text-center text-sm italic" style={{ color: 'var(--text-muted)' }}>
                {hasFilters ? 'Aucun mouvement ne correspond aux filtres.' : 'Aucun mouvement dans cette catégorie.'}
              </td></tr>
            ) : pageTx.map(tx => {
              const ticketCode = extractTicketCode(tx);
              const hasTicket = !!ticketCode;
              return (
                <tr key={tx.id} className="transition-colors"
                  style={{ borderBottom: '1px solid var(--border-subtle)', cursor: hasTicket ? 'pointer' : 'default' }}
                  onClick={hasTicket ? () => openTicket(ticketCode) : undefined}
                  onMouseEnter={e => e.currentTarget.style.background = 'var(--bg-elevated)'}
                  onMouseLeave={e => e.currentTarget.style.background = 'transparent'}
                  title={hasTicket ? 'Cliquer pour voir le ticket' : undefined}>
                  <td className="px-6 py-3.5 text-sm whitespace-nowrap" style={{ color: 'var(--text-secondary)' }}>{fmtDate(tx.created_at)}</td>
                  <td className="px-6 py-3.5 text-sm font-semibold" style={{ color: 'var(--text-primary)' }}>{tx.agent_name}</td>
                  <td className="px-6 py-3.5">{txBadge(tx.tx_type)}</td>
                  <td className="px-6 py-3.5">
                    <div className="flex items-center gap-1.5">
                      {tx.amount >= 0
                        ? <ArrowUpCircle size={13} style={{ color: 'var(--green)' }} />
                        : <ArrowDownCircle size={13} style={{ color: 'var(--red)' }} />}
                      <span className="text-sm font-bold" style={{ color: tx.amount >= 0 ? 'var(--green)' : 'var(--red)' }}>
                        {tx.amount >= 0 ? '+' : ''}{tx.amount.toLocaleString('fr-FR')} XAF
                      </span>
                    </div>
                  </td>
                  <td className="px-6 py-3.5 text-sm font-mono" style={{ color: 'var(--text-secondary)' }}>{tx.balance_after?.toLocaleString('fr-FR')} XAF</td>
                  <td className="px-6 py-3.5 text-xs font-mono" style={{ color: 'var(--text-muted)' }}>{tx.reference || '-'}</td>
                  <td className="px-6 py-3.5 text-sm"
                    style={{ color: hasTicket ? 'var(--accent)' : 'var(--text-muted)', textDecoration: hasTicket ? 'underline dotted' : 'none' }}>
                    {tx.description || '-'}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>

        {/* Pagination footer */}
        {!loading && filteredTx.length > 0 && (
          <div className="flex items-center justify-between px-6 py-3 text-sm"
            style={{ borderTop: '1px solid var(--border-subtle)', background: 'var(--bg-elevated)', color: 'var(--text-muted)' }}>
            <span>
              {pageStart + 1}–{Math.min(pageStart + PAGE_SIZE, filteredTx.length)} sur {filteredTx.length}
            </span>
            <div className="flex items-center gap-1">
              <PagerBtn disabled={safePage <= 1} onClick={() => setPage(safePage - 1)}>
                <ChevronLeft size={14} />
              </PagerBtn>
              <span className="px-3 font-semibold tabular-nums" style={{ color: 'var(--text-primary)' }}>
                {safePage} / {totalPages}
              </span>
              <PagerBtn disabled={safePage >= totalPages} onClick={() => setPage(safePage + 1)}>
                <ChevronRight size={14} />
              </PagerBtn>
            </div>
          </div>
        )}
      </div>

      {ticketError && (
        <div className="fixed bottom-6 right-6 z-50 px-4 py-3 rounded-lg text-sm font-medium animate-fade"
          style={{ background: 'var(--bg-surface)', border: '1px solid var(--red)40', color: 'var(--red)', boxShadow: 'var(--shadow-md)' }}>
          {ticketError}
        </div>
      )}

      {ticket && (
        <TicketReceipt ticket={ticket} onClose={() => setTicket(null)} />
      )}
    </div>
  );
}

const KpiCard = ({ label, value, accent }) => (
  <div className="rounded-xl p-4"
    style={{ background: 'var(--bg-surface)', border: '1px solid var(--border-subtle)', boxShadow: 'var(--shadow-sm)' }}>
    <p className="text-[10px] font-semibold uppercase tracking-[0.12em] mb-1" style={{ color: 'var(--text-muted)' }}>{label}</p>
    <p className="text-xl font-bold tabular-nums" style={{ color: accent }}>{value}</p>
  </div>
);

const FilterInput = ({ icon: Icon, placeholder, value, onChange }) => (
  <div className="relative">
    <Icon size={13} className="absolute left-2.5 top-1/2 -translate-y-1/2" style={{ color: 'var(--text-muted)' }} />
    <input
      value={value}
      onChange={e => onChange(e.target.value)}
      placeholder={placeholder}
      className="w-full pl-8 pr-2 py-2 text-sm rounded-md outline-none"
      style={{ background: 'var(--bg-elevated)', border: '1px solid var(--border-subtle)', color: 'var(--text-primary)' }}
    />
  </div>
);

const FilterDate = ({ label, value, onChange }) => (
  <div className="flex items-center gap-1.5">
    <span className="text-[10px] font-semibold uppercase tracking-wider" style={{ color: 'var(--text-muted)' }}>{label}</span>
    <input
      type="date"
      value={value}
      onChange={e => onChange(e.target.value)}
      className="flex-1 px-2 py-2 text-sm rounded-md outline-none"
      style={{ background: 'var(--bg-elevated)', border: '1px solid var(--border-subtle)', color: 'var(--text-primary)' }}
    />
  </div>
);

const PagerBtn = ({ disabled, onClick, children }) => (
  <button
    onClick={onClick}
    disabled={disabled}
    className="flex items-center justify-center w-8 h-8 rounded-md transition-colors"
    style={{
      background: 'var(--bg-surface)',
      border: '1px solid var(--border-subtle)',
      color: disabled ? 'var(--text-muted)' : 'var(--text-primary)',
      opacity: disabled ? 0.5 : 1,
      cursor: disabled ? 'not-allowed' : 'pointer',
    }}>
    {children}
  </button>
);

export default Transactions;
