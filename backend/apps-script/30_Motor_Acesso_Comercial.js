const MOTOR_COMMERCIAL_SCHEMA_VERSION = "1";
const MOTOR_SUBSCRIPTION_PROPERTY = "FAB_CONTROL_SUBSCRIPTION_V1";
const MOTOR_SUBSCRIPTION_SECRET_PROPERTY = "FAB_CONTROL_SUBSCRIPTION_SIGNING_SECRET";
const MOTOR_MAINTENANCE_PROPERTY = "FAB_CONTROL_MOTOR_MAINTENANCE_V1";
const MOTOR_MAINTENANCE_SECRET_PROPERTY = "FAB_CONTROL_MOTOR_MAINTENANCE_SIGNING_SECRET";
const MOTOR_TENANT_PROPERTY = "FAB_CONTROL_SPREADSHEET_ID";

var MOTOR_SUBSCRIPTION_CACHE = null;
var MOTOR_MAINTENANCE_CACHE = null;

const MOTOR_FEATURE = {
  CADASTROS: "CADASTROS",
  ORDENS_SERVICO: "ORDENS_SERVICO",
  CHECKLISTS: "CHECKLISTS",
  GESTAO_TECNICA: "GESTAO_TECNICA",
  INDICADORES: "INDICADORES",
  DOCUMENTOS: "DOCUMENTOS",
  IMPORTACOES: "IMPORTACOES",
  AUDITORIA: "AUDITORIA",
  CONTINUIDADE: "CONTINUIDADE",
  MOTOR_LIMITADO: "MOTOR_LIMITADO"
};

const MOTOR_FEATURE_CATALOG = [
  {codigo:MOTOR_FEATURE.CADASTROS, nome:"Cadastros e estrutura fabril"},
  {codigo:MOTOR_FEATURE.ORDENS_SERVICO, nome:"Ordens de serviço"},
  {codigo:MOTOR_FEATURE.CHECKLISTS, nome:"Checklists e evidências"},
  {codigo:MOTOR_FEATURE.GESTAO_TECNICA, nome:"Gestão e validação técnica"},
  {codigo:MOTOR_FEATURE.INDICADORES, nome:"Indicadores operacionais"},
  {codigo:MOTOR_FEATURE.DOCUMENTOS, nome:"Documentos técnicos"},
  {codigo:MOTOR_FEATURE.IMPORTACOES, nome:"Importações governadas"},
  {codigo:MOTOR_FEATURE.AUDITORIA, nome:"Auditoria e monitoramento"},
  {codigo:MOTOR_FEATURE.CONTINUIDADE, nome:"Backup e continuidade"},
  {codigo:MOTOR_FEATURE.MOTOR_LIMITADO, nome:"Configurações operacionais"}
];

const MOTOR_PLAN_CATALOG = {
  INICIAL: {
    codigo:"INICIAL",
    nome:"Inicial",
    recursos:[MOTOR_FEATURE.CADASTROS, MOTOR_FEATURE.ORDENS_SERVICO, MOTOR_FEATURE.MOTOR_LIMITADO]
  },
  BASICO: {
    codigo:"BASICO",
    nome:"Básico",
    recursos:[
      MOTOR_FEATURE.CADASTROS, MOTOR_FEATURE.ORDENS_SERVICO, MOTOR_FEATURE.CHECKLISTS,
      MOTOR_FEATURE.GESTAO_TECNICA, MOTOR_FEATURE.INDICADORES, MOTOR_FEATURE.MOTOR_LIMITADO
    ]
  },
  COMPLETO: {
    codigo:"COMPLETO",
    nome:"Completo",
    recursos:MOTOR_FEATURE_CATALOG.map(function(item){ return item.codigo; })
  }
};

function motorEffectivePlanCatalogState_(){
  if(typeof motorCommercialCatalogRuntime_ === "function"){
    return motorCommercialCatalogRuntime_();
  }
  return {
    catalogo:MOTOR_PLAN_CATALOG,
    planos:Object.keys(MOTOR_PLAN_CATALOG).map(function(code){ return MOTOR_PLAN_CATALOG[code]; }),
    versao_id:"",
    numero:0,
    origem:"PADRAO_EM_CODIGO",
    integridade:"PADRAO_SEGURO"
  };
}

