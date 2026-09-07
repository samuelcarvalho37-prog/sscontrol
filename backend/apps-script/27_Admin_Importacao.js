const ADMIN_IMPORT_MAX_ROWS = 250;
const ADMIN_IMPORT_MAX_CELL_CHARS = 500;

const ADMIN_IMPORT_MODELS = {
  plantas: {
    entidade:"plantas",
    grupo:"Estrutura",
    nome:"Plantas e unidades",
    descricao:"Cria ou atualiza as unidades raiz da implantação.",
    required:["tag","nome"],
    fields:[
      {key:"id",label:"ID",aliases:["id_planta"]},
      {key:"tag",label:"TAG",aliases:["codigo","codigo_planta"],example:"PLT-01"},
      {key:"nome",label:"Nome",aliases:["planta","unidade"],example:"Planta Principal"},
      {key:"status",label:"Status",aliases:["ativo"],example:"ATIVO"}
    ]
  },
  setores: {
    entidade:"setores",
    grupo:"Estrutura",
    nome:"Setores",
    descricao:"Vincula setores a uma planta já cadastrada.",
    required:["planta_id","tag","nome"],
    fields:[
      {key:"id",label:"ID",aliases:["id_setor"]},
      {key:"planta_id",label:"ID da planta",aliases:["id_planta"],example:"PLT-PLT-01"},
      {key:"tag",label:"TAG",aliases:["codigo","codigo_setor"],example:"MAN"},
      {key:"nome",label:"Nome",aliases:["setor"],example:"Manutenção"},
      {key:"status",label:"Status",aliases:["ativo"],example:"ATIVO"}
    ]
  },
  linhas: {
    entidade:"linhas",
    grupo:"Estrutura",
    nome:"Linhas de produção",
    descricao:"Vincula linhas a um setor já cadastrado.",
    required:["setor_id","tag","nome"],
    fields:[
      {key:"id",label:"ID",aliases:["id_linha"]},
      {key:"setor_id",label:"ID do setor",aliases:["id_setor"],example:"SET-PLT-PLT-01-PROD"},
      {key:"tag",label:"TAG",aliases:["codigo","codigo_linha"],example:"L01"},
      {key:"nome",label:"Nome",aliases:["linha"],example:"Linha 01"},
      {key:"status",label:"Status",aliases:["ativo"],example:"ATIVO"}
    ]
  },
  ativos: {
    entidade:"ativos",
    grupo:"Cadastro técnico",
    nome:"Equipamentos e ativos",
    descricao:"Cadastra ativos técnicos vinculados às linhas.",
    required:["linha_id","tag","nome"],
    fields:[
      {key:"id",label:"ID",aliases:["id_ativo","id_equipamento"]},
      {key:"linha_id",label:"ID da linha",aliases:["id_linha"],example:"LIN-SET-PLT-PLT-01-PROD-L01"},
      {key:"tag",label:"TAG",aliases:["codigo","codigo_ativo","tag_equipamento"],example:"EQ-001"},
      {key:"nome",label:"Nome",aliases:["equipamento","ativo"],example:"Prensa Hidráulica 01"},
      {key:"tipo",label:"Tipo",aliases:["tipo_equipamento"],example:"Prensa"},
      {key:"criticidade",label:"Criticidade",aliases:["classificacao"],example:"ALTA"},
      {key:"status",label:"Status",aliases:["situacao"],example:"OPERANDO"},
      {key:"saude_pct",label:"Saúde (%)",aliases:["saude","saude_percentual"],example:100},
      {key:"horimetro_atual",label:"Horímetro atual",aliases:["horimetro","horas_atuais"],example:0},
      {key:"fabricante",label:"Fabricante",aliases:[],example:"WEG"},
      {key:"modelo",label:"Modelo",aliases:[],example:"PH-100"},
      {key:"numero_serie",label:"Número de série",aliases:["serie"],example:"SN-001"},
      {key:"localizacao_tecnica",label:"Localização técnica",aliases:["local","localizacao"],example:"Produção / Linha 01"}
    ]
  },
  componentes: {
    entidade:"componentes",
    grupo:"Cadastro técnico",
    nome:"Componentes",
    descricao:"Cadastra componentes vinculados a um ativo técnico.",
    required:["ativo_id","tag","nome"],
    fields:[
      {key:"id",label:"ID",aliases:["id_componente"]},
      {key:"ativo_id",label:"ID do ativo",aliases:["id_ativo","id_equipamento","tag_equipamento"],example:"ATV-EQ-001"},
      {key:"tag",label:"TAG",aliases:["codigo","codigo_componente"],example:"CMP-001"},
      {key:"nome",label:"Nome",aliases:["componente"],example:"Motor principal"},
      {key:"tipo",label:"Tipo",aliases:["tipo_componente"],example:"Motor"},
      {key:"criticidade",label:"Criticidade",aliases:["classificacao"],example:"ALTA"},
      {key:"status",label:"Status",aliases:["situacao"],example:"ATIVO"},
      {key:"vida_util_horas",label:"Vida útil (h)",aliases:["vida_horas"],example:4000},
      {key:"vida_util_dias",label:"Vida útil (dias)",aliases:["vida_dias"],example:365},
      {key:"horas_acumuladas",label:"Horas acumuladas",aliases:["horas"],example:0},
      {key:"instalado_em",label:"Instalado em",aliases:["data_instalacao"],example:"2026-07-22"},
      {key:"fabricante",label:"Fabricante",aliases:[],example:"WEG"},
      {key:"modelo",label:"Modelo",aliases:[],example:"W22"},
      {key:"numero_serie",label:"Número de série",aliases:["serie"],example:"SN-CMP-001"},
      {key:"localizacao_tecnica",label:"Localização técnica",aliases:["local","localizacao"],example:"Painel principal"}
    ]
  },
  materiais: {
    entidade:"materiais",
    grupo:"Almoxarifado",
    nome:"Materiais e peças",
    descricao:"Cadastra itens de estoque usados nas execuções.",
    required:["sku","nome"],
    fields:[
      {key:"id",label:"ID",aliases:["id_material"]},
      {key:"sku",label:"SKU",aliases:["codigo","codigo_material"],example:"ROL-6205"},
      {key:"nome",label:"Nome",aliases:["material","descricao"],example:"Rolamento 6205"},
      {key:"unidade",label:"Unidade",aliases:["un"],example:"un"},
      {key:"estoque_atual",label:"Estoque atual",aliases:["saldo","quantidade"],example:10},
      {key:"estoque_minimo",label:"Estoque mínimo",aliases:["minimo"],example:3},
      {key:"status",label:"Status",aliases:["ativo"],example:"ATIVO"}
    ]
  },
  planos: {
    entidade:"planos",
    grupo:"Programação",
    nome:"Planos programados",
    descricao:"Cria planos em rascunho; a ativação continua dependendo da validação do Gestor.",
    required:["ativo_id","nome","gatilho_tipo","gatilho_valor"],
    fields:[
      {key:"id",label:"ID",aliases:["id_plano"]},
      {key:"ativo_id",label:"ID do ativo",aliases:["id_ativo","id_equipamento"],example:"ATV-EQ-001"},
      {key:"componente_id",label:"ID do componente",aliases:["id_componente"],example:""},
      {key:"nome",label:"Nome do plano",aliases:["plano","titulo"],example:"Inspeção mensal"},
      {key:"tipo",label:"Tipo",aliases:["tipo_manutencao"],example:"PREVENTIVA"},
      {key:"criticidade",label:"Criticidade",aliases:["prioridade"],example:"ALTA"},
      {key:"gatilho_tipo",label:"Tipo de gatilho",aliases:["gatilho","programacao_tipo"],example:"DIAS"},
      {key:"gatilho_valor",label:"Valor do gatilho",aliases:["intervalo","periodicidade_valor"],example:30},
      {key:"unidade",label:"Unidade",aliases:["un"],example:"dias"},
      {key:"recorrencia_dias",label:"Recorrência (dias)",aliases:["periodicidade_dias"],example:30},
      {key:"tempo_estimado_min",label:"Tempo estimado (min)",aliases:["tempo_minutos"],example:60},
      {key:"requer_bloqueio",label:"Requer bloqueio",aliases:["bloqueio"],example:"SIM"},
      {key:"requer_evidencia",label:"Requer evidência",aliases:["evidencia"],example:"SIM"},
      {key:"max_sessoes",label:"Máximo de sessões",aliases:["sessoes"],example:1},
      {key:"setor_id",label:"ID do setor",aliases:["id_setor"],example:""},
      {key:"modo_parada_manutencao",label:"Modo de parada",aliases:["modo_parada"],example:"AUTO"}
    ]
  },
  plano_itens: {
    entidade:"plano_itens",
    grupo:"Programação",
    nome:"Itens de checklist",
    descricao:"Inclui perguntas e regras em planos que ainda estão em rascunho.",
    required:["plano_id","titulo"],
    fields:[
      {key:"id",label:"ID",aliases:["id_item"]},
      {key:"plano_id",label:"ID do plano",aliases:["id_plano"],example:"PLN-ATV-EQ-001-ATIVO-INSPECAO-MENSAL"},
      {key:"ordem",label:"Ordem",aliases:["sequencia"],example:1},
      {key:"titulo",label:"Título",aliases:["item","pergunta","descricao"],example:"Verificar nível de óleo"},
      {key:"instrucao",label:"Instrução",aliases:["orientacao"],example:"Registrar anormalidades"},
      {key:"tipo_resposta",label:"Tipo de resposta",aliases:["tipo_item"],example:"OK_NOK"},
      {key:"obrigatorio",label:"Obrigatório",aliases:["requerido"],example:"SIM"},
      {key:"evidencia_obrigatoria",label:"Evidência obrigatória",aliases:["exige_evidencia"],example:"NAO"},
      {key:"limite_min",label:"Limite mínimo",aliases:["minimo"],example:""},
      {key:"limite_max",label:"Limite máximo",aliases:["maximo"],example:""},
      {key:"unidade",label:"Unidade",aliases:["un"],example:""},
      {key:"parametro_nome",label:"Parâmetro",aliases:["parametro"],example:""},
      {key:"valor_esperado",label:"Valor esperado",aliases:["esperado"],example:""},
      {key:"opcoes_json",label:"Opções",aliases:["opcoes"],example:""},
      {key:"bloqueia_finalizacao",label:"Bloqueia finalização",aliases:["bloqueia"],example:"NAO"},
      {key:"categoria",label:"Categoria",aliases:[],example:"OPERACIONAL"},
      {key:"peso",label:"Peso",aliases:[],example:1},
      {key:"status",label:"Status",aliases:["ativo"],example:"ATIVO"},
      {key:"validacao_regra",label:"Regra de validação",aliases:["regra"],example:""},
      {key:"evidencia_min_fotos",label:"Mínimo de fotos",aliases:["min_fotos"],example:0}
    ]
  }
};

