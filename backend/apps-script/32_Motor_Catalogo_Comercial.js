const MOTOR_CATALOG_SCHEMA_VERSION = "1";
const MOTOR_CATALOG_SECRET_PROPERTY = "FAB_CONTROL_PLAN_CATALOG_SIGNING_SECRET";
const MOTOR_CATALOG_ACTIVE_PROPERTY = "FAB_CONTROL_PLAN_CATALOG_ACTIVE_V1";
const MOTOR_CATALOG_DRAFT_PROPERTY = "FAB_CONTROL_PLAN_CATALOG_DRAFT_V1";
const MOTOR_CATALOG_INDEX_PROPERTY = "FAB_CONTROL_PLAN_CATALOG_VERSION_INDEX_V1";
const MOTOR_CATALOG_VERSION_PREFIX = "FAB_CONTROL_PLAN_CATALOG_VERSION_V1_";
const MOTOR_CATALOG_MAX_HISTORY = 20;
const MOTOR_CATALOG_MAX_PROPERTY_BYTES = 8500;

var MOTOR_CATALOG_RUNTIME_CACHE = null;

function motorCatalogRequireInternal_(auth){
  if(upper_(auth && auth.perfil) !== ROLE.SISTEMA){
    err_("MOTOR_INTERNAL_IDENTITY_REQUIRED", "A operação exige identidade interna da plataforma.", 403);
  }
  motorRequireMaintenanceAccess_(auth);
}

function motorCatalogSecret_(){
  return clean_(PropertiesService.getScriptProperties().getProperty(MOTOR_CATALOG_SECRET_PROPERTY));
}

function motorCatalogRequireSecret_(){
  var secret = motorCatalogSecret_();
  if(!secret){
    err_("MOTOR_CATALOG_SECRET_REQUIRED", "O segredo de assinatura do catálogo comercial não está configurado.", 503);
  }
  return secret;
}

function motorCatalogPropertyBytes_(value){
  if(Utilities && typeof Utilities.newBlob === "function"){
    return Utilities.newBlob(String(value), "application/json").getBytes().length;
  }
  return String(value).length;
}

function motorCatalogSignedEnvelope_(data){
  var secret = motorCatalogRequireSecret_();
  var payload = JSON.stringify(data);
  var envelope = JSON.stringify({
    payload:payload,
    signature:motorHmac_(payload, secret)
  });
  if(motorCatalogPropertyBytes_(envelope) > MOTOR_CATALOG_MAX_PROPERTY_BYTES){
    err_("MOTOR_CATALOG_STORAGE_LIMIT", "O catálogo excede o limite seguro de armazenamento.", 409);
  }
  return envelope;
}

function motorCatalogWriteSignedProperty_(propertyName, data){
  PropertiesService.getScriptProperties().setProperty(
    propertyName,
    motorCatalogSignedEnvelope_(data)
  );
}

function motorCatalogRestoreProperty_(properties, propertyName, previousValue){
  if(previousValue === null || previousValue === undefined){
    properties.deleteProperty(propertyName);
  } else {
    properties.setProperty(propertyName, previousValue);
  }
}

function motorCatalogPlanCodes_(){
  return ["INICIAL","BASICO","COMPLETO"];
}

function motorCatalogDefaultPlans_(){
  return motorCatalogPlanCodes_().map(function(code){
    var plan = MOTOR_PLAN_CATALOG[code];
    return {
      codigo:plan.codigo,
      nome:plan.nome,
      recursos:plan.recursos.slice()
    };
  });
}

function motorCatalogMapFromPlans_(plans){
  var catalog = {};
  (plans || []).forEach(function(plan){
    catalog[plan.codigo] = {
      codigo:plan.codigo,
      nome:plan.nome,
      recursos:plan.recursos.slice()
    };
  });
  return catalog;
}

