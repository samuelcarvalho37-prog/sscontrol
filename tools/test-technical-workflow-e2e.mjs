import crypto from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'
import vm from 'node:vm'

const root = path.resolve(import.meta.dirname, '..')
const read = (relativePath) => fs.readFileSync(path.join(root, relativePath), 'utf8').replace(/^\uFEFF/, '')
const assert = (condition, message) => {
  if (!condition) throw new Error(`Fluxo técnico E2E inválido: ${message}`)
}

let sequence = 0
const context = vm.createContext({
  console,
  Utilities: {
    DigestAlgorithm: { SHA_256: 'SHA_256' },
    Charset: { UTF_8: 'UTF_8' },
    computeDigest(_algorithm, value) {
      return [...crypto.createHash('sha256').update(String(value), 'utf8').digest()]
    },
    formatDate(date) {
      return new Date(date).toISOString().slice(0, 19)
    },
    getUuid() {
      sequence += 1
      return `${String(sequence).padStart(8, '0')}-aaaa-bbbb-cccc-dddddddddddd`
    },
  },
  LockService: {
    getScriptLock() {
      return { tryLock() { return true }, releaseLock() {} }
    },
  },
})

vm.runInContext(
  [
    read('backend/apps-script/00_Config.js'),
    read('backend/apps-script/01_Utils.js'),
    read('backend/apps-script/25_Workflow_Tecnico_KPI.js'),
    read('backend/apps-script/28_Admin_Intervencoes.js'),
    `
      var TEST_DB = {
        usuarios: [
          {id:'USR-ADMIN',nome:'Admin',perfil:'ADMIN',status:'ATIVO',area_id:'',cargo_id:'',__rowIndex:2},
          {id:'USR-QUALIDADE',nome:'Gestora Qualidade',perfil:'GESTOR',status:'ATIVO',area_id:'AREA-QUALIDADE',cargo_id:'CARGO-QUALIDADE',__rowIndex:3},
          {id:'USR-SEGURANCA',nome:'Gestor Seguranca',perfil:'GESTOR',status:'ATIVO',area_id:'AREA-SEGURANCA',cargo_id:'CARGO-SEGURANCA',__rowIndex:4},
          {id:'USR-MANUTENCAO',nome:'Gestor Manutencao',perfil:'GESTOR',status:'ATIVO',area_id:'AREA-MANUTENCAO',cargo_id:'CARGO-MANUTENCAO',__rowIndex:5},
          {id:'USR-OPERADOR',nome:'Operador',perfil:'OPERADOR',status:'ATIVO',area_id:'',cargo_id:'',__rowIndex:6}
        ],
        areas_tecnicas: [
          {id:'AREA-QUALIDADE',codigo:'QUALIDADE',nome:'Qualidade',status:'ATIVO',exige_assinatura_padrao:'SIM',__rowIndex:2},
          {id:'AREA-SEGURANCA',codigo:'SEGURANCA',nome:'Seguranca',status:'ATIVO',exige_assinatura_padrao:'SIM',__rowIndex:3},
          {id:'AREA-MANUTENCAO',codigo:'MANUTENCAO',nome:'Manutencao',status:'ATIVO',exige_assinatura_padrao:'NAO',__rowIndex:4}
        ],
        cargos_tecnicos: [
          {id:'CARGO-QUALIDADE',area_id:'AREA-QUALIDADE',nome:'Inspetor',status:'ATIVO',pode_assinar:'SIM',__rowIndex:2},
          {id:'CARGO-SEGURANCA',area_id:'AREA-SEGURANCA',nome:'Tecnico de Seguranca',status:'ATIVO',pode_assinar:'SIM',__rowIndex:3},
          {id:'CARGO-MANUTENCAO',area_id:'AREA-MANUTENCAO',nome:'Tecnico',status:'ATIVO',pode_assinar:'NAO',__rowIndex:4}
        ],
        sla_politicas: [{id:'SLA-ALTA',tipo_demanda:'',prioridade:'ALTA',area_id:'',resposta_minutos:30,resolucao_minutos:240,status:'ATIVO',__rowIndex:2}],
        demandas_tecnicas: [], demanda_tramitacoes: [], assinaturas_tecnicas: [],
        analises_tecnicas: [], notificacoes: [], audit_log: [],
        ocorrencias_operacionais: [{id:'OCR-1',ativo_id:'ATV-1',componente_id:'CMP-1',titulo:'Vibracao',descricao:'Vibracao elevada',severidade:'ALTA',status:'AGUARDANDO_ANALISE',__rowIndex:2}],
        planos_manutencao: [{id:'PLN-1',ativo_id:'ATV-1',componente_id:'CMP-1',nome:'Inspecao critica',status:'INATIVO',workflow_status:'EM_VALIDACAO_GESTAO',__rowIndex:2}],
        plano_itens: [{id:'ITEM-1',plano_id:'PLN-1',ordem:1,titulo:'Inspecionar acoplamento',tipo_resposta:'CONFORME',status:'ATIVO',__rowIndex:2}],
        ativos: [{id:'ATV-1',tag:'EQ-01',nome:'Prensa 01',status:'OPERANDO',__rowIndex:2}],
        componentes: [{id:'CMP-1',ativo_id:'ATV-1',tag:'MOTOR',nome:'Motor principal',status:'ATIVO',__rowIndex:2}],
        ordens_servico: [], os_acoes: [], historico: []
      };
      function technicalEnsureSchema_(){}
      function rows_(name){ return TEST_DB[name] || []; }
      function find_(name, key, value){ return rows_(name).find(function(row){ return String(row[key]) === String(value); }) || null; }
      function fit_(name, data){ var out = {}; SH[name].forEach(function(key){ out[key] = data[key] === undefined ? '' : data[key]; }); return out; }
      function append_(name, data){ if(!TEST_DB[name]) TEST_DB[name] = []; data.__rowIndex = TEST_DB[name].length + 2; TEST_DB[name].push(data); return data; }
      function update_(name, rowIndex, patch){ var row = rows_(name).find(function(item){ return item.__rowIndex === rowIndex; }); if(!row) throw new Error('Linha ausente: '+name+'#'+rowIndex); Object.assign(row, patch); }
      function configurationRuntimeValue_(key, fallback){ return fallback; }
      function audit_(){}
      function getSpreadsheet_(){ return {}; }
      function ensureSheet_(){}
      function adminRequireIdentityAdmin_(auth){ if(upper_(auth && auth.perfil) !== ROLE.ADMIN) err_('FORBIDDEN_ADMIN_REQUIRED','Somente ADMIN.',403); }
      function normalizaModoParadaManutencao115_(value){ var mode=upper_(value||'DECISAO_EXECUTOR'); return ['OBRIGATORIA','SEM_PARADA','DECISAO_EXECUTOR'].indexOf(mode)>=0?mode:'DECISAO_EXECUTOR'; }
      function isPlanoOperacional_(plan){ return !!plan && upper_(plan.status) === 'ATIVO' && ['VALIDADO','ATIVO'].indexOf(upper_(plan.workflow_status || 'VALIDADO')) >= 0; }
      function hist_(data){ append_('historico', fit_('historico', Object.assign({id:uuid_('HIS'),criado_em:now_()},data))); }
    `,
  ].join('\n'),
  context,
)

