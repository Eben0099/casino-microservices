import React, { useState, useEffect, useMemo, useCallback } from 'react';
import {
  Plus, X, RefreshCw, Edit2, Search, ChevronLeft, ChevronRight,
  Coins, Trophy, Globe2, Gamepad2, MapPin, Power,
} from 'lucide-react';
import axios from 'axios';
import LiveIndicator from '../components/LiveIndicator';
import { useAdminWs, useDebouncedTick } from '../hooks/useAdminWs';

const PAGE_SIZE = 10;
const POLL_MS = 5000;

const SCOPES = ['GLOBAL', 'GAME', 'LOCAL'];
const TIERS = ['BRONZE', 'SILVER', 'GOLD'];
const CONTRIB_MODES = ['PERCENT', 'FIXED'];
const RESET_MODES = ['ZERO', 'SEED'];
const WINNER_MODES = ['TRIGGER_TICKET', 'RANDOM_RECENT'];

const SCOPE_META = {
  GLOBAL: { color: 'var(--purple)', label: 'Global',  Icon: Globe2  },
  GAME:   { color: 'var(--blue)',   label: 'Jeu',     Icon: Gamepad2 },
  LOCAL:  { color: 'var(--accent)', label: 'Local',   Icon: MapPin  },
};

const TIER_META = {
  BRONZE: { color: '#b45309', label: 'Bronze' },
  SILVER: { color: '#94a3b8', label: 'Argent' },
  GOLD:   { color: '#eab308', label: 'Or'     },
};