function motorCatalogValidateSnapshot_(input){
  var source = Array.isArray(input)
    ? input
    : input && Array.isArray(input.planos)
      ? input.planos
      : [];
  var planCodes = motorCatalogPlanCodes_();
  var knownFeatures = {};
  var featureOrder = {};
  MOTOR_FEATURE_CATALOG.forEach(function(feature, index){
    knownFeatures[feature.codigo] = true;
    featureOrder[feature.codigo] = index;
  });
  var errors = [];
  var byCode = {};

  source.forEach(function(raw){
    var code = upper_(raw && raw.codigo);
    if(planCodes.indexOf(code) < 0){
      errors.push({plano:code || "DESCONHECIDO", codigo:"MOTOR_PLAN_CODE_INVALID", mensagem:"Plano não permitido."});
      return;
    }
    if(byCode[code]){
      errors.push({plano:code, codigo:"MOTOR_PLAN_DUPLICATED", mensagem:"Plano duplicado."});
      return;
    }
    var name = clean_(raw && raw.nome);
    if(name.length < 2 || name.length > 60){
      errors.push({plano:code, codigo:"MOTOR_PLAN_NAME_INVALID", mensagem:"O nome deve possuir entre 2 e 60 caracteres."});
    }
    var resources = [];
    var seen = {};
    (Array.isArray(raw && raw.recursos) ? raw.recursos : []).forEach(function(value){
      var resource = upper_(value);
      if(!knownFeatures[resource]){
        errors.push({plano:code, codigo:"MOTOR_PLAN_FEATURE_INVALID", mensagem:"Recurso não reconhecido: "+resource});
        return;
      }
      if(!seen[resource]){
        seen[resource] = true;
        resources.push(resource);
      }
    });
    resources.sort(function(left, right){ return featureOrder[left] - featureOrder[right]; });
    byCode[code] = {codigo:code, nome:name, recursos:resources};
  });

  planCodes.forEach(function(code){
    if(!byCode[code]){
      errors.push({plano:code, codigo:"MOTOR_PLAN_REQUIRED", mensagem:"Plano obrigatório ausente."});
    }
  });

  var baseline = [MOTOR_FEATURE.CADASTROS, MOTOR_FEATURE.ORDENS_SERVICO, MOTOR_FEATURE.MOTOR_LIMITADO];
  planCodes.forEach(function(code){
    if(!byCode[code]) return;
    baseline.forEach(function(resource){
      if(byCode[code].recursos.indexOf(resource) < 0){
        errors.push({
          plano:code,
          codigo:"MOTOR_PLAN_BASELINE_REQUIRED",
          mensagem:"O recurso "+resource+" é obrigatório neste plano."
        });
      }
    });
  });

  if(byCode.INICIAL && byCode.BASICO){
    byCode.INICIAL.recursos.forEach(function(resource){
      if(byCode.BASICO.recursos.indexOf(resource) < 0){
        errors.push({
          plano:"BASICO",
          codigo:"MOTOR_PLAN_HIERARCHY_INVALID",
          mensagem:"O plano Básico deve conter todos os recursos do plano Inicial."
        });
      }
    });
  }

  if(byCode.BASICO && byCode.COMPLETO){
    byCode.BASICO.recursos.forEach(function(resource){
      if(byCode.COMPLETO.recursos.indexOf(resource) < 0){
        errors.push({
          plano:"COMPLETO",
          codigo:"MOTOR_PLAN_HIERARCHY_INVALID",
          mensagem:"O plano Completo deve conter todos os recursos do plano Básico."
        });
      }
    });
  }

  if(byCode.COMPLETO){
    MOTOR_FEATURE_CATALOG.forEach(function(feature){
      if(byCode.COMPLETO.recursos.indexOf(feature.codigo) < 0){
        errors.push({
          plano:"COMPLETO",
          codigo:"MOTOR_COMPLETE_FEATURE_REQUIRED",
          mensagem:"O plano Completo deve conter o recurso "+feature.codigo+"."
        });
      }
    });
  }

  var plans = planCodes.filter(function(code){ return !!byCode[code]; }).map(function(code){
    return byCode[code];
  });
  var hash = sha256_(JSON.stringify(plans));
  return {
    valido:errors.length === 0,
    erros:errors,
    planos:plans,
    hash_sha256:hash
  };
}

function motorCatalogInvalidRuntime_(reason){
  return {
    catalogo:{},
    planos:[],
    versao_id:"",
    numero:0,
    origem:"PROPRIEDADE_ASSINADA",
    integridade:"INVALIDA",
    motivo:reason || "CATALOGO_INVALIDO",
    hash_sha256:""
  };
}

