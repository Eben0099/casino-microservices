import React, { useState, useEffect } from 'react';
import axios from 'axios';
import { Settings, Globe, Shield, Bell, Save, Eye, EyeOff, Copy, LogOut, CheckCircle2, AlertTriangle, Power, Clock, Wallet, Percent, Hash } from 'lucide-react';

const TABS = [
  { id: 'general',       label: 'General',       icon: Globe },
  { id: 'roulette',      label: 'Roulette',       icon: Settings },
  { id: 'keno',          label: 'Keno',           icon: Hash },
  { id: 'securite',      label: 'Securite',       icon: Shield },
  { id: 'notifications', label: 'Notifications',  icon: Bell },
];

const Toast = ({ kind, msg }) => {
  if (!msg) return null;
  const colors = { ok: 'var(--green)', err: 'var(--red)' };
  const Icon = kind === 'ok' ? CheckCircle2 : AlertTriangle;
  return (
    <div className="fixed bottom-6 right-6 px-4 py-3 rounded-lg shadow-lg flex items-center gap-2 text-sm font-medium animate-fade z-50"
      style={{ background: 'var(--bg-surface)', border: `1px solid ${colors[kind]}40`, color: colors[kind], boxShadow: 'var(--shadow-md)' }}>
      <Icon size={16} /> {msg}
    </div>
  );
};

const Field = ({ label, children, hint }) => (
  <div className="flex flex-col gap-1.5">
    <label className="text-xs font-semibold uppercase tracking-wider" style={{ color: 'var(--text-muted)' }}>{label}</label>
    {children}
    {hint && <p className="text-xs" style={{ color: 'var(--text-muted)' }}>{hint}</p>}
  </div>
);

const inputCls = "px-3.5 py-2.5 rounded-lg text-sm outline-none transition-colors";
const inputStyle = {
  background: 'var(--bg-elevated)',
  border: '1px solid var(--border-subtle)',
  color: 'var(--text-primary)',
};

const PrimaryBtn = ({ children, onClick, disabled, icon: Icon }) => (
  <button onClick={onClick} disabled={disabled}
    className="px-4 py-2.5 rounded-lg text-sm font-semibold flex items-center gap-2 transition-opacity"
    style={{ background: 'var(--accent)', color: '#000', opacity: disabled ? 0.5 : 1, cursor: disabled ? 'not-allowed' : 'pointer' }}>
    {Icon && <Icon size={15} />} {children}
  </button>
);

const SecondaryBtn = ({ children, onClick, icon: Icon }) => (
  <button onClick={onClick}
    className="px-3.5 py-2 rounded-lg text-xs font-semibold flex items-center gap-1.5 transition-colors"
    style={{ background: 'var(--bg-elevated)', border: '1px solid var(--border-subtle)', color: 'var(--text-secondary)' }}>
    {Icon && <Icon size={13} />} {children}
  </button>
);

const Card = ({ title, desc, children }) => (
  <div className="rounded-xl p-6"
    style={{ background: 'var(--bg-surface)', border: '1px solid var(--border-subtle)', boxShadow: 'var(--shadow-sm)' }}>
    <div className="mb-5">
      <h3 className="text-base font-bold" style={{ color: 'var(--text-primary)' }}>{title}</h3>
      {desc && <p className="text-xs mt-0.5" style={{ color: 'var(--text-muted)' }}>{desc}</p>}
    </div>
    {children}
  </div>
);

// ===== GENERAL TAB =====
function GeneralTab({ notify }) {
  const [siteName, setSiteName] = useState(() => localStorage.getItem('agd-site-name') || 'AGD ADMIN');
  const [currency, setCurrency] = useState(() => localStorage.getItem('agd-currency') || 'XAF');
  const [locale, setLocale] = useState(() => localStorage.getItem('agd-locale') || 'fr-FR');

  const save = () => {
    localStorage.setItem('agd-site-name', siteName);
    localStorage.setItem('agd-currency', currency);
    localStorage.setItem('agd-locale', locale);
    notify('ok', 'Preferences enregistrees');
  };

  return (
    <Card title="Configuration generale" desc="Apparence et formats d'affichage. Stocke localement dans le navigateur.">
      <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
        <Field label="Nom du site" hint="Affiche dans la sidebar et l'onglet">
          <input className={inputCls} style={inputStyle} value={siteName} onChange={e => setSiteName(e.target.value)} />
        </Field>
        <Field label="Devise" hint="Affichage des montants">
          <select className={inputCls} style={inputStyle} value={currency} onChange={e => setCurrency(e.target.value)}>
            <option value="XAF">XAF (FCFA)</option>
            <option value="EUR">EUR (Euro)</option>
            <option value="USD">USD (Dollar)</option>
            <option value="NGN">NGN (Naira)</option>
          </select>
        </Field>
        <Field label="Langue / format date" hint="Format des dates et nombres">
          <select className={inputCls} style={inputStyle} value={locale} onChange={e => setLocale(e.target.value)}>
            <option value="fr-FR">Francais (France)</option>
            <option value="fr-CM">Francais (Cameroun)</option>
            <option value="en-US">English (US)</option>
          </select>
        </Field>
      </div>
      <div className="mt-6 flex justify-end">
        <PrimaryBtn onClick={save} icon={Save}>Enregistrer</PrimaryBtn>
      </div>
    </Card>
  );
}

