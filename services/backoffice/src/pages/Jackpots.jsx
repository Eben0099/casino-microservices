import React, { useState, useEffect, useCallback, useMemo } from 'react';
import axios from 'axios';
import {
  RefreshCw, Edit2, X, Globe2, Gamepad2, MapPin, Crown, Gem,
  Search, Plus, ChevronDown, ChevronUp, History, AlertTriangle,
  ToggleLeft, ToggleRight, Trophy,
} from 'lucide-react';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const fmt = (n) => Math.round(Number(n) || 0).toLocaleString('fr-FR');

const fmtDate = (d) =>
  d
    ? new Date(d).toLocaleString('fr-FR', {
        day: '2-digit',
        month: '2-digit',
        year: 'numeric',
        hour: '2-digit',
        minute: '2-digit',
      })
    : '—';

function contributionSummary(pot) {
  if (pot.contribution_mode === 'PERCENT') {
    return `${Number(pot.contribution_percent).toFixed(2)} % de la mise`;
  }
  return `${fmt(pot.contribution_fixed)} XAF / ticket`;
}

function scopeLabel(pot) {
  if (pot.scope === 'GLOBAL') return 'GLOBAL — tous jeux';
  if (pot.scope === 'GAME') return `GAME — ${pot.game_id}`;
  const parts = [];
  if (pot.kiosk_code) parts.push(pot.kiosk_code);
  if (pot.game_id) parts.push(pot.game_id);
  if (pot.tier) parts.push(pot.tier);
  return `LOCAL — ${parts.join(' / ')}`;
}

const TIER_COLORS = {
  BRONZE: '#b45309',
  SILVER: '#94a3b8',
  GOLD:   '#eab308',
};
const TIER_LABELS = { BRONZE: 'Bronze', SILVER: 'Argent', GOLD: 'Or' };

const GAME_ICONS = { ROULETTE: Gamepad2, KENO: Gem };
function gameIcon(game_id) {
  if (!game_id) return Gamepad2;
  const key = Object.keys(GAME_ICONS).find((k) => game_id.toUpperCase().includes(k));
  return key ? GAME_ICONS[key] : Gamepad2;
}

// ---------------------------------------------------------------------------
// API helpers
// ---------------------------------------------------------------------------

function apiConfig() {
  return { headers: { 'x-api-key': localStorage.getItem('admin_key') || '' } };
}

async function fetchPots() {
  const res = await axios.get('/api/jackpots/admin/pots', apiConfig());
  return res.data;
}

async function fetchWins(limit = 20) {
  const res = await axios.get(`/api/jackpots/admin/pots/wins?limit=${limit}`, apiConfig());
  return res.data;
}

async function patchPot(id, payload) {
  const res = await axios.patch(`/api/jackpots/admin/pots/${id}`, payload, apiConfig());
  return res.data;
}

async function createPot(payload) {
  const res = await axios.post('/api/jackpots/admin/pots', payload, apiConfig());
  return res.data;
}

// ---------------------------------------------------------------------------
// Small UI atoms
// ---------------------------------------------------------------------------

function Badge({ children, color }) {
  return (
    <span
      className="inline-flex items-center px-2 py-0.5 rounded text-[10px] font-bold uppercase tracking-wider"
      style={{ background: `${color}22`, color }}
    >
      {children}
    </span>
  );
}

function EnabledPill({ enabled }) {
  return (
    <span
      className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-semibold uppercase tracking-wider"
      style={
        enabled
          ? { background: 'var(--green, #22c55e)22', color: 'var(--green, #22c55e)' }
          : { background: 'var(--red, #ef4444)22',   color: 'var(--red, #ef4444)' }
      }
    >
      {enabled ? <ToggleRight size={11} /> : <ToggleLeft size={11} />}
      {enabled ? 'Actif' : 'Inactif'}
    </span>
  );
}