// As regras mais específicas devem permanecer antes dos prefixos genéricos.
const MOTOR_ACTION_FEATURE_RULES = [
  {prefixo:"admin.configuracao.", recurso:MOTOR_FEATURE.MOTOR_LIMITADO},
  {prefixo:"admin.importacao.", recurso:MOTOR_FEATURE.IMPORTACOES},
  {prefixo:"admin.documentos.", recurso:MOTOR_FEATURE.DOCUMENTOS},
  {prefixo:"admin.auditoria.", recurso:MOTOR_FEATURE.AUDITORIA},
  {prefixo:"admin.monitoramento.", recurso:MOTOR_FEATURE.AUDITORIA},
  {prefixo:"admin.backups.", recurso:MOTOR_FEATURE.CONTINUIDADE},
  {prefixo:"admin.intervencoes.", recurso:MOTOR_FEATURE.GESTAO_TECNICA},
  {prefixo:"admin.areas_tecnicas.", recurso:MOTOR_FEATURE.GESTAO_TECNICA},
  {prefixo:"admin.cargos_tecnicos.", recurso:MOTOR_FEATURE.GESTAO_TECNICA},
  {prefixo:"admin.demandas_tecnicas.", recurso:MOTOR_FEATURE.GESTAO_TECNICA},
  {prefixo:"admin.analises_tecnicas.", recurso:MOTOR_FEATURE.GESTAO_TECNICA},
  {prefixo:"admin.registrar_horimetro_telemetria", recurso:MOTOR_FEATURE.GESTAO_TECNICA},
  {prefixo:"admin.reiniciar_contador_servico", recurso:MOTOR_FEATURE.GESTAO_TECNICA},
  {prefixo:"admin.verificar_drive_evidencias", recurso:MOTOR_FEATURE.DOCUMENTOS},
  {prefixo:"admin.salvar_modelo_checklist", recurso:MOTOR_FEATURE.CHECKLISTS},
  {prefixo:"admin.enviar_modelo_checklist_validacao", recurso:MOTOR_FEATURE.CHECKLISTS},
  {prefixo:"admin.detalhe_modelo_checklist", recurso:MOTOR_FEATURE.CHECKLISTS},
  {prefixo:"admin.listar_modelos_checklist", recurso:MOTOR_FEATURE.CHECKLISTS},
  {prefixo:"admin.modelos_devolvidos", recurso:MOTOR_FEATURE.CHECKLISTS},
  {prefixo:"admin.corrigir_modelo_checklist", recurso:MOTOR_FEATURE.CHECKLISTS},
  {prefixo:"admin.criar_revisao_modelo_checklist", recurso:MOTOR_FEATURE.CHECKLISTS},
  {prefixo:"admin.gerar_acao_teste_checklist", recurso:MOTOR_FEATURE.CHECKLISTS},
  {prefixo:"admin.corrigir_auditoria_execucao_operador", recurso:MOTOR_FEATURE.CHECKLISTS},
  {prefixo:"admin.listar_tipos_item_checklist", recurso:MOTOR_FEATURE.CHECKLISTS},
  {prefixo:"admin.listar_regras_checklist", recurso:MOTOR_FEATURE.CHECKLISTS},
  {prefixo:"admin.validar_catalogo_item_checklist", recurso:MOTOR_FEATURE.CHECKLISTS},
  {prefixo:"admin.salvar_item_modelo_checklist", recurso:MOTOR_FEATURE.CHECKLISTS},
  {prefixo:"admin.remover_item_modelo_checklist", recurso:MOTOR_FEATURE.CHECKLISTS},
  {prefixo:"admin.reordenar_itens_modelo_checklist", recurso:MOTOR_FEATURE.CHECKLISTS},
  {prefixo:"admin.clonar_item_modelo_checklist", recurso:MOTOR_FEATURE.CHECKLISTS},
  {prefixo:"admin.listar_itens_modelo_checklist", recurso:MOTOR_FEATURE.CHECKLISTS},
  {prefixo:"admin.detalhar_modelo_checklist_catalogo", recurso:MOTOR_FEATURE.CHECKLISTS},
  {prefixo:"admin.usuarios.", recurso:MOTOR_FEATURE.CADASTROS},
  {prefixo:"admin.permissoes.", recurso:MOTOR_FEATURE.CADASTROS},
  {prefixo:"admin.empresa.", recurso:MOTOR_FEATURE.CADASTROS},
  {prefixo:"admin.listar", recurso:MOTOR_FEATURE.CADASTROS},
  {prefixo:"admin.obter", recurso:MOTOR_FEATURE.CADASTROS},
  {prefixo:"admin.salvar", recurso:MOTOR_FEATURE.CADASTROS},
  {prefixo:"admin.entidade.acao", recurso:MOTOR_FEATURE.CADASTROS},
  {prefixo:"admin.recalcular_ativo", recurso:MOTOR_FEATURE.CADASTROS},
  {prefixo:"admin.gerar_qr", recurso:MOTOR_FEATURE.CADASTROS},
  {prefixo:"admin.criar_demo", recurso:MOTOR_FEATURE.CADASTROS},
  {prefixo:"gestor.modelos_", recurso:MOTOR_FEATURE.CHECKLISTS},
  {prefixo:"gestor.listar_modelos_checklist", recurso:MOTOR_FEATURE.CHECKLISTS},
  {prefixo:"gestor.detalhe_modelo_checklist", recurso:MOTOR_FEATURE.CHECKLISTS},
  {prefixo:"gestor.validar_modelo_checklist", recurso:MOTOR_FEATURE.CHECKLISTS},
  {prefixo:"gestor.auditoria_execucao_checklist", recurso:MOTOR_FEATURE.CHECKLISTS},
  {prefixo:"gestor.", recurso:MOTOR_FEATURE.GESTAO_TECNICA},
  {prefixo:"cmms.kpis", recurso:MOTOR_FEATURE.INDICADORES},
  {prefixo:"cmms.motor_recalcular", recurso:MOTOR_FEATURE.GESTAO_TECNICA},
  {prefixo:"catalogo.checklist_", recurso:MOTOR_FEATURE.CHECKLISTS},
  {prefixo:"operador.salvar_checklist", recurso:MOTOR_FEATURE.CHECKLISTS},
  {prefixo:"operador.listar_checklist", recurso:MOTOR_FEATURE.CHECKLISTS},
  {prefixo:"operador.detalhar_checklist", recurso:MOTOR_FEATURE.CHECKLISTS},
  {prefixo:"operador.registrar_evidencia", recurso:MOTOR_FEATURE.CHECKLISTS},
  {prefixo:"operador.upload_evidencia", recurso:MOTOR_FEATURE.CHECKLISTS},
  {prefixo:"operador.validar_resposta_checklist_item", recurso:MOTOR_FEATURE.CHECKLISTS},
  {prefixo:"operador.", recurso:MOTOR_FEATURE.ORDENS_SERVICO},
  {prefixo:"lock.", recurso:MOTOR_FEATURE.ORDENS_SERVICO},
  {prefixo:"telemetria.", recurso:MOTOR_FEATURE.ORDENS_SERVICO}
];

