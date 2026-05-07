import React from 'react';
import { Settings, Globe, Shield, Bell } from 'lucide-react';

function Parametres() {
  const cards = [
    { icon: Globe, title: 'Configuration Generale', desc: 'Nom du site, devise, langue, fuseau horaire', soon: true },
    { icon: Shield, title: 'Securite', desc: 'Cles API, rotation des secrets, logs d\'acces', soon: true },
    { icon: Bell, title: 'Notifications', desc: 'Alertes par email/SMS, seuils d\'alerte', soon: true },
    { icon: Settings, title: 'Jeux', desc: 'Limites de mise, commissions, activation/desactivation des jeux', soon: true },
  ];

  return (
    <div className="animate-fade">
      <h1 className="text-2xl font-bold font-title mb-1" style={{ color: 'var(--text-primary)' }}>Parametres</h1>
      <p className="text-sm mb-8" style={{ color: 'var(--text-muted)' }}>Configuration globale de la plateforme</p>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        {cards.map(({ icon: Icon, title, desc, soon }) => (
          <div key={title} className="rounded-xl p-5 relative overflow-hidden" style={{ background: 'var(--bg-surface)', border: '1px solid var(--border-subtle)', boxShadow: 'var(--shadow-sm)' }}>
            <div className="flex items-start gap-4">
              <div className="w-10 h-10 rounded-lg flex items-center justify-center shrink-0" style={{ background: 'var(--accent)18', color: 'var(--accent)' }}>
                <Icon size={20} />
              </div>
              <div>
                <h3 className="text-sm font-bold mb-1" style={{ color: 'var(--text-primary)' }}>{title}</h3>
                <p className="text-xs" style={{ color: 'var(--text-muted)' }}>{desc}</p>
              </div>
            </div>
            {soon && (
              <div className="absolute top-3 right-3">
                <span className="text-[9px] font-bold uppercase tracking-wider px-2 py-0.5 rounded-full" style={{ background: 'var(--accent)15', color: 'var(--accent)' }}>
                  Bientot
                </span>
              </div>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}

export default Parametres;
