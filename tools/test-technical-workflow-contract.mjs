import fs from 'node:fs'
import path from 'node:path'
import vm from 'node:vm'

const root = path.resolve(import.meta.dirname, '..')

function read(relativePath) {
  return fs.readFileSync(path.join(root, relativePath), 'utf8').replace(/^\uFEFF/, '')
}

function assert(condition, message) {
  if (!condition) throw new Error(`Contrato técnico inválido: ${message}`)
}

function near(actual, expected, tolerance = 0.001) {
  return Math.abs(Number(actual) - Number(expected)) <= tolerance
}

const config = read('backend/apps-script/00_Config.js')
const router = read('backend/apps-script/03_Http_Auth.js')
const workflow = read('backend/apps-script/25_Workflow_Tecnico_KPI.js')
const adminPermissions = read('backend/apps-script/04_Admin.js')
const gestorApi = read('frontend-gestor/src/services/api/gestor.ts')
const decisions = read('frontend-gestor/src/pages/GestorDecisionWorkspace.tsx')
const analytics = read('frontend-gestor/src/pages/GestorAnalyticsWorkspace.tsx')
const assetJourney = read('frontend-gestor/src/components/AssetJourneyPanel.tsx')
const qrWorkspace = read('frontend-gestor/src/pages/GestorQrWorkspace.tsx')
const checklistBuilder = read('frontend-gestor/src/components/AdminChecklistBuilder.tsx')
const notifications = read('frontend-gestor/src/components/NotificationCenter.tsx')
const gestorApp = read('frontend-gestor/src/app/App.tsx')
const adminWorkspace = read('frontend-gestor/src/components/AdminWorkspace.tsx')
const adminPage = read('frontend-gestor/src/pages/AdminPage.tsx')
const adminAnalytics = read('frontend-gestor/src/components/AdminAnalyticsWorkspace.tsx')
const adminInterventions = read('frontend-gestor/src/components/AdminInterventionsWorkspace.tsx')
const adminApi = read('frontend-gestor/src/services/api/admin.ts')
const technicalAnalysis = read('frontend-gestor/src/components/TechnicalAnalysisDialog.tsx')
const demandDialog = read('frontend-gestor/src/components/TechnicalDemandDialog.tsx')
const navigation = read('frontend-gestor/src/components/AppNavigation.tsx')
const gestorStyles = read('frontend-gestor/src/styles/global.css')
const operatorAction = read('frontend/src/pages/ActionDetailPage.tsx')
const operatorChecklist = read('frontend/src/pages/ChecklistExecutionPage.tsx')
const operatorApp = read('frontend/src/app/App.tsx')
const operatorHome = read('frontend/src/pages/OperatorHome.tsx')
const operatorApi = read('frontend/src/services/api/operator.ts')
const operatorQueue = read('backend/apps-script/23_Fila_Operador_Performance.js')
const executionBoundary = read('frontend/src/components/ExecutionErrorBoundary.tsx')
const operatorContract = read('backend/apps-script/17_Consolidacao_Operacional_UI.js')
const interventionsApi = read('frontend-gestor/src/services/api/interventions.ts')
const interventionsBackend = read('backend/apps-script/28_Admin_Intervencoes.js')

const requiredSheets = [
  'areas_tecnicas',
  'cargos_tecnicos',
  'demandas_tecnicas',
  'demanda_tramitacoes',
  'assinaturas_tecnicas',
  'analises_tecnicas',
  'notificacoes',
  'turnos',
  'apontamentos_producao',
  'sla_politicas',
]

for (const sheet of requiredSheets) {
  assert(config.includes(`${sheet}: [`), `schema ausente: ${sheet}`)
}

for (const column of ['area_id', 'cargo_id', 'especialidades_json', 'escopo_ids_json']) {
  assert(config.includes(`"${column}"`), `dimensão de identidade ausente: ${column}`)
}

