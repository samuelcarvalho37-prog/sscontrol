const CONFIG_ENGINE_SCHEMA_KEY = "configuration.engine.schema.version";
const CONFIG_ENGINE_RUNTIME_KEY = "configuration.runtime.snapshot.v1";
const CONFIG_ENGINE_SCHEMA_VERSION = "1";
var CONFIG_ENGINE_RUNTIME_CACHE = null;

const CONFIG_ENGINE_CATALOG = [
  {
    chave:"parada.tolerancia_retorno_min", grupo:"OPERACAO", nome:"Tolerância de retorno operacional",
    descricao:"Minutos permitidos entre o fim da manutenção e o retorno operacional.",
    tipo:"INTEIRO", padrao:10, minimo:0, maximo:1440, unidade:"min"
  },
  {
    chave:"manutencao.modo_parada_padrao", grupo:"OPERACAO", nome:"Modo de parada padrão",
    descricao:"Aplicado somente quando a ação e o plano não definem uma política própria.",
    tipo:"ENUM", padrao:"DECISAO_EXECUTOR", opcoes:["OBRIGATORIA","DECISAO_EXECUTOR","SEM_PARADA"]
  },
  {
    chave:"evidencia.foto.max_bytes", grupo:"EVIDENCIAS", nome:"Tamanho máximo de foto",
    descricao:"Limite de cada evidência fotográfica enviada pelo operador.",
    tipo:"INTEIRO", padrao:2500000, minimo:250000, maximo:5000000, unidade:"bytes"
  },
  {
    chave:"workflow.tecnico.exige_segregacao_padrao", grupo:"WORKFLOW", nome:"Segregação técnica padrão",
    descricao:"Impede que o autor da demanda assine a própria liberação quando a demanda não informar a regra.",
    tipo:"BOOLEANO", padrao:false
  },
  {
    chave:"workflow.tecnico.assinaturas_padrao", grupo:"WORKFLOW", nome:"Assinaturas técnicas padrão",
    descricao:"Quantidade padrão de assinaturas quando a área exige aprovação técnica.",
    tipo:"INTEIRO", padrao:1, minimo:1, maximo:5, unidade:"assinaturas"
  },
  {
    chave:"workflow.tecnico.politica_validacao_padrao", grupo:"WORKFLOW", nome:"Filtro técnico padrão",
    descricao:"Define quem pode validar documentos quando o Administrador não escolher uma política específica.",
    tipo:"ENUM", padrao:"QUALIDADE_OU_SEGURANCA",
    opcoes:["QUALIDADE_OU_SEGURANCA","QUALIDADE","SEGURANCA","QUALIDADE_E_SEGURANCA"]
  },
  {
    chave:"kpi.janela_padrao_dias", grupo:"INDICADORES", nome:"Janela padrão dos indicadores",
    descricao:"Período usado quando o painel não informa datas de consulta.",
    tipo:"INTEIRO", padrao:30, minimo:1, maximo:365, unidade:"dias"
  },
  {
    chave:"kpi.meta.disponibilidade_pct", grupo:"INDICADORES", nome:"Meta de disponibilidade",
    descricao:"Referência gerencial para a disponibilidade técnica.",
    tipo:"NUMERO", padrao:90, minimo:0, maximo:100, unidade:"%"
  },
  {
    chave:"kpi.meta.oee_pct", grupo:"INDICADORES", nome:"Meta de OEE",
    descricao:"Referência gerencial de eficiência global do equipamento.",
    tipo:"NUMERO", padrao:75, minimo:0, maximo:100, unidade:"%"
  }
];

const CONFIG_ENGINE_PROTECTED_KEYS = [
  "release.version", "app.version", "api.version", "schema.version", "contract.version",
  "frontend.version", "app.environment", "auth.schema.version", "permissions.matrix.capabilities.v1",
  "horimetro.regra", "workflow.tecnico.schema.version", CONFIG_ENGINE_SCHEMA_KEY, CONFIG_ENGINE_RUNTIME_KEY
];

function configurationRequireAdmin_(auth){
  if(upper_(auth && auth.perfil) !== ROLE.ADMIN){
    err_("FORBIDDEN_ADMIN_REQUIRED", "O Motor de Configuração exige perfil ADMIN.", 403);
  }
}