const MOTOR_CORE_ACTIONS = [
  "sistema.warmup",
  "cmms.operador_visual_schema_upgrade",
  "cmms.tela_operador_schema_upgrade",
  "cmms.operador_ui_schema_upgrade",
  "cmms.operacional_ui_schema_upgrade",
  "cmms.contrato_frontend_schema_upgrade",
  "cmms.frontend_contract_schema_upgrade",
  "cmms.execucao_checklist_schema_upgrade",
  "cmms.auditoria_operador_schema_upgrade",
  "cmms.paradas_operacionais_schema_upgrade",
  "cmms.horimetro_evidencias_schema_upgrade",
  "cmms.workflow_tecnico_schema_upgrade",
  "cmms.configuracao_schema_upgrade",
  "cmms.importacao_admin_schema_upgrade",
  "cmms.catalogo_checklist_schema_upgrade",
  "cmms.schema_upgrade",
  "cmms.diagnostico",
  "cmms.higiene_diagnosticar",
  "cmms.higienizar_status",
  "cmms.higienizar_duplicidades",
  "cmms.higienizar_base",
  "perf.cache_status",
  "perf.cache_clear",
  "admin.acesso.estado",
  "admin.resumo",
  "admin.resumo_cache"
];

function motorUniqueKnownFeatures_(features){
  var known = {};
  MOTOR_FEATURE_CATALOG.forEach(function(item){ known[item.codigo] = true; });
  var unique = {};
  return (Array.isArray(features) ? features : []).map(function(item){ return upper_(item); }).filter(function(item){
    if(!known[item] || unique[item]) return false;
    unique[item] = true;
    return true;
  });
}

function motorHmac_(payload, secret){
  var bytes = Utilities.computeHmacSha256Signature(String(payload), String(secret));
  return Utilities.base64EncodeWebSafe(bytes).replace(/=+$/g, "");
}

