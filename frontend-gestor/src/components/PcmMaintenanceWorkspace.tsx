import './PcmPlanning.css'
import { useState } from 'react'
import { ArrowLeft, CalendarCheck2, ClipboardList, CircleHelp, Network, Package, Settings2 } from 'lucide-react'
import { PcmCatalogWorkspace } from './PcmCatalogWorkspace'
import { PcmChecklistBuilder } from './PcmChecklistBuilder'
import { PcmTechnicalStructure } from './PcmTechnicalStructure'
import { PcmImportDialog } from './PcmImportDialog'

type MaintenanceModule = 'plans' | 'checklists' | 'technical-structure' | 'assets' | 'materials'
const MODULES = [
  { id: 'assets', label: 'Ativos e componentes', group: 'Cadastros', step: 1, Icon: Network, help: 'Consulte os ativos e sua localização antes de definir o trabalho.' },
  { id: 'technical-structure', label: 'Áreas e cargos', group: 'Cadastros', step: 1, Icon: Settings2, help: 'Organize especialidades e cargos. A edição depende das permissões concedidas à sua conta.' },
  { id: 'checklists', label: 'Checklists', group: 'Preparação', step: 2, Icon: ClipboardList, help: 'Prepare e valide o roteiro técnico que será vinculado ao plano.' },
  { id: 'plans', label: 'Planos de manutenção', group: 'Preparação', step: 2, Icon: CalendarCheck2, help: 'Defina o ativo, o gatilho e a programação. Use um checklist validado antes de publicar.' },
  { id: 'materials', label: 'Materiais', group: 'Recursos', step: 3, Icon: Package, help: 'Verifique os materiais necessários, o estoque e os recursos para executar o plano.' },
] as const

export function PcmMaintenanceWorkspace({ onSessionExpired, onCreateOrder }: { onSessionExpired: () => void; onCreateOrder?: (checklistId:string)=>void }) {
  const [module, setModule] = useState<MaintenanceModule | null>(null)
  const [importOpen, setImportOpen] = useState(false)
  const [revision, setRevision] = useState(0)
  const selected = MODULES.find(item => item.id === module)
  return <main className="content pcm-maintenance-workspace" aria-label="Planejamento da manutenção">
    <header className="pcm-planning-heading">
      <div>{selected ? <button type="button" className="pcm-planning-back" onClick={() => setModule(null)}><ArrowLeft size={15} /><span className="pcm-back-label">Voltar</span></button> : null}<h1>{selected?.label ?? 'Manutenção'}</h1></div>
      <button type="button" className="pcm-planning-help" aria-label="Ajuda desta área" title={selected?.help ?? 'Comece pela estrutura dos ativos e pelas áreas técnicas. Depois prepare checklists, planos e materiais. Os indicadores da lousa mostram o que precisa de atenção.'}><CircleHelp size={18} /></button>
    </header>
    {!selected ? <div className="pcm-planning-sections">{[1, 2, 3].map(step => {
      const items = MODULES.filter(item => item.step === step)
      return <section key={step} className="pcm-planning-section" aria-labelledby={`pcm-planning-step-${step}`}><header><span>{String(step).padStart(2, '0')}</span><h2 id={`pcm-planning-step-${step}`}>{items[0].group}</h2></header><div>{items.map(item => <button key={item.id} type="button" className="pcm-planning-entry" onClick={() => setModule(item.id)} title={item.help}><item.Icon size={23} /><span>{item.label}</span><span aria-hidden="true">→</span></button>)}</div></section>
    })}</div> : <>

      <div className="pcm-planning-page" key={`${module}-${revision}`}>
        {module === 'assets' || module === 'technical-structure' || module === 'materials' ? <div className="pcm-import-entry"><button type="button" onClick={() => setImportOpen(true)}>Importar planilha</button></div> : null}
        {module === 'plans' ? <PcmCatalogWorkspace scope="maintenance" onSessionExpired={onSessionExpired} onOpenImports={() => undefined} showImports={false} /> : null}
        {module === 'checklists' ? <PcmChecklistBuilder onSessionExpired={onSessionExpired} onCreateOrder={onCreateOrder} allowCustomValidators={false} /> : null}
        {module === 'technical-structure' ? <PcmTechnicalStructure onSessionExpired={onSessionExpired} /> : null}
        {module === 'assets' ? <PcmCatalogWorkspace scope="assets" onSessionExpired={onSessionExpired} onOpenImports={() => undefined} showImports={false} /> : null}
        {module === 'materials' ? <PcmCatalogWorkspace scope="inventory" onSessionExpired={onSessionExpired} onOpenImports={() => undefined} showImports={false} /> : null}
      </div>
    </>}
    {importOpen ? <div className="pcm-planning-page"><PcmImportDialog types={module === 'technical-structure' ? ['areas_tecnicas', 'cargos_tecnicos'] : module === 'materials' ? ['materiais'] : ['ativos', 'componentes']} onClose={() => setImportOpen(false)} onImported={() => setRevision(current => current + 1)} onSessionExpired={onSessionExpired} /></div> : null}
  </main>
}