function Toast({ msg, type }) {
  if (!msg) return null;
  const ok = type === 'success';
  return (
    <div
      className="mb-4 px-4 py-3 rounded-lg text-sm font-medium flex items-center gap-2"
      style={
        ok
          ? { background: 'var(--green, #22c55e)18', color: 'var(--green, #22c55e)', border: '1px solid var(--green, #22c55e)33' }
          : { background: 'var(--red, #ef4444)18',   color: 'var(--red, #ef4444)',   border: '1px solid var(--red, #ef4444)33'   }
      }
    >
      {!ok && <AlertTriangle size={14} />}
      {msg}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Edit modal — PATCHes all rule fields of a pot
// ---------------------------------------------------------------------------

const EMPTY_FORM = {
  enabled:              true,
  contribution_mode:    'PERCENT',
  contribution_percent: '0',
  contribution_fixed:   '0',
  threshold_min:        '0',
  threshold_max:        '0',
  reset_mode:           'ZERO',
  seed_amount:          '0',
  winner_mode:          'TRIGGER_TICKET',
  recent_window_minutes:'60',
  max_payout:           '',
};

function potToForm(pot) {
  return {
    enabled:               pot.enabled,
    contribution_mode:     pot.contribution_mode,
    contribution_percent:  String(Number(pot.contribution_percent)),
    contribution_fixed:    String(pot.contribution_fixed),
    threshold_min:         String(pot.threshold_min),
    threshold_max:         String(pot.threshold_max),
    reset_mode:            pot.reset_mode,
    seed_amount:           String(pot.seed_amount),
    winner_mode:           pot.winner_mode,
    recent_window_minutes: String(pot.recent_window_minutes),
    max_payout:            pot.max_payout != null ? String(pot.max_payout) : '',
  };
}

function formToPayload(form) {
  const p = {
    enabled:               form.enabled,
    contribution_mode:     form.contribution_mode,
    contribution_percent:  Number(form.contribution_percent),
    contribution_fixed:    parseInt(form.contribution_fixed, 10) || 0,
    threshold_min:         parseInt(form.threshold_min, 10) || 0,
    threshold_max:         parseInt(form.threshold_max, 10) || 0,
    reset_mode:            form.reset_mode,
    seed_amount:           parseInt(form.seed_amount, 10) || 0,
    winner_mode:           form.winner_mode,
    recent_window_minutes: parseInt(form.recent_window_minutes, 10) || 60,
    max_payout:            form.max_payout !== '' ? (parseInt(form.max_payout, 10) || 0) : null,
  };
  return p;
}

function validateForm(form) {
  const errs = [];
  const tmin = parseInt(form.threshold_min, 10);
  const tmax = parseInt(form.threshold_max, 10);
  if (isNaN(tmin) || tmin < 0) errs.push('threshold_min doit etre >= 0');
  if (isNaN(tmax) || tmax < 0) errs.push('threshold_max doit etre >= 0');
  if (!isNaN(tmin) && !isNaN(tmax) && tmax < tmin)
    errs.push('threshold_max doit etre >= threshold_min');
  if (form.contribution_mode === 'PERCENT') {
    const pct = Number(form.contribution_percent);
    if (isNaN(pct) || pct < 0 || pct > 100)
      errs.push('contribution_percent doit etre compris entre 0 et 100');
  }
  const win = parseInt(form.recent_window_minutes, 10);
  if (isNaN(win) || win < 1 || win > 1440)
    errs.push('recent_window_minutes doit etre entre 1 et 1440');
  return errs;
}

function EditModal({ pot, onClose, onSaved }) {
  const [form, setForm]     = useState(() => potToForm(pot));
  const [saving, setSaving] = useState(false);
  const [err, setErr]       = useState(null);

  const set = (key, val) => setForm((f) => ({ ...f, [key]: val }));

  const handleSubmit = async (e) => {
    e.preventDefault();
    const errs = validateForm(form);
    if (errs.length) { setErr(errs.join(' — ')); return; }
    setSaving(true);
    setErr(null);
    try {
      const updated = await patchPot(pot.id, formToPayload(form));
      onSaved(updated);
    } catch (ex) {
      setErr(ex.response?.data?.detail || ex.message || 'Echec de la mise a jour');
    } finally {
      setSaving(false);
    }
  };

  const fieldCls = 'mt-1 w-full px-3 py-2 rounded-md outline-none text-sm';
  const fieldStyle = {
    background: 'var(--bg-elevated)',
    border: '1px solid var(--border-subtle)',
    color: 'var(--text-primary)',
  };
  const labelCls = 'block text-xs font-semibold uppercase tracking-wider mb-1';
  const labelStyle = { color: 'var(--text-muted)' };

  return (
    <div
      className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto px-4 pb-8 pt-20"
      style={{ background: 'rgba(0,0,0,0.6)' }}
    >
      <div
        className="rounded-xl w-full max-w-lg max-h-[90vh] overflow-y-auto"
        style={{ background: 'var(--bg-surface)', border: '1px solid var(--border-subtle)' }}
      >
        {/* Header */}
        <div
          className="sticky top-0 flex justify-between items-start px-6 py-4 z-10"
          style={{ background: 'var(--bg-surface)', borderBottom: '1px solid var(--border-subtle)' }}
        >
          <div>
            <h3 className="text-base font-bold" style={{ color: 'var(--text-primary)' }}>
              Regles du pot
            </h3>
            <p className="text-xs mt-0.5 font-mono" style={{ color: 'var(--text-muted)' }}>
              {scopeLabel(pot)}
            </p>
          </div>
          <button onClick={onClose} style={{ color: 'var(--text-muted)' }}>
            <X size={18} />
          </button>
        </div>

        <form onSubmit={handleSubmit} className="px-6 py-5 space-y-5">
          {err && (
            <div
              className="px-3 py-2 rounded-md text-sm flex items-center gap-2"
              style={{ background: 'var(--red, #ef4444)18', color: 'var(--red, #ef4444)', border: '1px solid var(--red, #ef4444)33' }}
            >
              <AlertTriangle size={14} /> {err}
            </div>
          )}

          {/* Enabled toggle */}
          <div>
            <span className={labelCls} style={labelStyle}>Statut du pot</span>
            <button
              type="button"
              onClick={() => set('enabled', !form.enabled)}
              className="flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-semibold"
              style={
                form.enabled
                  ? { background: 'var(--green, #22c55e)22', color: 'var(--green, #22c55e)', border: '1px solid var(--green, #22c55e)44' }
                  : { background: 'var(--red, #ef4444)22',   color: 'var(--red, #ef4444)',   border: '1px solid var(--red, #ef4444)44'   }
              }
            >
              {form.enabled ? <ToggleRight size={16} /> : <ToggleLeft size={16} />}
              {form.enabled ? 'Actif — cliquer pour desactiver' : 'Inactif — cliquer pour activer'}
            </button>
          </div>

          {/* Contribution mode */}
          <div>
            <label className={labelCls} style={labelStyle}>Mode de contribution</label>
            <select
              value={form.contribution_mode}
              onChange={(e) => set('contribution_mode', e.target.value)}
              className={fieldCls}
              style={fieldStyle}
            >
              <option value="PERCENT">PERCENT — % de la mise</option>
              <option value="FIXED">FIXED — montant fixe par ticket (XAF)</option>
            </select>
          </div>

          {form.contribution_mode === 'PERCENT' ? (
            <div>
              <label className={labelCls} style={labelStyle}>
                Taux de contribution (%, ex : 0.5 = 0.5 %)
              </label>
              <input
                type="number" min="0" max="100" step="0.0001"
                value={form.contribution_percent}
                onChange={(e) => set('contribution_percent', e.target.value)}
                className={fieldCls}
                style={fieldStyle}
              />
            </div>
          ) : (
            <div>
              <label className={labelCls} style={labelStyle}>
                Contribution fixe par ticket (XAF entier)
              </label>
              <input
                type="number" min="0" step="1"
                value={form.contribution_fixed}
                onChange={(e) => set('contribution_fixed', e.target.value)}
                className={fieldCls}
                style={fieldStyle}
              />
            </div>
          )}

          {/* Threshold */}
          <div>
            <div
              className="px-3 py-2 rounded-md text-xs mb-2 flex items-start gap-2"
              style={{ background: 'var(--accent, #f59e0b)12', color: 'var(--accent, #f59e0b)', border: '1px solid var(--accent, #f59e0b)33' }}
            >
              <AlertTriangle size={13} className="mt-0.5 shrink-0" />
              Le seuil de declenchement reel est tire <strong>aleatoirement</strong> dans
              [min, max] et reste <strong>secret</strong> — il n&apos;est jamais affiché.
              Definissez une plage coherente.
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className={labelCls} style={labelStyle}>Seuil minimum (XAF)</label>
                <input
                  type="number" min="0" step="1"
                  value={form.threshold_min}
                  onChange={(e) => set('threshold_min', e.target.value)}
                  className={fieldCls}
                  style={fieldStyle}
                />
              </div>
              <div>
                <label className={labelCls} style={labelStyle}>Seuil maximum (XAF)</label>
                <input
                  type="number" min="0" step="1"
                  value={form.threshold_max}
                  onChange={(e) => set('threshold_max', e.target.value)}
                  className={fieldCls}
                  style={fieldStyle}
                />
              </div>
            </div>
          </div>

          {/* Reset mode */}
          <div>
            <label className={labelCls} style={labelStyle}>Mode de reinitialisation apres un HIT</label>
            <select
              value={form.reset_mode}
              onChange={(e) => set('reset_mode', e.target.value)}
              className={fieldCls}
              style={fieldStyle}
            >
              <option value="ZERO">ZERO — repart de 0 XAF</option>
              <option value="SEED">SEED — repart d&apos;un montant de seed</option>
            </select>
          </div>

          {form.reset_mode === 'SEED' && (
            <div>
              <label className={labelCls} style={labelStyle}>Montant de seed (XAF)</label>
              <input
                type="number" min="0" step="1"
                value={form.seed_amount}
                onChange={(e) => set('seed_amount', e.target.value)}
                className={fieldCls}
                style={fieldStyle}
              />
            </div>
          )}

          {/* Winner mode */}
          <div>
            <label className={labelCls} style={labelStyle}>Mode de selection du gagnant</label>
            <select
              value={form.winner_mode}
              onChange={(e) => set('winner_mode', e.target.value)}
              className={fieldCls}
              style={fieldStyle}
            >
              <option value="TRIGGER_TICKET">TRIGGER_TICKET — le ticket qui a franchi le seuil gagne</option>
              <option value="RANDOM_RECENT">RANDOM_RECENT — tirage parmi les tickets recents</option>
            </select>
          </div>

          {form.winner_mode === 'RANDOM_RECENT' && (
            <div>
              <label className={labelCls} style={labelStyle}>
                Fenetre de tickets recents (minutes, 1–1440)
              </label>
              <input
                type="number" min="1" max="1440" step="1"
                value={form.recent_window_minutes}
                onChange={(e) => set('recent_window_minutes', e.target.value)}
                className={fieldCls}
                style={fieldStyle}
              />
            </div>
          )}

          {/* Max payout */}
          <div>
            <label className={labelCls} style={labelStyle}>
              Paiement maximum (XAF — laisser vide = aucun cap)
            </label>
            <input
              type="number" min="0" step="1"
              value={form.max_payout}
              onChange={(e) => set('max_payout', e.target.value)}
              placeholder="Optionnel"
              className={fieldCls}
              style={fieldStyle}
            />
          </div>

          {/* Actions */}
          <div className="flex gap-2 pt-2 justify-end">
            <button
              type="button"
              onClick={onClose}
              className="px-4 py-2 rounded-md text-sm"
              style={{
                background: 'var(--bg-elevated)',
                color: 'var(--text-secondary)',
                border: '1px solid var(--border-subtle)',
              }}
            >
              Annuler
            </button>
            <button
              type="submit"
              disabled={saving}
              className="px-5 py-2 rounded-md text-sm font-bold"
              style={{ background: 'var(--accent)', color: '#000', opacity: saving ? 0.7 : 1 }}
            >
              {saving ? 'Enregistrement…' : 'Enregistrer les regles'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Create modal — POST a new pot
// ---------------------------------------------------------------------------

const CREATE_DEFAULTS = {
  scope:                'GAME',
  game_id:              '',
  kiosk_code:           '',
  tier:                 '',
  enabled:              true,
  contribution_mode:    'PERCENT',
  contribution_percent: '0.5',
  contribution_fixed:   '0',
  threshold_min:        '1000000',
  threshold_max:        '5000000',
  reset_mode:           'ZERO',
  seed_amount:          '0',
  winner_mode:          'TRIGGER_TICKET',
  recent_window_minutes:'60',
  max_payout:           '',
};

function CreateModal({ onClose, onCreated }) {
  const [form, setForm]     = useState(CREATE_DEFAULTS);
  const [saving, setSaving] = useState(false);
  const [err, setErr]       = useState(null);

  const set = (key, val) => setForm((f) => ({ ...f, [key]: val }));

  const handleSubmit = async (e) => {
    e.preventDefault();
    const errs = validateForm(form);
    if (form.scope !== 'GLOBAL' && !form.game_id.trim())
      errs.push('game_id requis pour les pots GAME et LOCAL');
    if (form.scope === 'LOCAL' && !form.kiosk_code.trim())
      errs.push('kiosk_code requis pour un pot LOCAL');
    if (form.scope === 'LOCAL' && !form.tier)
      errs.push('tier requis pour un pot LOCAL');
    if (errs.length) { setErr(errs.join(' — ')); return; }
    setSaving(true);
    setErr(null);
    try {
      const body = {
        scope:              form.scope,
        game_id:            form.game_id.trim() || null,
        kiosk_code:         form.kiosk_code.trim() || null,
        tier:               form.tier || null,
        ...formToPayload(form),
      };
      const created = await createPot(body);
      onCreated(created);
    } catch (ex) {
      setErr(ex.response?.data?.detail || ex.message || 'Echec de la creation');
    } finally {
      setSaving(false);
    }
  };

  const fieldCls = 'mt-1 w-full px-3 py-2 rounded-md outline-none text-sm';
  const fieldStyle = {
    background: 'var(--bg-elevated)',
    border: '1px solid var(--border-subtle)',
    color: 'var(--text-primary)',
  };
  const labelCls = 'block text-xs font-semibold uppercase tracking-wider mb-1';
  const labelStyle = { color: 'var(--text-muted)' };

  return (
    <div
      className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto px-4 pb-8 pt-20"
      style={{ background: 'rgba(0,0,0,0.6)' }}
    >
      <div
        className="rounded-xl w-full max-w-lg max-h-[90vh] overflow-y-auto"
        style={{ background: 'var(--bg-surface)', border: '1px solid var(--border-subtle)' }}
      >
        {/* Header */}
        <div
          className="sticky top-0 flex justify-between items-start px-6 py-4 z-10"
          style={{ background: 'var(--bg-surface)', borderBottom: '1px solid var(--border-subtle)' }}
        >
          <div>
            <h3 className="text-base font-bold" style={{ color: 'var(--text-primary)' }}>
              Nouveau pot
            </h3>
            <p className="text-xs mt-0.5" style={{ color: 'var(--text-muted)' }}>
              Definir l&apos;identite et les regles du nouveau pot jackpot.
            </p>
          </div>
          <button onClick={onClose} style={{ color: 'var(--text-muted)' }}>
            <X size={18} />
          </button>
        </div>

        <form onSubmit={handleSubmit} className="px-6 py-5 space-y-4">
          {err && (
            <div
              className="px-3 py-2 rounded-md text-sm flex items-center gap-2"
              style={{ background: 'var(--red, #ef4444)18', color: 'var(--red, #ef4444)', border: '1px solid var(--red, #ef4444)33' }}
            >
              <AlertTriangle size={14} /> {err}
            </div>
          )}

          {/* Identity */}
          <div>
            <label className={labelCls} style={labelStyle}>Scope</label>
            <select value={form.scope} onChange={(e) => set('scope', e.target.value)}
              className={fieldCls} style={fieldStyle}>
              <option value="GLOBAL">GLOBAL — tous jeux, tous kiosques</option>
              <option value="GAME">GAME — un jeu, tous kiosques</option>
              <option value="LOCAL">LOCAL — un jeu, un kiosque, un tier</option>
            </select>
          </div>

          {form.scope !== 'GLOBAL' && (
            <div>
              <label className={labelCls} style={labelStyle}>
                Game ID (ex : ROULETTE-TBL1, KENO-DRAW1)
              </label>
              <input
                type="text"
                value={form.game_id}
                onChange={(e) => set('game_id', e.target.value)}
                placeholder="ROULETTE-TBL1"
                className={fieldCls}
                style={fieldStyle}
              />
            </div>
          )}

          {form.scope === 'LOCAL' && (
            <>
              <div>
                <label className={labelCls} style={labelStyle}>Code kiosque (ex : 99A4)</label>
                <input
                  type="text"
                  value={form.kiosk_code}
                  onChange={(e) => set('kiosk_code', e.target.value)}
                  placeholder="99A4"
                  className={fieldCls}
                  style={fieldStyle}
                />
              </div>
              <div>
                <label className={labelCls} style={labelStyle}>Tier</label>
                <select value={form.tier} onChange={(e) => set('tier', e.target.value)}
                  className={fieldCls} style={fieldStyle}>
                  <option value="">— Choisir —</option>
                  <option value="BRONZE">BRONZE</option>
                  <option value="SILVER">SILVER</option>
                  <option value="GOLD">GOLD</option>
                </select>
              </div>
            </>
          )}

          <hr style={{ borderColor: 'var(--border-subtle)' }} />

          {/* Enabled toggle */}
          <div>
            <span className={labelCls} style={labelStyle}>Statut initial</span>
            <button
              type="button"
              onClick={() => set('enabled', !form.enabled)}
              className="flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-semibold"
              style={
                form.enabled
                  ? { background: 'var(--green, #22c55e)22', color: 'var(--green, #22c55e)', border: '1px solid var(--green, #22c55e)44' }
                  : { background: 'var(--red, #ef4444)22',   color: 'var(--red, #ef4444)',   border: '1px solid var(--red, #ef4444)44'   }
              }
            >
              {form.enabled ? <ToggleRight size={16} /> : <ToggleLeft size={16} />}
              {form.enabled ? 'Actif' : 'Inactif'}
            </button>
          </div>

          {/* Contribution mode */}
          <div>
            <label className={labelCls} style={labelStyle}>Mode de contribution</label>
            <select value={form.contribution_mode}
              onChange={(e) => set('contribution_mode', e.target.value)}
              className={fieldCls} style={fieldStyle}>
              <option value="PERCENT">PERCENT — % de la mise</option>
              <option value="FIXED">FIXED — montant fixe par ticket (XAF)</option>
            </select>
          </div>

          {form.contribution_mode === 'PERCENT' ? (
            <div>
              <label className={labelCls} style={labelStyle}>Taux (%)</label>
              <input type="number" min="0" max="100" step="0.0001"
                value={form.contribution_percent}
                onChange={(e) => set('contribution_percent', e.target.value)}
                className={fieldCls} style={fieldStyle} />
            </div>
          ) : (
            <div>
              <label className={labelCls} style={labelStyle}>Contribution fixe (XAF)</label>
              <input type="number" min="0" step="1"
                value={form.contribution_fixed}
                onChange={(e) => set('contribution_fixed', e.target.value)}
                className={fieldCls} style={fieldStyle} />
            </div>
          )}

          {/* Threshold */}
          <div>
            <div
              className="px-3 py-2 rounded-md text-xs mb-2 flex items-start gap-2"
              style={{ background: 'var(--accent, #f59e0b)12', color: 'var(--accent, #f59e0b)', border: '1px solid var(--accent, #f59e0b)33' }}
            >
              <AlertTriangle size={13} className="mt-0.5 shrink-0" />
              Seuil reel = tirage secret dans [min, max].
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className={labelCls} style={labelStyle}>Seuil min (XAF)</label>
                <input type="number" min="0" step="1"
                  value={form.threshold_min}
                  onChange={(e) => set('threshold_min', e.target.value)}
                  className={fieldCls} style={fieldStyle} />
              </div>
              <div>
                <label className={labelCls} style={labelStyle}>Seuil max (XAF)</label>
                <input type="number" min="0" step="1"
                  value={form.threshold_max}
                  onChange={(e) => set('threshold_max', e.target.value)}
                  className={fieldCls} style={fieldStyle} />
              </div>
            </div>
          </div>

          {/* Reset mode */}
          <div>
            <label className={labelCls} style={labelStyle}>Mode de reinitialisation</label>
            <select value={form.reset_mode} onChange={(e) => set('reset_mode', e.target.value)}
              className={fieldCls} style={fieldStyle}>
              <option value="ZERO">ZERO — repart de 0 XAF</option>
              <option value="SEED">SEED — repart du montant seed</option>
            </select>
          </div>

          {form.reset_mode === 'SEED' && (
            <div>
              <label className={labelCls} style={labelStyle}>Seed (XAF)</label>
              <input type="number" min="0" step="1"
                value={form.seed_amount}
                onChange={(e) => set('seed_amount', e.target.value)}
                className={fieldCls} style={fieldStyle} />
            </div>
          )}

          {/* Winner mode */}
          <div>
            <label className={labelCls} style={labelStyle}>Mode de selection du gagnant</label>
            <select value={form.winner_mode} onChange={(e) => set('winner_mode', e.target.value)}
              className={fieldCls} style={fieldStyle}>
              <option value="TRIGGER_TICKET">TRIGGER_TICKET</option>
              <option value="RANDOM_RECENT">RANDOM_RECENT</option>
            </select>
          </div>

          {form.winner_mode === 'RANDOM_RECENT' && (
            <div>
              <label className={labelCls} style={labelStyle}>Fenetre (minutes)</label>
              <input type="number" min="1" max="1440" step="1"
                value={form.recent_window_minutes}
                onChange={(e) => set('recent_window_minutes', e.target.value)}
                className={fieldCls} style={fieldStyle} />
            </div>
          )}

          {/* Max payout */}
          <div>
            <label className={labelCls} style={labelStyle}>
              Paiement max (XAF — laisser vide = sans cap)
            </label>
            <input type="number" min="0" step="1"
              value={form.max_payout}
              onChange={(e) => set('max_payout', e.target.value)}
              placeholder="Optionnel"
              className={fieldCls} style={fieldStyle} />
          </div>

          <div className="flex gap-2 pt-2 justify-end">
            <button type="button" onClick={onClose}
              className="px-4 py-2 rounded-md text-sm"
              style={{ background: 'var(--bg-elevated)', color: 'var(--text-secondary)', border: '1px solid var(--border-subtle)' }}>
              Annuler
            </button>
            <button type="submit" disabled={saving}
              className="px-5 py-2 rounded-md text-sm font-bold"
              style={{ background: 'var(--accent)', color: '#000', opacity: saving ? 0.7 : 1 }}>
              {saving ? 'Creation…' : 'Creer le pot'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Pot card — GLOBAL and GAME scopes
// ---------------------------------------------------------------------------

function PotCard({ pot, onEdit }) {
  const GameIcon = gameIcon(pot.game_id);
  const isGlobal = pot.scope === 'GLOBAL';
  const color = isGlobal ? 'var(--purple, #a855f7)' : 'var(--blue, #3b82f6)';

  return (
    <div
      className="rounded-xl p-5 transition-all"
      style={{ background: 'var(--bg-surface)', border: '1px solid var(--border-subtle)', boxShadow: 'var(--shadow-sm)' }}
    >
      <div className="flex items-start justify-between mb-3">
        <div className="flex items-center gap-2.5">
          <div
            className="flex items-center justify-center w-10 h-10 rounded-lg"
            style={{ background: `${color}22`, color }}
          >
            {isGlobal ? <Globe2 size={20} /> : <GameIcon size={20} />}
          </div>
          <div>
            <div className="text-sm font-bold" style={{ color: 'var(--text-primary)' }}>
              {isGlobal ? 'Jackpot General' : pot.game_id}
            </div>
            <div className="text-[11px]" style={{ color: 'var(--text-muted)' }}>
              {isGlobal ? 'Tous jeux · tous kiosques' : 'Tous kiosques · GAME'}
            </div>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <EnabledPill enabled={pot.enabled} />
          <button
            onClick={onEdit}
            className="p-1.5 rounded-md transition-colors"
            style={{ color: 'var(--text-muted)' }}
            title="Modifier les regles"
          >
            <Edit2 size={15} />
          </button>
        </div>
      </div>

      <div className="text-3xl font-bold tabular-nums" style={{ color }}>
        {fmt(pot.current_amount)}{' '}
        <span className="text-sm opacity-70 font-normal">XAF</span>
      </div>

      <div
        className="mt-3 grid grid-cols-2 gap-x-4 gap-y-1 text-[11px]"
        style={{ color: 'var(--text-muted)' }}
      >
        <span>
          Contribution :{' '}
          <strong style={{ color: 'var(--text-secondary)' }}>
            {contributionSummary(pot)}
          </strong>
        </span>
        <span>
          Cycle : <strong style={{ color: 'var(--text-secondary)' }}>#{pot.cycle_number}</strong>
        </span>
        <span>
          Seuil :{' '}
          <strong style={{ color: 'var(--accent, #f59e0b)' }}>
            secret dans [{fmt(pot.threshold_min)} – {fmt(pot.threshold_max)}] XAF
          </strong>
        </span>
        <span>
          Reset :{' '}
          <strong style={{ color: 'var(--text-secondary)' }}>
            {pot.reset_mode === 'SEED' ? `SEED (${fmt(pot.seed_amount)} XAF)` : 'ZERO'}
          </strong>
        </span>
        {pot.max_payout != null && (
          <span>
            Cap paiement :{' '}
            <strong style={{ color: 'var(--text-secondary)' }}>{fmt(pot.max_payout)} XAF</strong>
          </span>
        )}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// LOCAL pots table
// ---------------------------------------------------------------------------

function LocalTable({ pots, search, onEdit }) {
  // Group by (kiosk_code, game_id) → { [key]: { BRONZE, SILVER, GOLD } }
  const grouped = useMemo(() => {
    const m = {};
    for (const p of pots) {
      const key = `${p.kiosk_code || ''}|${p.game_id || ''}`;
      if (!m[key]) m[key] = { kiosk_code: p.kiosk_code, game_id: p.game_id, tiers: {} };
      if (p.tier) m[key].tiers[p.tier] = p;
    }
    return m;
  }, [pots]);

  const entries = useMemo(() => {
    const q = search.trim().toUpperCase();
    return Object.values(grouped)
      .filter((e) => !q || (e.kiosk_code || '').toUpperCase().includes(q) || (e.game_id || '').toUpperCase().includes(q))
      .sort((a, b) => {
        const kc = (a.kiosk_code || '').localeCompare(b.kiosk_code || '');
        if (kc !== 0) return kc;
        return (a.game_id || '').localeCompare(b.game_id || '');
      });
  }, [grouped, search]);

  return (
    <table className="w-full text-left">
      <thead>
        <tr style={{ borderBottom: '1px solid var(--border-subtle)' }}>
          <th className="px-4 py-3 text-[11px] font-semibold uppercase tracking-wider" style={{ color: 'var(--text-muted)' }}>Kiosque / Jeu</th>
          {['BRONZE', 'SILVER', 'GOLD'].map((t) => (
            <th key={t} className="px-4 py-3 text-[11px] font-semibold uppercase tracking-wider" style={{ color: TIER_COLORS[t] }}>
              {TIER_LABELS[t]}
            </th>
          ))}
        </tr>
      </thead>
      <tbody>
        {entries.length === 0 ? (
          <tr>
            <td colSpan="4" className="px-4 py-10 text-center text-sm italic" style={{ color: 'var(--text-muted)' }}>
              {search
                ? `Aucun kiosque ne correspond a "${search}".`
                : 'Aucun pot LOCAL. Les pots locaux sont crees automatiquement au premier ticket ou via "+ Nouveau pot".'}
            </td>
          </tr>
        ) : (
          entries.map((e) => {
            const rowKey = `${e.kiosk_code}|${e.game_id}`;
            return (
              <tr key={rowKey} style={{ borderBottom: '1px solid var(--border-subtle)' }}>
                <td className="px-4 py-3">
                  <div className="font-mono text-sm font-bold" style={{ color: 'var(--accent)' }}>
                    {e.kiosk_code || '—'}
                  </div>
                  <div className="text-[11px]" style={{ color: 'var(--text-muted)' }}>
                    {e.game_id || '—'}
                  </div>
                </td>
                {['BRONZE', 'SILVER', 'GOLD'].map((tier) => {
                  const p = e.tiers[tier];
                  const tc = TIER_COLORS[tier];
                  return (
                    <td key={tier} className="px-4 py-3">
                      {p ? (
                        <div className="flex items-center justify-between gap-2">
                          <div>
                            <div className="text-sm font-bold tabular-nums" style={{ color: tc }}>
                              {fmt(p.current_amount)}{' '}
                              <span className="text-[10px] opacity-70 font-normal">XAF</span>
                            </div>
                            <div className="text-[10px] mt-0.5" style={{ color: 'var(--text-muted)' }}>
                              {contributionSummary(p)} · cycle #{p.cycle_number}
                            </div>
                            <div className="mt-0.5">
                              <EnabledPill enabled={p.enabled} />
                            </div>
                          </div>
                          <button
                            onClick={() => onEdit(p)}
                            className="p-1 rounded-md shrink-0"
                            style={{ color: 'var(--text-muted)' }}
                            title={`Modifier ${TIER_LABELS[tier]}`}
                          >
                            <Edit2 size={12} />
                          </button>
                        </div>
                      ) : (
                        <span className="text-xs italic" style={{ color: 'var(--text-muted)' }}>—</span>
                      )}
                    </td>
                  );
                })}
              </tr>
            );
          })
        )}
      </tbody>
    </table>
  );
}

// ---------------------------------------------------------------------------
// Recent wins panel
// ---------------------------------------------------------------------------

function WinsPanel({ wins, loading }) {
  if (loading) {
    return (
      <div className="px-4 py-6 text-center text-sm" style={{ color: 'var(--text-muted)' }}>
        Chargement…
      </div>
    );
  }
  if (!wins.length) {
    return (
      <div className="px-4 py-6 text-center text-sm italic" style={{ color: 'var(--text-muted)' }}>
        Aucun gain enregistre.
      </div>
    );
  }
  return (
    <table className="w-full text-left text-sm">
      <thead>
        <tr style={{ borderBottom: '1px solid var(--border-subtle)' }}>
          {['Date', 'Ticket gagnant', 'Caissier', 'Montant', 'Cycle'].map((h) => (
            <th key={h} className="px-4 py-2 text-[11px] font-semibold uppercase tracking-wider" style={{ color: 'var(--text-muted)' }}>
              {h}
            </th>
          ))}
        </tr>
      </thead>
      <tbody>
        {wins.map((w) => (
          <tr key={w.id} style={{ borderBottom: '1px solid var(--border-subtle)' }}>
            <td className="px-4 py-2 text-xs" style={{ color: 'var(--text-muted)' }}>{fmtDate(w.paid_at)}</td>
            <td className="px-4 py-2 font-mono text-xs" style={{ color: 'var(--text-secondary)' }}>{w.winner_ticket_id}</td>
            <td className="px-4 py-2 font-mono text-xs" style={{ color: 'var(--text-secondary)' }}>{w.winner_agent_id}</td>
            <td className="px-4 py-2 font-bold tabular-nums text-xs" style={{ color: 'var(--accent)' }}>
              {fmt(w.payout_amount)} XAF
            </td>
            <td className="px-4 py-2 text-xs" style={{ color: 'var(--text-muted)' }}>#{w.cycle_number}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

// ---------------------------------------------------------------------------
// Main Jackpots page
// ---------------------------------------------------------------------------

function Jackpots() {
  const [pots, setPots]         = useState([]);
  const [wins, setWins]         = useState([]);
  const [loading, setLoading]   = useState(true);
  const [winsLoading, setWinsLoading] = useState(true);
  const [toast, setToast]       = useState({ msg: null, type: 'success' });
  const [editing, setEditing]   = useState(null);
  const [creating, setCreating] = useState(false);
  const [search, setSearch]     = useState('');
  const [showWins, setShowWins] = useState(false);

  const notify = useCallback((msg, type = 'success') => {
    setToast({ msg, type });
    setTimeout(() => setToast({ msg: null, type: 'success' }), 4000);
  }, []);

  const loadPots = useCallback(async () => {
    try {
      const data = await fetchPots();
      setPots(data);
    } catch (e) {
      notify(e.response?.data?.detail || e.message || 'Erreur de chargement des pots', 'error');
    } finally {
      setLoading(false);
    }
  }, [notify]);

  const loadWins = useCallback(async () => {
    setWinsLoading(true);
    try {
      const data = await fetchWins(30);
      setWins(data);
    } catch {
      // non-blocking
    } finally {
      setWinsLoading(false);
    }
  }, []);

  // Initial load + 5s polling for live current_amount
  useEffect(() => {
    loadPots();
    const id = setInterval(loadPots, 5000);
    return () => clearInterval(id);
  }, [loadPots]);

  // Load wins when panel is opened
  useEffect(() => {
    if (showWins) loadWins();
  }, [showWins, loadWins]);

  // Group pots by scope
  const { globalPots, gamePots, localPots } = useMemo(() => ({
    globalPots: pots.filter((p) => p.scope === 'GLOBAL'),
    gamePots:   pots.filter((p) => p.scope === 'GAME'),
    localPots:  pots.filter((p) => p.scope === 'LOCAL'),
  }), [pots]);

  const handleSaved = (updated) => {
    setPots((prev) => prev.map((p) => (p.id === updated.id ? updated : p)));
    setEditing(null);
    notify('Regles mises a jour avec succes.');
  };

  const handleCreated = (created) => {
    setPots((prev) => [...prev, created]);
    setCreating(false);
    notify('Nouveau pot cree avec succes.');
  };

  const totalPots = pots.length;
  const activePots = pots.filter((p) => p.enabled).length;

  return (
    <div className="animate-fade w-full">
      {/* Page header */}
      <div className="flex justify-between items-start mb-5 flex-wrap gap-4">
        <div>
          <h1 className="text-2xl font-bold" style={{ color: 'var(--text-primary)' }}>
            Jackpots
          </h1>
          <p className="text-sm mt-0.5" style={{ color: 'var(--text-muted)' }}>
            Editeur unifie des regles de repartition — source de verite jackpot-service.
            {!loading && (
              <span className="ml-2">
                <strong style={{ color: 'var(--text-secondary)' }}>{activePots}</strong>
                <span style={{ color: 'var(--text-muted)' }}>/{totalPots} pots actifs</span>
              </span>
            )}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={() => setShowWins((v) => !v)}
            className="flex items-center gap-2 px-4 py-2.5 rounded-lg text-sm font-medium"
            style={{ background: 'var(--bg-surface)', border: '1px solid var(--border-subtle)', color: 'var(--text-secondary)' }}
          >
            <History size={14} />
            Derniers gains
            {showWins ? <ChevronUp size={13} /> : <ChevronDown size={13} />}
          </button>
          <button
            onClick={loadPots}
            className="flex items-center gap-2 px-4 py-2.5 rounded-lg text-sm font-medium"
            style={{ background: 'var(--bg-surface)', border: '1px solid var(--border-subtle)', color: 'var(--text-secondary)' }}
          >
            <RefreshCw size={14} /> Actualiser
          </button>
          <button
            onClick={() => setCreating(true)}
            className="flex items-center gap-2 px-4 py-2.5 rounded-lg text-sm font-bold"
            style={{ background: 'var(--accent)', color: '#000' }}
          >
            <Plus size={14} /> Nouveau pot
          </button>
        </div>
      </div>

      <Toast msg={toast.msg} type={toast.type} />

      {/* Recent wins panel */}
      {showWins && (
        <div
          className="mb-6 rounded-xl overflow-hidden"
          style={{ background: 'var(--bg-surface)', border: '1px solid var(--border-subtle)' }}
        >
          <div
            className="px-4 py-3 flex items-center gap-2"
            style={{ borderBottom: '1px solid var(--border-subtle)' }}
          >
            <Trophy size={15} style={{ color: 'var(--accent)' }} />
            <h2 className="text-sm font-bold uppercase tracking-wider" style={{ color: 'var(--text-primary)' }}>
              Derniers gains (30)
            </h2>
          </div>
          <WinsPanel wins={wins} loading={winsLoading} />
        </div>
      )}

      {/* Loading state */}
      {loading && (
        <div className="py-16 text-center text-sm" style={{ color: 'var(--text-muted)' }}>
          Chargement des pots…
        </div>
      )}

      {!loading && (
        <>
          {/* GLOBAL section */}
          {globalPots.length > 0 && (
            <section className="mb-6">
              <div className="flex items-center gap-2 mb-3">
                <Globe2 size={15} style={{ color: 'var(--purple, #a855f7)' }} />
                <h2 className="text-xs font-bold uppercase tracking-wider" style={{ color: 'var(--text-muted)' }}>
                  Global — tous jeux
                </h2>
                <Badge color="var(--purple, #a855f7)">{globalPots.length}</Badge>
              </div>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                {globalPots.map((p) => (
                  <PotCard key={p.id} pot={p} onEdit={() => setEditing(p)} />
                ))}
              </div>
            </section>
          )}

          {/* GAME section */}
          {gamePots.length > 0 && (
            <section className="mb-6">
              <div className="flex items-center gap-2 mb-3">
                <Gamepad2 size={15} style={{ color: 'var(--blue, #3b82f6)' }} />
                <h2 className="text-xs font-bold uppercase tracking-wider" style={{ color: 'var(--text-muted)' }}>
                  Par jeu — tous kiosques
                </h2>
                <Badge color="var(--blue, #3b82f6)">{gamePots.length}</Badge>
              </div>
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                {gamePots.map((p) => (
                  <PotCard key={p.id} pot={p} onEdit={() => setEditing(p)} />
                ))}
              </div>
            </section>
          )}

          {/* LOCAL section */}
          <section>
            <div
              className="flex items-center justify-between gap-3 flex-wrap mb-0"
              style={{ borderBottom: '1px solid var(--border-subtle)' }}
            >
              <div
                className="flex items-center gap-3 px-4 py-3"
              >
                <MapPin size={15} style={{ color: 'var(--accent)' }} />
                <h2 className="text-xs font-bold uppercase tracking-wider" style={{ color: 'var(--text-primary)' }}>
                  Locaux — par kiosque × jeu × tier
                </h2>
                <Badge color="var(--accent)">{localPots.length} pot{localPots.length !== 1 ? 's' : ''}</Badge>
              </div>
              <div className="relative px-4 py-2">
                <Search size={13} className="absolute left-6 top-1/2 -translate-y-1/2" style={{ color: 'var(--text-muted)' }} />
                <input
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  placeholder="Filtrer kiosque ou game_id"
                  className="pl-8 pr-3 py-2 text-sm rounded-md outline-none w-56"
                  style={{ background: 'var(--bg-elevated)', border: '1px solid var(--border-subtle)', color: 'var(--text-primary)' }}
                />
              </div>
            </div>
            <div
              className="rounded-b-xl overflow-hidden"
              style={{ background: 'var(--bg-surface)', border: '1px solid var(--border-subtle)', borderTop: 'none' }}
            >
              <LocalTable pots={localPots} search={search} onEdit={(p) => setEditing(p)} />
            </div>
          </section>
        </>
      )}

      {/* Edit modal */}
      {editing && (
        <EditModal
          pot={editing}
          onClose={() => setEditing(null)}
          onSaved={handleSaved}
        />
      )}

      {/* Create modal */}
      {creating && (
        <CreateModal
          onClose={() => setCreating(false)}
          onCreated={handleCreated}
        />
      )}
    </div>
  );
}

export default Jackpots;