function adminImportRequireAdmin_(auth){
  adminRequireIdentityAdmin_(auth || {});
}

function adminImportEnsureSchema_(){
  var ss = getSpreadsheet_();
  ensureSheet_(ss, "importacao_lotes", SH.importacao_lotes);
  ensureSheet_(ss, "importacao_registros", SH.importacao_registros);
}

function cmmsImportacaoAdminSchemaUpgrade_(p, auth){
  adminImportRequireAdmin_(auth);
  adminImportEnsureSchema_();
  return {upgraded:true, sheets:["importacao_lotes","importacao_registros"], max_rows:ADMIN_IMPORT_MAX_ROWS};
}

function adminImportHeader_(value){
  return clean_(value).toLowerCase()
    .replace(/[áàãâä]/g,"a").replace(/[éèêë]/g,"e")
    .replace(/[íìîï]/g,"i").replace(/[óòõôö]/g,"o")
    .replace(/[úùûü]/g,"u").replace(/ç/g,"c")
    .replace(/[^a-z0-9]+/g,"_").replace(/^_+|_+$/g,"");
}

function adminImportFieldMap_(model){
  var out = {};
  model.fields.forEach(function(field){
    [field.key, field.label].concat(field.aliases || []).forEach(function(alias){
      var key = adminImportHeader_(alias);
      if(key) out[key] = field.key;
    });
  });
  return out;
}