const result = JSON.parse(vm.runInContext(`JSON.stringify((function(){
  var admin = {usuario_id:'USR-ADMIN',perfil:'ADMIN',nome:'Admin'};
  var quality = {usuario_id:'USR-QUALIDADE',perfil:'GESTOR',nome:'Gestora Qualidade'};
  var safety = {usuario_id:'USR-SEGURANCA',perfil:'GESTOR',nome:'Gestor Seguranca'};
  var maintenance = {usuario_id:'USR-MANUTENCAO',perfil:'GESTOR',nome:'Gestor Manutencao'};

  var sent = adminDemandasTecnicasEnviar_({demanda:{
    tipo:'VALIDACAO_CHECKLIST', entidade_tipo:'CHECKLIST_MODELO', entidade_id:'PLN-1',
    titulo:'Validar inspecao critica', descricao:'Requer qualidade e seguranca', prioridade:'ALTA',
    politica_assinatura:'QUALIDADE_E_SEGURANCA', exige_segregacao:true,
    versao_entidade:'2'
  },__auth:admin}, admin);
  var demandId = sent.demanda.id;
  var qualityQueueBefore = gestorDemandasListar_({}, quality).demandas;
  var safetyQueueBefore = gestorDemandasListar_({}, safety).demandas;
  var maintenanceQueueBefore = gestorDemandasListar_({}, maintenance).demandas;
  var sharedClaim = gestorDemandaAssumir_({demanda_id:demandId}, quality);
  var safetyQueueAfterSharedClaim = gestorDemandasListar_({}, safety).demandas;
  var forwardError = '';
  try{
    gestorDemandaEncaminhar_({
      demanda_id:demandId,
      para_area_id:'AREA-MANUTENCAO',
      para_cargo_id:'CARGO-MANUTENCAO',
      motivo:'Tentativa de retirar o documento do filtro.'
    }, quality);
  } catch(error){
    forwardError = error.code || error.message;
  }
  var maintenanceValidationError = '';
  try{
    gestorDemandaValidar_({demanda_id:demandId,parecer:'Tentativa indevida da manutencao.'}, maintenance);
  } catch(error){
    maintenanceValidationError = error.code || error.message;
  }
  var qualityValidation = gestorDemandaValidar_({
    demanda_id:demandId,
    parecer:'Conformidade e criterios de qualidade verificados.'
  }, quality);
  var planAfterFirstSignature = Object.assign({}, find_('planos_manutencao','id','PLN-1'));
  var duplicateQualityValidation = gestorDemandaValidar_({
    demanda_id:demandId,
    parecer:'Conformidade e criterios de qualidade verificados.'
  }, quality);
  var signatureCountAfterDuplicate = rows_('assinaturas_tecnicas').length;
  var safetyValidation = gestorDemandaValidar_({
    demanda_id:demandId,
    parecer:'Riscos, bloqueios e requisitos de seguranca verificados.'
  }, safety);
  var qualityQueueAfter = gestorDemandasListar_({}, quality).demandas;
  var safetyQueueAfter = gestorDemandasListar_({}, safety).demandas;

  var analysis = gestorAnaliseSalvar_({analise:{
    ocorrencia_id:'OCR-1',titulo:'Analise de vibracao',diagnostico:'Desalinhamento provavel',
    risco:'Falha de rolamento',causa_provavel:'Acoplamento',recomendacao:'Criar checklist de alinhamento',
    recomenda_checklist:true,recomenda_os:true,prioridade:'ALTA',
    relatorio_tecnico:{
      situacao:'Vibracao elevada no motor principal',
      causa_provavel:'Desalinhamento do acoplamento',
      resultado_esperado:'Vibracao dentro da faixa',
      etapas:[{ordem:1,titulo:'Medir vibracao',descricao:'Registrar os tres eixos.'}],
      seguranca:['Bloquear o equipamento.'],
      nrs:['NR-12'],
      ferramentas:[{tipo:'MEDICAO',nome:'Vibrometro'}],
      riscos:[{tipo:'MECANICO',titulo:'Partes moveis',descricao:'Bloquear antes de medir.'}],
      evidencias_requeridas:['Leitura final'],
      criterio_aceite:'Vibracao dentro da faixa aprovada.'
    }
  }}, maintenance);
  gestorAnaliseEnviarAdmin_({analise_id:analysis.analise.id}, maintenance);

  var interventionSaved = adminIntervencaoSalvar_({dados:{
    ativo_id:'ATV-1',componente_id:'CMP-1',plano_id:'PLN-1',tipo:'CORRETIVA',titulo:'Corrigir vibracao',
    descricao:'Inspecionar acoplamento e corrigir desalinhamento.',prioridade:'ALTA',
    modo_parada_manutencao:'OBRIGATORIA'
  }}, admin);
  var actionsBeforeRelease = rows_('os_acoes').length;
  var interventionSent = adminIntervencaoEnviarValidacao_({
    intervencao_id:interventionSaved.intervencao.id,
    politica_assinatura:'QUALIDADE',
    comentario:'Validar conformidade e liberar execucao.',
    exige_segregacao:'SIM'
  }, admin);
  var interventionDecision = gestorDemandaValidar_({
    demanda_id:interventionSent.demanda.id,
    parecer:'Intervencao segura e liberada para o operador.',
    relatorio_tecnico:{
      situacao:'Vibracao elevada no acoplamento',
      causa_provavel:'Desalinhamento',
      resultado_esperado:'Conjunto alinhado e testado',
      etapas:[
        {ordem:1,titulo:'Bloquear',descricao:'Aplicar bloqueio mecanico e eletrico.'},
        {ordem:2,titulo:'Alinhar',descricao:'Medir e corrigir o acoplamento.'},
        {ordem:3,titulo:'Testar',descricao:'Medir vibracao apos a partida.'}
      ],
      seguranca:['Aplicar LOTO.'],
      nrs:['NR-10','NR-12'],
      ferramentas:[{tipo:'MEDICAO',nome:'Alinhador a laser'}],
      riscos:[{tipo:'MECANICO',titulo:'Partes moveis',descricao:'Manter protecoes instaladas.'}],
      evidencias_requeridas:['Medicao antes e depois'],
      criterio_aceite:'Vibracao dentro do limite tecnico.'
    }
  }, quality);
  var interventionOrder = find_('ordens_servico','id',interventionSaved.intervencao.id);
  var interventionAction = rows_('os_acoes').find(function(item){ return String(item.os_id) === String(interventionOrder.id); });

  return {
    demandId:demandId,
    qualityQueueBefore:qualityQueueBefore.length,
    safetyQueueBefore:safetyQueueBefore.length,
    maintenanceQueueBefore:maintenanceQueueBefore.length,
    sharedClaim:sharedClaim,
    safetyQueueAfterSharedClaim:safetyQueueAfterSharedClaim.length,
    forwardError:forwardError,
    maintenanceValidationError:maintenanceValidationError,
    qualityValidation:qualityValidation,
    duplicateQualityValidation:duplicateQualityValidation,
    signatureCountAfterDuplicate:signatureCountAfterDuplicate,
    safetyValidation:safetyValidation,
    qualityQueueAfter:qualityQueueAfter.length,
    safetyQueueAfter:safetyQueueAfter.length,
    planAfterFirstSignature:planAfterFirstSignature,
    demand:find_('demandas_tecnicas','id',demandId),
    plan:find_('planos_manutencao','id','PLN-1'),
    signatures:rows_('assinaturas_tecnicas'),
    transitions:rows_('demanda_tramitacoes').filter(function(item){ return String(item.demanda_id) === String(demandId); }),
    analysis:find_('analises_tecnicas','id',analysis.analise.id),
    occurrence:find_('ocorrencias_operacionais','id','OCR-1'),
    adminNotifications:rows_('notificacoes').filter(function(item){ return item.usuario_id === 'USR-ADMIN'; }),
    actionsBeforeRelease:actionsBeforeRelease,
    interventionDecision:interventionDecision,
    interventionOrder:interventionOrder,
    interventionAction:interventionAction
  };
})())`, context))