function motorReadSignedProperty_(propertyName, secretName){
  var properties = PropertiesService.getScriptProperties();
  var raw = clean_(properties.getProperty(propertyName));
  var secret = clean_(properties.getProperty(secretName));
  if(!raw) return {estado:"AUSENTE"};
  if(!secret) return {estado:"INVALIDO", motivo:"SEGREDO_AUSENTE"};
  var envelope;
  try { envelope = JSON.parse(raw); } catch(e){ return {estado:"INVALIDO", motivo:"FORMATO_INVALIDO"}; }
  var payload = clean_(envelope && envelope.payload);
  var signature = clean_(envelope && envelope.signature);
  if(!payload || !signature) return {estado:"INVALIDO", motivo:"ENVELOPE_INCOMPLETO"};
  var expected = motorHmac_(payload, secret);
  if(!authSecureEquals_(signature, expected)) return {estado:"INVALIDO", motivo:"ASSINATURA_INVALIDA"};
  try {
    return {estado:"VALIDO", dados:JSON.parse(payload)};
  } catch(e){
    return {estado:"INVALIDO", motivo:"CONTEUDO_INVALIDO"};
  }
}

function motorConfiguredTenantId_(){
  return clean_(PropertiesService.getScriptProperties().getProperty(MOTOR_TENANT_PROPERTY));
}

function motorLegacySubscription_(catalog){
  var complete = catalog.COMPLETO;
  return {
    plano:complete,
    recursos:complete.recursos.slice(),
    status:"ATIVA",
    origem:"COMPATIBILIDADE_1_4_0",
    integridade:"PADRAO_SEGURO_DE_MIGRACAO",
    valido_ate:""
  };
}

function motorBlockedSubscription_(reason){
  return {
    plano:{codigo:"BLOQUEADO", nome:"Acesso suspenso", recursos:[]},
    recursos:[],
    status:"BLOQUEADA",
    origem:"POLITICA_DE_PLATAFORMA",
    integridade:reason || "CONFIGURACAO_INVALIDA",
    valido_ate:""
  };
}

function motorSubscriptionState_(){
  if(MOTOR_SUBSCRIPTION_CACHE) return MOTOR_SUBSCRIPTION_CACHE;
  var catalogState = motorEffectivePlanCatalogState_();
  if(catalogState.integridade === "INVALIDA"){
    MOTOR_SUBSCRIPTION_CACHE = motorBlockedSubscription_("CATALOGO_COMERCIAL_INVALIDO");
    return MOTOR_SUBSCRIPTION_CACHE;
  }
  var catalog = catalogState.catalogo;
  var signed = motorReadSignedProperty_(MOTOR_SUBSCRIPTION_PROPERTY, MOTOR_SUBSCRIPTION_SECRET_PROPERTY);
  if(signed.estado === "AUSENTE"){
    MOTOR_SUBSCRIPTION_CACHE = motorLegacySubscription_(catalog);
    return MOTOR_SUBSCRIPTION_CACHE;
  }
  if(signed.estado !== "VALIDO"){
    MOTOR_SUBSCRIPTION_CACHE = motorBlockedSubscription_(signed.motivo);
    return MOTOR_SUBSCRIPTION_CACHE;
  }
  var data = signed.dados || {};
  var plan = catalog[upper_(data.plano)];
  if(!plan){
    MOTOR_SUBSCRIPTION_CACHE = motorBlockedSubscription_("PLANO_DESCONHECIDO");
    return MOTOR_SUBSCRIPTION_CACHE;
  }
  var tenantId = clean_(data.tenant_id);
  var configuredTenantId = motorConfiguredTenantId_();
  if(!configuredTenantId || tenantId !== configuredTenantId){
    MOTOR_SUBSCRIPTION_CACHE = motorBlockedSubscription_(configuredTenantId ? "TENANT_DIVERGENTE" : "TENANT_NAO_CONFIGURADO");
    return MOTOR_SUBSCRIPTION_CACHE;
  }
  var status = upper_(data.status || "ATIVA");
  var validUntil = clean_(data.valido_ate);
  var expiry = validUntil ? new Date(validUntil).getTime() : 0;
  if(validUntil && !Number.isFinite(expiry)){
    MOTOR_SUBSCRIPTION_CACHE = motorBlockedSubscription_("VALIDADE_INVALIDA");
    return MOTOR_SUBSCRIPTION_CACHE;
  }
  if(status !== "ATIVA" || (expiry && expiry <= Date.now())){
    MOTOR_SUBSCRIPTION_CACHE = motorBlockedSubscription_(expiry && expiry <= Date.now() ? "ASSINATURA_EXPIRADA" : "ASSINATURA_INATIVA");
    return MOTOR_SUBSCRIPTION_CACHE;
  }
  var resources = Array.isArray(data.recursos)
    ? motorUniqueKnownFeatures_(data.recursos)
    : plan.recursos.slice();
  MOTOR_SUBSCRIPTION_CACHE = {
    plano:{codigo:plan.codigo, nome:plan.nome},
    recursos:resources,
    status:"ATIVA",
    origem:"ASSINATURA_DE_PLATAFORMA",
    integridade:"VALIDA",
    valido_ate:validUntil,
    tenant_id:clean_(data.tenant_id)
  };
  return MOTOR_SUBSCRIPTION_CACHE;
}