function configurationEnsureSchema_(){
  var ss = getSpreadsheet_();
  ["configuracao_versoes","configuracao_rascunhos"].forEach(function(name){
    ensureSheet_(ss, name, SH[name]);
  });
  var marker = find_("config", "chave", CONFIG_ENGINE_SCHEMA_KEY);
  if(!marker || clean_(marker.valor) !== CONFIG_ENGINE_SCHEMA_VERSION){
    upsert_("config", "chave", {
      chave:CONFIG_ENGINE_SCHEMA_KEY,
      valor:CONFIG_ENGINE_SCHEMA_VERSION,
      descricao:"Versão interna do Motor de Configuração",
      atualizado_em:now_()
    });
  }
}

function configurationCatalogMap_(){
  var map = {};
  CONFIG_ENGINE_CATALOG.forEach(function(item){ map[item.chave] = item; });
  return map;
}

function configurationDefaults_(){
  var values = {};
  CONFIG_ENGINE_CATALOG.forEach(function(item){ values[item.chave] = item.padrao; });
  return values;
}

function configurationLegacySnapshot_(){
  var values = configurationDefaults_();
  CONFIG_ENGINE_CATALOG.forEach(function(item){
    var legacy = find_("config", "chave", item.chave);
    if(legacy && clean_(legacy.valor) !== "") values[item.chave] = legacy.valor;
  });
  var validation = configurationValidateSnapshot_(values);
  return validation.valido ? validation.configuracao : configurationDefaults_();
}

function configurationParseJson_(value, fallback){
  if(value && typeof value === "object") return value;
  if(!clean_(value)) return fallback;
  try { return JSON.parse(String(value)); } catch(e){ return fallback; }
}

function configurationNormalizeValue_(definition, raw){
  if(definition.tipo === "BOOLEANO"){
    if(raw === true || raw === false) return raw;
    var booleanText = upper_(raw);
    if(["SIM","TRUE","1","YES"].indexOf(booleanText) >= 0) return true;
    if(["NAO","NÃO","FALSE","0","NO"].indexOf(booleanText) >= 0) return false;
    return raw;
  }
  if(definition.tipo === "INTEIRO"){
    if(raw === null || clean_(raw) === "") return raw;
    var integer = Number(raw);
    return Number.isFinite(integer) ? Math.floor(integer) : raw;
  }
  if(definition.tipo === "NUMERO"){
    if(raw === null || clean_(raw) === "") return raw;
    var number = Number(raw);
    return Number.isFinite(number) ? number : raw;
  }
  if(definition.tipo === "ENUM") return upper_(raw);
  return clean_(raw);
}

function configurationValidateSnapshot_(input){
  var source = input && typeof input === "object" && !Array.isArray(input) ? input : {};
  var catalog = configurationCatalogMap_();
  var normalized = {};
  var errors = [];
  Object.keys(source).forEach(function(key){
    if(!catalog[key]) errors.push({chave:key, codigo:"CONFIG_KEY_NOT_ALLOWED", mensagem:"Chave nao editavel pelo motor."});
  });
  CONFIG_ENGINE_CATALOG.forEach(function(definition){
    var raw = Object.prototype.hasOwnProperty.call(source, definition.chave)
      ? source[definition.chave]
      : definition.padrao;
    var value = configurationNormalizeValue_(definition, raw);
    if(definition.tipo === "BOOLEANO" && typeof value !== "boolean"){
      errors.push({chave:definition.chave, codigo:"CONFIG_BOOLEAN_INVALID", mensagem:"Informe verdadeiro ou falso."});
      return;
    }
    if(["INTEIRO","NUMERO"].indexOf(definition.tipo) >= 0){
      if(typeof value !== "number" || !Number.isFinite(value)){
        errors.push({chave:definition.chave, codigo:"CONFIG_NUMBER_INVALID", mensagem:"Informe um numero valido."});
        return;
      }
      if(value < definition.minimo || value > definition.maximo){
        errors.push({chave:definition.chave, codigo:"CONFIG_RANGE_INVALID", mensagem:"Valor fora do intervalo permitido."});
        return;
      }
    }
    if(definition.tipo === "ENUM" && definition.opcoes.indexOf(value) < 0){
      errors.push({chave:definition.chave, codigo:"CONFIG_ENUM_INVALID", mensagem:"Opcao nao permitida."});
      return;
    }
    normalized[definition.chave] = value;
  });
  var canonical = {};
  CONFIG_ENGINE_CATALOG.forEach(function(definition){
    if(Object.prototype.hasOwnProperty.call(normalized, definition.chave)) canonical[definition.chave] = normalized[definition.chave];
  });
  var json = JSON.stringify(canonical);
  return {valido:errors.length === 0, erros:errors, configuracao:canonical, hash_sha256:sha256_(json)};
}