function adminImportPublicModel_(key, model){
  return {
    tipo:key,
    entidade:model.entidade,
    grupo:model.grupo,
    nome:model.nome,
    descricao:model.descricao,
    max_linhas:ADMIN_IMPORT_MAX_ROWS,
    campos:model.fields.map(function(field){
      return {
        chave:field.key,
        rotulo:field.label,
        obrigatorio:model.required.indexOf(field.key) >= 0,
        exemplo:field.example === undefined ? "" : field.example
      };
    })
  };
}

function adminImportacaoModelos_(p, auth){
  adminImportRequireAdmin_(auth);
  return {
    max_linhas:ADMIN_IMPORT_MAX_ROWS,
    modelos:Object.keys(ADMIN_IMPORT_MODELS).map(function(key){
      return adminImportPublicModel_(key, ADMIN_IMPORT_MODELS[key]);
    })
  };
}

function adminImportPrimitive_(value){
  if(value === null || value === undefined) return "";
  if(typeof value === "number" || typeof value === "boolean") return value;
  var text = String(value).trim();
  if(text.length > ADMIN_IMPORT_MAX_CELL_CHARS){
    err_("IMPORT_CELL_TOO_LONG", "Uma célula excede "+ADMIN_IMPORT_MAX_CELL_CHARS+" caracteres.", 400);
  }
  if(/^[=+@]/.test(text) || (/^-/.test(text) && !/^-\d+(?:[.,]\d+)?$/.test(text))){
    err_("IMPORT_FORMULA_BLOCKED", "Fórmulas e comandos não são aceitos na importação.", 400);
  }
  return text;
}