function motorCommercialCatalogRuntime_(){
  if(MOTOR_CATALOG_RUNTIME_CACHE) return MOTOR_CATALOG_RUNTIME_CACHE;
  var signed = motorReadSignedProperty_(MOTOR_CATALOG_ACTIVE_PROPERTY, MOTOR_CATALOG_SECRET_PROPERTY);
  if(signed.estado === "AUSENTE"){
    var defaults = motorCatalogDefaultPlans_();
    MOTOR_CATALOG_RUNTIME_CACHE = {
      catalogo:motorCatalogMapFromPlans_(defaults),
      planos:defaults,
      versao_id:"",
      numero:0,
      origem:"PADRAO_EM_CODIGO",
      integridade:"PADRAO_SEGURO",
      motivo:"",
      hash_sha256:sha256_(JSON.stringify(defaults))
    };
    return MOTOR_CATALOG_RUNTIME_CACHE;
  }
  if(signed.estado !== "VALIDO"){
    MOTOR_CATALOG_RUNTIME_CACHE = motorCatalogInvalidRuntime_(signed.motivo);
    return MOTOR_CATALOG_RUNTIME_CACHE;
  }

  var data = signed.dados || {};
  var validation = motorCatalogValidateSnapshot_(data.planos);
  var tenantMatches = clean_(data.tenant_id) === motorConfiguredTenantId_();
  var environmentMatches = upper_(data.ambiente) === motorEnvironment_();
  var hashMatches = authSecureEquals_(clean_(data.hash_sha256), validation.hash_sha256);
  if(
    clean_(data.schema_version) !== MOTOR_CATALOG_SCHEMA_VERSION ||
    !validation.valido ||
    !tenantMatches ||
    !environmentMatches ||
    !hashMatches ||
    !clean_(data.versao_id) ||
    num_(data.numero, 0) < 1
  ){
    MOTOR_CATALOG_RUNTIME_CACHE = motorCatalogInvalidRuntime_(
      !tenantMatches
        ? "TENANT_DIVERGENTE"
        : !environmentMatches
          ? "AMBIENTE_DIVERGENTE"
          : !hashMatches
            ? "HASH_DIVERGENTE"
            : "CONTEUDO_INVALIDO"
    );
    return MOTOR_CATALOG_RUNTIME_CACHE;
  }

  MOTOR_CATALOG_RUNTIME_CACHE = {
    catalogo:motorCatalogMapFromPlans_(validation.planos),
    planos:validation.planos,
    versao_id:clean_(data.versao_id),
    numero:num_(data.numero, 0),
    origem:upper_(data.origem || "PUBLICACAO"),
    integridade:"VALIDA",
    motivo:"",
    hash_sha256:validation.hash_sha256,
    publicado_em:clean_(data.publicado_em),
    publicado_por:clean_(data.publicado_por)
  };
  return MOTOR_CATALOG_RUNTIME_CACHE;
}

function motorCatalogReadDraft_(){
  var signed = motorReadSignedProperty_(MOTOR_CATALOG_DRAFT_PROPERTY, MOTOR_CATALOG_SECRET_PROPERTY);
  if(signed.estado === "AUSENTE") return null;
  if(signed.estado !== "VALIDO") return {integridade:"INVALIDA", motivo:signed.motivo || "ASSINATURA_INVALIDA"};
  var data = signed.dados || {};
  var validation = motorCatalogValidateSnapshot_(data.planos);
  var persistedErrors = Array.isArray(data.validacao_erros)
    ? data.validacao_erros.filter(function(item){
        return item && clean_(item.codigo) && clean_(item.mensagem);
      }).map(function(item){
        return {
          plano:upper_(item.plano || "DESCONHECIDO"),
          codigo:upper_(item.codigo),
          mensagem:clean_(item.mensagem)
        };
      })
    : [];
  if(persistedErrors.length){
    validation.valido = false;
    validation.erros = persistedErrors;
  }
  var validContext =
    clean_(data.schema_version) === MOTOR_CATALOG_SCHEMA_VERSION &&
    clean_(data.tenant_id) === motorConfiguredTenantId_() &&
    upper_(data.ambiente) === motorEnvironment_();
  if(
    !validContext ||
    !clean_(data.id) ||
    !authSecureEquals_(clean_(data.hash_sha256), validation.hash_sha256)
  ){
    return {integridade:"INVALIDA", motivo:"CONTEXTO_OU_HASH_DIVERGENTE"};
  }
  return {
    integridade:"VALIDA",
    id:clean_(data.id),
    base_versao_id:clean_(data.base_versao_id),
    planos:validation.planos,
    hash_sha256:validation.hash_sha256,
    validacao:validation,
    criado_por:clean_(data.criado_por),
    criado_em:clean_(data.criado_em),
    atualizado_em:clean_(data.atualizado_em)
  };
}