// ===== ROULETTE TAB =====
function RouletteTab({ notify }) {
  const adminKey = localStorage.getItem('admin_key');
  const headers = { 'x-api-key': adminKey };
  const [s, setS] = useState(null);
  const [saving, setSaving] = useState(false);

  const load = async () => {
    try {
      const r = await axios.get('/api/roulette/admin/settings', { headers });
      setS(r.data);
    } catch (err) {
      notify('err', 'Erreur de chargement des parametres');
    }
  };

  useEffect(() => { load(); }, []);

  const save = async () => {
    setSaving(true);
    try {
      const r = await axios.patch('/api/roulette/admin/settings', s, { headers });
      setS(r.data);
      notify('ok', 'Parametres roulette mis a jour. Effet au prochain tour.');
    } catch (err) {
      notify('err', err.response?.data?.detail || 'Erreur de sauvegarde');
    } finally {
      setSaving(false);
    }
  };

  if (!s) return <Card title="Roulette"><p className="text-sm" style={{ color: 'var(--text-muted)' }}>Chargement...</p></Card>;

  const Update = (k) => (e) => setS({ ...s, [k]: e.target.value === '' ? '' : Number(e.target.value) });

  return (
    <div className="space-y-4">
      <Card title="Etat du jeu" desc="Activation/desactivation rapide de la roulette">
        <div className="flex items-center justify-between p-4 rounded-lg" style={{ background: 'var(--bg-elevated)' }}>
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-full flex items-center justify-center"
              style={{ background: s.enabled ? 'var(--green)20' : 'var(--red)20', color: s.enabled ? 'var(--green)' : 'var(--red)' }}>
              <Power size={18} />
            </div>
            <div>
              <p className="text-sm font-semibold" style={{ color: 'var(--text-primary)' }}>
                {s.enabled ? 'Roulette active' : 'Roulette en maintenance'}
              </p>
              <p className="text-xs" style={{ color: 'var(--text-muted)' }}>
                {s.enabled ? 'Les agents peuvent prendre des paris' : 'Les paris sont bloques, le moteur attend la reactivation'}
              </p>
            </div>
          </div>
          <button onClick={() => setS({ ...s, enabled: !s.enabled })}
            className="relative w-14 h-7 rounded-full transition-colors"
            style={{ background: s.enabled ? 'var(--green)' : 'var(--border-strong)' }}>
            <div className="absolute top-0.5 w-6 h-6 rounded-full bg-white transition-transform"
              style={{ transform: s.enabled ? 'translateX(28px)' : 'translateX(2px)' }} />
          </button>
        </div>
      </Card>

      <Card title="Durees des phases" desc="Controle du rythme du jeu (en secondes). Effet au prochain tour.">
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          {[
            ['betting_duration', 'Mise', '5-300'],
            ['bets_closing_duration', 'Fermeture', '1-30'],
            ['spinning_duration', 'Tirage', '3-60'],
            ['result_duration', 'Resultat', '1-30'],
          ].map(([k, label, range]) => (
            <Field key={k} label={label} hint={`${range}s`}>
              <div className="relative">
                <Clock size={14} className="absolute left-3 top-1/2 -translate-y-1/2" style={{ color: 'var(--text-muted)' }} />
                <input type="number" className={`${inputCls} pl-9 w-full`} style={inputStyle}
                  value={s[k]} onChange={Update(k)} />
              </div>
            </Field>
          ))}
        </div>
      </Card>

      <Card title="Limites de mise" desc="Plage autorisee par pari individuel (en XAF)">
        <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
          <Field label="Mise minimum" hint="Montant minimum par ligne de pari">
            <div className="relative">
              <Wallet size={14} className="absolute left-3 top-1/2 -translate-y-1/2" style={{ color: 'var(--text-muted)' }} />
              <input type="number" className={`${inputCls} pl-9 w-full`} style={inputStyle}
                value={s.min_stake} onChange={Update('min_stake')} />
            </div>
          </Field>
          <Field label="Mise maximum" hint="Plafond pour limiter l'exposition">
            <div className="relative">
              <Wallet size={14} className="absolute left-3 top-1/2 -translate-y-1/2" style={{ color: 'var(--text-muted)' }} />
              <input type="number" className={`${inputCls} pl-9 w-full`} style={inputStyle}
                value={s.max_stake} onChange={Update('max_stake')} />
            </div>
          </Field>
        </div>
      </Card>

      <Card title="Commission" desc="Marge maison theorique (informative, n'affecte pas les payouts europeens)">
        <Field label="Commission" hint="0 a 50%">
          <div className="relative max-w-xs">
            <Percent size={14} className="absolute left-3 top-1/2 -translate-y-1/2" style={{ color: 'var(--text-muted)' }} />
            <input type="number" step="0.1" className={`${inputCls} pl-9 w-full`} style={inputStyle}
              value={s.commission_pct} onChange={Update('commission_pct')} />
          </div>
        </Field>
      </Card>

      <div className="flex justify-end gap-2">
        <SecondaryBtn onClick={load}>Annuler</SecondaryBtn>
        <PrimaryBtn onClick={save} disabled={saving} icon={Save}>{saving ? 'Sauvegarde...' : 'Enregistrer'}</PrimaryBtn>
      </div>
    </div>
  );
}