function adminImportIsBlankRow_(raw){
  return !raw || Object.keys(raw).filter(function(key){ return key !== "__linha"; })
    .every(function(key){ return clean_(raw[key]) === ""; });
}

function adminImportMapRow_(raw, headerMap){
  var mapped = {};
  Object.keys(raw || {}).forEach(function(header){
    var canonical = headerMap[adminImportHeader_(header)];
    if(!canonical) return;
    mapped[canonical] = adminImportPrimitive_(raw[header]);
  });
  return mapped;
}

function adminImportResolveId_(sheetName, value){
  var requested = clean_(value);
  if(!requested) return "";
  var byId = find_(sheetName, "id", requested);
  if(byId) return byId.id;
  var byTag = rows_(sheetName, true).filter(function(row){ return upper_(row.tag) === upper_(requested); });
  if(byTag.length === 1) return byTag[0].id;
  if(byTag.length > 1){
    err_("IMPORT_REFERENCE_AMBIGUOUS", "A referência "+requested+" corresponde a mais de um cadastro.", 400);
  }
  return requested;
}

function adminImportResolveReferences_(entidade, mapped){
  if(entidade === "setores") mapped.planta_id = adminImportResolveId_("plantas", mapped.planta_id);
  if(entidade === "linhas") mapped.setor_id = adminImportResolveId_("setores", mapped.setor_id);
  if(entidade === "ativos") mapped.linha_id = adminImportResolveId_("linhas", mapped.linha_id);
  if(entidade === "componentes") mapped.ativo_id = adminImportResolveId_("ativos", mapped.ativo_id);
  if(entidade === "planos"){
    mapped.ativo_id = adminImportResolveId_("ativos", mapped.ativo_id);
    mapped.componente_id = adminImportResolveId_("componentes", mapped.componente_id);
    mapped.setor_id = adminImportResolveId_("setores", mapped.setor_id);
  }
  return mapped;
}

function adminImportAssertReference_(entidade, row){
  if(entidade === "setores" && !find_("plantas", "id", row.planta_id)){
    err_("IMPORT_REFERENCE_INVALID", "Planta não encontrada: "+row.planta_id, 400);
  }
  if(entidade === "linhas" && !find_("setores", "id", row.setor_id)){
    err_("IMPORT_REFERENCE_INVALID", "Setor não encontrado: "+row.setor_id, 400);
  }
  if(entidade === "ativos" && !find_("linhas", "id", row.linha_id)){
    err_("IMPORT_REFERENCE_INVALID", "Linha não encontrada: "+row.linha_id, 400);
  }
  if(entidade === "componentes" && !find_("ativos", "id", row.ativo_id)){
    err_("IMPORT_REFERENCE_INVALID", "Ativo não encontrado: "+row.ativo_id, 400);
  }
  if(entidade === "planos"){
    var ativo = find_("ativos", "id", row.ativo_id);
    if(!ativo) err_("IMPORT_REFERENCE_INVALID", "Ativo não encontrado: "+row.ativo_id, 400);
    if(row.componente_id){
      var componente = find_("componentes", "id", row.componente_id);
      if(!componente || String(componente.ativo_id) !== String(row.ativo_id)){
        err_("IMPORT_REFERENCE_INVALID", "Componente não pertence ao ativo informado: "+row.componente_id, 400);
      }
    }
    if(num_(row.gatilho_valor, 0) <= 0){
      err_("IMPORT_TRIGGER_INVALID", "O valor do gatilho deve ser maior que zero.", 400);
    }
  }
  if(entidade === "plano_itens"){
    var plano = find_("planos_manutencao", "id", row.plano_id);
    if(!plano) err_("IMPORT_REFERENCE_INVALID", "Plano não encontrado: "+row.plano_id, 400);
    if(upper_(plano.status) === ST.ATIVO || upper_(plano.workflow_status) === ST.VALIDADO){
      err_("IMPORT_PROTECTED_PLAN", "O plano "+row.plano_id+" já foi validado. Crie uma revisão antes de alterar seus itens.", 409);
    }
  }
}

