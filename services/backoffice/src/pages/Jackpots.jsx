import React, { useState, useEffect, useCallback, useMemo } from 'react';
import axios from 'axios';
import {
  RefreshCw, Edit2, X, Globe2, Gamepad2, MapPin, Crown, Gem, Search,
} from 'lucide-react';
import LiveIndicator from '../components/LiveIndicator';
import { useRouletteWs } from '../hooks/useRouletteWs';

// --- Layout du système de jackpots (game-roulette-service) ----------------
//
//   2 pots globaux  : general (Grand Jackpot) + spin2win (Game)
//   3 pots par kiosk : bronze / silver / gold
//
// Source de vérité : table `jackpot_state` (kiosk_id, name, value, contribution_pct).
// kiosk_id == '__GLOBAL__' pour general et spin2win.
// Endpoints :
//   GET   /api/roulette/admin/jackpots/all       → toutes les lignes
//   PATCH /api/roulette/admin/jackpots           → édition (auto-broadcast WS)
// Le live des 2 globaux passe aussi par useRouletteWs (jackpot_updated).
// --------------------------------------------------------------------------

const GLOBAL_KIOSK = '__GLOBAL__';

const GLOBAL_META = {
  general:  { label: 'Grand Jackpot', sub: 'Global · tous kiosques', Icon: Globe2,   color: 'var(--purple)' },
  spin2win: { label: 'Game Jackpot',  sub: 'Roulette · tous kiosques', Icon: Gamepad2, color: 'var(--blue)' },
};

const TIER_META = {
  bronze: { label: 'Bronze', color: '#b45309', Icon: Gem,   pct: 0.005 },
  silver: { label: 'Argent', color: '#94a3b8', Icon: Gem,   pct: 0.003 },
  gold:   { label: 'Or',     color: '#eab308', Icon: Crown, pct: 0.001 },
};