// ===== KENO TAB =====
function KenoTab({ notify }) {
  const adminKey = localStorage.getItem('admin_key');
  const headers = { 'x-api-key': adminKey };
  const [s, setS] = useState(null);
  const [saving, setSaving] = useState(false);

  const load = async () => {
    try {
      const r = await axios.get('/api/keno/admin/settings', { headers });
      setS(r.data);
    } catch (err) {
      notify('err', 'Erreur de chargement des parametres Keno');
    }
  };

  useEffect(() => { load(); }, []);

  const save = async () => {
    setSaving(true);
    try {
      const r = await axios.patch('/api/keno/admin/settings', s, { headers });
      setS(r.data);
      notify('ok', 'Parametres Keno mis a jour. Effet au prochain tour.');
    } catch (err) {
      notify('err', err.response?.data?.detail || 'Erreur de sauvegarde');
    } finally {
      setSaving(false);
    }
  };

  if (!s) return <Card title="Keno"><p className="text-sm" style={{ color: 'var(--text-muted)' }}>Chargement...</p></Card>;

  const Update = (k) => (e) => setS({ ...s, [k]: e.target.value === '' ? '' : Number(e.target.value) });
  const UpdateBool = (k) => () => setS({ ...s, [k]: !s[k] });

  return (
    <div className="space-y-4">
      <Card title="Etat du jeu" desc="Activation/desactivation rapide du moteur Keno (VOLKENO)">
        <div className="flex items-center justify-between p-4 rounded-lg" style={{ background: 'var(--bg-elevated)' }}>
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-full flex items-center justify-center"
              style={{ background: s.enabled ? 'var(--green)20' : 'var(--red)20', color: s.enabled ? 'var(--green)' : 'var(--red)' }}>
              <Power size={18} />
            </div>
            <div>
              <p className="text-sm font-semibold" style={{ color: 'var(--text-primary)' }}>
                {s.enabled ? 'Keno actif' : 'Keno en maintenance'}
              </p>
              <p className="text-xs" style={{ color: 'var(--text-muted)' }}>
                {s.enabled ? 'Les agents peuvent prendre des tickets Keno' : 'Les tickets sont bloques, le moteur attend la reactivation'}
              </p>
            </div>
          </div>
          <button onClick={UpdateBool('enabled')}
            className="relative w-14 h-7 rounded-full transition-colors"
            style={{ background: s.enabled ? 'var(--green)' : 'var(--border-strong)' }}>
            <div className="absolute top-0.5 w-6 h-6 rounded-full bg-white transition-transform"
              style={{ transform: s.enabled ? 'translateX(28px)' : 'translateX(2px)' }} />
          </button>
        </div>
      </Card>

      <Card title="Durees des phases" desc="Rythme du jeu (en secondes). Effet au prochain tour. Idle = fenetre de mises.">
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          {[
            ['idle_duration',       'Mises (idle)',    '5-300'],
            ['prelaunch_duration',  'Pre-lancement',   '1-30'],
            ['draw_duration',       'Tirage',          '10-120'],
            ['results_duration',    'Resultats',       '1-60'],
          ].map(([k, label, range]) => (
            <Field key={k} label={label} hint={`${range}s`}>
              <div className="relative">
                <Clock size={14} className="absolute left-3 top-1/2 -translate-y-1/2" style={{ color: 'var(--text-muted)' }} />
                <input type="number" className={`${inputCls} pl-9 w-full`} style={inputStyle}
                  value={s[k]} onChange={Update(k)} />
              </div>
            </Field>
          ))}
        </div>
      </Card>

      <Card title="Limites de mise" desc="Plage autorisee par ticket Keno individuel (en XAF)">
        <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
          <Field label="Mise minimum" hint="Montant minimum par ticket">
            <div className="relative">
              <Wallet size={14} className="absolute left-3 top-1/2 -translate-y-1/2" style={{ color: 'var(--text-muted)' }} />
              <input type="number" className={`${inputCls} pl-9 w-full`} style={inputStyle}
                value={s.min_stake} onChange={Update('min_stake')} />
            </div>
          </Field>
          <Field label="Mise maximum" hint="Plafond pour limiter l'exposition">
            <div className="relative">
              <Wallet size={14} className="absolute left-3 top-1/2 -translate-y-1/2" style={{ color: 'var(--text-muted)' }} />
              <input type="number" className={`${inputCls} pl-9 w-full`} style={inputStyle}
                value={s.max_stake} onChange={Update('max_stake')} />
            </div>
          </Field>
        </div>
      </Card>

      <Card title="Spots par defaut" desc="Nombre de numeros pre-selectionnes a l'ouverture de la grille (1-10)">
        <Field label="Spots par defaut" hint="1 a 10 numeros">
          <div className="relative max-w-xs">
            <Hash size={14} className="absolute left-3 top-1/2 -translate-y-1/2" style={{ color: 'var(--text-muted)' }} />
            <input type="number" min="1" max="10" className={`${inputCls} pl-9 w-full`} style={inputStyle}
              value={s.default_spots} onChange={Update('default_spots')} />
          </div>
        </Field>
      </Card>

      <Card title="Commission" desc="Marge maison (informative — n'affecte pas la table des gains Keno)">
        <Field label="Commission" hint="0 a 50%">
          <div className="relative max-w-xs">
            <Percent size={14} className="absolute left-3 top-1/2 -translate-y-1/2" style={{ color: 'var(--text-muted)' }} />
            <input type="number" step="0.1" className={`${inputCls} pl-9 w-full`} style={inputStyle}
              value={s.commission_pct} onChange={Update('commission_pct')} />
          </div>
        </Field>
      </Card>

      <div className="flex justify-end gap-2">
        <SecondaryBtn onClick={load}>Annuler</SecondaryBtn>
        <PrimaryBtn onClick={save} disabled={saving} icon={Save}>{saving ? 'Sauvegarde...' : 'Enregistrer'}</PrimaryBtn>
      </div>
    </div>
  );
}