function configurationRuntimeEnvelope_(){
  if(CONFIG_ENGINE_RUNTIME_CACHE) return CONFIG_ENGINE_RUNTIME_CACHE;
  var row = find_("config", "chave", CONFIG_ENGINE_RUNTIME_KEY);
  var parsed = configurationParseJson_(row && row.valor, null);
  if(!parsed || !parsed.configuracao || !parsed.hash_sha256){
    CONFIG_ENGINE_RUNTIME_CACHE = {versao_id:"", numero:0, hash_sha256:"", configuracao:configurationLegacySnapshot_()};
    return CONFIG_ENGINE_RUNTIME_CACHE;
  }
  var validation = configurationValidateSnapshot_(parsed.configuracao);
  if(!validation.valido || !authSecureEquals_(validation.hash_sha256, clean_(parsed.hash_sha256))){
    CONFIG_ENGINE_RUNTIME_CACHE = {versao_id:"", numero:0, hash_sha256:"", configuracao:configurationDefaults_(), integridade:"FALLBACK_SEGURO"};
    return CONFIG_ENGINE_RUNTIME_CACHE;
  }
  CONFIG_ENGINE_RUNTIME_CACHE = {
    versao_id:clean_(parsed.versao_id), numero:num_(parsed.numero, 0), hash_sha256:validation.hash_sha256,
    configuracao:validation.configuracao, publicado_em:clean_(parsed.publicado_em), publicado_por:clean_(parsed.publicado_por),
    integridade:"VALIDA"
  };
  return CONFIG_ENGINE_RUNTIME_CACHE;
}

function configurationRuntimeValue_(key, fallback){
  var envelope = configurationRuntimeEnvelope_();
  if(Object.prototype.hasOwnProperty.call(envelope.configuracao, key)) return envelope.configuracao[key];
  var legacy = find_("config", "chave", key);
  if(legacy && clean_(legacy.valor) !== "") return legacy.valor;
  return fallback;
}

function configurationDraftForUser_(userId){
  return rows_("configuracao_rascunhos", true).filter(function(item){
    return String(item.usuario_id) === String(userId) && upper_(item.status) === "RASCUNHO";
  }).sort(function(a,b){ return clean_(b.atualizado_em).localeCompare(clean_(a.atualizado_em)); })[0] || null;
}

function configurationPublicVersion_(row, activeId){
  if(!row) return null;
  return {
    id:clean_(row.id), numero:num_(row.numero, 0), status:clean_(row.id) === clean_(activeId) ? "ATIVA" : upper_(row.status),
    origem:upper_(row.origem), base_versao_id:clean_(row.base_versao_id), hash_sha256:clean_(row.hash_sha256),
    valido:configurationParseJson_(row.validacao_json, {}).valido === true,
    criado_por:clean_(row.criado_por), criado_em:clean_(row.criado_em)
  };
}

function configurationState_(p, auth){
  configurationRequireAdmin_(auth);
  configurationEnsureSchema_();
  CONFIG_ENGINE_RUNTIME_CACHE = null;
  var active = configurationRuntimeEnvelope_();
  var draft = configurationDraftForUser_(auth.usuario_id);
  var draftValidation = draft ? configurationParseJson_(draft.validacao_json, {}) : null;
  return {
    catalogo:CONFIG_ENGINE_CATALOG,
    protegidas:CONFIG_ENGINE_PROTECTED_KEYS,
    acesso_comercial:typeof motorCommercialAccessContext_ === "function" ? motorCommercialAccessContext_(auth) : null,
    ativa:{
      id:active.versao_id, numero:active.numero, hash_sha256:active.hash_sha256,
      configuracao:active.configuracao, publicado_em:active.publicado_em || "",
      publicado_por:active.publicado_por || "", integridade:active.integridade || "PADRAO_SEGURO"
    },
    rascunho:draft ? {
      id:draft.id, base_versao_id:draft.base_versao_id,
      configuracao:configurationParseJson_(draft.configuracao_json, configurationDefaults_()),
      hash_sha256:draft.hash_sha256, validacao:draftValidation, atualizado_em:draft.atualizado_em
    } : null
  };
}