const fmt = (n) => Math.round(Number(n) || 0).toLocaleString('fr-FR');
const fmtPct = (p) => `${(Number(p) * 100).toFixed(3)}%`;
const fmtDate = (d) => d ? new Date(d).toLocaleString('fr-FR', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' }) : '—';

// Group rows by kiosk_id → { __GLOBAL__: {general, spin2win}, ZHHN: {bronze, silver, gold}, ... }
function groupByKiosk(rows) {
  const out = {};
  for (const r of rows || []) {
    if (!out[r.kiosk_id]) out[r.kiosk_id] = {};
    out[r.kiosk_id][r.name] = r;
  }
  return out;
}

const GlobalPotCard = ({ name, row, liveValue, onEdit }) => {
  const meta = GLOBAL_META[name];
  const Icon = meta.Icon;
  // Si l'event WS a une valeur fraîche, on l'affiche, sinon on retombe sur la
  // valeur DB du dernier fetch /all. Évite le "saut" à chaque refresh.
  const displayed = typeof liveValue === 'number' ? liveValue : (row?.value || 0);
  return (
    <div className="rounded-xl p-5 transition-all" style={{
      background: 'var(--bg-surface)',
      border: '1px solid var(--border-subtle)',
      boxShadow: 'var(--shadow-sm)',
    }}>
      <div className="flex items-start justify-between mb-3">
        <div className="flex items-center gap-2.5">
          <div className="flex items-center justify-center w-10 h-10 rounded-lg" style={{ background: `${meta.color}20`, color: meta.color }}>
            <Icon size={20} />
          </div>
          <div>
            <div className="text-sm font-bold" style={{ color: 'var(--text-primary)' }}>{meta.label}</div>
            <div className="text-[11px]" style={{ color: 'var(--text-muted)' }}>{meta.sub}</div>
          </div>
        </div>
        <button onClick={onEdit} className="p-1.5 rounded-md transition-colors" style={{ color: 'var(--text-muted)' }} title="Éditer">
          <Edit2 size={15} />
        </button>
      </div>
      <div className="text-3xl font-bold tabular-nums" style={{ color: meta.color }}>
        {fmt(displayed)} <span className="text-sm opacity-70 font-normal">XAF</span>
      </div>
      <div className="mt-2 flex items-center gap-3 text-[11px]" style={{ color: 'var(--text-muted)' }}>
        <span>Contribution : <strong style={{ color: 'var(--text-secondary)' }}>{row ? fmtPct(row.contribution_pct) : '—'}</strong></span>
        {row?.updated_at && <span>· MAJ {fmtDate(row.updated_at)}</span>}
      </div>
    </div>
  );
};

const KioskRow = ({ kioskId, kioskName, pots, onEdit }) => {
  return (
    <tr style={{ borderBottom: '1px solid var(--border-subtle)' }}>
      <td className="px-4 py-3">
        <div className="font-mono text-sm font-bold" style={{ color: 'var(--accent)' }}>{kioskId}</div>
        {kioskName && <div className="text-xs" style={{ color: 'var(--text-muted)' }}>{kioskName}</div>}
      </td>
      {['bronze', 'silver', 'gold'].map(tier => {
        const p = pots[tier];
        const meta = TIER_META[tier];
        return (
          <td key={tier} className="px-4 py-3">
            <div className="flex items-center justify-between gap-2">
              <div>
                <div className="text-sm font-bold tabular-nums" style={{ color: meta.color }}>
                  {p ? fmt(p.value) : '—'} <span className="text-[10px] opacity-70 font-normal">XAF</span>
                </div>
                <div className="text-[10px]" style={{ color: 'var(--text-muted)' }}>
                  {p ? fmtPct(p.contribution_pct) : `défaut ${fmtPct(meta.pct)}`}
                </div>
              </div>
              <button
                onClick={() => onEdit(tier, p)}
                className="p-1 rounded-md transition-colors"
                style={{ color: 'var(--text-muted)' }}
                title={`Éditer ${meta.label}`}>
                <Edit2 size={12} />
              </button>
            </div>
          </td>
        );
      })}
    </tr>
  );
};

const EditModal = ({ entry, onClose, onSave, saving }) => {
  const [value, setValue] = useState(entry.value);
  const [pct, setPct] = useState(entry.contribution_pct);
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center" style={{ background: 'rgba(0,0,0,0.5)' }}>
      <div className="rounded-xl p-6 max-w-md w-full mx-4" style={{ background: 'var(--bg-surface)', border: '1px solid var(--border-subtle)' }}>
        <div className="flex justify-between items-start mb-4">
          <div>
            <h3 className="text-lg font-bold" style={{ color: 'var(--text-primary)' }}>Éditer le pot</h3>
            <p className="text-xs mt-1" style={{ color: 'var(--text-muted)' }}>
              <span className="font-mono">{entry.name}</span> · scope <span className="font-mono">{entry.kiosk_id}</span>
            </p>
          </div>
          <button onClick={onClose} style={{ color: 'var(--text-muted)' }}><X size={18} /></button>
        </div>
        <div className="space-y-3">
          <label className="block">
            <span className="text-xs font-semibold uppercase tracking-wider" style={{ color: 'var(--text-muted)' }}>Valeur courante (XAF)</span>
            <input
              type="number" min="0" step="1"
              value={value}
              onChange={e => setValue(e.target.value)}
              className="mt-1 w-full px-3 py-2 rounded-md outline-none text-sm tabular-nums"
              style={{ background: 'var(--bg-elevated)', border: '1px solid var(--border-subtle)', color: 'var(--text-primary)' }}
            />
          </label>
          <label className="block">
            <span className="text-xs font-semibold uppercase tracking-wider" style={{ color: 'var(--text-muted)' }}>Contribution par mise (fraction, ex : 0.003 = 0.3%)</span>
            <input
              type="number" min="0" step="0.0001"
              value={pct}
              onChange={e => setPct(e.target.value)}
              className="mt-1 w-full px-3 py-2 rounded-md outline-none text-sm tabular-nums"
              style={{ background: 'var(--bg-elevated)', border: '1px solid var(--border-subtle)', color: 'var(--text-primary)' }}
            />
            <span className="text-[11px] mt-1 block" style={{ color: 'var(--text-muted)' }}>{fmtPct(pct || 0)} de chaque mise contribuera à ce pot.</span>
          </label>
        </div>
        <div className="flex gap-2 mt-5 justify-end">
          <button onClick={onClose} className="px-4 py-2 rounded-md text-sm" style={{ background: 'var(--bg-elevated)', color: 'var(--text-secondary)', border: '1px solid var(--border-subtle)' }}>
            Annuler
          </button>
          <button
            onClick={() => onSave({ value: Number(value), contribution_pct: Number(pct) })}
            disabled={saving}
            className="px-4 py-2 rounded-md text-sm font-bold"
            style={{ background: 'var(--accent)', color: '#000', opacity: saving ? 0.7 : 1 }}>
            {saving ? 'Enregistrement…' : 'Enregistrer'}
          </button>
        </div>
      </div>
    </div>
  );
};