const notificationResult = JSON.parse(vm.runInContext(`JSON.stringify((function(){
  var reader = {usuario_id:'USR-ADMIN',perfil:'ADMIN',nome:'Admin'};
  var persistent = rows_('notificacoes').find(function(item){
    return item.usuario_id === reader.usuario_id && upper_(item.status) === 'NAO_LIDA';
  });
  var firstRead = gestorNotificacaoMarcarLida_({notificacao_id:persistent.id}, reader);
  var repeatedRead = gestorNotificacaoMarcarLida_({notificacao_id:persistent.id}, reader);
  var contextRead = gestorNotificacaoMarcarLida_({
    entidade_tipo:'PARADAS_EQUIPAMENTO',
    entidade_id:'PARADA-VIRTUAL-1',
    tipo:'PARADA_TECNICA',
    titulo:'Parada consultada',
    prioridade:'CRITICA'
  }, reader);
  var contextRepeated = gestorNotificacaoMarcarLida_({
    entidade_tipo:'PARADAS_EQUIPAMENTO',
    entidade_id:'PARADA-VIRTUAL-1'
  }, reader);
  var listed = gestorNotificacoesListar_({}, reader).notificacoes;
  return {
    firstRead:firstRead,
    repeatedRead:repeatedRead,
    contextRead:contextRead,
    contextRepeated:contextRepeated,
    persistentStatus:find_('notificacoes','id',persistent.id).status,
    contextMarkers:listed.filter(function(item){
      return upper_(item.entidade_tipo) === 'PARADAS_EQUIPAMENTO' &&
        item.entidade_id === 'PARADA-VIRTUAL-1';
    })
  };
})())`, context))