// ===== SECURITE TAB =====
function SecuriteTab({ notify }) {
  const [show, setShow] = useState(false);
  const adminKey = localStorage.getItem('admin_key') || '';
  const masked = adminKey ? `${'•'.repeat(Math.max(0, adminKey.length - 4))}${adminKey.slice(-4)}` : '';

  const copy = () => {
    navigator.clipboard.writeText(adminKey);
    notify('ok', 'Cle copiee dans le presse-papier');
  };

  const change = () => {
    if (!confirm('Etes-vous sur de vouloir changer la cle administrateur ? Vous serez deconnecte.')) return;
    localStorage.removeItem('admin_key');
    location.href = '/login';
  };

  return (
    <div className="space-y-4">
      <Card title="Cle API administrateur" desc="Cle utilisee pour authentifier toutes les requetes admin. Sensible.">
        <Field label="Cle actuelle">
          <div className="flex gap-2">
            <input className={`${inputCls} flex-1 font-mono`} style={inputStyle}
              type={show ? 'text' : 'password'} value={adminKey} readOnly />
            <button onClick={() => setShow(s => !s)}
              className="px-3 rounded-lg" style={{ background: 'var(--bg-elevated)', border: '1px solid var(--border-subtle)', color: 'var(--text-secondary)' }}>
              {show ? <EyeOff size={15} /> : <Eye size={15} />}
            </button>
            <SecondaryBtn onClick={copy} icon={Copy}>Copier</SecondaryBtn>
          </div>
        </Field>
        <p className="text-xs mt-3" style={{ color: 'var(--text-muted)' }}>
          Cle masquee : <span className="font-mono">{masked || '—'}</span>
        </p>
      </Card>

      <Card title="Session" desc="Deconnexion ou changement d'identite">
        <div className="flex gap-3">
          <button onClick={change}
            className="px-4 py-2.5 rounded-lg text-sm font-semibold flex items-center gap-2"
            style={{ background: 'var(--red)15', color: 'var(--red)', border: '1px solid var(--red)40' }}>
            <LogOut size={15} /> Changer de cle / Deconnexion
          </button>
        </div>
      </Card>

      <Card title="Bonnes pratiques" desc="Recommandations pour la securite de la cle">
        <ul className="text-sm space-y-2" style={{ color: 'var(--text-secondary)' }}>
          <li className="flex gap-2"><span style={{ color: 'var(--accent)' }}>•</span> Ne partagez jamais cette cle via email, Slack ou git.</li>
          <li className="flex gap-2"><span style={{ color: 'var(--accent)' }}>•</span> Effectuez une rotation tous les 90 jours minimum.</li>
          <li className="flex gap-2"><span style={{ color: 'var(--accent)' }}>•</span> En production, utilisez des secrets ECS / Secrets Manager.</li>
          <li className="flex gap-2"><span style={{ color: 'var(--accent)' }}>•</span> En cas de compromission suspectee, regenerez immediatement via les variables d'environnement du backend.</li>
        </ul>
      </Card>
    </div>
  );
}