const requiredActions = [
  'cmms.workflow_tecnico_schema_upgrade',
  'cmms.kpis_tecnicos',
  'admin.demandas_tecnicas.enviar',
  'admin.analises_tecnicas.converter',
  'admin.intervencoes.listar',
  'admin.intervencoes.salvar',
  'admin.intervencoes.enviar_validacao',
  'gestor.contexto_tecnico',
  'gestor.demandas.listar',
  'gestor.demandas.assumir',
  'gestor.demandas.encaminhar',
  'gestor.demandas.assinar',
  'gestor.demandas.validar',
  'gestor.demandas.decidir',
  'gestor.paradas.criar_tratamento',
  'gestor.analises.salvar',
  'gestor.analises.enviar_admin',
  'gestor.registrar_parametro',
  'gestor.dossie_ativo',
  'gestor.parametros.solicitar_acao',
  'gestor.notificacoes.listar',
  'gestor.notificacoes.marcar_lida',
]

for (const action of requiredActions) {
  assert(router.includes(`case "${action}"`), `rota ausente: ${action}`)
  assert(config.includes(`"${action}"`), `permissão ausente: ${action}`)
}

for (const action of requiredActions.filter((action) => action.startsWith('admin.intervencoes.'))) {
  assert(interventionsApi.includes(`'${action}'`), `cliente de intervenção não usa ${action}`)
}

for (const action of requiredActions.filter((action) => action.startsWith('gestor.') || action === 'cmms.kpis_tecnicos')) {
  assert(gestorApi.includes(`'${action}'`), `cliente gestor não usa ${action}`)
}

