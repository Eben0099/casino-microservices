import React, { useState, useEffect, useCallback } from 'react';
import { Plus, X, Ban, CheckCircle, Wallet, Eye, RefreshCw } from 'lucide-react';
import axios from 'axios';
import LiveIndicator from '../components/LiveIndicator';
import { useAdminWs, useDebouncedTick } from '../hooks/useAdminWs';

function Agents() {
  const adminKey = localStorage.getItem('admin_key');
  const config = { headers: { 'x-api-key': adminKey } };

  const [agents, setAgents] = useState([]);
  const [loading, setLoading] = useState(true);
  const { connected, tick, lastEvent } = useAdminWs();
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [showDetailModal, setShowDetailModal] = useState(false);
  const [showProvisionModal, setShowProvisionModal] = useState(false);
  const [selectedAgent, setSelectedAgent] = useState(null);
  const [agentDetail, setAgentDetail] = useState(null);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');
  const [form, setForm] = useState({ phone: '', display_name: '', password: '', kiosk_name: '', kiosk_location: '' });
  const [provisionForm, setProvisionForm] = useState({ amount: '', description: '' });

  const fetchAgents = useCallback(async () => {
    try {
      const res = await axios.get('/api/agents', config);
      setAgents(res.data);
    } catch (err) { console.error(err); }
    finally { setLoading(false); }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [adminKey]);

  useEffect(() => { fetchAgents(); }, [fetchAgents]);

  // Refresh on admin events (balances change after each ticket sale / payout)
  useDebouncedTick(tick, fetchAgents, 2500);

  // Polling fallback
  useEffect(() => {
    if (connected) return;
    const id = setInterval(fetchAgents, 5000);
    return () => clearInterval(id);
  }, [connected, fetchAgents]);

  const handleCreate = async (e) => {
    e.preventDefault(); setError('');
    try {
      await axios.post('/api/agents/register', { phone: form.phone, display_name: form.display_name, password: form.password, kiosk_name: form.kiosk_name || null, kiosk_location: form.kiosk_location || null, role: 'AGENT' }, config);
      setShowCreateModal(false);
      setForm({ phone: '', display_name: '', password: '', kiosk_name: '', kiosk_location: '' });
      setSuccess('Caissier cree avec succes'); setTimeout(() => setSuccess(''), 3000);
      fetchAgents();
    } catch (err) { setError(err.response?.data?.detail || 'Erreur lors de la creation'); }
  };

  const openDetail = async (agent) => {
    try { const res = await axios.get(`/api/agents/admin/${agent.id}`, config); setAgentDetail(res.data); }
    catch { setAgentDetail({ agent, caisse: { balance: 'N/A' } }); }
    setSelectedAgent(agent); setShowDetailModal(true);
  };

  const toggleSuspend = async (agent) => {
    try {
      await axios.patch(`/api/agents/admin/${agent.id}`, { is_suspended: !agent.is_suspended }, config);
      setSuccess(agent.is_suspended ? 'Agent reactive' : 'Agent suspendu'); setTimeout(() => setSuccess(''), 3000);
      fetchAgents(); setShowDetailModal(false);
    } catch (err) { setError(err.response?.data?.detail || 'Erreur'); setTimeout(() => setError(''), 3000); }
  };

  const openProvision = (agent) => { setSelectedAgent(agent); setProvisionForm({ amount: '', description: '' }); setShowProvisionModal(true); };

  const regenerateKioskCode = async (agent) => {
    if (!window.confirm(`Regenerer le code du kiosque pour ${agent.display_name} ?\n\nL'ancien code (${agent.kiosk_code || '-'}) sera invalide. Pensez a mettre a jour la configuration Unity.`)) return;
    try {
      const res = await axios.post(`/api/agents/admin/${agent.id}/regenerate-code`, {}, config);
      setSuccess(`Nouveau code : ${res.data.kiosk_code}`); setTimeout(() => setSuccess(''), 4000);
      fetchAgents();
      if (selectedAgent?.id === agent.id) setSelectedAgent({ ...selectedAgent, kiosk_code: res.data.kiosk_code });
    } catch (err) {
      setError(err.response?.data?.detail || 'Erreur lors de la regeneration du code');
      setTimeout(() => setError(''), 3000);
    }
  };

  const handleProvision = async (e) => {
    e.preventDefault(); setError('');
    try {
      await axios.post(`/api/agents/${selectedAgent.id}/provision`, { amount: parseInt(provisionForm.amount), description: provisionForm.description || 'Provision caisse backoffice' }, config);
      setShowProvisionModal(false);
      setSuccess(`Provision de ${provisionForm.amount} XAF effectuee`); setTimeout(() => setSuccess(''), 3000);
      fetchAgents();
    } catch (err) { setError(err.response?.data?.detail || 'Erreur lors de la provision'); }
  };

  const roleBadge = (role) => {
    const s = { ADMIN: ['var(--purple)', 'Admin'], SUPER_AGENT: ['var(--blue)', 'Super Agent'], AGENT: ['var(--green)', 'Caissier'] };
    const [c, l] = s[role] || s.AGENT;
    return <span className="text-[10px] font-semibold px-2 py-0.5 rounded-full uppercase" style={{ background: `${c}15`, color: c }}>{l}</span>;
  };

  const statusBadge = (suspended) => (
    <span className="text-[10px] font-semibold px-2 py-0.5 rounded-full uppercase" style={{ background: suspended ? 'var(--red, #ef4444)15' : 'var(--green)15', color: suspended ? 'var(--red)' : 'var(--green)' }}>
      {suspended ? 'Suspendu' : 'Actif'}
    </span>
  );

  const inputStyle = { background: 'var(--bg-base)', border: '1px solid var(--border-subtle)', color: 'var(--text-primary)' };

  return (
    <div className="animate-fade w-full">
      {success && <div className="mb-4 px-4 py-3 rounded-lg text-sm font-medium" style={{ background: 'var(--green)15', color: 'var(--green)', border: '1px solid var(--green)30' }}>{success}</div>}
      {error && !showCreateModal && !showProvisionModal && <div className="mb-4 px-4 py-3 rounded-lg text-sm font-medium" style={{ background: 'var(--red)15', color: 'var(--red)', border: '1px solid var(--red)30' }}>{error}</div>}

      <div className="flex justify-between items-center mb-6">
        <div>
          <h1 className="text-2xl font-bold" style={{ color: 'var(--text-primary)' }}>Caissiers</h1>
          <p className="text-sm" style={{ color: 'var(--text-muted)' }}>Gerez vos agents et leurs habilitations</p>
        </div>
        <div className="flex items-center gap-3">
          <LiveIndicator connected={connected} lastEventType={lastEvent?.type} />
          <button onClick={() => { setShowCreateModal(true); setError(''); }}
            className="flex items-center gap-2 px-4 py-2.5 rounded-lg text-sm font-bold transition-all hover:-translate-y-0.5"
            style={{ background: 'var(--accent)', color: '#000' }}>
            <Plus size={16} /> Nouveau Caissier
          </button>
        </div>
      </div>

      {/* Table */}
      <div className="rounded-xl overflow-hidden" style={{ background: 'var(--bg-surface)', border: '1px solid var(--border-subtle)', boxShadow: 'var(--shadow-sm)' }}>
        <table className="w-full text-left">
          <thead>
            <tr style={{ borderBottom: '1px solid var(--border-subtle)' }}>
              {['Nom', 'Telephone', 'Role', 'Kiosque', 'Code', 'Statut', 'Actions'].map(h => (
                <th key={h} className="px-6 py-3 text-xs font-semibold uppercase tracking-wider" style={{ color: 'var(--text-muted)' }}>{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <tr><td colSpan="7" className="px-6 py-10 text-center text-sm" style={{ color: 'var(--text-muted)' }}>Chargement...</td></tr>
            ) : agents.length === 0 ? (
              <tr><td colSpan="7" className="px-6 py-10 text-center text-sm" style={{ color: 'var(--text-muted)' }}>Aucun agent enregistre.</td></tr>
            ) : agents.map(agent => (
              <tr key={agent.id} className="transition-colors" style={{ borderBottom: '1px solid var(--border-subtle)' }}
                onMouseEnter={e => e.currentTarget.style.background = 'var(--bg-elevated)'}
                onMouseLeave={e => e.currentTarget.style.background = 'transparent'}>
                <td className="px-6 py-4">
                  <div className="flex items-center gap-3">
                    <div className="w-8 h-8 rounded-lg flex items-center justify-center text-xs font-bold" style={{ background: 'var(--accent)', color: '#000' }}>
                      {agent.display_name?.split(' ').map(w => w[0]).join('').slice(0, 2).toUpperCase()}
                    </div>
                    <span className="text-sm font-semibold" style={{ color: 'var(--text-primary)' }}>{agent.display_name}</span>
                  </div>
                </td>
                <td className="px-6 py-4 text-sm" style={{ color: 'var(--text-secondary)' }}>{agent.phone}</td>
                <td className="px-6 py-4">{roleBadge(agent.role)}</td>
                <td className="px-6 py-4 text-sm" style={{ color: 'var(--text-secondary)' }}>{agent.kiosk_name || '-'}</td>
                <td className="px-6 py-4">
                  {agent.kiosk_code ? (
                    <span className="text-xs font-mono font-bold px-2.5 py-1 rounded tracking-widest"
                      style={{ background: 'var(--bg-elevated)', color: 'var(--accent)', border: '1px solid var(--border-subtle)' }}>
                      {agent.kiosk_code}
                    </span>
                  ) : <span className="text-xs" style={{ color: 'var(--text-muted)' }}>-</span>}
                </td>
                <td className="px-6 py-4">{statusBadge(agent.is_suspended)}</td>
                <td className="px-6 py-4">
                  <div className="flex items-center gap-1.5">
                    <button onClick={() => openDetail(agent)} className="p-1.5 rounded-md transition-colors" style={{ color: 'var(--text-muted)' }} title="Details"><Eye size={15} /></button>
                    <button onClick={() => openProvision(agent)} className="p-1.5 rounded-md transition-colors" style={{ color: 'var(--green)' }} title="Provision"><Wallet size={15} /></button>
                    <button onClick={() => toggleSuspend(agent)} className="p-1.5 rounded-md transition-colors" style={{ color: agent.is_suspended ? 'var(--green)' : 'var(--red)' }}
                      title={agent.is_suspended ? 'Reactiver' : 'Suspendre'}>
                      {agent.is_suspended ? <CheckCircle size={15} /> : <Ban size={15} />}
                    </button>
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* Create Modal */}
      {showCreateModal && (
        <div className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto p-4" style={{ background: 'rgba(0,0,0,0.4)' }}>
          <div className="rounded-xl p-6 w-full max-w-lg" style={{ background: 'var(--bg-surface)', border: '1px solid var(--border-subtle)', boxShadow: 'var(--shadow-md)' }}>
            <div className="flex justify-between items-center mb-5">
              <h3 className="text-lg font-bold font-title" style={{ color: 'var(--text-primary)' }}>Nouveau Caissier</h3>
              <button onClick={() => setShowCreateModal(false)} style={{ color: 'var(--text-muted)' }}><X size={18} /></button>
            </div>
            {error && <div className="mb-4 px-3 py-2 rounded-lg text-sm" style={{ background: 'var(--red)15', color: 'var(--red)' }}>{error}</div>}
            <form onSubmit={handleCreate} className="space-y-4">
              <div>
                <label className="block text-xs font-semibold uppercase tracking-wider mb-1.5" style={{ color: 'var(--text-muted)' }}>Nom complet *</label>
                <input type="text" required value={form.display_name} onChange={e => setForm({ ...form, display_name: e.target.value })}
                  className="w-full px-3 py-2.5 rounded-lg text-sm" style={inputStyle} placeholder="Ex: Jean Dupont" />
              </div>
              <div>
                <label className="block text-xs font-semibold uppercase tracking-wider mb-1.5" style={{ color: 'var(--text-muted)' }}>Telephone *</label>
                <input type="text" required value={form.phone} onChange={e => setForm({ ...form, phone: e.target.value })}
                  className="w-full px-3 py-2.5 rounded-lg text-sm" style={inputStyle} placeholder="+237 6XX XXX XXX" />
              </div>
              <div>
                <label className="block text-xs font-semibold uppercase tracking-wider mb-1.5" style={{ color: 'var(--text-muted)' }}>Mot de passe *</label>
                <input type="password" required value={form.password} onChange={e => setForm({ ...form, password: e.target.value })}
                  className="w-full px-3 py-2.5 rounded-lg text-sm" style={inputStyle} placeholder="Min. 6 caracteres" />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-semibold uppercase tracking-wider mb-1.5" style={{ color: 'var(--text-muted)' }}>Kiosque</label>
                  <input type="text" value={form.kiosk_name} onChange={e => setForm({ ...form, kiosk_name: e.target.value })}
                    className="w-full px-3 py-2.5 rounded-lg text-sm" style={inputStyle} placeholder="Kiosque A" />
                </div>
                <div>
                  <label className="block text-xs font-semibold uppercase tracking-wider mb-1.5" style={{ color: 'var(--text-muted)' }}>Localisation</label>
                  <input type="text" value={form.kiosk_location} onChange={e => setForm({ ...form, kiosk_location: e.target.value })}
                    className="w-full px-3 py-2.5 rounded-lg text-sm" style={inputStyle} placeholder="Douala, Akwa" />
                </div>
              </div>
              <button type="submit" className="w-full py-3 rounded-lg text-sm font-bold transition-all hover:-translate-y-0.5" style={{ background: 'var(--accent)', color: '#000' }}>
                Creer le caissier
              </button>
            </form>
          </div>
        </div>
      )}

      {/* Detail Modal */}
      {showDetailModal && selectedAgent && (
        <div className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto p-4" style={{ background: 'rgba(0,0,0,0.4)' }}>
          <div className="rounded-xl p-6 w-full max-w-lg" style={{ background: 'var(--bg-surface)', border: '1px solid var(--border-subtle)', boxShadow: 'var(--shadow-md)' }}>
            <div className="flex justify-between items-center mb-5">
              <h3 className="text-lg font-bold font-title" style={{ color: 'var(--text-primary)' }}>Detail Agent</h3>
              <button onClick={() => setShowDetailModal(false)} style={{ color: 'var(--text-muted)' }}><X size={18} /></button>
            </div>
            <div className="flex items-center gap-4 mb-5">
              <div className="w-14 h-14 rounded-xl flex items-center justify-center text-lg font-bold" style={{ background: 'var(--accent)', color: '#000' }}>
                {selectedAgent.display_name?.split(' ').map(w => w[0]).join('').slice(0, 2).toUpperCase()}
              </div>
              <div>
                <p className="font-bold text-lg" style={{ color: 'var(--text-primary)' }}>{selectedAgent.display_name}</p>
                <p className="text-sm" style={{ color: 'var(--text-muted)' }}>{selectedAgent.phone}</p>
              </div>
            </div>
            <div className="grid grid-cols-2 gap-3 mb-4">
              {[
                ['Role', selectedAgent.role],
                ['Solde', agentDetail?.caisse?.balance !== 'N/A' ? `${(agentDetail?.caisse?.balance || 0).toLocaleString()} XAF` : 'N/A'],
                ['Kiosque', selectedAgent.kiosk_name || '-'],
                ['Statut', selectedAgent.is_suspended ? 'Suspendu' : 'Actif']
              ].map(([l, v]) => (
                <div key={l} className="p-3 rounded-lg" style={{ background: 'var(--bg-base)', border: '1px solid var(--border-subtle)' }}>
                  <p className="text-[10px] font-semibold uppercase tracking-wider mb-0.5" style={{ color: 'var(--text-muted)' }}>{l}</p>
                  <p className="text-sm font-semibold" style={{ color: 'var(--text-primary)' }}>{v}</p>
                </div>
              ))}
            </div>

            {/* Kiosk code panel */}
            <div className="p-3 rounded-lg mb-5 flex items-center justify-between"
              style={{ background: 'var(--bg-base)', border: '1px solid var(--border-subtle)' }}>
              <div>
                <p className="text-[10px] font-semibold uppercase tracking-wider mb-1" style={{ color: 'var(--text-muted)' }}>Code Kiosque (Unity)</p>
                <span className="text-base font-mono font-bold px-3 py-1 rounded tracking-widest"
                  style={{ background: 'var(--bg-elevated)', color: 'var(--accent)', border: '1px solid var(--border-subtle)' }}>
                  {selectedAgent.kiosk_code || '-'}
                </span>
              </div>
              <button onClick={() => regenerateKioskCode(selectedAgent)}
                className="flex items-center gap-1.5 px-3 py-2 rounded-lg text-xs font-semibold transition-colors"
                style={{ background: 'var(--bg-elevated)', color: 'var(--text-secondary)', border: '1px solid var(--border-subtle)' }}
                title="Generer un nouveau code (invalide l'ancien)">
                <RefreshCw size={13} /> Regenerer
              </button>
            </div>
            <div className="flex gap-3">
              <button onClick={() => { setShowDetailModal(false); openProvision(selectedAgent); }}
                className="flex-1 py-2.5 rounded-lg text-sm font-semibold flex items-center justify-center gap-2" style={{ background: 'var(--green)15', color: 'var(--green)' }}>
                <Wallet size={16} /> Provisionner
              </button>
              <button onClick={() => toggleSuspend(selectedAgent)}
                className="flex-1 py-2.5 rounded-lg text-sm font-semibold flex items-center justify-center gap-2"
                style={{ background: selectedAgent.is_suspended ? 'var(--green)15' : 'var(--red)15', color: selectedAgent.is_suspended ? 'var(--green)' : 'var(--red)' }}>
                {selectedAgent.is_suspended ? <><CheckCircle size={16} /> Reactiver</> : <><Ban size={16} /> Suspendre</>}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Provision Modal */}
      {showProvisionModal && selectedAgent && (
        <div className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto p-4" style={{ background: 'rgba(0,0,0,0.4)' }}>
          <div className="rounded-xl p-6 w-full max-w-md" style={{ background: 'var(--bg-surface)', border: '1px solid var(--border-subtle)', boxShadow: 'var(--shadow-md)' }}>
            <div className="flex justify-between items-center mb-5">
              <h3 className="text-lg font-bold font-title" style={{ color: 'var(--text-primary)' }}>Provision Caisse</h3>
              <button onClick={() => setShowProvisionModal(false)} style={{ color: 'var(--text-muted)' }}><X size={18} /></button>
            </div>
            <p className="text-sm mb-4" style={{ color: 'var(--text-muted)' }}>Agent : <span className="font-semibold" style={{ color: 'var(--text-primary)' }}>{selectedAgent.display_name}</span></p>
            {error && <div className="mb-4 px-3 py-2 rounded-lg text-sm" style={{ background: 'var(--red)15', color: 'var(--red)' }}>{error}</div>}
            <form onSubmit={handleProvision} className="space-y-4">
              <div>
                <label className="block text-xs font-semibold uppercase tracking-wider mb-1.5" style={{ color: 'var(--text-muted)' }}>Montant (XAF) *</label>
                <input type="number" required value={provisionForm.amount} onChange={e => setProvisionForm({ ...provisionForm, amount: e.target.value })}
                  className="w-full px-3 py-2.5 rounded-lg text-sm" style={inputStyle} placeholder="Positif = depot, Negatif = retrait" />
              </div>
              <div>
                <label className="block text-xs font-semibold uppercase tracking-wider mb-1.5" style={{ color: 'var(--text-muted)' }}>Description</label>
                <input type="text" value={provisionForm.description} onChange={e => setProvisionForm({ ...provisionForm, description: e.target.value })}
                  className="w-full px-3 py-2.5 rounded-lg text-sm" style={inputStyle} placeholder="Ex: Depot du matin" />
              </div>
              <div className="flex gap-3">
                <button type="submit" className="flex-1 py-2.5 rounded-lg text-sm font-bold" style={{ background: 'var(--accent)', color: '#000' }}>Valider</button>
                <button type="button" onClick={() => setShowProvisionModal(false)} className="flex-1 py-2.5 rounded-lg text-sm font-semibold" style={{ background: 'var(--bg-base)', color: 'var(--text-secondary)', border: '1px solid var(--border-subtle)' }}>Annuler</button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}

export default Agents;