function configurationSaveDraft_(p, auth){
  configurationRequireAdmin_(auth);
  configurationEnsureSchema_();
  var validation = configurationValidateSnapshot_(p.configuracao);
  var current = configurationDraftForUser_(auth.usuario_id);
  var active = configurationRuntimeEnvelope_();
  var timestamp = now_();
  var draft = fit_("configuracao_rascunhos", Object.assign({}, current || {}, {
    id:current ? current.id : uuid_("CFGR"), usuario_id:auth.usuario_id,
    base_versao_id:clean_(p.base_versao_id || active.versao_id), configuracao_json:JSON.stringify(validation.configuracao),
    hash_sha256:validation.hash_sha256, validacao_json:JSON.stringify(validation), status:"RASCUNHO",
    criado_em:current ? current.criado_em : timestamp, atualizado_em:timestamp
  }));
  if(current) update_("configuracao_rascunhos", current.__rowIndex, draft); else append_("configuracao_rascunhos", draft);
  audit_(auth, "CONFIG_DRAFT_SAVED", "configuracao_rascunhos", draft.id, current && strip_(current), {
    id:draft.id, base_versao_id:draft.base_versao_id, hash_sha256:draft.hash_sha256, valido:validation.valido
  }, clean_(p.user_agent));
  return {saved:true, rascunho:{id:draft.id, base_versao_id:draft.base_versao_id, configuracao:validation.configuracao, hash_sha256:draft.hash_sha256, validacao:validation, atualizado_em:timestamp}};
}

function configurationValidate_(p, auth){
  configurationRequireAdmin_(auth);
  configurationEnsureSchema_();
  return configurationValidateSnapshot_(p.configuracao);
}

function configurationNextVersionNumber_(){
  return rows_("configuracao_versoes", true).reduce(function(maximum, item){
    return Math.max(maximum, num_(item.numero, 0));
  }, 0) + 1;
}

function configurationPublishSnapshot_(snapshot, baseVersionId, origin, auth, userAgent){
  var validation = configurationValidateSnapshot_(snapshot);
  if(!validation.valido) err_("CONFIG_VALIDATION_FAILED", "A configuracao possui erros e nao pode ser publicada.", 409);
  var lock = LockService.getScriptLock();
  if(!lock.tryLock(30000)) err_("CONFIG_PUBLICATION_BUSY", "Outra publicacao esta em andamento.", 409);
  try{
    CONFIG_ENGINE_RUNTIME_CACHE = null;
    var current = configurationRuntimeEnvelope_();
    if(clean_(baseVersionId) !== clean_(current.versao_id)){
      err_("CONFIG_BASE_VERSION_CHANGED", "A versao ativa mudou. Recarregue o workspace antes de publicar.", 409);
    }
    if(current.hash_sha256 && authSecureEquals_(current.hash_sha256, validation.hash_sha256)){
      err_("CONFIG_NO_CHANGES", "A configuracao validada e igual a versao ativa.", 409);
    }
    var timestamp = now_();
    var version = fit_("configuracao_versoes", {
      id:uuid_("CFGV"), numero:configurationNextVersionNumber_(), status:"PUBLICADA",
      origem:upper_(origin || "PUBLICACAO"), base_versao_id:clean_(current.versao_id),
      configuracao_json:JSON.stringify(validation.configuracao), hash_sha256:validation.hash_sha256,
      validacao_json:JSON.stringify(validation), criado_por:auth.usuario_id, criado_em:timestamp
    });
    append_("configuracao_versoes", version);
    var envelope = {
      versao_id:version.id, numero:version.numero, hash_sha256:version.hash_sha256,
      configuracao:validation.configuracao, publicado_em:timestamp, publicado_por:auth.usuario_id
    };
    audit_(auth, "CONFIG_PUBLICATION_AUTHORIZED", "configuracao_versoes", version.id, {
      versao_id:current.versao_id, hash_sha256:current.hash_sha256
    }, {
      versao_id:version.id, numero:version.numero, origem:version.origem, hash_sha256:version.hash_sha256
    }, userAgent);
    upsert_("config", "chave", {
      chave:CONFIG_ENGINE_RUNTIME_KEY, valor:JSON.stringify(envelope),
      descricao:"Snapshot ativo e validado do Motor de Configuracao", atualizado_em:timestamp
    });
    CONFIG_ENGINE_RUNTIME_CACHE = envelope;
    invalidateRuntimeCache_();
    CONFIG_ENGINE_RUNTIME_CACHE = envelope;
    return {published:true, ativa:{id:version.id, numero:version.numero, hash_sha256:version.hash_sha256, configuracao:validation.configuracao, publicado_em:timestamp, publicado_por:auth.usuario_id, integridade:"VALIDA"}};
  } finally {
    lock.releaseLock();
  }
}