function Jackpots() {
  const adminKey = localStorage.getItem('admin_key');
  const config = useMemo(() => ({ headers: { 'x-api-key': adminKey } }), [adminKey]);

  const [rows, setRows] = useState([]);
  const [agents, setAgents] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [success, setSuccess] = useState(null);
  const [editing, setEditing] = useState(null); // {name, kiosk_id, value, contribution_pct}
  const [saving, setSaving] = useState(false);
  const [search, setSearch] = useState('');

  // Live updates pour les 2 pots globaux (welcome.jackpots / jackpot_updated)
  const { connected, jackpots: liveJackpots } = useRouletteWs();

  const fetchAll = useCallback(async () => {
    try {
      const [potsRes, agentsRes] = await Promise.all([
        axios.get('/api/roulette/admin/jackpots/all', config),
        axios.get('/api/agents/', config).catch(() => ({ data: [] })),
      ]);
      setRows(potsRes.data?.rows || []);
      setAgents(agentsRes.data || []);
      setError(null);
    } catch (e) {
      setError(e.response?.data?.detail || e.message || 'Erreur de chargement');
    } finally {
      setLoading(false);
    }
  }, [config]);

  useEffect(() => {
    fetchAll();
    const id = setInterval(fetchAll, 5000);
    return () => clearInterval(id);
  }, [fetchAll]);

  // Auto-clear flash messages
  useEffect(() => {
    if (!success && !error) return undefined;
    const id = setTimeout(() => { setSuccess(null); setError(null); }, 4000);
    return () => clearTimeout(id);
  }, [success, error]);

  const grouped = useMemo(() => groupByKiosk(rows), [rows]);
  const kioskNameByCode = useMemo(() => {
    const m = {};
    for (const a of agents) {
      if (a.kiosk_code) m[a.kiosk_code] = a.kiosk_name || a.display_name || null;
    }
    return m;
  }, [agents]);

  const kioskEntries = useMemo(() => {
    const keys = Object.keys(grouped).filter(k => k !== GLOBAL_KIOSK).sort();
    const q = search.trim().toUpperCase();
    return keys
      .map(k => ({ kioskId: k, kioskName: kioskNameByCode[k] || null, pots: grouped[k] }))
      .filter(({ kioskId, kioskName }) => {
        if (!q) return true;
        return kioskId.includes(q) || (kioskName || '').toUpperCase().includes(q);
      });
  }, [grouped, kioskNameByCode, search]);

  const totalPerKiosk = kioskEntries.length;

  const openEditGlobal = (name) => {
    const r = grouped[GLOBAL_KIOSK]?.[name] || {
      name, kiosk_id: GLOBAL_KIOSK, value: 0, contribution_pct: name === 'general' ? 0.003 : 0.002,
    };
    setEditing({ name: r.name, kiosk_id: r.kiosk_id, value: r.value, contribution_pct: r.contribution_pct });
  };

  const openEditKiosk = (kioskId, tier, existing) => {
    setEditing({
      name: tier,
      kiosk_id: kioskId,
      value: existing?.value ?? 0,
      contribution_pct: existing?.contribution_pct ?? TIER_META[tier].pct,
    });
  };

  const handleSave = async (patch) => {
    if (!editing) return;
    setSaving(true);
    try {
      const body = {
        [editing.name]: {
          ...patch,
          kiosk_id: editing.kiosk_id === GLOBAL_KIOSK ? null : editing.kiosk_id,
        },
      };
      await axios.patch('/api/roulette/admin/jackpots', body, config);
      setEditing(null);
      setSuccess(`Pot ${editing.name} mis à jour.`);
      await fetchAll();
    } catch (e) {
      setError(e.response?.data?.detail || e.message || 'Échec de la mise à jour');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="animate-fade w-full">
      {success && <div className="mb-4 px-4 py-3 rounded-lg text-sm font-medium" style={{ background: 'var(--green)15', color: 'var(--green)', border: '1px solid var(--green)30' }}>{success}</div>}
      {error && <div className="mb-4 px-4 py-3 rounded-lg text-sm font-medium" style={{ background: 'var(--red)15', color: 'var(--red)', border: '1px solid var(--red)30' }}>{error}</div>}

      <div className="flex justify-between items-center mb-5">
        <div>
          <h1 className="text-2xl font-bold" style={{ color: 'var(--text-primary)' }}>Jackpots</h1>
          <p className="text-sm" style={{ color: 'var(--text-muted)' }}>2 pots globaux + 3 pots locaux par kiosque (Bronze / Argent / Or)</p>
        </div>
        <div className="flex gap-2 items-center">
          <LiveIndicator connected={connected} lastEventType="jackpot_updated" />
          <button onClick={fetchAll} className="flex items-center gap-2 px-4 py-2.5 rounded-lg text-sm font-medium"
            style={{ background: 'var(--bg-surface)', border: '1px solid var(--border-subtle)', color: 'var(--text-secondary)' }}>
            <RefreshCw size={15} /> Actualiser
          </button>
        </div>
      </div>

      {/* Cartes Pots globaux */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-6">
        <GlobalPotCard
          name="general"
          row={grouped[GLOBAL_KIOSK]?.general}
          liveValue={liveJackpots?.general}
          onEdit={() => openEditGlobal('general')}
        />
        <GlobalPotCard
          name="spin2win"
          row={grouped[GLOBAL_KIOSK]?.spin2win}
          liveValue={liveJackpots?.spin2win}
          onEdit={() => openEditGlobal('spin2win')}
        />
      </div>

      {/* Tableau pots par kiosque */}
      <div className="rounded-xl overflow-hidden" style={{ background: 'var(--bg-surface)', border: '1px solid var(--border-subtle)' }}>
        <div className="px-4 py-3 flex items-center justify-between gap-3 flex-wrap" style={{ borderBottom: '1px solid var(--border-subtle)' }}>
          <div className="flex items-center gap-2">
            <MapPin size={16} style={{ color: 'var(--accent)' }} />
            <h2 className="text-sm font-bold uppercase tracking-wider" style={{ color: 'var(--text-primary)' }}>Pots locaux par kiosque</h2>
            <span className="text-xs" style={{ color: 'var(--text-muted)' }}>{totalPerKiosk} kiosque{totalPerKiosk > 1 ? 's' : ''}</span>
          </div>
          <div className="relative">
            <Search size={13} className="absolute left-2.5 top-1/2 -translate-y-1/2" style={{ color: 'var(--text-muted)' }} />
            <input value={search} onChange={e => setSearch(e.target.value)} placeholder="Code ou nom du kiosque"
              className="pl-8 pr-2 py-2 text-sm rounded-md outline-none w-56"
              style={{ background: 'var(--bg-elevated)', border: '1px solid var(--border-subtle)', color: 'var(--text-primary)' }} />
          </div>
        </div>
        <table className="w-full text-left">
          <thead>
            <tr style={{ borderBottom: '1px solid var(--border-subtle)' }}>
              <th className="px-4 py-3 text-[11px] font-semibold uppercase tracking-wider" style={{ color: 'var(--text-muted)' }}>Kiosque</th>
              {['Bronze', 'Argent', 'Or'].map(h => (
                <th key={h} className="px-4 py-3 text-[11px] font-semibold uppercase tracking-wider" style={{ color: 'var(--text-muted)' }}>{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <tr><td colSpan="4" className="px-4 py-10 text-center text-sm" style={{ color: 'var(--text-muted)' }}>Chargement…</td></tr>
            ) : kioskEntries.length === 0 ? (
              <tr><td colSpan="4" className="px-4 py-10 text-center text-sm italic" style={{ color: 'var(--text-muted)' }}>
                {search ? `Aucun kiosque ne correspond à "${search}".` : 'Aucun pot local. Les lignes apparaîtront automatiquement au premier settlement d\'un kiosque, ou via une édition manuelle.'}
              </td></tr>
            ) : kioskEntries.map(({ kioskId, kioskName, pots }) => (
              <KioskRow
                key={kioskId}
                kioskId={kioskId}
                kioskName={kioskName}
                pots={pots}
                onEdit={(tier, p) => openEditKiosk(kioskId, tier, p)}
              />
            ))}
          </tbody>
        </table>
      </div>

      {editing && (
        <EditModal entry={editing} onClose={() => setEditing(null)} onSave={handleSave} saving={saving} />
      )}
    </div>
  );
}

export default Jackpots;