function motorFeatureForAction_(action){
  action = clean_(action);
  for(var i = 0; i < MOTOR_ACTION_FEATURE_RULES.length; i++){
    var rule = MOTOR_ACTION_FEATURE_RULES[i];
    if(action.indexOf(rule.prefixo) === 0) return rule.recurso;
  }
  return "";
}

function motorAuthorizeAction_(action, auth){
  if(upper_(auth && auth.perfil) === ROLE.SISTEMA){
    motorRequireMaintenanceAccess_(auth);
    return true;
  }
  var feature = motorFeatureForAction_(action);
  if(!feature){
    if(MOTOR_CORE_ACTIONS.indexOf(clean_(action)) >= 0) return true;
    audit_(auth || {}, "SUBSCRIPTION_ACTION_UNCLASSIFIED", "motor_assinatura", clean_(action), null, null, "");
    err_("SUBSCRIPTION_ACTION_UNCLASSIFIED", "A operação não possui classificação comercial segura.", 403);
  }
  var subscription = motorSubscriptionState_();
  if(subscription.status === "ATIVA" && subscription.recursos.indexOf(feature) >= 0) return true;
  audit_(auth || {}, "SUBSCRIPTION_FEATURE_DENIED", "motor_assinatura", feature, null, {
    acao:clean_(action), plano:subscription.plano && subscription.plano.codigo || "", motivo:subscription.integridade
  }, "");
  err_("SUBSCRIPTION_FEATURE_REQUIRED", "O recurso solicitado não está disponível na assinatura atual.", 403);
}

function motorEnvironment_(){
  var row = find_("config", "chave", "app.environment");
  var configured = upper_(row && row.valor);
  if(configured) return configured;
  var propertyValue = PropertiesService.getScriptProperties().getProperty(PROP_APP_ENVIRONMENT);
  return upper_(propertyValue || "INDEFINIDO");
}

function motorMaintenanceState_(){
  if(MOTOR_MAINTENANCE_CACHE) return MOTOR_MAINTENANCE_CACHE;
  var signed = motorReadSignedProperty_(MOTOR_MAINTENANCE_PROPERTY, MOTOR_MAINTENANCE_SECRET_PROPERTY);
  if(signed.estado !== "VALIDO"){
    MOTOR_MAINTENANCE_CACHE = {aberta:false, estado:signed.estado === "AUSENTE" ? "FECHADA" : "BLOQUEADA", motivo:"", expira_em:""};
    return MOTOR_MAINTENANCE_CACHE;
  }
  var data = signed.dados || {};
  var enabled = data.ativa === true;
  var expiresAt = clean_(data.expira_em);
  var expiry = expiresAt ? new Date(expiresAt).getTime() : 0;
  var environmentMatches = upper_(data.ambiente) === motorEnvironment_();
  var tenantMatches = clean_(data.tenant_id) === motorConfiguredTenantId_();
  var opened = enabled && expiry > Date.now() && environmentMatches && tenantMatches;
  MOTOR_MAINTENANCE_CACHE = {
    aberta:opened,
    estado:opened ? "ABERTA" : "FECHADA",
    motivo:opened ? clean_(data.motivo) : "",
    expira_em:opened ? expiresAt : ""
  };
  return MOTOR_MAINTENANCE_CACHE;
}