function adminImportProtectWorkflow_(entidade, row){
  if(entidade !== "planos") return row;
  var existing = row.id ? find_("planos_manutencao", "id", row.id) : null;
  if(existing && (upper_(existing.status) === ST.ATIVO || upper_(existing.workflow_status) === ST.VALIDADO)){
    err_("IMPORT_PROTECTED_PLAN", "O plano "+existing.id+" já foi validado. Crie uma revisão antes de alterá-lo.", 409);
  }
  row.status = ST.INATIVO;
  row.workflow_status = ST.RASCUNHO;
  row.validado_gestao = "NAO";
  row.validado_por = "";
  row.validado_em = "";
  row.enviado_validacao_em = "";
  return row;
}

function adminImportError_(cause){
  return {
    codigo:clean_(cause && cause.code) || "IMPORT_ROW_INVALID",
    mensagem:clean_(cause && cause.message) || "Linha inválida."
  };
}

function adminImportComparable_(sheetName, row){
  var source = strip_(row || {});
  var out = {};
  SH[sheetName].forEach(function(key){ out[key] = source[key] === undefined ? "" : source[key]; });
  return out;
}

function adminImportRowHash_(row){
  return sha256_(JSON.stringify(row || {}));
}

function adminImportacaoValidar_(p, auth){
  adminImportRequireAdmin_(auth);
  adminImportEnsureSchema_();
  req_(p, ["tipo","arquivo_nome","cabecalhos","linhas"]);
  var tipo = clean_(p.tipo);
  var model = ADMIN_IMPORT_MODELS[tipo];
  if(!model) err_("IMPORT_MODEL_INVALID", "Modelo de importação inválido: "+tipo, 400);
  if(!Array.isArray(p.cabecalhos) || !p.cabecalhos.length){
    err_("IMPORT_HEADERS_REQUIRED", "A planilha não possui cabeçalhos.", 400);
  }
  if(!Array.isArray(p.linhas) || !p.linhas.length){
    err_("IMPORT_ROWS_REQUIRED", "A planilha não possui linhas para importar.", 400);
  }
  if(p.linhas.length > ADMIN_IMPORT_MAX_ROWS){
    err_("IMPORT_ROWS_LIMIT", "O lote aceita no máximo "+ADMIN_IMPORT_MAX_ROWS+" linhas.", 413);
  }

  var headerMap = adminImportFieldMap_(model);
  var canonicalHeaders = [];
  var ignoredHeaders = [];
  p.cabecalhos.forEach(function(header){
    var normalized = adminImportHeader_(header);
    var canonical = headerMap[normalized];
    if(!canonical){ ignoredHeaders.push(clean_(header)); return; }
    if(canonicalHeaders.indexOf(canonical) >= 0){
      err_("IMPORT_DUPLICATE_HEADER", "Mais de uma coluna corresponde ao campo "+canonical+".", 400);
    }
    canonicalHeaders.push(canonical);
  });
  var missing = model.required.filter(function(key){ return canonicalHeaders.indexOf(key) < 0; });
  if(missing.length){
    err_("IMPORT_REQUIRED_HEADERS_MISSING", "Cabeçalhos obrigatórios ausentes: "+missing.join(", ")+".", 400);
  }

  var batchId = "IMP-"+Utilities.getUuid().replace(/-/g, "").slice(0, 16).toUpperCase();
  var seenIds = {};
  var staged = [];
  var valid = 0;
  var invalid = 0;
  p.linhas.forEach(function(raw, index){
    if(adminImportIsBlankRow_(raw)) return;
    var lineNumber = num_(raw && raw.__linha, index + 2);
    var normalized = {};
    var errors = [];
    try{
      var mapped = adminImportResolveReferences_(model.entidade, adminImportMapRow_(raw, headerMap));
      normalized = normalizeEnt_(model.entidade, mapped);
      normalized = adminImportProtectWorkflow_(model.entidade, normalized);
      adminImportAssertReference_(model.entidade, normalized);
      if(seenIds[normalized.id]){
        err_("IMPORT_DUPLICATE_ID", "O ID "+normalized.id+" aparece mais de uma vez no lote.", 400);
      }
      seenIds[normalized.id] = true;
    } catch(cause){
      errors.push(adminImportError_(cause));
    }
    var sheetName = ADMIN_ENT[model.entidade];
    var old = normalized.id ? find_(sheetName, "id", normalized.id) : null;
    var operation = old ? "ATUALIZAR" : "CRIAR";
    var status = errors.length ? "INVALIDO" : "VALIDADO";
    if(errors.length) invalid++; else valid++;
    var record = fit_("importacao_registros", {
      id:batchId+"-"+String(lineNumber),
      lote_id:batchId,
      linha_numero:lineNumber,
      entidade:model.entidade,
      entidade_id:normalized.id || "",
      operacao:operation,
      status:status,
      raw_json:JSON.stringify(raw || {}),
      normalizado_json:JSON.stringify(normalized || {}),
      erros_json:JSON.stringify(errors),
      antes_json:"",
      depois_json:"",
      aplicado_em:"",
      rollback_em:"",
      criado_em:now_(),
      atualizado_em:now_()
    });
    append_("importacao_registros", record);
    staged.push(record);
  });
  if(!staged.length) err_("IMPORT_ROWS_REQUIRED", "Nenhuma linha preenchida foi encontrada.", 400);

  var validationHash = sha256_("FAB-IMPORT-V1:"+batchId+":"+staged.map(function(row){
    return row.linha_numero+":"+row.status+":"+adminImportRowHash_(JSON.parse(row.normalizado_json || "{}"));
  }).join("|"));
  var batch = fit_("importacao_lotes", {
    id:batchId,
    tipo:tipo,
    entidade:model.entidade,
    arquivo_nome:clean_(p.arquivo_nome).slice(0, 180),
    aba_nome:clean_(p.aba_nome).slice(0, 120),
    status:invalid ? "COM_ERROS" : "VALIDADO",
    total_linhas:staged.length,
    linhas_validas:valid,
    linhas_invalidas:invalid,
    validacao_hash:validationHash,
    cabecalhos_json:JSON.stringify(canonicalHeaders),
    cabecalhos_ignorados_json:JSON.stringify(ignoredHeaders),
    resultado_json:"",
    criado_por:auth.usuario_id,
    criado_em:now_(),
    confirmado_por:"",
    confirmado_em:"",
    rollback_por:"",
    rollback_em:"",
    atualizado_em:now_()
  });
  append_("importacao_lotes", batch);
  audit_(auth, "ADMIN_IMPORT_VALIDATED", "importacao_lotes", batchId, null, {
    tipo:tipo, total:staged.length, validas:valid, invalidas:invalid
  }, clean_(p.user_agent));
  return adminImportPublicBatch_(batch, staged);
}