assert(decisions.includes('<h1>Validar</h1>'), 'área de validação não apresenta a ação principal')
assert(decisions.includes('PRÓXIMO PASSO'), 'fila não orienta a próxima decisão')
assert(decisions.includes('<option value="demands">Solicitações') && decisions.includes('<option value="models">Checklists'), 'categorias de documentos não estão organizadas')
assert(!decisions.includes('<option value="operations">Ocorrências'), 'ocorrências ainda concorrem com documentos na área de assinatura')
assert(navigation.includes("label: 'Validar'"), 'navegação não expõe a validação técnica')
assert(navigation.includes("label: 'Acompanhar'"), 'navegação não expõe o acompanhamento técnico')
assert(navigation.includes("label: 'Conta'") && !navigation.includes("label: 'Mais'"), 'navegação mantém uma aba genérica')
assert(!gestorApp.includes('manager-mode-switch'), 'cabeçalho repete a navegação inferior')
assert(
  gestorStyles.includes('.manager-decision-workspace') &&
    gestorStyles.includes('height: calc(100dvh - 184px)') &&
    gestorStyles.includes('.manager-decision-queue::-webkit-scrollbar'),
  'workspace não controla altura e rolagem interna invisível',
)
assert(!decisions.includes('setSelectedOccurrence'), 'ocorrência ainda abre no fluxo reservado à assinatura')
assert(analytics.includes('setSelectedOccurrence'), 'ocorrência não abre no acompanhamento técnico')
assert(demandDialog.includes('Assinaturas desta versão'), 'fluxo não evidencia as assinaturas permanentes')
assert(demandDialog.includes('O ADMINISTRADOR SOLICITOU'), 'validação não apresenta a solicitação do Administrador')
assert(demandDialog.includes('Assinar e aprovar'), 'ação principal de validação está ausente')
assert(demandDialog.includes('Solicitar correção') && demandDialog.includes('Devolver ao Administrador'), 'alternativa de correção está ausente')
assert(
  demandDialog.includes('getGestorChecklistModelDetail') &&
    demandDialog.includes('CONTEÚDO PARA CONFERÊNCIA') &&
    demandDialog.includes('visibleItems?.map') &&
    demandDialog.includes('Ver todas as'),
  'Gestor não consegue abrir as etapas do checklist roteado pelo Administrador',
)
assert(
  workflow.includes('TECH_DEFAULT_VALIDATOR_CODES = ["QUALIDADE","SEGURANCA"]') &&
    workflow.includes('QUALIDADE_E_SEGURANCA') &&
    workflow.includes('technicalSignaturesForDemand_') &&
    workflow.includes('entidade_id:demand.entidade_id') &&
    workflow.includes('versao_entidade:demand.versao_entidade') &&
    workflow.includes('payload_hash:demand.payload_hash'),
  'filtro Qualidade/Segurança ou persistência da assinatura por documento/versão está incompleto',
)
assert(
  workflow.includes('function gestorDemandaValidar_') &&
    gestorApi.includes("'gestor.demandas.validar'") &&
    demandDialog.includes('validateGestorTechnicalDemand'),
  'validação atômica com assinatura não está conectada ao frontend',
)
assert(
  workflow.includes('shared_queue:true') &&
    workflow.includes('TECH_VALIDATION_FORWARD_DISABLED'),
  'fila compartilhada pode ser reservada ou encaminhada para fora do filtro',
)
assert(
  gestorApp.includes('technicalContext?.pode_validar') &&
    navigation.includes("if (item.id === 'home') return canValidate") &&
    decisions.includes('Perfil de acompanhamento técnico'),
  'interface não separa validadores de perfis apenas analíticos',
)
assert(
  workflow.includes(
    '!adminOnly && !statuses.length && TECH_FINAL_STATUSES.indexOf(upper_(demand.status)) >= 0',
  ),
  'fila do Gestor inclui demandas encerradas quando nenhum estado e informado',
)
assert(
  gestorApi.includes('OPEN_TECHNICAL_DEMAND_STATUSES.join') &&
    gestorApi.includes('FINAL_TECHNICAL_DEMAND_STATUSES.has'),
  'cliente Gestor nao protege a fila contra demandas encerradas',
)
assert(
  decisions.includes('routedChecklistIds') &&
    decisions.includes('standaloneModels'),
  'fila de decisão duplica checklist roteado como solicitação e modelo',
)
assert(
  interventionsBackend.includes('adminIntervencaoRequireExecutablePlan_') &&
    interventionsBackend.includes('plano_id:executablePlan.plan.id') &&
    interventionsBackend.includes('INTERVENTION_CHECKLIST_REQUIRED'),
  'intervenção pode ser liberada sem checklist validado',
)
assert(
  operatorContract.includes('operationalPlanIds') &&
    operatorContract.includes('planItemCounts') &&
    operatorContract.includes('!clean_(a.plano_id)'),
  'fila do Operador aceita ação sem checklist executável',
)
assert(
  config.includes('ordens_servico: ["id", "codigo", "ativo_id", "componente_id", "plano_id"'),
  'ordem de serviço não persiste o vínculo com o checklist',
)
assert(analytics.includes("label: 'MTBF'"), 'modo Analítico não exibe MTBF')
assert(analytics.includes("label: 'Lead time'"), 'modo Analítico não exibe lead time')
assert(analytics.includes("label: 'SLA de resposta'"), 'modo Analítico não exibe SLA')
assert(
  !analytics.includes("label: 'OEE'") &&
    analytics.includes("label: 'Falhas não planejadas'") &&
    analytics.includes('ATENDIMENTO TÉCNICO'),
  'painel do Gestor ainda exibe OEE sem dados de produção ou não oferece métricas técnicas substitutas',
)
assert(
  !adminAnalytics.includes("['OEE (%)'") &&
    !adminAnalytics.includes('>OEE</span>') &&
    adminAnalytics.includes('CONFIABILIDADE'),
  'painel do Admin ainda publica OEE sem base de produção',
)
assert(analytics.includes('período anterior'), 'painel não compara tendências')
assert(
  analytics.includes('<AssetSearchSelect') &&
    analytics.includes('assets={catalog.assets}') &&
    analytics.includes('selectedId={assetId}'),
  'painel não permite pesquisar e recortar por ativo',
)
assert(
  analytics.includes("'monitoring'") &&
    analytics.includes("'history'") &&
    analytics.includes("'library'") &&
    !analytics.includes("{ id: 'critical'"),
  'centro técnico não separa campo, histórico e ativos ou ainda duplica críticos fora das notificações',
)
assert(gestorApi.includes('getGestorTechnicalKpisForPeriod'), 'cliente não envia período e ativo aos KPIs')
assert(
  gestorApi.includes('getGestorAssetJourney') &&
    gestorApi.includes("'gestor.dossie_ativo'") &&
    !gestorApi.includes("'operador.contexto_qr'"),
  'ficha do ativo não usa o dossiê técnico rastreável do Gestor',
)
assert(assetJourney.includes('Faixas configuradas') && assetJourney.includes('Últimas alterações') && assetJourney.includes('Histórico'), 'jornada completa do ativo está incompleta')
assert(
  qrWorkspace.includes('BarcodeDetector') &&
    qrWorkspace.includes('getGestorAssetJourney') &&
    qrWorkspace.includes('registerGestorParameter') &&
    qrWorkspace.includes('requestGestorParameterAction') &&
    qrWorkspace.includes('parametros_analisados') &&
    qrWorkspace.includes('historico_manutencao') &&
    qrWorkspace.includes("'AJUSTE_LIMITE'") &&
    qrWorkspace.includes('Código do equipamento ou componente'),
  'Gestor móvel não possui dossiê QR, parâmetros, histórico e decisão rastreável',
)
assert(
  workflow.includes('function gestorRegistrarParametro_') &&
    workflow.includes('function gestorDossieAtivo_') &&
    workflow.includes('function gestorSolicitarAcaoParametro_') &&
    workflow.includes('GESTOR_QR_CONTEXT_VIEWED') &&
    workflow.includes('PARAMETRO_ENCAMINHADO_ADMIN') &&
    workflow.includes('COMPONENT_ASSET_MISMATCH') &&
    workflow.includes('GESTOR_PARAMETER_RECORDED') &&
    workflow.includes('componente_id:componentId'),
  'backend não protege o dossiê, o registro ou a decisão sobre parâmetros',
)
assert(
  adminPermissions.includes('"gestor.dossie_ativo"') &&
    adminPermissions.includes('"gestor.parametros.solicitar_acao"'),
  'matriz efetiva de capacidades bloqueia o dossiê ou a solicitação do Gestor',
)
assert(
  navigation.includes("id: 'scan'") &&
    navigation.includes('compactDevice') &&
    assetJourney.includes('Indicadores do componente') &&
    assetJourney.includes('Abrir componente'),
  'navegação adaptativa ou ficha profunda dos componentes está incompleta',
)
assert(checklistBuilder.includes('QUICK_ITEM_TYPES') && checklistBuilder.includes('admin-checklist-quick-types'), 'construtor não possui criação rápida por tipo')
assert(
  checklistBuilder.includes('admin-checklist-routing-dialog') &&
    checklistBuilder.includes('role="dialog"') &&
    checklistBuilder.includes('Definir filtro técnico'),
  'filtro técnico não abre em um popup dedicado',
)
for (const responseType of [
  'OK_NOK',
  'CONFIRMACAO',
  'NUMERO',
  'PARAMETRO',
  'TEXTO',
  'SELECAO',
  'EVIDENCIA',
  'LEITURA_OPERACIONAL',
  'INSTRUCAO',
]) {
  assert(
    checklistBuilder.includes(`value: '${responseType}'`),
    `criação rápida não oferece ${responseType}`,
  )
  assert(
    operatorChecklist.includes(`'${responseType}'`),
    `Operador não reconhece ${responseType}`,
  )
}
assert(
  operatorChecklist.includes('aria-pressed={currentDraft.answer === option}') &&
    operatorChecklist.includes('aria-labelledby={currentItemTitleId}') &&
    operatorChecklist.includes('aria-live="polite"'),
  'respostas do Operador não possuem os contratos mínimos de acessibilidade',
)
assert(gestorApi.includes('getGestorNotifications') && gestorApi.includes('markGestorNotificationRead'), 'central de notificações não usa o backend real')
assert(gestorApp.includes('notification.entidade_tipo') && notifications.includes('NAO_LIDA'), 'notificações não preservam contexto e leitura')
assert(
  gestorApi.includes("{ limite: 300 }") &&
    gestorApi.includes("normalizedStatus(item.status) === 'NAO_LIDA'") &&
    workflow.includes('context_acknowledged:true'),
  'contagem não distingue mensagens não lidas de contextos operacionais já reconhecidos',
)
assert(
  notifications.indexOf('await markGestorNotificationRead(destination)') <
    notifications.indexOf('await onOpenNotification(destination)') &&
    notifications.includes('const pending = notifications.filter(isUnread)'),
  'clique e leitura em lote não persistem a leitura antes de navegar',
)
assert(
  notifications.includes('manager-notification-summary') &&
    notifications.includes('Buscar por ativo, ocorrência ou decisão') &&
    notifications.includes('Todos os contextos') &&
    notifications.includes('markAllAsRead') &&
    notifications.includes('Marcar mensagens como lidas'),
  'central de notificações não oferece priorização, busca, filtros e leitura em lote',
)
assert(
  gestorApp.includes('audience="manager"') &&
    adminWorkspace.includes('audience="admin"'),
  'central de notificações não adapta o contexto entre Gestor e Admin',
)
assert(
  adminWorkspace.includes('<NotificationCenter') &&
    adminWorkspace.includes('setNotificationOpen(true)') &&
    adminWorkspace.includes("notificationType === 'SOLICITACAO_CHECKLIST'") &&
    adminWorkspace.includes("openModule('checklists')"),
  'Admin não roteia a solicitação do Gestor para o construtor de checklist',
)
assert(
  adminWorkspace.includes('listAdminTechnicalDemands') &&
    adminWorkspace.includes("entityType === 'DEMANDAS_TECNICAS'") &&
    adminWorkspace.includes('setNotificationTarget'),
  'notificação administrativa não resolve o registro técnico real antes de navegar',
)
assert(
  notifications.includes('await onOpenNotification(destination)') &&
    notifications.includes('openingId') &&
    notifications.includes('Abrindo…'),
  'central marca a notificação como lida antes de confirmar a abertura do destino',
)
assert(
  adminApi.includes('admin.analises_tecnicas.listar') &&
    adminInterventions.includes('Análises recebidas do Gestor') &&
    adminInterventions.includes('focusTarget.entityId') &&
    adminInterventions.includes('String(item.acao_id'),
  'Admin não possui caixa de análises nem foco no registro originado pela notificação',
)
assert(
  workflow.includes('"SOLICITACAO_CHECKLIST"') &&
    workflow.includes('"SOLICITACAO_INTERVENCAO"') &&
    workflow.includes('technicalNotify_(') &&
    workflow.includes('"DECISAO_TECNICA"'),
  'decisões e análises do Gestor não notificam o Admin',
)
assert(
  checklistBuilder.includes('checklistDraftFromAnalysis') &&
    checklistBuilder.includes('convertAdminTechnicalAnalysisToChecklist') &&
    checklistBuilder.includes('parametro_contexto') &&
    checklistBuilder.includes('Solicitação do Gestor carregada'),
  'solicitação de checklist não preenche nem converte o rascunho no Admin',
)
assert(
  workflow.includes('demand.entidade_tipo') &&
    workflow.includes('demand.entidade_id'),
  'decisão técnica ainda notifica uma demanda intermediária em vez da entidade de destino',
)
assert(
  analytics.includes('ATENÇÃO AGORA') &&
    analytics.includes('TRABALHO EM CAMPO') &&
    analytics.includes('Acompanhar ativo'),
  'acompanhamento do Gestor não apresenta desvios e execuções em campo',
)
assert(
  analytics.includes('Execuções concluídas') &&
    analytics.includes('Ver auditoria') &&
    gestorApi.includes('getGestorCompletedActions') &&
    gestorApi.includes("status: 'CONCLUIDA'"),
  'conclusões do Operador não foram transferidas para o histórico auditável do Gestor',
)
assert(
  operatorQueue.includes('status:"PENDENTE,EM_EXECUCAO"') &&
    operatorQueue.includes('incluir_concluidas:false') &&
    operatorApi.includes("status: 'PENDENTE,EM_EXECUCAO'") &&
    operatorApi.includes('incluir_concluidas: false') &&
    !operatorHome.includes("'CONCLUIDAS'") &&
    operatorApp.includes('remainingActions'),
  'Operador ainda recebe ou mantém ações concluídas na fila operacional',
)
assert(
    config.includes('"parada_id"') &&
    workflow.includes('function gestorParadaCriarTratamento_') &&
    workflow.includes('TRATAMENTO_PARADA_CRIADO') &&
    notifications.includes('Tratar parada') &&
    gestorApi.includes("'gestor.paradas.criar_tratamento'"),
  'parada técnica aberta não cria uma ocorrência rastreável para tratamento',
)
assert(
  !adminWorkspace.includes("{ id: 'maintenance', code: 'PM'") &&
    adminWorkspace.includes("module === 'maintenance' ? 'operations' : module") &&
    adminInterventions.includes("scope=\"maintenance\"") &&
    adminInterventions.includes('Planejadas e não planejadas') &&
    adminPage.includes("tab === 'operations' || tab === 'maintenance'"),
  'Programação e Intervenções/OS continuam concorrendo em janelas separadas',
)
assert(technicalAnalysis.includes('relatorio_tecnico: brief'), 'análise assistida não envia o relatório estruturado')
assert(workflow.includes('TECH_SIGNATURE_SEGREGATION'), 'segregação de assinatura ausente')
assert(workflow.includes('payload_hash'), 'assinatura não está vinculada ao hash do payload')
assert(config.includes('"analise_tecnica_json"') && config.includes('"relatorio_tecnico_json"'), 'schema não persiste o briefing técnico')
assert(workflow.includes('technicalAttachBriefToDemandEntity_'), 'decisão do Gestor não vincula o briefing à intervenção')
assert(interventionsBackend.includes('analise_tecnica_json:clean_(order.analise_tecnica_json)'), 'liberação não propaga o briefing para a ação')
assert(operatorContract.includes('analise_tecnica:CMMS110_technicalBrief_'), 'tela do Operador não recebe o briefing técnico')
assert(operatorAction.includes("titulo: 'Preparar e isolar'") && operatorAction.includes('technical-requirements-grid'), 'Operador não possui etapas e requisitos seguros de fallback')
assert(operatorAction.includes('technicalFacts.map') && !operatorAction.includes("<span>Duração prevista</span><strong>{detail.plano?.tempo_estimado_min"), 'análise do Operador ainda exibe fatos técnicos vazios')
assert(
  operatorChecklist.includes("String(value ?? '')") &&
    operatorChecklist.includes('Array.isArray(options)'),
  'checklist do Operador não normaliza valores heterogêneos vindos da planilha',
)
assert(
  operatorApp.includes('<ExecutionErrorBoundary') &&
    operatorApp.includes('Carregando checklist') &&
    executionBoundary.includes('Não foi possível exibir o checklist'),
  'execução do Operador ainda pode resultar em uma tela vazia',
)
assert(workflow.includes('workflow.tecnico.text.repair.version'), 'catálogo técnico não versiona a correção de acentuação')
assert(workflow.includes('technicalLooksMojibake_'), 'catálogo técnico não detecta textos legados corrompidos')
assert(workflow.includes('var roleId = eid_("CTEC", definition.codigo)'), 'correção de cargos não preserva o identificador estável')
assert(!workflow.includes('tÃ©cnic') && !workflow.includes('ocorrÃªncia') && !workflow.includes('produÃ§Ã£o'), 'workflow ainda contém acentuação UTF-8 corrompida')
assert(interventionsBackend.includes('ADMIN_INTERVENTION_WAITING'), 'intervenção não possui estado de validação')
assert(interventionsBackend.includes('adminIntervencaoLiberarOperacao_'), 'liberação técnica não cria ação operacional')