function configurationPublish_(p, auth){
  configurationRequireAdmin_(auth);
  configurationEnsureSchema_();
  req_(p, ["rascunho_id"]);
  var draft = configurationDraftForUser_(auth.usuario_id);
  if(!draft || String(draft.id) !== String(p.rascunho_id)) err_("CONFIG_DRAFT_NOT_FOUND", "Rascunho ativo nao encontrado.", 404);
  var savedValidation = configurationParseJson_(draft.validacao_json, {});
  if(savedValidation.valido !== true){
    err_("CONFIG_DRAFT_INVALID", "Corrija e valide o rascunho antes de publicar.", 409);
  }
  var result = configurationPublishSnapshot_(
    configurationParseJson_(draft.configuracao_json, {}), draft.base_versao_id, "PUBLICACAO", auth, clean_(p.user_agent)
  );
  try {
    update_("configuracao_rascunhos", draft.__rowIndex, {status:"PUBLICADO", atualizado_em:now_()});
  } catch(e){
    result.aviso = "A versao foi ativada, mas o rascunho nao pode ser arquivado automaticamente.";
  }
  return result;
}

function configurationVersions_(p, auth){
  configurationRequireAdmin_(auth);
  configurationEnsureSchema_();
  var activeId = configurationRuntimeEnvelope_().versao_id;
  var limit = Math.max(1, Math.min(num_(p.limite, 30), 100));
  var all = rows_("configuracao_versoes", true);
  var versions = all.slice().sort(function(a,b){
    return num_(b.numero, 0) - num_(a.numero, 0);
  }).slice(0, limit).map(function(item){ return configurationPublicVersion_(item, activeId); });
  return {total:all.length, versoes:versions};
}

function configurationRollback_(p, auth){
  configurationRequireAdmin_(auth);
  configurationEnsureSchema_();
  req_(p, ["versao_id","base_versao_id","motivo"]);
  if(clean_(p.motivo).length < 10) err_("CONFIG_ROLLBACK_REASON_REQUIRED", "Informe um motivo com pelo menos 10 caracteres.", 400);
  var target = find_("configuracao_versoes", "id", p.versao_id);
  if(!target) err_("CONFIG_VERSION_NOT_FOUND", "Versao de configuracao nao encontrada.", 404);
  var stored = configurationParseJson_(target.configuracao_json, {});
  var validation = configurationValidateSnapshot_(stored);
  if(!validation.valido || !authSecureEquals_(validation.hash_sha256, clean_(target.hash_sha256))){
    err_("CONFIG_VERSION_INTEGRITY_FAILED", "A versao historica falhou na verificacao de integridade.", 409);
  }
  var result = configurationPublishSnapshot_(stored, p.base_versao_id, "ROLLBACK", auth, clean_(p.user_agent));
  try {
    audit_(auth, "CONFIG_ROLLBACK_COMPLETED", "configuracao_versoes", result.ativa.id, {
      alvo_versao_id:target.id, alvo_hash_sha256:target.hash_sha256
    }, {nova_versao_id:result.ativa.id, motivo:clean_(p.motivo)}, clean_(p.user_agent));
  } catch(e){
    result.aviso = "O rollback foi ativado; o motivo permanece na solicitacao, mas o evento complementar falhou.";
  }
  result.rollback_from_version_id = target.id;
  return result;
}

function cmmsConfiguracaoSchemaUpgrade_(p, auth){
  configurationRequireAdmin_(auth);
  configurationEnsureSchema_();
  return {upgraded:true, schema_version:CONFIG_ENGINE_SCHEMA_VERSION, sheets:["configuracao_versoes","configuracao_rascunhos"], total_sheets:Object.keys(SH).length};
}