// ===== NOTIFICATIONS TAB =====
function NotificationsTab() {
  return (
    <Card title="Notifications" desc="Alertes operationnelles par email/SMS, seuils d'alerte et webhooks">
      <div className="text-center py-12">
        <Bell size={36} style={{ color: 'var(--text-muted)' }} className="mx-auto mb-3 opacity-50" />
        <p className="text-sm font-semibold mb-1" style={{ color: 'var(--text-primary)' }}>Bientot disponible</p>
        <p className="text-xs max-w-md mx-auto" style={{ color: 'var(--text-muted)' }}>
          Configuration des alertes par email/SMS, seuils sur le solde global, notifications de fraude et de perte. Necessite l'integration d'un fournisseur d'envoi (Twilio, SendGrid).
        </p>
      </div>
    </Card>
  );
}

// ===== MAIN =====
function Parametres() {
  const [tab, setTab] = useState('general');
  const [toast, setToast] = useState({ kind: '', msg: '' });

  const notify = (kind, msg) => {
    setToast({ kind, msg });
    setTimeout(() => setToast({ kind: '', msg: '' }), 3500);
  };

  return (
    <div className="animate-fade w-full">
      <h1 className="text-2xl font-bold mb-1" style={{ color: 'var(--text-primary)' }}>Paramètres</h1>
      <p className="text-sm mb-6" style={{ color: 'var(--text-muted)' }}>Configuration globale de la plateforme</p>

      <div className="flex gap-1 mb-5 overflow-x-auto" style={{ borderBottom: '1px solid var(--border-subtle)' }}>
        {TABS.map(({ id, label, icon: Icon }) => {
          const active = tab === id;
          return (
            <button key={id} onClick={() => setTab(id)}
              className="flex items-center gap-2 px-4 py-2.5 text-sm font-medium transition-colors relative"
              style={{
                color: active ? 'var(--accent)' : 'var(--text-secondary)',
              }}>
              <Icon size={15} /> {label}
              {active && <div className="absolute bottom-0 left-0 right-0 h-0.5" style={{ background: 'var(--accent)' }} />}
            </button>
          );
        })}
      </div>

      {tab === 'general'       && <GeneralTab notify={notify} />}
      {tab === 'roulette'      && <RouletteTab notify={notify} />}
      {tab === 'keno'          && <KenoTab notify={notify} />}
      {tab === 'securite'      && <SecuriteTab notify={notify} />}
      {tab === 'notifications' && <NotificationsTab />}

      <Toast {...toast} />
    </div>
  );
}

export default Parametres;