function motorCatalogReadIndex_(){
  var signed = motorReadSignedProperty_(MOTOR_CATALOG_INDEX_PROPERTY, MOTOR_CATALOG_SECRET_PROPERTY);
  if(signed.estado === "AUSENTE") return {integridade:"PADRAO_SEGURO", versoes:[]};
  if(signed.estado !== "VALIDO") return {integridade:"INVALIDA", versoes:[], motivo:signed.motivo || ""};
  var data = signed.dados || {};
  if(
    clean_(data.schema_version) !== MOTOR_CATALOG_SCHEMA_VERSION ||
    clean_(data.tenant_id) !== motorConfiguredTenantId_() ||
    upper_(data.ambiente) !== motorEnvironment_() ||
    !Array.isArray(data.versoes)
  ){
    return {integridade:"INVALIDA", versoes:[], motivo:"CONTEXTO_INVALIDO"};
  }
  return {
    integridade:"VALIDA",
    versoes:data.versoes.filter(function(item){
      return /^[A-Z0-9_-]{5,80}$/.test(upper_(item && item.id)) && num_(item && item.numero, 0) > 0;
    }).map(function(item){
      return {
        id:clean_(item.id),
        numero:num_(item.numero, 0),
        origem:upper_(item.origem),
        hash_sha256:clean_(item.hash_sha256),
        publicado_por:clean_(item.publicado_por),
        publicado_em:clean_(item.publicado_em)
      };
    }).sort(function(left, right){ return right.numero - left.numero; })
  };
}

function motorCatalogReadVersion_(versionId){
  var normalizedId = upper_(versionId);
  if(!/^[A-Z0-9_-]{5,80}$/.test(normalizedId)) return null;
  var signed = motorReadSignedProperty_(
    MOTOR_CATALOG_VERSION_PREFIX + normalizedId,
    MOTOR_CATALOG_SECRET_PROPERTY
  );
  if(signed.estado !== "VALIDO") return null;
  var data = signed.dados || {};
  var validation = motorCatalogValidateSnapshot_(data.planos);
  if(
    clean_(data.schema_version) !== MOTOR_CATALOG_SCHEMA_VERSION ||
    clean_(data.versao_id) !== normalizedId ||
    clean_(data.tenant_id) !== motorConfiguredTenantId_() ||
    upper_(data.ambiente) !== motorEnvironment_() ||
    !validation.valido ||
    !authSecureEquals_(clean_(data.hash_sha256), validation.hash_sha256) ||
    num_(data.numero, 0) < 1
  ){
    return null;
  }
  return {
    versao_id:normalizedId,
    numero:num_(data.numero, 0),
    base_versao_id:clean_(data.base_versao_id),
    origem:upper_(data.origem),
    planos:validation.planos,
    hash_sha256:validation.hash_sha256,
    publicado_por:clean_(data.publicado_por),
    publicado_em:clean_(data.publicado_em)
  };
}

function motorCommercialCatalogControlState_(auth){
  motorCatalogRequireInternal_(auth);
  var runtime = motorCommercialCatalogRuntime_();
  var draft = motorCatalogReadDraft_();
  var index = motorCatalogReadIndex_();
  return {
    schema_version:MOTOR_CATALOG_SCHEMA_VERSION,
    edicao_disponivel:!!motorCatalogSecret_() && runtime.integridade !== "INVALIDA" && index.integridade !== "INVALIDA",
    ativa:{
      id:runtime.versao_id,
      numero:runtime.numero,
      origem:runtime.origem,
      integridade:runtime.integridade,
      hash_sha256:runtime.hash_sha256,
      publicado_em:runtime.publicado_em || "",
      publicado_por:runtime.publicado_por || ""
    },
    rascunho:draft,
    historico:{
      integridade:index.integridade,
      total:index.versoes.length,
      versoes:index.versoes.slice(0, MOTOR_CATALOG_MAX_HISTORY)
    },
    limites:{
      versoes_retidas:MOTOR_CATALOG_MAX_HISTORY,
      bytes_por_propriedade:MOTOR_CATALOG_MAX_PROPERTY_BYTES
    }
  };
}

function motorCommercialCatalogValidate_(p, auth){
  motorCatalogRequireInternal_(auth);
  return motorCatalogValidateSnapshot_(p && p.planos);
}

