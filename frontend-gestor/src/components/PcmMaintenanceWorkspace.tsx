import { useState } from 'react'
import { AdminCatalogWorkspace } from './AdminCatalogWorkspace'
import { AdminChecklistBuilder } from './AdminChecklistBuilder'
import { AdminTechnicalStructure } from './AdminTechnicalStructure'

type MaintenanceModule = 'plans' | 'checklists' | 'technical-structure' | 'assets' | 'materials'

const MODULES: Array<{ id: MaintenanceModule; label: string }> = [
  { id: 'plans', label: 'Planos preventivos' },
  { id: 'checklists', label: 'Checklists' },
  { id: 'technical-structure', label: 'Áreas e cargos técnicos' },
  { id: 'assets', label: 'Ativos e estrutura' },
  { id: 'materials', label: 'Materiais' },
]

export function PcmMaintenanceWorkspace({ onSessionExpired }: { onSessionExpired: () => void }) {
  const [module, setModule] = useState<MaintenanceModule>('plans')

  return (
    <main className="content pcm-maintenance-workspace" aria-label="Configurações da manutenção">
      <header className="page-heading">
        <div>
          <span className="eyebrow">DOMÍNIO DA MANUTENÇÃO</span>
          <h1>Planejamento e recursos técnicos</h1>
          <p>O PCM administra os planos, checklists, ativos e recursos usados no fluxo de manutenção.</p>
        </div>
      </header>
      <nav className="pcm-maintenance-workspace__tabs" aria-label="Recursos de manutenção">
        {MODULES.map((item) => (
          <button
            key={item.id}
            type="button"
            aria-current={module === item.id ? 'page' : undefined}
            aria-pressed={module === item.id}
            onClick={() => setModule(item.id)}
          >
            {item.label}
          </button>
        ))}
      </nav>
      {module === 'plans' ? <AdminCatalogWorkspace scope="maintenance" onSessionExpired={onSessionExpired} onOpenImports={() => undefined} showImports={false} /> : null}
      {module === 'checklists' ? <AdminChecklistBuilder onSessionExpired={onSessionExpired} allowCustomValidators={false} /> : null}
      {module === 'technical-structure' ? <AdminTechnicalStructure onSessionExpired={onSessionExpired} /> : null}
      {module === 'assets' ? <AdminCatalogWorkspace scope="assets" onSessionExpired={onSessionExpired} onOpenImports={() => undefined} showImports={false} /> : null}
      {module === 'materials' ? <AdminCatalogWorkspace scope="inventory" onSessionExpired={onSessionExpired} onOpenImports={() => undefined} showImports={false} /> : null}
    </main>
  )
}