function adminImportPublicRecord_(row){
  return {
    id:row.id,
    linha_numero:num_(row.linha_numero, 0),
    entidade:row.entidade,
    entidade_id:row.entidade_id,
    operacao:row.operacao,
    status:row.status,
    normalizado:JSON.parse(clean_(row.normalizado_json) || "{}"),
    erros:JSON.parse(clean_(row.erros_json) || "[]")
  };
}

function adminImportPublicBatch_(batch, records){
  return {
    id:batch.id,
    tipo:batch.tipo,
    entidade:batch.entidade,
    arquivo_nome:batch.arquivo_nome,
    aba_nome:batch.aba_nome,
    status:batch.status,
    total_linhas:num_(batch.total_linhas, 0),
    linhas_validas:num_(batch.linhas_validas, 0),
    linhas_invalidas:num_(batch.linhas_invalidas, 0),
    validacao_hash:batch.validacao_hash,
    cabecalhos:JSON.parse(clean_(batch.cabecalhos_json) || "[]"),
    cabecalhos_ignorados:JSON.parse(clean_(batch.cabecalhos_ignorados_json) || "[]"),
    resultado:JSON.parse(clean_(batch.resultado_json) || "{}"),
    criado_por:batch.criado_por,
    criado_em:batch.criado_em,
    confirmado_por:batch.confirmado_por,
    confirmado_em:batch.confirmado_em,
    rollback_por:batch.rollback_por,
    rollback_em:batch.rollback_em,
    registros:(records || []).map(adminImportPublicRecord_)
  };
}

function adminImportBatchRecords_(batchId){
  return rows_("importacao_registros", true).filter(function(row){
    return String(row.lote_id) === String(batchId);
  }).sort(function(a,b){ return num_(a.linha_numero, 0) - num_(b.linha_numero, 0); });
}

function adminImportacaoDetalhe_(p, auth){
  adminImportRequireAdmin_(auth);
  adminImportEnsureSchema_();
  req_(p, ["lote_id"]);
  var batch = find_("importacao_lotes", "id", p.lote_id);
  if(!batch) err_("IMPORT_BATCH_NOT_FOUND", "Lote de importação não encontrado.", 404);
  return adminImportPublicBatch_(batch, adminImportBatchRecords_(batch.id));
}