function motorCommercialCatalogDraftSave_(p, auth){
  motorCatalogRequireInternal_(auth);
  motorCatalogRequireSecret_();
  var validation = motorCatalogValidateSnapshot_(p && p.planos);
  var runtime = motorCommercialCatalogRuntime_();
  if(runtime.integridade === "INVALIDA"){
    err_("MOTOR_CATALOG_INTEGRITY_FAILED", "O catálogo ativo precisa ser recuperado antes de uma nova edição.", 409);
  }
  if(clean_(p && p.base_versao_id) !== clean_(runtime.versao_id)){
    err_("MOTOR_CATALOG_BASE_VERSION_CHANGED", "O catálogo ativo mudou. Recarregue antes de salvar.", 409);
  }

  var lock = LockService.getScriptLock();
  if(!lock.tryLock(10000)) err_("MOTOR_CATALOG_DRAFT_BUSY", "Outro rascunho está sendo salvo.", 409);
  try{
    MOTOR_CATALOG_RUNTIME_CACHE = null;
    runtime = motorCommercialCatalogRuntime_();
    if(clean_(p && p.base_versao_id) !== clean_(runtime.versao_id)){
      err_("MOTOR_CATALOG_BASE_VERSION_CHANGED", "O catálogo ativo mudou. Recarregue antes de salvar.", 409);
    }
    var current = motorCatalogReadDraft_();
    if(current && current.integridade === "VALIDA" && current.criado_por !== clean_(auth.usuario_id)){
      err_("MOTOR_CATALOG_DRAFT_OWNED", "Existe um rascunho interno aberto por outro responsável.", 409);
    }
    var timestamp = now_();
    var draft = {
      schema_version:MOTOR_CATALOG_SCHEMA_VERSION,
      id:current && current.integridade === "VALIDA" ? current.id : uuid_("MCD"),
      tenant_id:motorConfiguredTenantId_(),
      ambiente:motorEnvironment_(),
      base_versao_id:runtime.versao_id,
      planos:validation.planos,
      hash_sha256:validation.hash_sha256,
      validacao_erros:validation.erros,
      criado_por:clean_(auth.usuario_id),
      criado_em:current && current.integridade === "VALIDA" ? current.criado_em : timestamp,
      atualizado_em:timestamp
    };
    motorCatalogWriteSignedProperty_(MOTOR_CATALOG_DRAFT_PROPERTY, draft);
    audit_(
      auth,
      "MOTOR_CATALOG_DRAFT_SAVED",
      "motor_catalogo_comercial",
      draft.id,
      current && current.integridade === "VALIDA" ? {
        hash_sha256:current.hash_sha256,
        base_versao_id:current.base_versao_id
      } : null,
      {
        hash_sha256:draft.hash_sha256,
        base_versao_id:draft.base_versao_id,
        valido:validation.valido
      },
      clean_(p && p.user_agent)
    );
    return {
      saved:true,
      rascunho:{
        id:draft.id,
        base_versao_id:draft.base_versao_id,
        planos:draft.planos,
        hash_sha256:draft.hash_sha256,
        validacao:validation,
        atualizado_em:draft.atualizado_em
      }
    };
  } finally {
    lock.releaseLock();
  }
}

function motorCatalogNextVersionNumber_(index){
  return (index.versoes || []).reduce(function(maximum, item){
    return Math.max(maximum, num_(item.numero, 0));
  }, 0) + 1;
}