const context = vm.createContext({ console })
vm.runInContext(
  [
    'var FAB = {SCHEMA_VERSION:"1.4.0"};',
    'function num_(value, fallback){ var number = Number(value); return isNaN(number) ? Number(fallback || 0) : number; }',
    'function upper_(value){ return String(value || "").trim().toUpperCase(); }',
    'function err_(code, message, status){ var error = new Error(message); error.code = code; error.status = status; throw error; }',
    workflow,
  ].join('\n'),
  context,
)

const calculated = JSON.parse(vm.runInContext(`JSON.stringify(technicalAggregateKpis_({
  observation_seconds: 36000,
  downtime_seconds: 3600,
  repair_seconds: 1800,
  failures: 2,
  os_lead_times: [7200, 3600],
  demand_lead_times: [1800],
  sla_response: [{eligible:true,met:true},{eligible:true,met:false},{eligible:false,met:false}],
  sla_resolution: [{eligible:true,met:true}],
  production: [{
    tempo_planejado_segundos:10000,
    tempo_operacao_segundos:9000,
    ciclo_ideal_segundos:10,
    quantidade_total:800,
    quantidade_boas:780
  }]
}))`, context))

assert(near(calculated.disponibilidade_pct, 90), 'disponibilidade deveria ser 90%')
assert(calculated.mttr_segundos === 900, 'MTTR deveria ser 900 segundos')
assert(calculated.mtbf_segundos === 16200, 'MTBF deveria ser 16200 segundos')
assert(calculated.lead_time_os_segundos === 5400, 'lead time médio de OS incorreto')
assert(calculated.lead_time_demanda_segundos === 1800, 'lead time de demanda incorreto')
assert(near(calculated.sla_resposta_pct, 50), 'SLA de resposta deveria ser 50%')
assert(near(calculated.sla_resolucao_pct, 100), 'SLA de resolução deveria ser 100%')
assert(near(calculated.oee_pct, 78), 'OEE deveria ser 78%')

const empty = JSON.parse(vm.runInContext('JSON.stringify(technicalAggregateKpis_({}))', context))
assert(empty.mttr_segundos === null, 'MTTR sem falhas deve ser indisponível')
assert(empty.mtbf_segundos === null, 'MTBF sem falhas deve ser indisponível')
assert(empty.oee_disponivel === false && empty.oee_pct === null, 'OEE sem produção não pode ser zero')
assert(vm.runInContext('technicalAssertDemandOpen_({status:"EM_TRIAGEM"})', context) === true, 'demanda aberta foi bloqueada')
assert(
  vm.runInContext('try { technicalAssertDemandOpen_({status:"CONCLUIDA"}); false } catch (error) { error.code === "TECH_DEMAND_FINAL" && error.status === 409 }', context),
  'demanda final aceita nova transição',
)

console.log('CONTRATO DO WORKFLOW TÉCNICO APROVADO')
console.log(`${requiredActions.length} rotas e ${requiredSheets.length} tabelas conferidas`)
console.log('Fórmulas controladas: disponibilidade, MTTR, MTBF, lead time, SLA e OEE')