function motorCommercialAccessContext_(auth){
  var subscription = motorSubscriptionState_();
  var allowed = {};
  subscription.recursos.forEach(function(code){ allowed[code] = true; });
  var internal = upper_(auth && auth.perfil) === ROLE.SISTEMA;
  var maintenance = typeof motorInternalMaintenancePublicState_ === "function"
    ? motorInternalMaintenancePublicState_(auth)
    : motorMaintenanceState_();
  var fullAccess = internal && maintenance.aberta === true;
  return {
    schema_version:MOTOR_COMMERCIAL_SCHEMA_VERSION,
    plano:{codigo:subscription.plano.codigo, nome:subscription.plano.nome},
    status:subscription.status,
    valido_ate:subscription.valido_ate || "",
    recursos:MOTOR_FEATURE_CATALOG.filter(function(item){ return allowed[item.codigo]; }).map(function(item){
      return {codigo:item.codigo, nome:item.nome};
    }),
    manutencao:maintenance,
    acesso_integral:fullAccess,
    identidade_interna:fullAccess ? {
      nome:clean_(auth && auth.nome),
      ambiente:clean_(auth && auth.ambiente),
      janela_id:clean_(auth && auth.janela_id)
    } : null,
    usuario_id:auth && auth.usuario_id || ""
  };
}

function motorCommercialAccessState_(p, auth){
  var profile = upper_(auth && auth.perfil);
  if(profile === ROLE.SISTEMA){
    motorRequireMaintenanceAccess_(auth);
    return motorCommercialAccessContext_(auth);
  }
  if(profile !== ROLE.ADMIN){
    err_("FORBIDDEN_ADMIN_REQUIRED", "A consulta do plano exige perfil ADMIN.", 403);
  }
  return motorCommercialAccessContext_(auth);
}

function motorPlatformCatalogState_(p, auth){
  if(upper_(auth && auth.perfil) !== ROLE.SISTEMA){
    err_("MOTOR_INTERNAL_IDENTITY_REQUIRED", "A operação exige identidade interna da plataforma.", 403);
  }
  motorRequireMaintenanceAccess_(auth);

  var subscription = motorSubscriptionState_();
  var catalogState = motorEffectivePlanCatalogState_();
  if(catalogState.integridade === "INVALIDA"){
    err_("MOTOR_CATALOG_INTEGRITY_FAILED", "O catálogo comercial ativo falhou na verificação de integridade.", 409);
  }
  var maintenance = typeof motorInternalMaintenancePublicState_ === "function"
    ? motorInternalMaintenancePublicState_(auth)
    : motorMaintenanceState_();

  return {
    schema_version:MOTOR_COMMERCIAL_SCHEMA_VERSION,
    gerado_em:now_(),
    ambiente:motorEnvironment_(),
    tenant_id:motorConfiguredTenantId_(),
    assinatura:{
      plano:{
        codigo:subscription.plano && subscription.plano.codigo || "",
        nome:subscription.plano && subscription.plano.nome || ""
      },
      status:subscription.status,
      origem:subscription.origem,
      integridade:subscription.integridade,
      valido_ate:subscription.valido_ate || "",
      recursos:motorUniqueKnownFeatures_(subscription.recursos)
    },
    manutencao:maintenance,
    recursos:MOTOR_FEATURE_CATALOG.map(function(feature){
      return {codigo:feature.codigo, nome:feature.nome};
    }),
    planos:Object.keys(catalogState.catalogo).map(function(code){
      var plan = catalogState.catalogo[code];
      return {
        codigo:plan.codigo,
        nome:plan.nome,
        recursos:motorUniqueKnownFeatures_(plan.recursos)
      };
    }),
    politicas:{
      padrao:"NEGAR_ACAO_NAO_CLASSIFICADA",
      regras:MOTOR_ACTION_FEATURE_RULES.map(function(rule){
        return {prefixo:rule.prefixo, recurso:rule.recurso};
      }),
      acoes_nucleo:MOTOR_CORE_ACTIONS.slice()
    },
    protecoes:{
      identidade_assinada:true,
      janela_assinada:true,
      codigo_uso_unico:true,
      sessao_sem_cache:true,
      revalidacao_por_requisicao:true
    },
    controle:typeof motorCommercialCatalogControlState_ === "function"
      ? motorCommercialCatalogControlState_(auth)
      : null
  };
}

function motorRequireMaintenanceAccess_(auth){
  var maintenance = typeof motorInternalMaintenanceState_ === "function"
    ? motorInternalMaintenanceState_()
    : motorMaintenanceState_();
  var sameWindow = !clean_(auth && auth.janela_id) || clean_(auth && auth.janela_id) === clean_(maintenance.janela_id);
  if(maintenance.aberta && sameWindow && upper_(auth && auth.perfil) === ROLE.SISTEMA) return true;
  err_("MOTOR_MAINTENANCE_REQUIRED", "O acesso integral ao Motor exige uma janela interna de manutenção.", 403);
}