function motorCatalogPublishUnderLock_(plans, baseVersionId, origin, auth, userAgent, draftId){
  MOTOR_CATALOG_RUNTIME_CACHE = null;
  var runtime = motorCommercialCatalogRuntime_();
  if(runtime.integridade === "INVALIDA"){
    err_("MOTOR_CATALOG_INTEGRITY_FAILED", "O catálogo ativo falhou na verificação de integridade.", 409);
  }
  if(clean_(baseVersionId) !== clean_(runtime.versao_id)){
    err_("MOTOR_CATALOG_BASE_VERSION_CHANGED", "O catálogo ativo mudou. Recarregue antes de publicar.", 409);
  }
  var validation = motorCatalogValidateSnapshot_(plans);
  if(!validation.valido){
    err_("MOTOR_CATALOG_VALIDATION_FAILED", "O catálogo possui erros e não pode ser publicado.", 409);
  }
  if(runtime.hash_sha256 && authSecureEquals_(runtime.hash_sha256, validation.hash_sha256)){
    err_("MOTOR_CATALOG_NO_CHANGES", "O catálogo validado é igual à versão ativa.", 409);
  }

  var index = motorCatalogReadIndex_();
  if(index.integridade === "INVALIDA"){
    err_("MOTOR_CATALOG_HISTORY_INTEGRITY_FAILED", "O índice de versões falhou na verificação de integridade.", 409);
  }
  var timestamp = now_();
  var versionId = upper_(uuid_("MCV"));
  var version = {
    schema_version:MOTOR_CATALOG_SCHEMA_VERSION,
    versao_id:versionId,
    numero:motorCatalogNextVersionNumber_(index),
    tenant_id:motorConfiguredTenantId_(),
    ambiente:motorEnvironment_(),
    base_versao_id:runtime.versao_id,
    origem:upper_(origin || "PUBLICACAO"),
    planos:validation.planos,
    hash_sha256:validation.hash_sha256,
    publicado_por:clean_(auth.usuario_id),
    publicado_em:timestamp
  };
  var metadata = {
    id:version.versao_id,
    numero:version.numero,
    origem:version.origem,
    hash_sha256:version.hash_sha256,
    publicado_por:version.publicado_por,
    publicado_em:version.publicado_em
  };
  var allVersions = [metadata].concat(index.versoes || []);
  var retained = allVersions.slice(0, MOTOR_CATALOG_MAX_HISTORY);
  var removed = allVersions.slice(MOTOR_CATALOG_MAX_HISTORY);
  var indexData = {
    schema_version:MOTOR_CATALOG_SCHEMA_VERSION,
    tenant_id:version.tenant_id,
    ambiente:version.ambiente,
    versoes:retained,
    atualizado_em:timestamp
  };

  audit_(
    auth,
    "MOTOR_CATALOG_PUBLICATION_AUTHORIZED",
    "motor_catalogo_comercial",
    version.versao_id,
    {versao_id:runtime.versao_id, hash_sha256:runtime.hash_sha256},
    {
      versao_id:version.versao_id,
      numero:version.numero,
      origem:version.origem,
      hash_sha256:version.hash_sha256
    },
    clean_(userAgent)
  );

  var properties = PropertiesService.getScriptProperties();
  var versionProperty = MOTOR_CATALOG_VERSION_PREFIX + version.versao_id;
  var previousActive = properties.getProperty(MOTOR_CATALOG_ACTIVE_PROPERTY);
  var previousIndex = properties.getProperty(MOTOR_CATALOG_INDEX_PROPERTY);
  var previousDraft = properties.getProperty(MOTOR_CATALOG_DRAFT_PROPERTY);
  try{
    motorCatalogWriteSignedProperty_(versionProperty, version);
    motorCatalogWriteSignedProperty_(MOTOR_CATALOG_ACTIVE_PROPERTY, version);
    motorCatalogWriteSignedProperty_(MOTOR_CATALOG_INDEX_PROPERTY, indexData);
    if(draftId) properties.deleteProperty(MOTOR_CATALOG_DRAFT_PROPERTY);
  } catch(error){
    motorCatalogRestoreProperty_(properties, MOTOR_CATALOG_ACTIVE_PROPERTY, previousActive);
    motorCatalogRestoreProperty_(properties, MOTOR_CATALOG_INDEX_PROPERTY, previousIndex);
    motorCatalogRestoreProperty_(properties, MOTOR_CATALOG_DRAFT_PROPERTY, previousDraft);
    properties.deleteProperty(versionProperty);
    MOTOR_CATALOG_RUNTIME_CACHE = null;
    throw error;
  }

  removed.forEach(function(item){
    try {
      properties.deleteProperty(MOTOR_CATALOG_VERSION_PREFIX + upper_(item.id));
    } catch(e){}
  });

  MOTOR_CATALOG_RUNTIME_CACHE = null;
  MOTOR_SUBSCRIPTION_CACHE = null;
  var result = {
    published:true,
    ativa:{
      id:version.versao_id,
      numero:version.numero,
      origem:version.origem,
      hash_sha256:version.hash_sha256,
      planos:version.planos,
      publicado_por:version.publicado_por,
      publicado_em:version.publicado_em,
      integridade:"VALIDA"
    }
  };
  try{
    audit_(
      auth,
      "MOTOR_CATALOG_PUBLICATION_COMPLETED",
      "motor_catalogo_comercial",
      version.versao_id,
      null,
      {numero:version.numero, origem:version.origem, hash_sha256:version.hash_sha256},
      clean_(userAgent)
    );
  } catch(e){
    result.aviso = "O catálogo foi ativado, mas o evento complementar de auditoria falhou.";
  }
  return result;
}

