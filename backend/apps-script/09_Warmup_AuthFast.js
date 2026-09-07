/**
 * FAB Control 10.3
 * Warmup operacional e cache de autenticação.
 */

function authCacheKey_(token){
  return "FAB_AUTH_" + FAB.VERSION + "_" + sha256_(token).slice(0,32);
}

function cacheAuthSession_(auth){
  if(!auth || !auth.token) return false;
  if(upper_(auth.perfil) === ROLE.SISTEMA) return false;
  var expMs = auth.expira_ms || new Date(auth.expira_em || "").getTime();
  if(!expMs || expMs < Date.now()) return false;

  var ttlByExp = Math.floor((expMs - Date.now()) / 1000);
  var ttl = Math.max(5, Math.min(FAB.AUTH_CACHE_SECONDS || 180, ttlByExp));

  return safeCachePutJson_(authCacheKey_(auth.token), {
    token:auth.token,
    usuario_id:auth.usuario_id,
    nome:auth.nome,
    email:auth.email,
    perfil:upper_(auth.perfil),
    expira_em:auth.expira_em || "",
    expira_ms:expMs
  }, ttl);
}

function getCachedAuthSession_(token){
  if(!token) return null;
  var hit = safeCacheGetJson_(authCacheKey_(token));
  if(!hit) return null;
  if(hit.expira_ms && Number(hit.expira_ms) < Date.now()){
    safeCacheRemove_(authCacheKey_(token));
    return null;
  }
  if(upper_(hit.perfil) === ROLE.SISTEMA){
    safeCacheRemove_(authCacheKey_(token));
    return null;
  }
  return hit;
}

function ensurePermission_(perfil, action){
  perfil = upper_(perfil);
  var configuredDecision = typeof adminPermissionDecision_ === "function"
    ? adminPermissionDecision_(perfil, action)
    : null;
  if(configuredDecision === true) return true;
  if(configuredDecision === false){
    err_("FORBIDDEN", "Perfil "+perfil+" sem permissão configurada para "+action, 403);
  }
  var lista = (PERM && PERM[perfil]) ? PERM[perfil] : [];
  if(lista.indexOf(action) >= 0) return true;

  // Hotfix 1.0.8.2: proteção contra matriz PERM antiga em projetos parcialmente atualizados.
  // Estes endpoints são administrativos de schema/reparo e continuam bloqueados para GESTOR/OPERADOR.
  if(perfil === ROLE.ADMIN){
    var adminHardAllow = [
      "cmms.schema_upgrade",
      "cmms.catalogo_checklist_schema_upgrade",
      "cmms.execucao_checklist_schema_upgrade",
      "cmms.auditoria_operador_schema_upgrade",
      "admin.corrigir_auditoria_execucao_operador",
      "admin.gerar_acao_teste_checklist"
    ];
    if(adminHardAllow.indexOf(action) >= 0) return true;
  }

  err_("FORBIDDEN","Perfil "+perfil+" sem permissão para "+action,403);
}

function sistemaWarmup_(p){
  var auth = p.__auth || {};
  var perfil = upper_(auth.perfil || "");
  var started = Date.now();

  var tables = [
    "ativos",
    "componentes",
    "planos_manutencao",
    "plano_controle",
    "os_acoes",
    "ordens_servico",
    "execucao_locks"
  ];

  if(perfil === ROLE.GESTOR){
    tables = tables.concat([
      "plantas",
      "setores",
      "linhas",
      "usuarios",
      "execucoes",
      "checklist_execucao",
      "historico",
      "materiais",
      "plano_itens",
      "evidencias",
      "materiais_uso",
      "parametros",
      "paradas_equipamento",
      "paradas_manutencao",
      "ocorrencias_operacionais",
      "areas_tecnicas",
      "cargos_tecnicos",
      "demandas_tecnicas",
      "demanda_tramitacoes",
      "assinaturas_tecnicas",
      "analises_tecnicas",
      "notificacoes",
      "turnos",
      "apontamentos_producao",
      "sla_politicas",
      "checklist_modelo_validacoes",
      "checklist_tipos_item",
      "checklist_validacao_regras",
      "dashboard_cache"
    ]);
  }

  if(perfil === ROLE.ADMIN){
    var deferredAdminTables = {
      sessoes:true,
      audit_log:true,
      historico:true,
      telemetria_sessoes:true,
      modelo_checklist_auditoria:true,
      importacao_registros:true,
      documento_revisoes:true
    };
    tables = Object.keys(SH).filter(function(name){
      return !deferredAdminTables[name];
    });
  }

  tables = tables.filter(function(name, index, collection){
    return !!SH[name] && collection.indexOf(name) === index;
  });

  var loaded = {};
  tables.forEach(function(name){
    var r = rows_(name);
    loaded[name] = r.length;
  });

  var qrIndex = getQrIndex_();

  var resumo = null;
  if(perfil === ROLE.ADMIN || perfil === ROLE.GESTOR){
    resumo = adminResumoCache_({no_cache:true});
  }

  var qrResult = null;
  if(clean_(p.qr_payload)){
    qrResult = operadorContextoQrFast_({
      token:p.token,
      qr_payload:p.qr_payload,
      __auth:auth,
      motor:p.motor
    });
  }

  var out = {
    warmed:true,
    version:FAB.VERSION,
    perfil:perfil,
    usuario_id:auth.usuario_id || "",
    elapsed_internal_ms:Date.now()-started,
    loaded:loaded,
    loaded_tables:Object.keys(loaded).length,
    qr_index_keys:qrIndex.keys,
    resumo:resumo ? {totais:resumo.totais || null, cache:resumo.cache || null} : null,
    qr_result:qrResult ? {
      found:qrResult.found,
      tipo_contexto:qrResult.tipo_contexto,
      proxima_acao:qrResult.proxima_acao ? qrResult.proxima_acao.id : null,
      cache:qrResult.cache || null
    } : null,
    next:{
      operador:"usar operador.contexto_qr_fast",
      admin:"usar admin.resumo_cache",
      gestor:"usar gestor.modelos_em_validacao e gestor.detalhe_acao_fast"
    }
  };

  safeCachePutJson_(metaCacheKey_("warmup_status"), {
    generated_em:now_(),
    perfil:perfil,
    usuario_id:auth.usuario_id || "",
    elapsed_internal_ms:out.elapsed_internal_ms,
    loaded:loaded,
    loaded_tables:out.loaded_tables,
    qr_index_keys:qrIndex.keys
  }, FAB.WARMUP_CACHE_SECONDS || 300);

  return out;
}