function adminImportacaoLotes_(p, auth){
  adminImportRequireAdmin_(auth);
  adminImportEnsureSchema_();
  var limit = Math.max(1, Math.min(num_(p.limite, 50), 100));
  var batches = rows_("importacao_lotes", true).sort(function(a,b){
    return clean_(b.criado_em).localeCompare(clean_(a.criado_em));
  }).slice(0, limit).map(function(batch){ return adminImportPublicBatch_(batch, []); });
  return {total:batches.length, lotes:batches};
}

function adminImportRollbackApplied_(applied, rollbackTimestamp){
  applied.slice().reverse().forEach(function(item){
    var current = find_(item.sheetName, "id", item.entityId);
    if(item.operation === "CRIAR"){
      if(current) deleteRow_(item.sheetName, current.__rowIndex);
    } else if(current){
      update_(item.sheetName, current.__rowIndex, item.before);
    }
    if(item.record && item.record.__rowIndex){
      update_("importacao_registros", item.record.__rowIndex, {
        status:"REVERTIDO",
        rollback_em:rollbackTimestamp,
        atualizado_em:rollbackTimestamp
      });
    }
  });
}

function adminImportacaoConfirmar_(p, auth){
  adminImportRequireAdmin_(auth);
  adminImportEnsureSchema_();
  req_(p, ["lote_id","validacao_hash"]);
  var batch = find_("importacao_lotes", "id", p.lote_id);
  if(!batch) err_("IMPORT_BATCH_NOT_FOUND", "Lote de importação não encontrado.", 404);
  if(upper_(batch.status) !== "VALIDADO"){
    err_("IMPORT_BATCH_NOT_READY", "O lote precisa estar integralmente validado antes da confirmação.", 409);
  }
  if(!authSecureEquals_(clean_(batch.validacao_hash), clean_(p.validacao_hash))){
    err_("IMPORT_VALIDATION_CHANGED", "A assinatura da pré-análise não confere. Valide o arquivo novamente.", 409);
  }
  var records = adminImportBatchRecords_(batch.id);
  if(!records.length || records.some(function(row){ return upper_(row.status) !== "VALIDADO"; })){
    err_("IMPORT_BATCH_NOT_READY", "O lote contém registros não validados.", 409);
  }

  var lock = LockService.getScriptLock();
  if(!lock.tryLock(15000)) err_("IMPORT_WRITE_BUSY", "Outra importação está sendo confirmada.", 409);
  var applied = [];
  var timestamp = now_();
  try{
    records.forEach(function(record){
      var entity = clean_(record.entidade);
      var sheetName = ADMIN_ENT[entity];
      if(!sheetName) err_("IMPORT_ENTITY_INVALID", "Entidade inválida no lote: "+entity, 400);
      var data = JSON.parse(clean_(record.normalizado_json) || "{}");
      data = adminImportProtectWorkflow_(entity, data);
      adminImportAssertReference_(entity, data);
      var current = data.id ? find_(sheetName, "id", data.id) : null;
      var operation = current ? "ATUALIZAR" : "CRIAR";
      var before = current ? adminImportComparable_(sheetName, current) : {};
      var result = adminSalvar_({entidade:entity, dados:data, __auth:auth});
      var after = adminImportComparable_(sheetName, result.row);
      applied.push({
        record:record,
        sheetName:sheetName,
        entityId:result.row.id,
        operation:operation,
        before:before,
        after:after
      });
      update_("importacao_registros", record.__rowIndex, {
        entidade_id:result.row.id,
        operacao:operation,
        status:"APLICADO",
        antes_json:JSON.stringify(before),
        depois_json:JSON.stringify(after),
        aplicado_em:timestamp,
        atualizado_em:timestamp
      });
      audit_(auth, "ADMIN_IMPORT_ROW_APPLIED", sheetName, result.row.id, before, after, clean_(p.user_agent));
    });

    var resultSummary = {criados:0, atualizados:0};
    applied.forEach(function(item){
      if(item.operation === "CRIAR") resultSummary.criados++;
      else resultSummary.atualizados++;
    });
    update_("importacao_lotes", batch.__rowIndex, {
      status:"CONCLUIDO",
      resultado_json:JSON.stringify(resultSummary),
      confirmado_por:auth.usuario_id,
      confirmado_em:timestamp,
      atualizado_em:timestamp
    });
    audit_(auth, "ADMIN_IMPORT_CONFIRMED", "importacao_lotes", batch.id, null, resultSummary, clean_(p.user_agent));
    batch = find_("importacao_lotes", "id", batch.id);
    return adminImportPublicBatch_(batch, adminImportBatchRecords_(batch.id));
  } catch(cause){
    var rollbackTimestamp = now_();
    adminImportRollbackApplied_(applied, rollbackTimestamp);
    update_("importacao_lotes", batch.__rowIndex, {
      status:"FALHOU",
      resultado_json:JSON.stringify({erro:adminImportError_(cause), revertidos:applied.length}),
      atualizado_em:rollbackTimestamp
    });
    throw cause;
  } finally {
    lock.releaseLock();
  }
}