function motorCommercialCatalogPublish_(p, auth){
  motorCatalogRequireInternal_(auth);
  motorCatalogRequireSecret_();
  req_(p, ["rascunho_id"]);
  var lock = LockService.getScriptLock();
  if(!lock.tryLock(30000)) err_("MOTOR_CATALOG_PUBLICATION_BUSY", "Outra publicação está em andamento.", 409);
  try{
    var draft = motorCatalogReadDraft_();
    if(!draft || draft.integridade !== "VALIDA" || clean_(draft.id) !== clean_(p.rascunho_id)){
      err_("MOTOR_CATALOG_DRAFT_NOT_FOUND", "Rascunho interno não encontrado.", 404);
    }
    if(draft.criado_por !== clean_(auth.usuario_id)){
      err_("MOTOR_CATALOG_DRAFT_OWNED", "O rascunho pertence a outro responsável interno.", 409);
    }
    if(!draft.validacao.valido){
      err_("MOTOR_CATALOG_DRAFT_INVALID", "Corrija o rascunho antes de publicar.", 409);
    }
    return motorCatalogPublishUnderLock_(
      draft.planos,
      draft.base_versao_id,
      "PUBLICACAO",
      auth,
      clean_(p.user_agent),
      draft.id
    );
  } finally {
    lock.releaseLock();
  }
}

function motorCommercialCatalogVersions_(p, auth){
  motorCatalogRequireInternal_(auth);
  var index = motorCatalogReadIndex_();
  if(index.integridade === "INVALIDA"){
    err_("MOTOR_CATALOG_HISTORY_INTEGRITY_FAILED", "O índice de versões falhou na verificação de integridade.", 409);
  }
  var limit = Math.max(1, Math.min(num_(p && p.limite, MOTOR_CATALOG_MAX_HISTORY), MOTOR_CATALOG_MAX_HISTORY));
  var runtime = motorCommercialCatalogRuntime_();
  return {
    total:index.versoes.length,
    versoes:index.versoes.slice(0, limit).map(function(item){
      return {
        id:item.id,
        numero:item.numero,
        origem:item.origem,
        hash_sha256:item.hash_sha256,
        publicado_por:item.publicado_por,
        publicado_em:item.publicado_em,
        ativa:clean_(item.id) === clean_(runtime.versao_id)
      };
    })
  };
}

function motorCommercialCatalogRollback_(p, auth){
  motorCatalogRequireInternal_(auth);
  motorCatalogRequireSecret_();
  req_(p, ["versao_id","base_versao_id","motivo"]);
  if(clean_(p.motivo).length < 10){
    err_("MOTOR_CATALOG_ROLLBACK_REASON_REQUIRED", "Informe um motivo com pelo menos 10 caracteres.", 400);
  }
  var lock = LockService.getScriptLock();
  if(!lock.tryLock(30000)) err_("MOTOR_CATALOG_PUBLICATION_BUSY", "Outra publicação está em andamento.", 409);
  try{
    var target = motorCatalogReadVersion_(p.versao_id);
    if(!target){
      err_("MOTOR_CATALOG_VERSION_NOT_FOUND", "Versão histórica íntegra não encontrada.", 404);
    }
    var result = motorCatalogPublishUnderLock_(
      target.planos,
      p.base_versao_id,
      "ROLLBACK",
      auth,
      clean_(p.user_agent),
      ""
    );
    result.rollback_from_version_id = target.versao_id;
    try{
      audit_(
        auth,
        "MOTOR_CATALOG_ROLLBACK_COMPLETED",
        "motor_catalogo_comercial",
        result.ativa.id,
        {alvo_versao_id:target.versao_id, alvo_hash_sha256:target.hash_sha256},
        {nova_versao_id:result.ativa.id, motivo:clean_(p.motivo)},
        clean_(p.user_agent)
      );
    } catch(e){
      result.aviso = "O rollback foi ativado, mas o evento complementar de auditoria falhou.";
    }
    return result;
  } finally {
    lock.releaseLock();
  }
}