const fmt = (n) => Math.round(n || 0).toLocaleString('fr-FR');
const fmtDate = (d) => d ? new Date(d).toLocaleString('fr-FR', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' }) : '-';

const defaultForm = {
  scope: 'GLOBAL',
  game_id: '',
  kiosk_id: '',
  tier: '',
  enabled: true,
  contribution_mode: 'PERCENT',
  contribution_percent: '0.5',
  contribution_fixed: 0,
  threshold_min: 100000,
  threshold_max: 500000,
  reset_mode: 'ZERO',
  seed_amount: 0,
  winner_mode: 'TRIGGER_TICKET',
  recent_window_minutes: 60,
  max_payout: '',
};

function Jackpots() {
  const adminKey = localStorage.getItem('admin_key');
  const config = { headers: { 'x-api-key': adminKey } };

  const [activeTab, setActiveTab] = useState('pots');
  const [pots, setPots] = useState([]);
  const [wins, setWins] = useState([]);
  const [agents, setAgents] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');

  const [showModal, setShowModal] = useState(false);
  const [editingId, setEditingId] = useState(null);
  const [form, setForm] = useState(defaultForm);

  // Filtres pots
  const [filterScope, setFilterScope] = useState('all');
  const [filterTier, setFilterTier] = useState('all');
  const [filterGame, setFilterGame] = useState('');

  // Filtres wins
  const [winPage, setWinPage] = useState(1);

  // Helpers
  const agentLabel = (id) => {
    const a = agents.find(x => x.id === id);
    if (!a) return id ? `${id.slice(0, 8)}…` : '-';
    return `${a.kiosk_code || '??'} · ${a.display_name}`;
  };
  const clearFlash = () => { setSuccess(''); setError(''); };
  const flash = (msg, isError = false) => {
    if (isError) setError(msg); else setSuccess(msg);
    setTimeout(() => { setError(''); setSuccess(''); }, 4000);
  };

  const { connected, tick, lastEvent } = useAdminWs();

  // Fetch
  const fetchPots = useCallback(async () => {
    try {
      const res = await axios.get('/api/tickets/admin/jackpots', config);
      setPots(res.data);
    } catch (err) { console.error('pots', err); }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [adminKey]);
  const fetchWins = useCallback(async () => {
    try {
      const res = await axios.get('/api/tickets/admin/jackpots/wins', { ...config, params: { limit: 500 } });
      setWins(res.data);
    } catch (err) { console.error('wins', err); }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [adminKey]);
  const fetchAgents = useCallback(async () => {
    try {
      const res = await axios.get('/api/agents', config);
      setAgents(res.data);
    } catch (err) { console.error('agents', err); }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [adminKey]);

  useEffect(() => {
    fetchAgents();
    fetchPots().finally(() => setLoading(false));
  }, [fetchAgents, fetchPots]);

  // Live refresh on WS events. jackpot_progress fires on every ticket sale —
  // we debounce 2s to avoid hammering the API under burst load.
  useDebouncedTick(tick, () => {
    fetchPots();
    if (activeTab === 'wins') fetchWins();
  }, 2000);

  // Polling fallback when WS is offline
  useEffect(() => {
    if (connected) return;
    const id = setInterval(fetchPots, POLL_MS);
    return () => clearInterval(id);
  }, [connected, fetchPots]);

  useEffect(() => { if (activeTab === 'wins') fetchWins(); }, [activeTab, fetchWins]);
  useEffect(() => { setWinPage(1); }, [activeTab]);

  // KPIs
  const kpis = useMemo(() => {
    const total = pots.reduce((acc, p) => acc + (p.current_amount || 0), 0);
    const active = pots.filter(p => p.enabled).length;
    return { total, active, count: pots.length, wins: wins.length };
  }, [pots, wins]);

  // Filtrage pots
  const filteredPots = useMemo(() => pots.filter(p => {
    if (filterScope !== 'all' && p.scope !== filterScope) return false;
    if (filterTier !== 'all' && p.tier !== filterTier) return false;
    if (filterGame && !(p.game_id || '').toLowerCase().includes(filterGame.toLowerCase())) return false;
    return true;
  }), [pots, filterScope, filterTier, filterGame]);

  // Wins pagination
  const totalWinPages = Math.max(1, Math.ceil(wins.length / PAGE_SIZE));
  const safeWinPage = Math.min(winPage, totalWinPages);
  const winStart = (safeWinPage - 1) * PAGE_SIZE;
  const pageWins = wins.slice(winStart, winStart + PAGE_SIZE);

  // CRUD
  const openCreate = () => {
    clearFlash();
    setEditingId(null);
    setForm(defaultForm);
    setShowModal(true);
  };

  const openEdit = (pot) => {
    clearFlash();
    setEditingId(pot.id);
    setForm({
      scope: pot.scope,
      game_id: pot.game_id || '',
      kiosk_id: pot.kiosk_id || '',
      tier: pot.tier || '',
      enabled: pot.enabled,
      contribution_mode: pot.contribution_mode,
      contribution_percent: pot.contribution_percent?.toString() || '0',
      contribution_fixed: pot.contribution_fixed || 0,
      threshold_min: pot.threshold_min,
      threshold_max: pot.threshold_max,
      reset_mode: pot.reset_mode,
      seed_amount: pot.seed_amount || 0,
      winner_mode: pot.winner_mode,
      recent_window_minutes: pot.recent_window_minutes || 60,
      max_payout: pot.max_payout ?? '',
    });
    setShowModal(true);
  };

  const handleSave = async (e) => {
    e.preventDefault();
    clearFlash();

    const payload = {
      ...form,
      contribution_percent: form.contribution_percent.toString(),
      contribution_fixed: parseInt(form.contribution_fixed) || 0,
      threshold_min: parseInt(form.threshold_min) || 0,
      threshold_max: parseInt(form.threshold_max) || 0,
      seed_amount: parseInt(form.seed_amount) || 0,
      recent_window_minutes: parseInt(form.recent_window_minutes) || 60,
      max_payout: form.max_payout === '' ? null : parseInt(form.max_payout),
    };
    if (payload.scope === 'GLOBAL') { payload.game_id = null; payload.kiosk_id = null; payload.tier = null; }
    if (payload.scope === 'GAME')   { payload.kiosk_id = null; payload.game_id = payload.game_id || null; }
    if (payload.scope === 'LOCAL')  { payload.kiosk_id = payload.kiosk_id || null; payload.game_id = payload.game_id || null; }
    if (payload.tier === '') payload.tier = null;

    try {
      if (editingId) {
        // Update : on n'envoie que les champs modifiables (pas scope/identite)
        const patch = (({ enabled, contribution_mode, contribution_percent, contribution_fixed,
          threshold_min, threshold_max, reset_mode, seed_amount, winner_mode, recent_window_minutes, max_payout }) =>
          ({ enabled, contribution_mode, contribution_percent, contribution_fixed,
            threshold_min, threshold_max, reset_mode, seed_amount, winner_mode, recent_window_minutes, max_payout }))(payload);
        await axios.patch(`/api/tickets/admin/jackpots/${editingId}`, patch, config);
        flash('Pot mis a jour');
      } else {
        await axios.post('/api/tickets/admin/jackpots', payload, config);
        flash('Pot cree');
      }
      setShowModal(false);
      fetchPots();
    } catch (err) {
      flash(err.response?.data?.detail || 'Erreur lors de la sauvegarde', true);
    }
  };

  const toggleEnabled = async (pot) => {
    try {
      await axios.patch(`/api/tickets/admin/jackpots/${pot.id}`, { enabled: !pot.enabled }, config);
      fetchPots();
    } catch (err) { flash(err.response?.data?.detail || 'Erreur', true); }
  };

  // Render helpers
  const scopeBadge = (scope) => {
    const m = SCOPE_META[scope] || { color: 'var(--text-muted)', label: scope, Icon: Globe2 };
    const Icon = m.Icon;
    return (
      <span className="inline-flex items-center gap-1.5 text-[10px] font-semibold px-2 py-0.5 rounded-full uppercase"
        style={{ background: `${m.color}15`, color: m.color }}>
        <Icon size={11} /> {m.label}
      </span>
    );
  };

  const tierBadge = (tier) => {
    if (!tier) return <span className="text-xs" style={{ color: 'var(--text-muted)' }}>-</span>;
    const m = TIER_META[tier] || { color: 'var(--text-muted)', label: tier };
    return (
      <span className="text-[10px] font-bold px-2 py-0.5 rounded uppercase tracking-wider"
        style={{ background: `${m.color}20`, color: m.color, border: `1px solid ${m.color}40` }}>
        {m.label}
      </span>
    );
  };

  const contribLabel = (p) => p.contribution_mode === 'PERCENT'
    ? `${p.contribution_percent}%`
    : `${fmt(p.contribution_fixed)} XAF`;

  return (
    <div className="animate-fade w-full">
      {success && <div className="mb-4 px-4 py-3 rounded-lg text-sm font-medium" style={{ background: 'var(--green)15', color: 'var(--green)', border: '1px solid var(--green)30' }}>{success}</div>}
      {error && !showModal && <div className="mb-4 px-4 py-3 rounded-lg text-sm font-medium" style={{ background: 'var(--red)15', color: 'var(--red)', border: '1px solid var(--red)30' }}>{error}</div>}

      {/* Header */}
      <div className="flex justify-between items-center mb-5">
        <div>
          <h1 className="text-2xl font-bold" style={{ color: 'var(--text-primary)' }}>Jackpots</h1>
          <p className="text-sm" style={{ color: 'var(--text-muted)' }}>Cagnottes globales, par jeu et par kiosque · 3 niveaux Bronze / Argent / Or</p>
        </div>
        <div className="flex gap-2 items-center">
          <LiveIndicator connected={connected} lastEventType={lastEvent?.type} />
          <button onClick={fetchPots}
            className="flex items-center gap-2 px-4 py-2.5 rounded-lg text-sm font-medium transition-colors"
            style={{ background: 'var(--bg-surface)', border: '1px solid var(--border-subtle)', color: 'var(--text-secondary)' }}>
            <RefreshCw size={15} /> Actualiser
          </button>
          <button onClick={openCreate}
            className="flex items-center gap-2 px-4 py-2.5 rounded-lg text-sm font-bold transition-all hover:-translate-y-0.5"
            style={{ background: 'var(--accent)', color: '#000' }}>
            <Plus size={16} /> Nouveau pot
          </button>
        </div>
      </div>

      {/* KPIs */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 mb-5">
        <KpiCard label="Cagnotte cumulee" value={`${fmt(kpis.total)} XAF`} accent="var(--accent)" Icon={Coins} />
        <KpiCard label="Pots configures" value={kpis.count} accent="var(--blue)" Icon={Globe2} />
        <KpiCard label="Pots actifs" value={kpis.active} accent="var(--green)" Icon={Power} />
        <KpiCard label="Wins enregistres" value={kpis.wins} accent="var(--purple)" Icon={Trophy} />
      </div>

      {/* Tabs */}
      <div className="flex gap-1 mb-4">
        <TabBtn active={activeTab === 'pots'} onClick={() => setActiveTab('pots')} label="Pots actifs" count={pots.length} />
        <TabBtn active={activeTab === 'wins'} onClick={() => setActiveTab('wins')} label="Historique" count={wins.length} />
      </div>

      {activeTab === 'pots' && (
        <>
          {/* Filters */}
          <div className="rounded-xl p-3 mb-4 flex items-center gap-2 flex-wrap"
            style={{ background: 'var(--bg-surface)', border: '1px solid var(--border-subtle)' }}>
            <SelectFilter value={filterScope} onChange={setFilterScope} options={[['all', 'Tous scopes'], ...SCOPES.map(s => [s, SCOPE_META[s].label])]} />
            <SelectFilter value={filterTier} onChange={setFilterTier} options={[['all', 'Tous niveaux'], ...TIERS.map(t => [t, TIER_META[t].label])]} />
            <div className="relative">
              <Search size={13} className="absolute left-2.5 top-1/2 -translate-y-1/2" style={{ color: 'var(--text-muted)' }} />
              <input value={filterGame} onChange={e => setFilterGame(e.target.value)} placeholder="Jeu (roulette, spin2win…)"
                className="pl-8 pr-2 py-2 text-sm rounded-md outline-none w-56"
                style={{ background: 'var(--bg-elevated)', border: '1px solid var(--border-subtle)', color: 'var(--text-primary)' }} />
            </div>
            <span className="text-xs ml-auto" style={{ color: 'var(--text-muted)' }}>
              {filteredPots.length} sur {pots.length}
            </span>
          </div>

          {/* Pots table */}
          <div className="rounded-xl overflow-hidden"
            style={{ background: 'var(--bg-surface)', border: '1px solid var(--border-subtle)', boxShadow: 'var(--shadow-sm)' }}>
            <table className="w-full text-left">
              <thead>
                <tr style={{ borderBottom: '1px solid var(--border-subtle)' }}>
                  {['Scope', 'Jeu', 'Niveau', 'Kiosque', 'Contribution', 'Seuil [min;max]', 'Reset', 'Gagnant', 'Cagnotte', 'Cycle', 'Actions'].map(h => (
                    <th key={h} className="px-4 py-3 text-[11px] font-semibold uppercase tracking-wider" style={{ color: 'var(--text-muted)' }}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {loading ? (
                  <tr><td colSpan="11" className="px-4 py-10 text-center text-sm" style={{ color: 'var(--text-muted)' }}>Chargement...</td></tr>
                ) : filteredPots.length === 0 ? (
                  <tr><td colSpan="11" className="px-4 py-10 text-center text-sm italic" style={{ color: 'var(--text-muted)' }}>Aucun pot ne correspond aux filtres.</td></tr>
                ) : filteredPots.map(p => (
                  <tr key={p.id} className="transition-colors"
                    style={{ borderBottom: '1px solid var(--border-subtle)', opacity: p.enabled ? 1 : 0.55 }}
                    onMouseEnter={e => e.currentTarget.style.background = 'var(--bg-elevated)'}
                    onMouseLeave={e => e.currentTarget.style.background = 'transparent'}>
                    <td className="px-4 py-3">{scopeBadge(p.scope)}</td>
                    <td className="px-4 py-3 text-sm" style={{ color: 'var(--text-secondary)' }}>{p.game_id || '-'}</td>
                    <td className="px-4 py-3">{tierBadge(p.tier)}</td>
                    <td className="px-4 py-3 text-xs font-mono" style={{ color: 'var(--text-secondary)' }}>{p.kiosk_id ? agentLabel(p.kiosk_id) : '-'}</td>
                    <td className="px-4 py-3 text-sm" style={{ color: 'var(--text-primary)' }}>{contribLabel(p)}</td>
                    <td className="px-4 py-3 text-xs tabular-nums" style={{ color: 'var(--text-secondary)' }}>
                      {fmt(p.threshold_min)} ; {fmt(p.threshold_max)}
                    </td>
                    <td className="px-4 py-3 text-xs" style={{ color: 'var(--text-secondary)' }}>
                      {p.reset_mode}{p.reset_mode === 'SEED' ? ` (${fmt(p.seed_amount)})` : ''}
                    </td>
                    <td className="px-4 py-3 text-xs" style={{ color: 'var(--text-secondary)' }}>
                      {p.winner_mode === 'TRIGGER_TICKET' ? 'Trigger' : `Random ${p.recent_window_minutes}min`}
                    </td>
                    <td className="px-4 py-3 text-sm font-bold tabular-nums" style={{ color: 'var(--accent)' }}>
                      {fmt(p.current_amount)} <span className="text-[10px] opacity-70">XAF</span>
                    </td>
                    <td className="px-4 py-3 text-sm tabular-nums" style={{ color: 'var(--text-muted)' }}>#{p.cycle_number}</td>
                    <td className="px-4 py-3">
                      <div className="flex items-center gap-1.5">
                        <button onClick={() => openEdit(p)} title="Editer" className="p-1.5 rounded-md transition-colors" style={{ color: 'var(--text-muted)' }}><Edit2 size={14} /></button>
                        <button onClick={() => toggleEnabled(p)} title={p.enabled ? 'Desactiver' : 'Activer'} className="p-1.5 rounded-md transition-colors" style={{ color: p.enabled ? 'var(--green)' : 'var(--red)' }}><Power size={14} /></button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}

      {activeTab === 'wins' && (
        <div className="rounded-xl overflow-hidden"
          style={{ background: 'var(--bg-surface)', border: '1px solid var(--border-subtle)', boxShadow: 'var(--shadow-sm)' }}>
          <table className="w-full text-left">
            <thead>
              <tr style={{ borderBottom: '1px solid var(--border-subtle)' }}>
                {['Date', 'Pot', 'Cycle', 'Trigger', 'Gagnant (kiosque)', 'Seuil tire', 'Cagnotte', 'Payout', 'Carryover'].map(h => (
                  <th key={h} className="px-4 py-3 text-[11px] font-semibold uppercase tracking-wider" style={{ color: 'var(--text-muted)' }}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {pageWins.length === 0 ? (
                <tr><td colSpan="9" className="px-4 py-10 text-center text-sm italic" style={{ color: 'var(--text-muted)' }}>Aucun jackpot tombe pour l'instant.</td></tr>
              ) : pageWins.map(w => {
                const pot = pots.find(p => p.id === w.pot_id);
                return (
                  <tr key={w.id} style={{ borderBottom: '1px solid var(--border-subtle)' }}>
                    <td className="px-4 py-3 text-sm whitespace-nowrap" style={{ color: 'var(--text-secondary)' }}>{fmtDate(w.paid_at)}</td>
                    <td className="px-4 py-3">{pot ? <span className="inline-flex items-center gap-2">{scopeBadge(pot.scope)}{tierBadge(pot.tier)}<span className="text-xs" style={{ color: 'var(--text-muted)' }}>{pot.game_id || ''}</span></span> : <span className="text-xs" style={{ color: 'var(--text-muted)' }}>{w.pot_id.slice(0, 8)}…</span>}</td>
                    <td className="px-4 py-3 text-sm tabular-nums" style={{ color: 'var(--text-secondary)' }}>#{w.cycle_number}</td>
                    <td className="px-4 py-3 text-[11px] font-mono" style={{ color: 'var(--text-muted)' }}>{w.trigger_ticket_id.slice(0, 8)}…</td>
                    <td className="px-4 py-3 text-xs font-mono" style={{ color: 'var(--text-secondary)' }}>{agentLabel(w.winner_agent_id)}</td>
                    <td className="px-4 py-3 text-xs tabular-nums" style={{ color: 'var(--text-muted)' }}>{fmt(w.threshold_hit)}</td>
                    <td className="px-4 py-3 text-sm tabular-nums" style={{ color: 'var(--text-primary)' }}>{fmt(w.pot_amount_at_hit)}</td>
                    <td className="px-4 py-3 text-sm font-bold tabular-nums" style={{ color: 'var(--green)' }}>{fmt(w.payout_amount)}</td>
                    <td className="px-4 py-3 text-xs tabular-nums" style={{ color: 'var(--text-muted)' }}>{fmt(w.carryover)}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>

          {wins.length > 0 && (
            <div className="flex items-center justify-between px-4 py-3 text-sm"
              style={{ borderTop: '1px solid var(--border-subtle)', background: 'var(--bg-elevated)', color: 'var(--text-muted)' }}>
              <span>{winStart + 1}–{Math.min(winStart + PAGE_SIZE, wins.length)} sur {wins.length}</span>
              <div className="flex items-center gap-1">
                <PagerBtn disabled={safeWinPage <= 1} onClick={() => setWinPage(safeWinPage - 1)}><ChevronLeft size={14} /></PagerBtn>
                <span className="px-3 font-semibold tabular-nums" style={{ color: 'var(--text-primary)' }}>{safeWinPage} / {totalWinPages}</span>
                <PagerBtn disabled={safeWinPage >= totalWinPages} onClick={() => setWinPage(safeWinPage + 1)}><ChevronRight size={14} /></PagerBtn>
              </div>
            </div>
          )}
        </div>
      )}

      {/* Create / Edit modal */}
      {showModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 overflow-y-auto" style={{ background: 'rgba(0,0,0,0.5)' }}>
          <div className="rounded-xl p-6 w-full max-w-3xl my-auto"
            style={{ background: 'var(--bg-surface)', border: '1px solid var(--border-subtle)', boxShadow: 'var(--shadow-md)' }}>
            <div className="flex justify-between items-center mb-5">
              <div>
                <h3 className="text-lg font-bold" style={{ color: 'var(--text-primary)' }}>
                  {editingId ? 'Modifier le pot' : 'Nouveau pot'}
                </h3>
                <p className="text-xs mt-1" style={{ color: 'var(--text-muted)' }}>
                  Renseignez les paramètres ci-dessous. Les champs restent modifiables après création (hors portée).
                </p>
              </div>
              <button onClick={() => setShowModal(false)} style={{ color: 'var(--text-muted)' }} className="p-1 rounded hover:opacity-70"><X size={18} /></button>
            </div>

            {error && <div className="mb-4 px-3 py-2 rounded-lg text-sm" style={{ background: 'var(--red)15', color: 'var(--red)' }}>{error}</div>}

            <form onSubmit={handleSave} className="space-y-5">
              <FormSection title="Portee">
                <FieldRow>
                  <FormSelect label="Scope" value={form.scope} disabled={!!editingId}
                    onChange={v => setForm(f => ({ ...f, scope: v, tier: v === 'GLOBAL' ? '' : (f.tier || 'BRONZE') }))}>
                    {SCOPES.map(s => <option key={s} value={s}>{SCOPE_META[s].label}</option>)}
                  </FormSelect>
                  {form.scope !== 'GLOBAL' && (
                    <FormInput label="Jeu (game_id)" value={form.game_id} disabled={!!editingId}
                      onChange={v => setForm(f => ({ ...f, game_id: v }))} placeholder="roulette, spin2win..." />
                  )}
                  {form.scope === 'LOCAL' && (
                    <FormSelect label="Kiosque" value={form.kiosk_id} disabled={!!editingId}
                      onChange={v => setForm(f => ({ ...f, kiosk_id: v }))}>
                      <option value="">— Choisir —</option>
                      {agents.map(a => <option key={a.id} value={a.id}>{a.kiosk_code} · {a.display_name}</option>)}
                    </FormSelect>
                  )}
                  {form.scope !== 'GLOBAL' && (
                    <FormSelect label="Niveau" value={form.tier} disabled={!!editingId}
                      onChange={v => setForm(f => ({ ...f, tier: v }))}>
                      <option value="">{form.scope === 'GAME' ? '— Jackpot global du jeu —' : '— Choisir —'}</option>
                      {TIERS.map(t => <option key={t} value={t}>{TIER_META[t].label}</option>)}
                    </FormSelect>
                  )}
                </FieldRow>
              </FormSection>

              <FormSection title="Contribution par ticket">
                <FieldRow>
                  <FormSelect label="Mode" value={form.contribution_mode}
                    onChange={v => setForm(f => ({ ...f, contribution_mode: v }))}>
                    {CONTRIB_MODES.map(m => <option key={m} value={m}>{m === 'PERCENT' ? 'Pourcentage' : 'Montant fixe'}</option>)}
                  </FormSelect>
                  {form.contribution_mode === 'PERCENT' ? (
                    <FormInput label="% de la mise" type="number" step="0.01" value={form.contribution_percent}
                      onChange={v => setForm(f => ({ ...f, contribution_percent: v }))} suffix="%" />
                  ) : (
                    <FormInput label="Montant fixe" type="number" value={form.contribution_fixed}
                      onChange={v => setForm(f => ({ ...f, contribution_fixed: v }))} suffix="XAF" />
                  )}
                </FieldRow>
              </FormSection>

              <FormSection title="Seuil de declenchement (secret)">
                <FieldRow>
                  <FormInput label="Min" type="number" value={form.threshold_min}
                    onChange={v => setForm(f => ({ ...f, threshold_min: v }))} suffix="XAF" />
                  <FormInput label="Max" type="number" value={form.threshold_max}
                    onChange={v => setForm(f => ({ ...f, threshold_max: v }))} suffix="XAF" />
                </FieldRow>
                <p className="text-[11px]" style={{ color: 'var(--text-muted)' }}>
                  Un seuil aleatoire est tire dans cet intervalle a chaque cycle. Bronze = bas / Or = haut.
                </p>
              </FormSection>

              <FormSection title="Reset apres gain">
                <FieldRow>
                  <FormSelect label="Mode" value={form.reset_mode}
                    onChange={v => setForm(f => ({ ...f, reset_mode: v }))}>
                    {RESET_MODES.map(m => <option key={m} value={m}>{m === 'ZERO' ? 'Repartir de 0' : 'Repartir avec seed'}</option>)}
                  </FormSelect>
                  {form.reset_mode === 'SEED' && (
                    <FormInput label="Seed (montant)" type="number" value={form.seed_amount}
                      onChange={v => setForm(f => ({ ...f, seed_amount: v }))} suffix="XAF" />
                  )}
                </FieldRow>
              </FormSection>

              <FormSection title="Designation du gagnant">
                <FieldRow>
                  <FormSelect label="Mode" value={form.winner_mode}
                    onChange={v => setForm(f => ({ ...f, winner_mode: v }))}>
                    {WINNER_MODES.map(m => <option key={m} value={m}>{m === 'TRIGGER_TICKET' ? 'Ticket declencheur' : 'Aleatoire (fenetre recente)'}</option>)}
                  </FormSelect>
                  {form.winner_mode === 'RANDOM_RECENT' && (
                    <FormInput label="Fenetre (minutes)" type="number" value={form.recent_window_minutes}
                      onChange={v => setForm(f => ({ ...f, recent_window_minutes: v }))} suffix="min" />
                  )}
                </FieldRow>
              </FormSection>

              <FormSection title="Plafond optionnel">
                <FormInput label="Max payout (vide = pas de plafond)" type="number" value={form.max_payout}
                  onChange={v => setForm(f => ({ ...f, max_payout: v }))} suffix="XAF" />
              </FormSection>

              <div className="flex items-center gap-2 pt-2">
                <label className="flex items-center gap-2 text-sm cursor-pointer" style={{ color: 'var(--text-primary)' }}>
                  <input type="checkbox" checked={form.enabled} onChange={e => setForm(f => ({ ...f, enabled: e.target.checked }))} />
                  Pot actif
                </label>
                <div className="flex-1" />
                <button type="button" onClick={() => setShowModal(false)}
                  className="px-4 py-2 rounded-lg text-sm font-semibold"
                  style={{ background: 'var(--bg-base)', color: 'var(--text-secondary)', border: '1px solid var(--border-subtle)' }}>
                  Annuler
                </button>
                <button type="submit"
                  className="px-5 py-2 rounded-lg text-sm font-bold"
                  style={{ background: 'var(--accent)', color: '#000' }}>
                  {editingId ? 'Mettre a jour' : 'Creer'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}


// ============ SUB-COMPONENTS ============

const KpiCard = ({ label, value, accent, Icon }) => (
  <div className="rounded-xl p-4 flex items-center justify-between"
    style={{ background: 'var(--bg-surface)', border: '1px solid var(--border-subtle)', boxShadow: 'var(--shadow-sm)' }}>
    <div>
      <p className="text-[10px] font-semibold uppercase tracking-[0.12em] mb-1" style={{ color: 'var(--text-muted)' }}>{label}</p>
      <p className="text-xl font-bold tabular-nums" style={{ color: accent }}>{value}</p>
    </div>
    {Icon && <Icon size={20} style={{ color: accent, opacity: 0.5 }} />}
  </div>
);

const TabBtn = ({ active, onClick, label, count }) => (
  <button onClick={onClick}
    className="flex items-center gap-2 px-4 py-2.5 rounded-lg text-sm font-medium transition-all"
    style={{
      background: active ? 'var(--bg-surface)' : 'transparent',
      color: active ? 'var(--text-primary)' : 'var(--text-secondary)',
      border: '1px solid ' + (active ? 'var(--border-subtle)' : 'transparent'),
      borderBottom: active ? '2px solid var(--accent)' : '2px solid transparent',
      paddingBottom: 9,
    }}>
    {label}
    <span className="text-[11px] font-bold px-2 py-0.5 rounded-full"
      style={{ background: active ? 'var(--accent)1F' : 'var(--bg-elevated)', color: active ? 'var(--accent)' : 'var(--text-muted)' }}>
      {count}
    </span>
  </button>
);

const SelectFilter = ({ value, onChange, options }) => (
  <select value={value} onChange={e => onChange(e.target.value)}
    className="px-3 py-2 text-sm rounded-md outline-none cursor-pointer"
    style={{ background: 'var(--bg-elevated)', border: '1px solid var(--border-subtle)', color: 'var(--text-primary)' }}>
    {options.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
  </select>
);

const PagerBtn = ({ disabled, onClick, children }) => (
  <button onClick={onClick} disabled={disabled}
    className="flex items-center justify-center w-8 h-8 rounded-md transition-colors"
    style={{
      background: 'var(--bg-surface)', border: '1px solid var(--border-subtle)',
      color: disabled ? 'var(--text-muted)' : 'var(--text-primary)',
      opacity: disabled ? 0.5 : 1, cursor: disabled ? 'not-allowed' : 'pointer',
    }}>
    {children}
  </button>
);

const FormSection = ({ title, children }) => (
  <div>
    <p className="text-[10px] font-bold uppercase tracking-[0.12em] mb-2" style={{ color: 'var(--text-muted)' }}>{title}</p>
    <div className="space-y-2">{children}</div>
  </div>
);

const FieldRow = ({ children }) => (
  <div
    className="grid gap-3"
    style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))' }}
  >
    {children}
  </div>
);

const FormInput = ({ label, value, onChange, type = 'text', step, placeholder, suffix, disabled }) => (
  <div>
    <label className="block text-[10px] font-semibold uppercase tracking-wider mb-1" style={{ color: 'var(--text-muted)' }}>{label}</label>
    <div className="relative">
      <input type={type} step={step} value={value} onChange={e => onChange(e.target.value)}
        placeholder={placeholder} disabled={disabled}
        className="w-full px-3 py-2 text-sm rounded-md outline-none"
        style={{ background: 'var(--bg-base)', border: '1px solid var(--border-subtle)', color: 'var(--text-primary)', opacity: disabled ? 0.6 : 1 }} />
      {suffix && <span className="absolute right-2.5 top-1/2 -translate-y-1/2 text-[11px] font-semibold" style={{ color: 'var(--text-muted)' }}>{suffix}</span>}
    </div>
  </div>
);

const FormSelect = ({ label, value, onChange, children, disabled }) => (
  <div>
    <label className="block text-[10px] font-semibold uppercase tracking-wider mb-1" style={{ color: 'var(--text-muted)' }}>{label}</label>
    <select value={value} onChange={e => onChange(e.target.value)} disabled={disabled}
      className="w-full px-3 py-2 text-sm rounded-md outline-none cursor-pointer"
      style={{ background: 'var(--bg-base)', border: '1px solid var(--border-subtle)', color: 'var(--text-primary)', opacity: disabled ? 0.6 : 1 }}>
      {children}
    </select>
  </div>
);

export default Jackpots;