function adminImportAssertDeleteSafe_(entity, entityId){
  var references = {
    plantas:["setores","planta_id"],
    setores:["linhas","setor_id"],
    linhas:["ativos","linha_id"],
    ativos:["componentes","ativo_id","planos_manutencao","ativo_id","ordens_servico","ativo_id"],
    componentes:["planos_manutencao","componente_id","ordens_servico","componente_id"],
    materiais:["materiais_uso","material_id"],
    planos:["plano_itens","plano_id","os_acoes","plano_id"],
    plano_itens:["checklist_execucao","plano_item_id"]
  };
  var list = references[entity] || [];
  for(var index = 0; index < list.length; index += 2){
    if(rows_(list[index], true).some(function(row){ return String(row[list[index + 1]]) === String(entityId); })){
      err_("IMPORT_ROLLBACK_REFERENCED", "O registro "+entityId+" possui vínculos posteriores e não pode ser removido automaticamente.", 409);
    }
  }
}

function adminImportacaoRollback_(p, auth){
  adminImportRequireAdmin_(auth);
  adminImportEnsureSchema_();
  req_(p, ["lote_id","motivo"]);
  if(clean_(p.motivo).length < 8) err_("IMPORT_ROLLBACK_REASON_REQUIRED", "Informe um motivo com pelo menos 8 caracteres.", 400);
  var batch = find_("importacao_lotes", "id", p.lote_id);
  if(!batch) err_("IMPORT_BATCH_NOT_FOUND", "Lote de importação não encontrado.", 404);
  if(upper_(batch.status) !== "CONCLUIDO"){
    err_("IMPORT_ROLLBACK_NOT_ALLOWED", "Somente lotes concluídos podem ser revertidos.", 409);
  }
  var records = adminImportBatchRecords_(batch.id).filter(function(row){ return upper_(row.status) === "APLICADO"; });
  if(!records.length) err_("IMPORT_ROLLBACK_NOT_ALLOWED", "O lote não possui registros aplicados.", 409);

  var lock = LockService.getScriptLock();
  if(!lock.tryLock(15000)) err_("IMPORT_WRITE_BUSY", "Outra alteração administrativa está em andamento.", 409);
  try{
    var prepared = records.map(function(record){
      var entity = clean_(record.entidade);
      var sheetName = ADMIN_ENT[entity];
      var current = find_(sheetName, "id", record.entidade_id);
      if(!current) err_("IMPORT_ROLLBACK_DIVERGED", "O registro "+record.entidade_id+" não existe mais.", 409);
      var after = JSON.parse(clean_(record.depois_json) || "{}");
      if(adminImportRowHash_(adminImportComparable_(sheetName, current)) !== adminImportRowHash_(after)){
        err_("IMPORT_ROLLBACK_DIVERGED", "O registro "+record.entidade_id+" foi alterado após a importação.", 409);
      }
      if(upper_(record.operacao) === "CRIAR") adminImportAssertDeleteSafe_(entity, record.entidade_id);
      return {
        record:record,
        entity:entity,
        sheetName:sheetName,
        entityId:record.entidade_id,
        operation:upper_(record.operacao),
        before:JSON.parse(clean_(record.antes_json) || "{}"),
        after:after
      };
    });
    var timestamp = now_();
    adminImportRollbackApplied_(prepared, timestamp);
    update_("importacao_lotes", batch.__rowIndex, {
      status:"REVERTIDO",
      rollback_por:auth.usuario_id,
      rollback_em:timestamp,
      resultado_json:JSON.stringify({revertidos:prepared.length, motivo:clean_(p.motivo)}),
      atualizado_em:timestamp
    });
    audit_(auth, "ADMIN_IMPORT_ROLLED_BACK", "importacao_lotes", batch.id, null, {
      revertidos:prepared.length, motivo:clean_(p.motivo)
    }, clean_(p.user_agent));
    batch = find_("importacao_lotes", "id", batch.id);
    return adminImportPublicBatch_(batch, adminImportBatchRecords_(batch.id));
  } finally {
    lock.releaseLock();
  }
}