assert(result.qualityQueueBefore === 1, 'Qualidade não recebeu a demanda do administrador')
assert(result.safetyQueueBefore === 1, 'Segurança não recebeu a demanda do administrador')
assert(result.maintenanceQueueBefore === 0, 'Manutenção recebeu documento reservado aos validadores')
assert(result.sharedClaim.shared_queue === true, 'uma pessoa conseguiu reservar uma validação compartilhada')
assert(result.safetyQueueAfterSharedClaim === 1, 'assumir a demanda ocultou a fila da outra área obrigatória')
assert(result.forwardError === 'TECH_VALIDATION_FORWARD_DISABLED', 'documento saiu do filtro definido pelo Administrador')
assert(
  ['TECH_DEMAND_FORBIDDEN', 'TECH_VALIDATOR_NOT_ALLOWED'].includes(result.maintenanceValidationError),
  'Manutenção conseguiu assinar um documento técnico',
)
assert(result.qualityValidation.completed === false, 'primeira assinatura liberou uma política que exige ambas')
assert(result.duplicateQualityValidation.already_validated === true, 'repetição da assinatura não foi idempotente')
assert(result.signatureCountAfterDuplicate === 1, 'repetição criou uma segunda assinatura')
assert(result.planAfterFirstSignature.status === 'INATIVO', 'checklist foi ativado antes de todas as assinaturas')
assert(result.safetyValidation.completed === true, 'assinatura de Segurança não concluiu a validação')
assert(result.qualityQueueAfter === 0 && result.safetyQueueAfter === 0, 'documento finalizado permaneceu na fila')
assert(result.signatures.length === 3, 'assinaturas permanentes dos dois documentos não foram persistidas')
assert(result.signatures[0].payload_hash === result.demand.payload_hash, 'assinatura não corresponde à versão/hash da demanda')
assert(result.transitions.length === 3, 'trilha deveria conter apenas envio, assinatura parcial e assinatura final')
assert(result.demand.status === 'APROVADA_TECNICAMENTE', 'checklist não foi aprovado pelo filtro técnico')
assert(result.plan.status === 'ATIVO' && result.plan.workflow_status === 'VALIDADO', 'plano não foi ativado após aprovação')
assert(result.analysis.status === 'ENVIADA_ADMIN', 'análise de ocorrência não chegou ao administrador')
assert(JSON.parse(result.analysis.relatorio_tecnico_json).etapas.length === 1, 'análise estruturada não foi persistida')
assert(result.occurrence.status === 'EM_TRATAMENTO_ADMIN', 'ocorrência não sinalizou tratamento administrativo')
assert(result.occurrence.tratamento_status === 'AGUARDANDO_ADMIN', 'operador não recebeu o estado de tratamento da ocorrência')
assert(result.adminNotifications.length >= 2, 'administrador não recebeu decisão e análise')
assert(result.actionsBeforeRelease === 0, 'rascunho administrativo apareceu ao Operador antes da validação')
assert(result.interventionDecision.demanda.status === 'LIBERADA_OPERACAO', 'intervenção não recebeu liberação técnica')
assert(result.interventionOrder.status === 'ABERTA', 'OS não foi aberta depois da liberação')
assert(result.interventionAction.status === 'PENDENTE', 'ação não chegou ao Operador depois da liberação')
assert(result.interventionAction.plano_id === 'PLN-1', 'ação foi liberada sem checklist executável')
assert(result.interventionAction.modo_parada_manutencao === 'OBRIGATORIA', 'modo de parada não foi preservado')
assert(JSON.parse(result.interventionOrder.analise_tecnica_json).etapas.length === 3, 'briefing não foi vinculado à OS')
assert(result.interventionAction.analise_tecnica_json === result.interventionOrder.analise_tecnica_json, 'briefing não chegou à ação do Operador')
assert(notificationResult.firstRead.read === true, 'clique não marcou a notificação persistente')
assert(notificationResult.repeatedRead.already_read === true, 'leitura repetida não foi idempotente')
assert(notificationResult.persistentStatus === 'LIDA', 'status persistente da notificação não foi atualizado')
assert(notificationResult.contextRead.context_acknowledged === true, 'alerta operacional virtual não criou reconhecimento')
assert(notificationResult.contextRepeated.already_read === true, 'reconhecimento virtual repetido não foi idempotente')
assert(notificationResult.contextMarkers.length === 1, 'contexto virtual criou reconhecimentos duplicados')
assert(notificationResult.contextMarkers[0].status === 'LIDA', 'reconhecimento virtual não foi gravado como lido')

console.log('FLUXO TÉCNICO E2E EM MEMÓRIA APROVADO')
console.log('ADMIN → QUALIDADE + SEGURANÇA (assinaturas permanentes) → CHECKLIST APROVADO')
console.log('OPERADOR (ocorrência) → PERFIL TÉCNICO (análise) → ADMIN')
console.log('ADMIN (intervenção) → QUALIDADE (assinatura) → OPERADOR (ação pendente)')
