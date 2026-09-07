const TECH_DEMAND_STATUS = {
  ABERTA:"ABERTA",
  EM_TRIAGEM:"EM_TRIAGEM",
  EM_VALIDACAO:"EM_VALIDACAO_TECNICA",
  AGUARDANDO_ASSINATURA:"AGUARDANDO_ASSINATURA",
  ENCAMINHADA:"ENCAMINHADA",
  DEVOLVIDA_ADMIN:"DEVOLVIDA_ADMIN",
  APROVADA:"APROVADA_TECNICAMENTE",
  LIBERADA_OPERACAO:"LIBERADA_OPERACAO",
  CONCLUIDA:"CONCLUIDA",
  CANCELADA:"CANCELADA"
};

const TECH_WORKFLOW_SCHEMA_VERSION = FAB.SCHEMA_VERSION + ".validation-policy.1";

const TECH_SIGNATURE_POLICY = {
  QUALIDADE_OU_SEGURANCA:"QUALIDADE_OU_SEGURANCA",
  QUALIDADE:"QUALIDADE",
  SEGURANCA:"SEGURANCA",
  QUALIDADE_E_SEGURANCA:"QUALIDADE_E_SEGURANCA",
  PERSONALIZADA:"PERSONALIZADA"
};

const TECH_DEFAULT_VALIDATOR_CODES = ["QUALIDADE","SEGURANCA"];

const TECH_FINAL_STATUSES = [
  TECH_DEMAND_STATUS.DEVOLVIDA_ADMIN,
  TECH_DEMAND_STATUS.APROVADA,
  TECH_DEMAND_STATUS.LIBERADA_OPERACAO,
  TECH_DEMAND_STATUS.CONCLUIDA,
  TECH_DEMAND_STATUS.CANCELADA
];

function technicalEnsureSchema_(){
  var ss = getSpreadsheet_();
  var marker = find_("config", "chave", "workflow.tecnico.schema.version");
  var textRepairMarker = find_("config", "chave", "workflow.tecnico.text.repair.version");
  if(marker && clean_(marker.valor) === TECH_WORKFLOW_SCHEMA_VERSION && textRepairMarker && clean_(textRepairMarker.valor) === "1") return;
  var lock = LockService.getScriptLock();
  if(!lock.tryLock(20000)) err_("TECH_SCHEMA_BUSY", "A preparação do workflow técnico está em andamento. Tente novamente.", 409);
  try{
    marker = find_("config", "chave", "workflow.tecnico.schema.version");
    if(!marker || clean_(marker.valor) !== TECH_WORKFLOW_SCHEMA_VERSION){
      [
        "areas_tecnicas","cargos_tecnicos","demandas_tecnicas","demanda_tramitacoes",
        "assinaturas_tecnicas","analises_tecnicas","notificacoes","turnos",
        "apontamentos_producao","sla_politicas","usuarios","planos_manutencao",
        "ordens_servico","os_acoes","ocorrencias_operacionais"
      ].forEach(function(name){ ensureSheet_(ss, name, SH[name]); });
      upsert_("config", "chave", {
        chave:"workflow.tecnico.schema.version",
        valor:TECH_WORKFLOW_SCHEMA_VERSION,
        descricao:"Versão do roteamento, assinatura, análises e KPIs técnicos",
        atualizado_em:now_()
      });
    }
    technicalSeedCatalog_({usuario_id:"SISTEMA", perfil:ROLE.SISTEMA});
    technicalMigrateValidationPolicies_();
    upsert_("config", "chave", {
      chave:"workflow.tecnico.text.repair.version",
      valor:"1",
      descricao:"Versão da correção de acentuação dos catálogos técnicos",
      atualizado_em:now_()
    });
  } finally {
    lock.releaseLock();
  }
}

function technicalLooksMojibake_(value){
  return /Ã[^A-Z0-9\s]|Â|â€|[\u0080-\u009F]|�/.test(String(value || ""));
}

function cmmsWorkflowTecnicoSchemaUpgrade_(p, auth){
  if(upper_(auth && auth.perfil) !== ROLE.ADMIN){
    err_("FORBIDDEN_ADMIN_REQUIRED", "A migração do workflow técnico exige perfil ADMIN.", 403);
  }
  technicalEnsureSchema_();
  var catalog = technicalSeedCatalog_(auth);
  var interventionIntegrity = typeof adminIntervencaoQuarentenarAcoesInvalidas_ === "function"
    ? adminIntervencaoQuarentenarAcoesInvalidas_(auth)
    : {checked:0, quarantined:0, manual_review:0};
  upsert_("config", "chave", {
    chave:"workflow.tecnico.schema.version",
    valor:TECH_WORKFLOW_SCHEMA_VERSION,
    descricao:"Versão do roteamento, assinatura, análises e KPIs técnicos",
    atualizado_em:now_()
  });
  invalidateRuntimeCache_();
  return {
    upgraded:true,
    schema_version:FAB.SCHEMA_VERSION,
    sheets:Object.keys(SH).length,
    catalog:catalog,
    intervention_integrity:interventionIntegrity
  };
}

function technicalSeedCatalog_(auth){
  var permissionMigrationKey = "workflow.tecnico.validadores_padrao.v1";
  var permissionMigration = find_("config", "chave", permissionMigrationKey);
  var shouldMigratePermissions = !permissionMigration || !bool_(permissionMigration.valor);
  var definitions = [
    {codigo:"MANUTENCAO", nome:"Manutenção", descricao:"Diagnóstico, reparo, confiabilidade e acompanhamento técnico.", exige:"NAO", assina:"NAO", cargo:"TÉCNICO DE MANUTENÇÃO"},
    {codigo:"QUALIDADE", nome:"Qualidade", descricao:"Conformidade, inspeção e assinatura de qualidade.", exige:"SIM", assina:"SIM", cargo:"INSPETOR DE QUALIDADE"},
    {codigo:"SEGURANCA", nome:"Segurança", descricao:"Riscos, bloqueios e assinatura de segurança.", exige:"SIM", assina:"SIM", cargo:"TÉCNICO DE SEGURANÇA"},
    {codigo:"SUPERVISAO", nome:"Supervisão", descricao:"Coordenação operacional e acompanhamento de turno.", exige:"NAO", assina:"NAO", cargo:"SUPERVISOR"},
    {codigo:"LIDERANCA_SETOR", nome:"Liderança de setor", descricao:"Acompanhamento do escopo da linha ou setor.", exige:"NAO", assina:"NAO", cargo:"LÍDER DE SETOR"}
  ];
  var createdAreas = 0;
  var createdRoles = 0;
  definitions.forEach(function(definition){
    var area = rows_("areas_tecnicas", true).find(function(item){ return upper_(item.codigo) === definition.codigo; });
    if(!area){
      area = fit_("areas_tecnicas", {
        id:eid_("ATEC", definition.codigo), codigo:definition.codigo, nome:definition.nome,
        descricao:definition.descricao, status:ST.ATIVO, exige_assinatura_padrao:definition.exige,
        criado_por:auth.usuario_id, criado_em:now_(), atualizado_em:now_()
      });
      append_("areas_tecnicas", area);
      createdAreas++;
    } else if(technicalLooksMojibake_(area.nome) || technicalLooksMojibake_(area.descricao)){
      update_("areas_tecnicas", area.__rowIndex, {
        nome:definition.nome,
        descricao:definition.descricao,
        atualizado_em:now_()
      });
      area.nome = definition.nome;
      area.descricao = definition.descricao;
    }
    var roleCode = slug_(definition.cargo);
    var roleId = eid_("CTEC", definition.codigo);
    var role = rows_("cargos_tecnicos", true).find(function(item){
      return String(item.id) === String(roleId) || (String(item.area_id) === String(area.id) && upper_(item.codigo) === roleCode);
    });
    if(!role){
      append_("cargos_tecnicos", fit_("cargos_tecnicos", {
        id:roleId, area_id:area.id, codigo:roleCode,
        nome:definition.cargo, descricao:definition.descricao, status:ST.ATIVO,
        pode_assinar:definition.assina, criado_por:auth.usuario_id, criado_em:now_(), atualizado_em:now_()
      }));
      createdRoles++;
    } else if(upper_(role.codigo) !== roleCode || (shouldMigratePermissions && upper_(role.pode_assinar) !== definition.assina) || technicalLooksMojibake_(role.nome) || technicalLooksMojibake_(role.descricao)){
      update_("cargos_tecnicos", role.__rowIndex, {
        codigo:roleCode,
        nome:definition.cargo,
        descricao:definition.descricao,
        pode_assinar:shouldMigratePermissions ? definition.assina : role.pode_assinar,
        atualizado_em:now_()
      });
    }
  });
  if(shouldMigratePermissions){
    var migrationRow = {
      chave:permissionMigrationKey,
      valor:"SIM",
      descricao:"Migração única dos validadores padrão de Qualidade e Segurança.",
      atualizado_em:now_()
    };
    if(permissionMigration){
      update_("config", permissionMigration.__rowIndex, migrationRow);
    } else {
      append_("config", fit_("config", migrationRow));
    }
  }
  [
    {prioridade:"CRITICA", resposta:15, resolucao:120},
    {prioridade:"ALTA", resposta:30, resolucao:240},
    {prioridade:"MEDIA", resposta:120, resolucao:480},
    {prioridade:"NORMAL", resposta:120, resolucao:480},
    {prioridade:"BAIXA", resposta:240, resolucao:1440}
  ].forEach(function(definition){
    var policyId = "SLA-DEFAULT-" + definition.prioridade;
    if(find_("sla_politicas", "id", policyId)) return;
    append_("sla_politicas", fit_("sla_politicas", {
      id:policyId, tipo_demanda:"", prioridade:definition.prioridade, area_id:"",
      resposta_minutos:definition.resposta, resolucao_minutos:definition.resolucao,
      calendario_id:"24X7", status:ST.ATIVO, criado_em:now_(), atualizado_em:now_()
    }));
  });
  return {areas_criadas:createdAreas, cargos_criados:createdRoles};
}

function technicalRequireAdmin_(auth){
  if(upper_(auth && auth.perfil) !== ROLE.ADMIN){
    err_("FORBIDDEN_ADMIN_REQUIRED", "Esta operação exige perfil ADMIN.", 403);
  }
}

function technicalRequireManager_(auth){
  var profile = upper_(auth && auth.perfil);
  if([ROLE.GESTOR, ROLE.ADMIN].indexOf(profile) < 0){
    err_("FORBIDDEN_GESTOR_REQUIRED", "Esta operação exige perfil GESTOR ou ADMIN.", 403);
  }
}

function gestorRegistrarParametro_(p, auth){
  technicalRequireManager_(auth);
  req_(p, ["ativo_id", "parametro", "valor"]);

  var ativo = find_("ativos", "id", p.ativo_id);
  if(!ativo) err_("ASSET_NOT_FOUND", "Equipamento não encontrado para registrar parâmetro.", 404);

  var componente = null;
  if(clean_(p.componente_id)){
    componente = find_("componentes", "id", p.componente_id);
    if(!componente || String(componente.ativo_id) !== String(ativo.id)){
      err_("COMPONENT_ASSET_MISMATCH", "Componente não pertence ao equipamento informado.", 400);
    }
  }

  var parametroNome = upper_(p.parametro);
  var valor = Number(String(p.valor).replace(",", "."));
  if(!isFinite(valor)) err_("PARAMETER_VALUE_INVALID", "Valor do parâmetro deve ser numérico.", 400);

  var row;
  var horimetro = null;
  if(parametroNome === "HORIMETRO" && typeof registrarParametroHorimetro116_ === "function"){
    var resultHorimetro = registrarParametroHorimetro116_(
      ativo,
      valor,
      p.origem || "GESTOR_QR",
      auth || {},
      componente ? componente.id : ""
    );
    row = resultHorimetro.parametro;
    horimetro = resultHorimetro.horimetro;
  } else {
    row = fit_("parametros", {
      id:uuid_("PAR"),
      ativo_id:ativo.id,
      componente_id:componente ? componente.id : "",
      parametro:parametroNome,
      valor:valor,
      unidade:clean_(p.unidade),
      origem:clean_(p.origem || "GESTOR_QR"),
      registrado_por:clean_(auth && auth.usuario_id),
      registrado_em:now_(),
      criado_em:now_()
    });
    append_("parametros", row);
  }

  var recalculo = cmmsMotorRecalcular_({ativo_id:ativo.id, __auth:auth});
  audit_(
    auth || {},
    "GESTOR_PARAMETER_RECORDED",
    "parametros",
    row.id,
    null,
    strip_(row),
    clean_(p.user_agent)
  );
  return {
    saved:true,
    parametro:strip_(row),
    horimetro:horimetro,
    recalculo:recalculo
  };
}

function technicalNullableNumber_(value){
  if(value === undefined || value === null || clean_(value) === "") return null;
  var parsed = Number(String(value).replace(",", "."));
  return isFinite(parsed) ? parsed : null;
}

function technicalParameterStatus_(value, minimum, maximum){
  var reading = technicalNullableNumber_(value);
  var min = technicalNullableNumber_(minimum);
  var max = technicalNullableNumber_(maximum);
  if(reading === null) return "SEM_LEITURA";
  if(min !== null && reading < min) return "ABAIXO_LIMITE";
  if(max !== null && reading > max) return "ACIMA_LIMITE";
  return min === null && max === null ? "SEM_LIMITE" : "NORMAL";
}

function technicalManagerParameterSummaries_(context){
  var assetId = clean_(context && context.ativo && context.ativo.id);
  var selectedComponentId = clean_(context && context.componente && context.componente.id);
  if(!assetId) return [];

  var plans = rows_("planos_manutencao", true).filter(function(plan){
    if(String(plan.ativo_id) !== String(assetId)) return false;
    if(selectedComponentId && clean_(plan.componente_id) && String(plan.componente_id) !== String(selectedComponentId)) return false;
    if(typeof isPlanoOperacional_ === "function") return isPlanoOperacional_(plan);
    return upper_(plan.status) === ST.ATIVO && ["VALIDADO","ATIVO"].indexOf(upper_(plan.workflow_status)) >= 0;
  }).sort(sortByDateDesc_("atualizado_em"));
  var planMap = {};
  plans.forEach(function(plan){ planMap[String(plan.id)] = plan; });

  var rules = rows_("plano_itens", true).filter(function(item){
    return !!planMap[String(item.plano_id)] &&
      upper_(item.status || ST.ATIVO) === ST.ATIVO &&
      !!clean_(item.parametro_nome);
  });
  var readings = rows_("parametros", true).filter(function(reading){
    if(String(reading.ativo_id) !== String(assetId)) return false;
    return !selectedComponentId ||
      !clean_(reading.componente_id) ||
      String(reading.componente_id) === String(selectedComponentId);
  }).sort(sortByDateDesc_("registrado_em"));
  var users = {};
  rows_("usuarios", true).forEach(function(user){ users[String(user.id)] = user; });
  var components = {};
  rows_("componentes", true).filter(function(component){
    return String(component.ativo_id) === String(assetId);
  }).forEach(function(component){ components[String(component.id)] = component; });

  function key(componentId, parameter){
    return clean_(componentId) + "|" + upper_(parameter);
  }

  var summaries = {};
  rules.forEach(function(rule){
    var plan = planMap[String(rule.plano_id)];
    var componentId = clean_(plan && plan.componente_id);
    var summaryKey = key(componentId, rule.parametro_nome);
    if(summaries[summaryKey]) return;
    summaries[summaryKey] = {
      chave:summaryKey,
      parametro:upper_(rule.parametro_nome),
      unidade:clean_(rule.unidade || plan.unidade),
      limite_min:technicalNullableNumber_(rule.limite_min),
      limite_max:technicalNullableNumber_(rule.limite_max),
      valor_esperado:clean_(rule.valor_esperado),
      plano_id:clean_(plan.id),
      plano_nome:clean_(plan.nome),
      componente_id:componentId,
      componente_nome:clean_(components[componentId] && components[componentId].nome),
      componente_tag:clean_(components[componentId] && components[componentId].tag),
      configurado:true,
      leitura_atual:null,
      leituras_recentes:[]
    };
  });

  readings.forEach(function(reading){
    var summaryKey = key(reading.componente_id, reading.parametro);
    if(!summaries[summaryKey]){
      summaries[summaryKey] = {
        chave:summaryKey,
        parametro:upper_(reading.parametro),
        unidade:clean_(reading.unidade),
        limite_min:null,
        limite_max:null,
        valor_esperado:"",
        plano_id:"",
        plano_nome:"",
        componente_id:clean_(reading.componente_id),
        componente_nome:clean_(components[String(reading.componente_id)] && components[String(reading.componente_id)].nome),
        componente_tag:clean_(components[String(reading.componente_id)] && components[String(reading.componente_id)].tag),
        configurado:false,
        leitura_atual:null,
        leituras_recentes:[]
      };
    }
    var summary = summaries[summaryKey];
    var publicReading = strip_(reading);
    var author = users[String(reading.registrado_por)];
    publicReading.registrado_por_nome = clean_(author && author.nome);
    publicReading.status_limite = technicalParameterStatus_(
      reading.valor,
      summary.limite_min,
      summary.limite_max
    );
    if(!summary.leitura_atual) summary.leitura_atual = publicReading;
    if(summary.leituras_recentes.length < 6) summary.leituras_recentes.push(publicReading);
  });

  return Object.keys(summaries).map(function(summaryKey){
    var summary = summaries[summaryKey];
    summary.status = technicalParameterStatus_(
      summary.leitura_atual && summary.leitura_atual.valor,
      summary.limite_min,
      summary.limite_max
    );
    return summary;
  }).sort(function(a, b){
    var score = {ACIMA_LIMITE:4, ABAIXO_LIMITE:4, SEM_LEITURA:3, SEM_LIMITE:2, NORMAL:1};
    return num_(score[b.status], 0) - num_(score[a.status], 0) ||
      String(a.parametro).localeCompare(String(b.parametro));
  });
}

function technicalManagerAssetHistory_(context, limit){
  var assetId = clean_(context && context.ativo && context.ativo.id);
  var selectedComponentId = clean_(context && context.componente && context.componente.id);
  if(!assetId) return [];
  var users = {};
  rows_("usuarios", true).forEach(function(user){ users[String(user.id)] = user; });
  var orders = {};
  rows_("ordens_servico", true).filter(function(order){
    return String(order.ativo_id) === String(assetId);
  }).forEach(function(order){ orders[String(order.id)] = order; });
  var actions = {};
  rows_("os_acoes", true).filter(function(action){
    return String(action.ativo_id) === String(assetId);
  }).forEach(function(action){ actions[String(action.id)] = action; });
  var executions = rows_("execucoes", true).filter(function(execution){
    if(String(execution.ativo_id) !== String(assetId)) return false;
    return !selectedComponentId ||
      !clean_(execution.componente_id) ||
      String(execution.componente_id) === String(selectedComponentId);
  });
  var executionsMap = {};
  executions.forEach(function(execution){ executionsMap[String(execution.id)] = execution; });
  var checklistByExecution = {};
  rows_("checklist_execucao", true).forEach(function(item){
    var executionId = String(item.execucao_id || "");
    if(!executionsMap[executionId]) return;
    if(!checklistByExecution[executionId]) checklistByExecution[executionId] = [];
    checklistByExecution[executionId].push(strip_(item));
  });

  function publicExecution(execution){
    if(!execution) return null;
    var checklist = checklistByExecution[String(execution.id)] || [];
    var operator = users[String(execution.operador_id)];
    return {
      id:clean_(execution.id),
      status:upper_(execution.status),
      resultado:clean_(execution.resultado),
      observacao:clean_(execution.observacao),
      duracao_segundos:num_(execution.duracao_segundos, 0),
      iniciou_em:clean_(execution.iniciou_em || execution.abriu_em),
      finalizou_em:clean_(execution.finalizou_em),
      operador_id:clean_(execution.operador_id),
      operador_nome:clean_(operator && operator.nome),
      checklist_total:checklist.length,
      checklist_respondidos:checklist.filter(function(item){ return !!clean_(item.resposta) || clean_(item.valor_numero) !== ""; }).length,
      checklist_nao_conformes:checklist.filter(function(item){ return upper_(item.conforme) === "NAO"; }).length,
      checklist_itens:checklist.sort(function(a,b){ return num_(a.ordem,0)-num_(b.ordem,0); }).slice(0, 40)
    };
  }

  var events = rows_("historico", true).filter(function(item){
    if(String(item.ativo_id) !== String(assetId)) return false;
    return !selectedComponentId ||
      !clean_(item.componente_id) ||
      String(item.componente_id) === String(selectedComponentId);
  }).map(function(item){
    var user = users[String(item.usuario_id)];
    var order = orders[String(item.os_id)];
    var action = actions[String(item.acao_id)];
    return Object.assign({}, strip_(item), {
      usuario_nome:clean_(user && user.nome) || clean_(item.usuario_id) || "Sistema",
      os_codigo:clean_(order && (order.codigo || order.id)),
      os_titulo:clean_(order && order.titulo),
      acao_titulo:clean_(action && action.titulo),
      execucao:publicExecution(executionsMap[String(item.execucao_id)])
    });
  });

  var representedExecutions = {};
  events.forEach(function(event){
    if(clean_(event.execucao_id)) representedExecutions[String(event.execucao_id)] = true;
  });
  executions.forEach(function(execution){
    if(representedExecutions[String(execution.id)]) return;
    var action = actions[String(execution.acao_id)];
    var order = orders[String(execution.os_id)];
    var publicData = publicExecution(execution);
    events.push({
      id:"EXEC-"+execution.id,
      ativo_id:execution.ativo_id,
      componente_id:execution.componente_id,
      os_id:execution.os_id,
      acao_id:execution.acao_id,
      execucao_id:execution.id,
      evento:"EXECUCAO_"+upper_(execution.status || "REGISTRADA"),
      descricao:clean_(execution.observacao || action && action.titulo || "Execução operacional registrada."),
      usuario_id:execution.operador_id,
      usuario_nome:publicData && publicData.operador_nome || clean_(execution.operador_id),
      perfil:ROLE.OPERADOR,
      criado_em:clean_(execution.finalizou_em || execution.iniciou_em || execution.criado_em),
      os_codigo:clean_(order && (order.codigo || order.id)),
      os_titulo:clean_(order && order.titulo),
      acao_titulo:clean_(action && action.titulo),
      execucao:publicData
    });
  });

  return events.sort(sortByDateDesc_("criado_em")).slice(0, Math.max(10, Math.min(num_(limit, 60), 120)));
}

function gestorDossieAtivo_(p, auth){
  technicalRequireManager_(auth);
  req_(p, ["qr_payload"]);
  var context = operadorContextoQr_({
    qr_payload:p.qr_payload,
    motor:false,
    __auth:auth
  });
  if(!context.found || !context.ativo) return context;

  var identity = technicalIdentity_(auth);
  var recentAccess = rows_("historico", true).filter(function(item){
    if(String(item.ativo_id) !== String(context.ativo.id)) return false;
    if(String(item.usuario_id) !== String(identity.usuario_id)) return false;
    if(upper_(item.evento) !== "GESTOR_QR_CONSULTADO") return false;
    var timestamp = new Date(clean_(item.criado_em)).getTime();
    return timestamp && Date.now() - timestamp < 60000;
  })[0];
  if(!recentAccess){
    hist_({
      ativo_id:context.ativo.id,
      componente_id:context.componente ? context.componente.id : "",
      evento:"GESTOR_QR_CONSULTADO",
      descricao:"Dossiê técnico consultado por QR Code ou TAG.",
      usuario_id:identity.usuario_id,
      perfil:identity.perfil
    });
    audit_(auth, "GESTOR_QR_CONTEXT_VIEWED", "ativos", context.ativo.id, null, {
      ativo_id:context.ativo.id,
      componente_id:context.componente ? context.componente.id : "",
      qr_payload:clean_(p.qr_payload)
    }, clean_(p.user_agent));
  }

  context.parametros_analisados = technicalManagerParameterSummaries_(context);
  context.historico_manutencao = technicalManagerAssetHistory_(context, p.limite_historico);
  context.consulta_registrada_em = now_();
  context.consultado_por = {
    usuario_id:identity.usuario_id,
    nome:identity.nome,
    area_nome:identity.area_nome,
    cargo_nome:identity.cargo_nome
  };
  return context;
}

function gestorSolicitarAcaoParametro_(p, auth){
  technicalRequireManager_(auth);
  technicalEnsureSchema_();
  req_(p, ["parametro_id", "tipo_solicitacao"]);
  var identity = technicalIdentity_(auth);
  var reading = find_("parametros", "id", p.parametro_id);
  if(!reading) err_("PARAMETER_READING_NOT_FOUND", "A leitura selecionada não foi encontrada.", 404);
  var asset = find_("ativos", "id", reading.ativo_id);
  if(!asset) err_("ASSET_NOT_FOUND", "O equipamento da leitura não foi encontrado.", 404);
  var component = clean_(reading.componente_id)
    ? find_("componentes", "id", reading.componente_id)
    : null;
  var requestType = upper_(p.tipo_solicitacao);
  if(["INSPECAO","CHECKLIST","AJUSTE_LIMITE"].indexOf(requestType) < 0){
    err_("PARAMETER_REQUEST_TYPE_INVALID", "Escolha inspeção, checklist ou ajuste de limites.", 400);
  }

  var summaries = technicalManagerParameterSummaries_({
    ativo:asset,
    componente:component
  });
  var summary = summaries.filter(function(item){
    return String(item.componente_id || "") === String(reading.componente_id || "") &&
      upper_(item.parametro) === upper_(reading.parametro);
  })[0] || {};
  var status = technicalParameterStatus_(reading.valor, summary.limite_min, summary.limite_max);
  var priority = upper_(p.prioridade || (
    ["ACIMA_LIMITE","ABAIXO_LIMITE"].indexOf(status) >= 0 ? "ALTA" : "MEDIA"
  ));
  var assetLabel = clean_(asset.tag || asset.nome || asset.id);
  var parameterLabel = upper_(reading.parametro);
  var valueLabel = clean_(reading.valor) + (clean_(reading.unidade) ? " " + clean_(reading.unidade) : "");
  var requestLabels = {
    INSPECAO:"Solicitar inspeção",
    CHECKLIST:"Solicitar checklist",
    AJUSTE_LIMITE:"Revisar limites"
  };
  var timestamp = now_();
  var occurrence = fit_("ocorrencias_operacionais", {
    id:uuid_("OCR"),
    ativo_id:asset.id,
    componente_id:clean_(reading.componente_id),
    tipo:"PARAMETRO_TECNICO",
    titulo:requestLabels[requestType]+" - "+parameterLabel+" - "+assetLabel,
    descricao:clean_(p.observacao || (
      "Leitura de "+parameterLabel+" em "+valueLabel+" requer avaliação administrativa."
    )),
    severidade:priority,
    status:"EM_ANALISE_TECNICA",
    usuario_id:identity.usuario_id,
    perfil:identity.perfil,
    os_id:"",
    acao_id:"",
    parada_id:"",
    tratamento_status:"EM_ANALISE_TECNICA",
    criado_em:timestamp,
    atualizado_em:timestamp
  });
  occurrence = append_("ocorrencias_operacionais", occurrence);

  var limitText = [];
  if(summary.limite_min !== null && summary.limite_min !== undefined) limitText.push("mínimo "+summary.limite_min);
  if(summary.limite_max !== null && summary.limite_max !== undefined) limitText.push("máximo "+summary.limite_max);
  var recommendation = requestType === "CHECKLIST"
    ? "Criar um checklist de inspeção para confirmar a causa, registrar evidências e validar o retorno à faixa esperada."
    : (requestType === "INSPECAO"
      ? "Programar uma inspeção técnica orientada para confirmar a condição e definir o tratamento."
      : "Revisar tecnicamente os limites propostos antes de alterar a configuração mestre.");
  var analysisResult = gestorAnaliseSalvar_({
    ocorrencia_id:occurrence.id,
    ativo_id:asset.id,
    componente_id:clean_(reading.componente_id),
    titulo:requestLabels[requestType]+": "+parameterLabel+" - "+assetLabel,
    diagnostico:parameterLabel+" registrou "+valueLabel+
      (limitText.length ? " (faixa configurada: "+limitText.join(", ")+")." : " sem faixa configurada."),
    risco:clean_(p.risco || (
      status === "NORMAL"
        ? "A tendência deve ser confirmada antes de qualquer alteração operacional."
        : "Leitura fora da faixa configurada pode indicar degradação ou condição operacional insegura."
    )),
    causa_provavel:clean_(p.causa_provavel || "A confirmar por inspeção técnica no equipamento."),
    recomendacao:recommendation,
    recomenda_checklist:requestType === "CHECKLIST",
    recomenda_os:requestType === "INSPECAO",
    prioridade:priority,
    relatorio_tecnico:{
      situacao:parameterLabel+" em "+valueLabel+" no ativo "+assetLabel+".",
      causa_provavel:clean_(p.causa_provavel || "A confirmar por inspeção técnica."),
      resultado_esperado:"Confirmar a causa e restabelecer ou validar a faixa operacional segura.",
      riscos:[{
        tipo:priority,
        titulo:"Parâmetro técnico",
        descricao:clean_(p.risco || "Validar a condição antes de liberar qualquer intervenção.")
      }],
      seguranca:[
        "Confirmar a identificação do ativo e a condição segura da área.",
        "Usar instrumento compatível e calibrado para repetir a medição.",
        "Interromper a operação se a leitura representar risco imediato."
      ],
      nrs:["NR-12"],
      ferramentas:[{tipo:"MEDICAO", nome:"Instrumento compatível com "+parameterLabel}],
      etapas:[
        {ordem:1, titulo:"Confirmar a leitura", descricao:"Repetir a medição e registrar data, condição operacional e evidência."},
        {ordem:2, titulo:"Inspecionar a causa", descricao:"Verificar o componente e os fatores que podem alterar o parâmetro."},
        {ordem:3, titulo:"Definir o tratamento", descricao:"Corrigir, monitorar ou revisar a faixa somente após avaliação técnica."},
        {ordem:4, titulo:"Validar o resultado", descricao:"Registrar a leitura final e confirmar a condição segura."}
      ],
      evidencias_requeridas:["Leitura inicial", "Condição encontrada", "Leitura após o tratamento"],
      criterio_aceite:"Parâmetro confirmado em faixa aprovada e condição segura documentada.",
      parametro_contexto:{
        leitura_id:reading.id,
        ativo_id:asset.id,
        componente_id:clean_(reading.componente_id),
        parametro:parameterLabel,
        valor:reading.valor,
        unidade:reading.unidade,
        limite_min:summary.limite_min,
        limite_max:summary.limite_max,
        limite_min_proposto:technicalNullableNumber_(p.limite_min_proposto),
        limite_max_proposto:technicalNullableNumber_(p.limite_max_proposto),
        status:status,
        registrado_por:reading.registrado_por,
        registrado_em:reading.registrado_em,
        tipo_solicitacao:requestType
      }
    },
    user_agent:p.user_agent
  }, auth);
  var sent = gestorAnaliseEnviarAdmin_({
    analise_id:analysisResult.analise.id,
    user_agent:p.user_agent
  }, auth);

  hist_({
    ativo_id:asset.id,
    componente_id:clean_(reading.componente_id),
    evento:"PARAMETRO_ENCAMINHADO_ADMIN",
    descricao:requestLabels[requestType]+": "+parameterLabel+" em "+valueLabel+".",
    usuario_id:identity.usuario_id,
    perfil:identity.perfil
  });
  return {
    requested:true,
    tipo_solicitacao:requestType,
    status_parametro:status,
    ocorrencia:strip_(occurrence),
    analise:sent.analise
  };
}

function technicalIdentity_(auth){
  var user = auth && auth.usuario_id ? find_("usuarios", "id", auth.usuario_id) : null;
  var area = user && user.area_id ? find_("areas_tecnicas", "id", user.area_id) : null;
  var role = user && user.cargo_id ? find_("cargos_tecnicos", "id", user.cargo_id) : null;
  return {
    usuario_id:clean_(auth && auth.usuario_id),
    nome:clean_(user && user.nome || auth && auth.nome),
    perfil:upper_(user && user.perfil || auth && auth.perfil),
    area_id:clean_(user && user.area_id),
    area_codigo:upper_(area && area.codigo),
    area_nome:clean_(area && area.nome),
    cargo_id:clean_(user && user.cargo_id),
    cargo_nome:clean_(role && role.nome),
    pode_assinar:!!(role && bool_(role.pode_assinar)),
    validador_padrao:TECH_DEFAULT_VALIDATOR_CODES.indexOf(upper_(area && area.codigo)) >= 0,
    especialidades:technicalJsonArray_(user && user.especialidades_json),
    escopo_ids:technicalJsonArray_(user && user.escopo_ids_json)
  };
}

function technicalJsonArray_(value){
  if(Array.isArray(value)) return value.map(clean_).filter(Boolean);
  if(!clean_(value)) return [];
  try{
    var parsed = JSON.parse(clean_(value));
    return Array.isArray(parsed) ? parsed.map(clean_).filter(Boolean) : [];
  } catch(e){
    return clean_(value).split(",").map(clean_).filter(Boolean);
  }
}

function technicalSerializeArray_(value){
  return JSON.stringify(technicalJsonArray_(value));
}

function technicalObject_(value){
  if(value && typeof value === "object" && !Array.isArray(value)) return value;
  if(!clean_(value)) return {};
  try{
    var parsed = JSON.parse(clean_(value));
    return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed : {};
  } catch(e){
    return {};
  }
}

function technicalTextList_(value, fallback, limit){
  var source = Array.isArray(value) ? value : (Array.isArray(fallback) ? fallback : []);
  return source.map(function(item){ return clean_(item); }).filter(Boolean).slice(0, limit || 20);
}

function technicalNormalizeBrief_(value, fallback){
  var data = technicalObject_(value);
  var base = technicalObject_(fallback);
  var parameterSource = technicalObject_(data.parametro_contexto || base.parametro_contexto);
  var parameterContext = clean_(parameterSource.parametro) ? {
    leitura_id:clean_(parameterSource.leitura_id),
    ativo_id:clean_(parameterSource.ativo_id),
    componente_id:clean_(parameterSource.componente_id),
    parametro:upper_(parameterSource.parametro),
    valor:parameterSource.valor,
    unidade:clean_(parameterSource.unidade),
    limite_min:parameterSource.limite_min,
    limite_max:parameterSource.limite_max,
    limite_min_proposto:parameterSource.limite_min_proposto,
    limite_max_proposto:parameterSource.limite_max_proposto,
    status:upper_(parameterSource.status),
    registrado_por:clean_(parameterSource.registrado_por),
    registrado_em:clean_(parameterSource.registrado_em),
    tipo_solicitacao:upper_(parameterSource.tipo_solicitacao)
  } : null;
  var situation = clean_(data.situacao || base.situacao || "Intervenção técnica registrada para execução.");
  var cause = clean_(data.causa_provavel || base.causa_provavel || "A confirmar na inspeção inicial do equipamento.");
  var expected = clean_(data.resultado_esperado || base.resultado_esperado || "Concluir a atividade em condição segura e operacional.");
  var acceptance = clean_(data.criterio_aceite || base.criterio_aceite || "Condição segura confirmada e evidências registradas.");
  var rawRisks = Array.isArray(data.riscos) ? data.riscos : (Array.isArray(base.riscos) ? base.riscos : []);
  var risks = rawRisks.map(function(item){
    var risk = technicalObject_(item);
    return {
      tipo:clean_(risk.tipo || "OPERACIONAL"),
      titulo:clean_(risk.titulo || "Risco operacional"),
      descricao:clean_(risk.descricao || "Interromper a atividade se a condição exceder o escopo autorizado.")
    };
  }).filter(function(item){ return item.titulo || item.descricao; }).slice(0, 12);
  var rawTools = Array.isArray(data.ferramentas) ? data.ferramentas : (Array.isArray(base.ferramentas) ? base.ferramentas : []);
  var tools = rawTools.map(function(item){
    var tool = technicalObject_(item);
    return {tipo:clean_(tool.tipo || "TECNICA"), nome:clean_(tool.nome)};
  }).filter(function(item){ return item.nome; }).slice(0, 20);
  var rawSteps = Array.isArray(data.etapas) ? data.etapas : (Array.isArray(base.etapas) ? base.etapas : []);
  var steps = rawSteps.map(function(item, index){
    var step = technicalObject_(item);
    return {
      ordem:index + 1,
      titulo:clean_(step.titulo || "Etapa " + (index + 1)),
      descricao:clean_(step.descricao || step.instrucao)
    };
  }).filter(function(item){ return item.titulo && item.descricao; }).slice(0, 40);
  if(!steps.length){
    steps = [
      {ordem:1, titulo:"Preparar e isolar", descricao:"Confirmar o equipamento, a autorização e as medidas de segurança."},
      {ordem:2, titulo:"Inspecionar", descricao:"Verificar a condição informada e registrar a evidência inicial."},
      {ordem:3, titulo:"Executar", descricao:"Realizar somente o serviço aprovado e comunicar qualquer desvio."},
      {ordem:4, titulo:"Testar e liberar", descricao:"Validar o resultado e registrar a condição operacional final."}
    ];
  }
  return {
    situacao:situation,
    causa_provavel:cause,
    resultado_esperado:expected,
    riscos:risks.length ? risks : [{
      tipo:"OPERACIONAL",
      titulo:"Risco operacional",
      descricao:"Interromper a atividade se a condição exceder o escopo autorizado."
    }],
    seguranca:technicalTextList_(data.seguranca, base.seguranca && base.seguranca.length ? base.seguranca : [
      "Confirmar autorização, identificação do ativo e condição segura da área.",
      "Isolar as fontes de energia aplicáveis antes de acessar a zona de risco.",
      "Registrar e comunicar qualquer desvio do escopo aprovado."
    ], 20),
    nrs:technicalTextList_(data.nrs, base.nrs && base.nrs.length ? base.nrs : ["NR-12"], 12),
    ferramentas:tools,
    etapas:steps,
    evidencias_requeridas:technicalTextList_(data.evidencias_requeridas, base.evidencias_requeridas && base.evidencias_requeridas.length ? base.evidencias_requeridas : [
      "Condição encontrada",
      "Teste ou condição final"
    ], 20),
    criterio_aceite:acceptance,
    parametro_contexto:parameterContext
  };
}

function technicalSerializeBrief_(value, fallback){
  return JSON.stringify(technicalNormalizeBrief_(value, fallback));
}

function technicalActiveArea_(id){
  var area = id ? find_("areas_tecnicas", "id", id) : null;
  if(!area || upper_(area.status) !== ST.ATIVO){
    err_("TECH_AREA_INVALID", "Área técnica inexistente ou inativa.", 400);
  }
  return area;
}

function technicalActiveRole_(id, areaId){
  if(!id) return null;
  var role = find_("cargos_tecnicos", "id", id);
  if(!role || upper_(role.status) !== ST.ATIVO){
    err_("TECH_ROLE_INVALID", "Cargo técnico inexistente ou inativo.", 400);
  }
  if(areaId && String(role.area_id) !== String(areaId)){
    err_("TECH_ROLE_AREA_MISMATCH", "O cargo não pertence à área técnica informada.", 400);
  }
  return role;
}

function technicalAreaByCode_(code){
  var normalized = upper_(code);
  var area = rows_("areas_tecnicas", true).find(function(item){
    return upper_(item.codigo) === normalized && upper_(item.status) === ST.ATIVO;
  }) || null;
  if(!area){
    err_(
      "TECH_VALIDATOR_AREA_MISSING",
      "A área técnica "+normalized+" precisa estar ativa antes de usar o filtro de validação.",
      409
    );
  }
  return area;
}

function technicalNormalizeSignaturePolicy_(value){
  var normalized = upper_(value || configurationRuntimeValue_(
    "workflow.tecnico.politica_validacao_padrao",
    TECH_SIGNATURE_POLICY.QUALIDADE_OU_SEGURANCA
  ));
  return Object.keys(TECH_SIGNATURE_POLICY).some(function(key){
    return TECH_SIGNATURE_POLICY[key] === normalized;
  }) ? normalized : TECH_SIGNATURE_POLICY.QUALIDADE_OU_SEGURANCA;
}

function technicalResolveValidationPolicy_(data){
  var policy = technicalNormalizeSignaturePolicy_(data.politica_assinatura);
  var areaIds = [];
  var userIds = technicalJsonArray_(data.usuarios_validadores_json || data.usuarios_validadores);
  if(policy === TECH_SIGNATURE_POLICY.QUALIDADE){
    areaIds = [technicalAreaByCode_("QUALIDADE").id];
  } else if(policy === TECH_SIGNATURE_POLICY.SEGURANCA){
    areaIds = [technicalAreaByCode_("SEGURANCA").id];
  } else if(policy === TECH_SIGNATURE_POLICY.QUALIDADE_E_SEGURANCA || policy === TECH_SIGNATURE_POLICY.QUALIDADE_OU_SEGURANCA){
    areaIds = [
      technicalAreaByCode_("QUALIDADE").id,
      technicalAreaByCode_("SEGURANCA").id
    ];
  } else {
    areaIds = technicalJsonArray_(data.areas_validadoras_json || data.areas_validadoras);
    if(clean_(data.area_atual_id) && areaIds.indexOf(clean_(data.area_atual_id)) < 0){
      areaIds.push(clean_(data.area_atual_id));
    }
    if(clean_(data.responsavel_atual_id) && userIds.indexOf(clean_(data.responsavel_atual_id)) < 0){
      userIds.push(clean_(data.responsavel_atual_id));
    }
    if(!areaIds.length && !userIds.length){
      err_("TECH_CUSTOM_VALIDATOR_REQUIRED", "Escolha ao menos uma área ou pessoa autorizada para a validação personalizada.", 400);
    }
  }
  areaIds = areaIds.filter(function(id, index, list){
    technicalActiveArea_(id);
    return list.indexOf(id) === index;
  });
  userIds = userIds.filter(function(id, index, list){
    var user = find_("usuarios", "id", id);
    if(!user || upper_(user.status) !== ST.ATIVO || upper_(user.perfil) !== ROLE.GESTOR){
      err_("TECH_CUSTOM_VALIDATOR_INVALID", "A pessoa escolhida não possui um perfil técnico ativo.", 400);
    }
    var role = technicalActiveRole_(user.cargo_id, user.area_id);
    if(!role || !bool_(role.pode_assinar)){
      err_("TECH_CUSTOM_VALIDATOR_NOT_AUTHORIZED", "A pessoa escolhida não está autorizada a assinar documentos.", 400);
    }
    return list.indexOf(id) === index;
  });
  var required = policy === TECH_SIGNATURE_POLICY.QUALIDADE_E_SEGURANCA
    ? 2
    : (policy === TECH_SIGNATURE_POLICY.PERSONALIZADA
      ? Math.max(1, num_(data.assinaturas_necessarias, areaIds.length || userIds.length))
      : 1);
  var primaryArea = areaIds.indexOf(clean_(data.area_atual_id)) >= 0
    ? clean_(data.area_atual_id)
    : (areaIds[0] || clean_(data.area_atual_id));
  if(!primaryArea && userIds.length){
    var primaryUser = find_("usuarios", "id", userIds[0]);
    primaryArea = clean_(primaryUser && primaryUser.area_id);
  }
  return {
    politica:policy,
    areas:areaIds,
    usuarios:userIds,
    assinaturas_necessarias:required,
    area_primaria:primaryArea
  };
}

function technicalDemandValidatorAreaIds_(demand){
  var ids = technicalJsonArray_(demand.areas_validadoras_json);
  if(ids.length) return ids;
  var current = clean_(demand.area_atual_id);
  return current ? [current] : [];
}

function technicalDemandValidatorUserIds_(demand){
  return technicalJsonArray_(demand.usuarios_validadores_json);
}

function technicalSignaturesForDemand_(demand){
  return rows_("assinaturas_tecnicas", true).filter(function(signature){
    if(clean_(signature.revogado_em)) return false;
    return upper_(signature.entidade_tipo) === upper_(demand.entidade_tipo) &&
      String(signature.entidade_id) === String(demand.entidade_id) &&
      String(signature.versao_entidade) === String(demand.versao_entidade) &&
      String(signature.payload_hash) === String(demand.payload_hash);
  });
}

function technicalSignatureProgress_(demand){
  var signatures = technicalSignaturesForDemand_(demand);
  var policy = technicalNormalizeSignaturePolicy_(demand.politica_assinatura);
  var areaIds = technicalDemandValidatorAreaIds_(demand);
  var userIds = technicalDemandValidatorUserIds_(demand);
  var signedAreaIds = [];
  var signedUserIds = [];
  signatures.forEach(function(signature){
    var areaId = clean_(signature.area_id);
    var userId = clean_(signature.usuario_id);
    if(areaId && signedAreaIds.indexOf(areaId) < 0) signedAreaIds.push(areaId);
    if(userId && signedUserIds.indexOf(userId) < 0) signedUserIds.push(userId);
  });
  var completed;
  if(policy === TECH_SIGNATURE_POLICY.QUALIDADE_E_SEGURANCA){
    completed = areaIds.filter(function(id){ return signedAreaIds.indexOf(id) >= 0; }).length;
  } else if(policy === TECH_SIGNATURE_POLICY.PERSONALIZADA){
    completed = signatures.filter(function(signature){
      return areaIds.indexOf(clean_(signature.area_id)) >= 0 ||
        userIds.indexOf(clean_(signature.usuario_id)) >= 0;
    }).length;
  } else {
    completed = signatures.some(function(signature){
      return areaIds.indexOf(clean_(signature.area_id)) >= 0;
    }) ? 1 : 0;
  }
  var required = Math.max(1, num_(demand.assinaturas_necessarias, 1));
  return {
    politica:policy,
    necessarias:required,
    realizadas:Math.min(completed, required),
    concluida:completed >= required,
    areas_assinadas:signedAreaIds,
    areas_pendentes:completed >= required
      ? []
      : areaIds.filter(function(id){ return signedAreaIds.indexOf(id) < 0; }),
    assinaturas:signatures
  };
}

function technicalCanValidateDemand_(demand, identity){
  if(identity.perfil === ROLE.ADMIN) return true;
  if(identity.perfil !== ROLE.GESTOR || !identity.pode_assinar) return false;
  var allowedUsers = technicalDemandValidatorUserIds_(demand);
  if(allowedUsers.indexOf(identity.usuario_id) >= 0) return true;
  return technicalDemandValidatorAreaIds_(demand).indexOf(identity.area_id) >= 0;
}

function technicalAssertValidationIdentity_(auth, demand){
  var identity = technicalIdentity_(auth);
  if(demand){
    if(!technicalCanValidateDemand_(demand, identity)){
      err_("TECH_VALIDATOR_NOT_ALLOWED", "Somente o validador definido pelo Administrador pode assinar este documento.", 403);
    }
    return identity;
  }
  if(identity.perfil !== ROLE.ADMIN && (
    identity.perfil !== ROLE.GESTOR ||
    !identity.pode_assinar ||
    TECH_DEFAULT_VALIDATOR_CODES.indexOf(identity.area_codigo) < 0
  )){
    err_("TECH_VALIDATOR_REQUIRED", "Esta validação exige um técnico de Qualidade ou de Segurança.", 403);
  }
  return identity;
}

function technicalMigrateValidationPolicies_(){
  rows_("demandas_tecnicas", true).forEach(function(demand){
    if(clean_(demand.politica_assinatura)) return;
    var currentArea = demand.area_atual_id ? find_("areas_tecnicas", "id", demand.area_atual_id) : null;
    var currentCode = upper_(currentArea && currentArea.codigo);
    var legacyPolicy = currentCode === "QUALIDADE"
      ? TECH_SIGNATURE_POLICY.QUALIDADE
      : (currentCode === "SEGURANCA"
        ? TECH_SIGNATURE_POLICY.SEGURANCA
        : TECH_SIGNATURE_POLICY.QUALIDADE_OU_SEGURANCA);
    var policy = technicalResolveValidationPolicy_({
      politica_assinatura:legacyPolicy,
      area_atual_id:demand.area_atual_id
    });
    var patch = {
      politica_assinatura:policy.politica,
      areas_validadoras_json:JSON.stringify(policy.areas),
      usuarios_validadores_json:"[]",
      area_atual_id:policy.area_primaria,
      cargo_atual_id:"",
      responsavel_atual_id:"",
      exige_assinatura:"SIM",
      assinaturas_necessarias:policy.assinaturas_necessarias,
      atualizado_em:now_()
    };
    var next = Object.assign({}, strip_(demand), patch);
    patch.payload_hash = technicalDemandHash_(next);
    var progress = technicalSignatureProgress_(Object.assign({}, next, {payload_hash:patch.payload_hash}));
    patch.assinaturas_realizadas = progress.realizadas;
    if(TECH_FINAL_STATUSES.indexOf(upper_(demand.status)) < 0){
      patch.status = progress.concluida
        ? TECH_DEMAND_STATUS.EM_VALIDACAO
        : TECH_DEMAND_STATUS.AGUARDANDO_ASSINATURA;
    }
    update_("demandas_tecnicas", demand.__rowIndex, patch);
  });
}

function adminAreasTecnicasListar_(p, auth){
  technicalRequireAdmin_(auth);
  technicalEnsureSchema_();
  var status = upper_(p.status);
  var items = rows_("areas_tecnicas", true).filter(function(item){
    return !status || upper_(item.status) === status;
  }).sort(function(a,b){ return clean_(a.nome).localeCompare(clean_(b.nome)); }).map(strip_);
  return {total:items.length, areas:items};
}

function adminAreasTecnicasSalvar_(p, auth){
  technicalRequireAdmin_(auth);
  technicalEnsureSchema_();
  var data = Object.assign({}, p.dados || p.area || {});
  req_(data, ["nome"]);
  var old = data.id ? find_("areas_tecnicas", "id", data.id) : null;
  var code = upper_(data.codigo || slug_(data.nome));
  if(!code) err_("TECH_AREA_CODE_REQUIRED", "Informe o código da área técnica.", 400);
  var duplicate = rows_("areas_tecnicas", true).find(function(item){
    return (!old || String(item.id) !== String(old.id)) && upper_(item.codigo) === code;
  });
  if(duplicate) err_("TECH_AREA_CODE_EXISTS", "Já existe uma área com este código.", 409);
  var saved = fit_("areas_tecnicas", Object.assign({}, old || {}, {
    id:old ? old.id : uuid_("ATEC"),
    codigo:code,
    nome:clean_(data.nome),
    descricao:clean_(data.descricao),
    status:upper_(data.status || ST.ATIVO),
    exige_assinatura_padrao:bool_(data.exige_assinatura_padrao) ? "SIM" : "NAO",
    criado_por:old ? old.criado_por : auth.usuario_id,
    criado_em:old ? old.criado_em : now_(),
    atualizado_em:now_()
  }));
  if(old) update_("areas_tecnicas", old.__rowIndex, saved); else append_("areas_tecnicas", saved);
  audit_(auth, old ? "TECH_AREA_UPDATED" : "TECH_AREA_CREATED", "areas_tecnicas", saved.id, old && strip_(old), saved, clean_(p.user_agent));
  return {saved:true, area:saved};
}

function adminCargosTecnicosListar_(p, auth){
  technicalRequireAdmin_(auth);
  technicalEnsureSchema_();
  var areaId = clean_(p.area_id);
  var status = upper_(p.status);
  var items = rows_("cargos_tecnicos", true).filter(function(item){
    if(areaId && String(item.area_id) !== String(areaId)) return false;
    return !status || upper_(item.status) === status;
  }).sort(function(a,b){ return clean_(a.nome).localeCompare(clean_(b.nome)); }).map(strip_);
  return {total:items.length, cargos:items};
}

function adminCargosTecnicosSalvar_(p, auth){
  technicalRequireAdmin_(auth);
  technicalEnsureSchema_();
  var data = Object.assign({}, p.dados || p.cargo || {});
  req_(data, ["area_id","nome"]);
  technicalActiveArea_(data.area_id);
  var old = data.id ? find_("cargos_tecnicos", "id", data.id) : null;
  var code = upper_(data.codigo || slug_(data.nome));
  var duplicate = rows_("cargos_tecnicos", true).find(function(item){
    return (!old || String(item.id) !== String(old.id)) &&
      String(item.area_id) === String(data.area_id) && upper_(item.codigo) === code;
  });
  if(duplicate) err_("TECH_ROLE_CODE_EXISTS", "Já existe um cargo com este código na área.", 409);
  var saved = fit_("cargos_tecnicos", Object.assign({}, old || {}, {
    id:old ? old.id : uuid_("CTEC"),
    area_id:clean_(data.area_id),
    codigo:code,
    nome:clean_(data.nome),
    descricao:clean_(data.descricao),
    status:upper_(data.status || ST.ATIVO),
    pode_assinar:bool_(data.pode_assinar) ? "SIM" : "NAO",
    criado_por:old ? old.criado_por : auth.usuario_id,
    criado_em:old ? old.criado_em : now_(),
    atualizado_em:now_()
  }));
  if(old) update_("cargos_tecnicos", old.__rowIndex, saved); else append_("cargos_tecnicos", saved);
  audit_(auth, old ? "TECH_ROLE_UPDATED" : "TECH_ROLE_CREATED", "cargos_tecnicos", saved.id, old && strip_(old), saved, clean_(p.user_agent));
  return {saved:true, cargo:saved};
}

function technicalSlaPolicy_(type, priority, areaId){
  var matches = rows_("sla_politicas", true).filter(function(policy){
    if(upper_(policy.status || ST.ATIVO) !== ST.ATIVO) return false;
    if(clean_(policy.tipo_demanda) && upper_(policy.tipo_demanda) !== upper_(type)) return false;
    if(clean_(policy.prioridade) && upper_(policy.prioridade) !== upper_(priority)) return false;
    if(clean_(policy.area_id) && String(policy.area_id) !== String(areaId)) return false;
    return true;
  }).sort(function(a,b){
    return (clean_(b.area_id) ? 2 : 0) + (clean_(b.prioridade) ? 1 : 0) -
      ((clean_(a.area_id) ? 2 : 0) + (clean_(a.prioridade) ? 1 : 0));
  });
  return matches[0] || null;
}

function technicalAddMinutesIso_(minutes){
  return minutes > 0 ? iso_(addMinutes_(new Date(), minutes)) : "";
}

function technicalDemandHash_(data){
  return sha256_(JSON.stringify({
    entidade_tipo:upper_(data.entidade_tipo),
    entidade_id:clean_(data.entidade_id),
    versao_entidade:clean_(data.versao_entidade || "1"),
    titulo:clean_(data.titulo),
    descricao:clean_(data.descricao),
    politica_assinatura:technicalNormalizeSignaturePolicy_(data.politica_assinatura),
    areas_validadoras:technicalJsonArray_(data.areas_validadoras_json).sort(),
    usuarios_validadores:technicalJsonArray_(data.usuarios_validadores_json).sort()
  }));
}

function technicalNotify_(target, type, title, message, entityType, entityId, priority){
  var users = rows_("usuarios", true).filter(function(user){
    if(upper_(user.status) !== ST.ATIVO) return false;
    if(target.usuario_id) return String(user.id) === String(target.usuario_id);
    if(target.perfil && upper_(user.perfil) !== upper_(target.perfil)) return false;
    if(target.area_id && String(user.area_id) !== String(target.area_id)) return false;
    if(target.cargo_id && String(user.cargo_id) !== String(target.cargo_id)) return false;
    return !!(target.perfil || target.area_id || target.cargo_id);
  });
  users.forEach(function(user){
    append_("notificacoes", fit_("notificacoes", {
      id:uuid_("NOT"), usuario_id:user.id, perfil:user.perfil, area_id:user.area_id,
      tipo:type, titulo:title, mensagem:message, entidade_tipo:entityType,
      entidade_id:entityId, prioridade:priority || "MEDIA", status:"NAO_LIDA",
      lida_em:"", criado_em:now_()
    }));
  });
  return users.length;
}

function technicalCloseDemandNotifications_(demandId){
  rows_("notificacoes", true).filter(function(item){
    return upper_(item.entidade_tipo) === "DEMANDAS_TECNICAS" &&
      String(item.entidade_id) === String(demandId) &&
      upper_(item.status) === "NAO_LIDA";
  }).forEach(function(item){
    update_("notificacoes", item.__rowIndex, {
      status:"LIDA",
      lida_em:now_()
    });
  });
}

function technicalAppendTransition_(demand, action, identity, target, decision, opinion, reason){
  var sequence = rows_("demanda_tramitacoes", true).filter(function(item){
    return String(item.demanda_id) === String(demand.id);
  }).length + 1;
  var row = fit_("demanda_tramitacoes", {
    id:uuid_("TRM"), demanda_id:demand.id, sequencia:sequence, acao:action,
    de_area_id:identity.area_id, de_cargo_id:identity.cargo_id, de_usuario_id:identity.usuario_id,
    para_area_id:clean_(target && target.area_id), para_cargo_id:clean_(target && target.cargo_id),
    para_usuario_id:clean_(target && target.usuario_id), decisao:clean_(decision),
    parecer:clean_(opinion), motivo:clean_(reason), payload_hash:demand.payload_hash, criado_em:now_()
  });
  append_("demanda_tramitacoes", row);
  return row;
}

function adminDemandasTecnicasEnviar_(p, auth){
  technicalRequireAdmin_(auth);
  technicalEnsureSchema_();
  var data = Object.assign({}, p.demanda || p.dados || p);
  req_(data, ["entidade_tipo","entidade_id","titulo"]);
  var validationPolicy = technicalResolveValidationPolicy_(data);
  var area = technicalActiveArea_(validationPolicy.area_primaria);
  technicalActiveRole_(data.cargo_atual_id, area.id);
  if(data.responsavel_atual_id){
    var targetUser = find_("usuarios", "id", data.responsavel_atual_id);
    if(!targetUser || upper_(targetUser.status) !== ST.ATIVO || upper_(targetUser.perfil) !== ROLE.GESTOR){
      err_("TECH_ASSIGNEE_INVALID", "Responsável técnico inexistente, inativo ou fora do perfil GESTOR.", 400);
    }
    if(
      validationPolicy.usuarios.indexOf(clean_(targetUser.id)) < 0 &&
      validationPolicy.areas.indexOf(clean_(targetUser.area_id)) < 0
    ){
      err_("TECH_ASSIGNEE_POLICY_MISMATCH", "O responsável não pertence ao filtro de validação escolhido.", 400);
    }
  }
  var priority = upper_(data.prioridade || "MEDIA");
  var policy = technicalSlaPolicy_(data.tipo || data.entidade_tipo, priority, area.id);
  var separationRequired = data.exige_segregacao === undefined
    ? bool_(configurationRuntimeValue_("workflow.tecnico.exige_segregacao_padrao", true))
    : bool_(data.exige_segregacao);
  var demand = fit_("demandas_tecnicas", {
    id:uuid_("DMT"), tipo:upper_(data.tipo || "VALIDACAO_TECNICA"),
    entidade_tipo:upper_(data.entidade_tipo), entidade_id:clean_(data.entidade_id),
    origem_tipo:upper_(data.origem_tipo || "ADMIN"), origem_id:clean_(data.origem_id || auth.usuario_id),
    titulo:clean_(data.titulo), descricao:clean_(data.descricao), prioridade:priority,
    status:TECH_DEMAND_STATUS.AGUARDANDO_ASSINATURA,
    area_origem_id:clean_(data.area_origem_id), area_atual_id:validationPolicy.area_primaria,
    cargo_atual_id:clean_(data.cargo_atual_id), responsavel_atual_id:clean_(data.responsavel_atual_id),
    criado_por:auth.usuario_id, criado_perfil:auth.perfil,
    exige_assinatura:"SIM",
    assinaturas_necessarias:validationPolicy.assinaturas_necessarias,
    assinaturas_realizadas:0, exige_segregacao:separationRequired ? "SIM" : "NAO",
    politica_assinatura:validationPolicy.politica,
    areas_validadoras_json:JSON.stringify(validationPolicy.areas),
    usuarios_validadores_json:JSON.stringify(validationPolicy.usuarios),
    prazo_primeira_resposta_em:technicalAddMinutesIso_(num_(data.resposta_minutos, policy && policy.resposta_minutos)),
    prazo_resolucao_em:technicalAddMinutesIso_(num_(data.resolucao_minutos, policy && policy.resolucao_minutos)),
    primeiro_atendimento_em:"", concluido_em:"", versao_entidade:clean_(data.versao_entidade || "1"),
    payload_hash:"", criado_em:now_(), atualizado_em:now_()
  });
  demand.payload_hash = technicalDemandHash_(demand);
  append_("demandas_tecnicas", demand);
  technicalAppendTransition_(demand, "ENVIADA_PELO_ADMIN", technicalIdentity_(auth), {
    area_id:demand.area_atual_id, cargo_id:demand.cargo_atual_id, usuario_id:demand.responsavel_atual_id
  }, "", data.parecer, data.motivo);
  if(demand.responsavel_atual_id){
    technicalNotify_({usuario_id:demand.responsavel_atual_id}, "DEMANDA_TECNICA", demand.titulo, "Documento aguardando sua validação e assinatura.", "demandas_tecnicas", demand.id, demand.prioridade);
  } else {
    validationPolicy.areas.forEach(function(areaId){
      technicalNotify_({area_id:areaId}, "DEMANDA_TECNICA", demand.titulo, "Documento aguardando validação e assinatura.", "demandas_tecnicas", demand.id, demand.prioridade);
    });
    validationPolicy.usuarios.forEach(function(userId){
      technicalNotify_({usuario_id:userId}, "DEMANDA_TECNICA", demand.titulo, "Documento aguardando sua validação e assinatura.", "demandas_tecnicas", demand.id, demand.prioridade);
    });
  }
  audit_(auth, "TECH_DEMAND_SENT", "demandas_tecnicas", demand.id, null, demand, clean_(p.user_agent));
  return {sent:true, demanda:technicalDemandPublic_(demand)};
}

function technicalDemandAccessible_(demand, identity){
  if(identity.perfil === ROLE.ADMIN) return true;
  if(identity.perfil !== ROLE.GESTOR) return false;
  if(clean_(demand.responsavel_atual_id)) return String(demand.responsavel_atual_id) === String(identity.usuario_id);
  return technicalCanValidateDemand_(demand, identity);
}

function technicalRequireDemand_(id, identity){
  var demand = find_("demandas_tecnicas", "id", id);
  if(!demand) err_("TECH_DEMAND_NOT_FOUND", "Demanda técnica não encontrada.", 404);
  if(!technicalDemandAccessible_(demand, identity)) err_("TECH_DEMAND_FORBIDDEN", "Demanda fora do seu escopo técnico.", 403);
  return demand;
}

function technicalAssertDemandOpen_(demand){
  if(TECH_FINAL_STATUSES.indexOf(upper_(demand.status)) >= 0){
    err_("TECH_DEMAND_FINAL", "A demanda já está encerrada e não aceita novas transições.", 409);
  }
  return true;
}

function technicalDemandPublic_(demand){
  var out = strip_(demand);
  var area = demand.area_atual_id ? find_("areas_tecnicas", "id", demand.area_atual_id) : null;
  var role = demand.cargo_atual_id ? find_("cargos_tecnicos", "id", demand.cargo_atual_id) : null;
  var assignee = demand.responsavel_atual_id ? find_("usuarios", "id", demand.responsavel_atual_id) : null;
  var now = Date.now();
  var responseDeadline = new Date(clean_(demand.prazo_primeira_resposta_em)).getTime();
  var resolutionDeadline = new Date(clean_(demand.prazo_resolucao_em)).getTime();
  out.area_atual_nome = clean_(area && area.nome);
  out.cargo_atual_nome = clean_(role && role.nome);
  out.responsavel_atual_nome = clean_(assignee && assignee.nome);
  var progress = technicalSignatureProgress_(demand);
  out.politica_assinatura = progress.politica;
  out.assinaturas_necessarias = progress.necessarias;
  out.assinaturas_realizadas = progress.realizadas;
  out.assinatura_concluida = progress.concluida;
  out.areas_validadoras = technicalDemandValidatorAreaIds_(demand).map(function(id){
    var validatorArea = find_("areas_tecnicas", "id", id);
    return validatorArea ? {
      id:clean_(validatorArea.id),
      codigo:upper_(validatorArea.codigo),
      nome:clean_(validatorArea.nome),
      assinada:progress.areas_assinadas.indexOf(id) >= 0,
      necessaria:!progress.concluida && progress.areas_pendentes.indexOf(id) >= 0
    } : null;
  }).filter(Boolean);
  out.sla_resposta_atrasado = !!(responseDeadline && !clean_(demand.primeiro_atendimento_em) && responseDeadline < now);
  out.sla_resolucao_atrasado = !!(resolutionDeadline && TECH_FINAL_STATUSES.indexOf(upper_(demand.status)) < 0 && resolutionDeadline < now);
  return out;
}

function technicalListDemands_(p, auth, adminOnly){
  if(adminOnly) technicalRequireAdmin_(auth); else technicalRequireManager_(auth);
  technicalEnsureSchema_();
  var identity = technicalIdentity_(auth);
  var statuses = clean_(p.status).split(",").map(upper_).filter(Boolean);
  var demands = rows_("demandas_tecnicas", true).filter(function(demand){
    if(!adminOnly && !technicalDemandAccessible_(demand, identity)) return false;
    if(!adminOnly && !statuses.length && TECH_FINAL_STATUSES.indexOf(upper_(demand.status)) >= 0) return false;
    if(statuses.length && statuses.indexOf(upper_(demand.status)) < 0) return false;
    if(clean_(p.tipo) && upper_(demand.tipo) !== upper_(p.tipo)) return false;
    return true;
  }).sort(function(a,b){
    var score = priorityScore_(b.prioridade) - priorityScore_(a.prioridade);
    return score || clean_(a.criado_em).localeCompare(clean_(b.criado_em));
  });
  var limit = Math.max(1, Math.min(num_(p.limite, 200), 500));
  return {total:demands.length, demandas:demands.slice(0, limit).map(technicalDemandPublic_)};
}

function adminDemandasTecnicasListar_(p, auth){ return technicalListDemands_(p, auth, true); }
function gestorDemandasListar_(p, auth){ return technicalListDemands_(p, auth, false); }

function gestorContextoTecnico_(p, auth){
  technicalRequireManager_(auth);
  technicalEnsureSchema_();
  var identity = technicalIdentity_(auth);
  var canValidate = identity.perfil === ROLE.ADMIN || (
    identity.pode_assinar &&
    TECH_DEFAULT_VALIDATOR_CODES.indexOf(identity.area_codigo) >= 0
  );
  return {
    identidade:identity,
    areas:rows_("areas_tecnicas", true).filter(function(item){ return upper_(item.status) === ST.ATIVO; }).map(strip_),
    cargos:rows_("cargos_tecnicos", true).filter(function(item){ return upper_(item.status) === ST.ATIVO; }).map(strip_),
    pode_encaminhar:false,
    pode_assinar:identity.perfil === ROLE.ADMIN || identity.pode_assinar,
    pode_validar:canValidate,
    modo_trabalho:canValidate ? "VALIDACAO" : "ACOMPANHAMENTO",
    politicas_assinatura:[
      {codigo:TECH_SIGNATURE_POLICY.QUALIDADE_OU_SEGURANCA, nome:"Qualidade ou Segurança", assinaturas:1},
      {codigo:TECH_SIGNATURE_POLICY.QUALIDADE, nome:"Somente Qualidade", assinaturas:1},
      {codigo:TECH_SIGNATURE_POLICY.SEGURANCA, nome:"Somente Segurança", assinaturas:1},
      {codigo:TECH_SIGNATURE_POLICY.QUALIDADE_E_SEGURANCA, nome:"Qualidade e Segurança", assinaturas:2},
      {codigo:TECH_SIGNATURE_POLICY.PERSONALIZADA, nome:"Validador autorizado", assinaturas:1}
    ]
  };
}

function gestorDemandaDetalhe_(p, auth){
  technicalRequireManager_(auth);
  technicalEnsureSchema_();
  req_(p, ["demanda_id"]);
  var identity = technicalIdentity_(auth);
  var demand = technicalRequireDemand_(p.demanda_id, identity);
  var transitions = rows_("demanda_tramitacoes", true).filter(function(item){ return String(item.demanda_id) === String(demand.id); }).sort(function(a,b){ return num_(a.sequencia,0)-num_(b.sequencia,0); }).map(strip_);
  var signatures = technicalSignaturesForDemand_(demand).map(strip_);
  var analyses = rows_("analises_tecnicas", true).filter(function(item){ return String(item.demanda_id) === String(demand.id); }).map(strip_);
  return {demanda:technicalDemandPublic_(demand), tramitacoes:transitions, assinaturas:signatures, analises:analyses};
}

function gestorDemandaAssumir_(p, auth){
  technicalRequireManager_(auth);
  technicalEnsureSchema_();
  req_(p, ["demanda_id"]);
  var identity = technicalIdentity_(auth);
  var demand = technicalRequireDemand_(p.demanda_id, identity);
  identity = technicalAssertValidationIdentity_(auth, demand);
  technicalAssertDemandOpen_(demand);
  if(technicalNormalizeSignaturePolicy_(demand.politica_assinatura) !== TECH_SIGNATURE_POLICY.PERSONALIZADA){
    return {
      assumed:false,
      shared_queue:true,
      demanda:technicalDemandPublic_(demand)
    };
  }
  if(clean_(demand.responsavel_atual_id) && String(demand.responsavel_atual_id) !== String(identity.usuario_id)){
    err_("TECH_DEMAND_ALREADY_ASSIGNED", "A demanda já possui outro responsável.", 409);
  }
  var patch = {responsavel_atual_id:identity.usuario_id, status:TECH_DEMAND_STATUS.EM_TRIAGEM, atualizado_em:now_()};
  if(!clean_(demand.primeiro_atendimento_em)) patch.primeiro_atendimento_em = now_();
  update_("demandas_tecnicas", demand.__rowIndex, patch);
  technicalAppendTransition_(Object.assign({}, demand, patch), "ASSUMIDA", identity, identity, "", clean_(p.parecer), "");
  return {assumed:true, demanda:technicalDemandPublic_(Object.assign({}, demand, patch))};
}

function gestorDemandaEncaminhar_(p, auth){
  technicalRequireManager_(auth);
  technicalEnsureSchema_();
  req_(p, ["demanda_id","para_area_id","motivo"]);
  if(clean_(p.motivo).length < 5) err_("TECH_FORWARD_REASON_REQUIRED", "Informe o motivo técnico do encaminhamento.", 400);
  var identity = technicalIdentity_(auth);
  var demand = technicalRequireDemand_(p.demanda_id, identity);
  technicalAssertDemandOpen_(demand);
  if(clean_(demand.politica_assinatura)){
    err_(
      "TECH_VALIDATION_FORWARD_DISABLED",
      "Este documento não pode sair do filtro de validação definido pelo Administrador.",
      409
    );
  }
  var area = technicalActiveArea_(p.para_area_id);
  technicalActiveRole_(p.para_cargo_id, area.id);
  var targetUser = p.para_usuario_id ? find_("usuarios", "id", p.para_usuario_id) : null;
  if(p.para_usuario_id && (!targetUser || upper_(targetUser.status) !== ST.ATIVO || upper_(targetUser.perfil) !== ROLE.GESTOR)){
    err_("TECH_ASSIGNEE_INVALID", "Responsável de destino inválido.", 400);
  }
  if(targetUser && clean_(targetUser.area_id) && String(targetUser.area_id) !== String(area.id)){
    err_("TECH_ASSIGNEE_AREA_MISMATCH", "O responsável não pertence à área de destino.", 400);
  }
  var patch = {
    area_atual_id:area.id, cargo_atual_id:clean_(p.para_cargo_id),
    responsavel_atual_id:clean_(p.para_usuario_id), status:TECH_DEMAND_STATUS.ENCAMINHADA,
    primeiro_atendimento_em:clean_(demand.primeiro_atendimento_em) || now_(), atualizado_em:now_()
  };
  update_("demandas_tecnicas", demand.__rowIndex, patch);
  technicalAppendTransition_(Object.assign({}, demand, patch), "ENCAMINHADA", identity, {
    area_id:patch.area_atual_id, cargo_id:patch.cargo_atual_id, usuario_id:patch.responsavel_atual_id
  }, "", clean_(p.parecer), clean_(p.motivo));
  technicalNotify_({usuario_id:patch.responsavel_atual_id, area_id:patch.responsavel_atual_id ? "" : patch.area_atual_id, cargo_id:patch.cargo_atual_id}, "DEMANDA_ENCAMINHADA", demand.titulo, "Demanda encaminhada por " + identity.nome + ".", "demandas_tecnicas", demand.id, demand.prioridade);
  audit_(auth, "TECH_DEMAND_FORWARDED", "demandas_tecnicas", demand.id, strip_(demand), Object.assign({}, strip_(demand), patch), clean_(p.user_agent));
  return {forwarded:true, demanda:technicalDemandPublic_(Object.assign({}, demand, patch))};
}

function gestorDemandaAssinar_(p, auth){
  req_(p, ["demanda_id","declaracao"]);
  var result = gestorDemandaValidar_({
    demanda_id:p.demanda_id,
    parecer:p.declaracao,
    declaracao:p.declaracao,
    relatorio_tecnico:p.relatorio_tecnico,
    user_agent:p.user_agent
  }, auth);
  return {
    signed:true,
    already_signed:!!result.already_validated,
    completed:!!result.completed,
    assinatura:result.assinatura,
    assinaturas_pendentes:result.assinaturas_pendentes || 0,
    demanda:result.demanda,
    relatorio_tecnico:result.relatorio_tecnico || null
  };
}

function gestorDemandaValidar_(p, auth){
  technicalRequireManager_(auth);
  technicalEnsureSchema_();
  req_(p, ["demanda_id","parecer"]);
  if(clean_(p.parecer).length < 5){
    err_("TECH_OPINION_REQUIRED", "Registre um parecer técnico objetivo.", 400);
  }
  var lock = LockService.getScriptLock();
  if(!lock.tryLock(15000)){
    err_("TECH_VALIDATION_BUSY", "Outra assinatura está sendo registrada. Tente novamente.", 409);
  }
  try{
    var baseIdentity = technicalIdentity_(auth);
    var demand = technicalRequireDemand_(p.demanda_id, baseIdentity);
    var identity = technicalAssertValidationIdentity_(auth, demand);
    var existingSignature = technicalSignaturesForDemand_(demand).find(function(item){
      return String(item.usuario_id) === String(identity.usuario_id);
    });
    if(TECH_FINAL_STATUSES.indexOf(upper_(demand.status)) >= 0){
      if(existingSignature){
        return {
          validated:true,
          already_validated:true,
          completed:true,
          assinatura:strip_(existingSignature),
          demanda:technicalDemandPublic_(demand)
        };
      }
      err_("TECH_DEMAND_FINAL", "A demanda já foi encerrada.", 409);
    }
    if(bool_(demand.exige_segregacao) && String(demand.criado_por) === String(identity.usuario_id)){
      err_("TECH_SIGNATURE_SEGREGATION", "O autor da demanda não pode assiná-la.", 409);
    }
    if(existingSignature){
      var existingProgress = technicalSignatureProgress_(demand);
      if(!existingProgress.concluida){
        return {
          validated:true,
          already_validated:true,
          completed:false,
          assinatura:strip_(existingSignature),
          assinaturas_pendentes:Math.max(0, existingProgress.necessarias - existingProgress.realizadas),
          demanda:technicalDemandPublic_(demand)
        };
      }
    }
    var signature = existingSignature;
    if(!signature){
      signature = fit_("assinaturas_tecnicas", {
        id:uuid_("AST"), demanda_id:demand.id, entidade_tipo:demand.entidade_tipo,
        entidade_id:demand.entidade_id, versao_entidade:demand.versao_entidade,
        usuario_id:identity.usuario_id, perfil:identity.perfil, area_id:identity.area_id,
        cargo_id:identity.cargo_id, significado:"APROVACAO_TECNICA",
        declaracao:clean_(p.declaracao || p.parecer), payload_hash:demand.payload_hash,
        criado_em:now_(), revogado_em:"", motivo_revogacao:""
      });
      append_("assinaturas_tecnicas", signature);
      audit_(auth, "TECH_DEMAND_SIGNED", "assinaturas_tecnicas", signature.id, null, signature, clean_(p.user_agent));
    }
    var progress = technicalSignatureProgress_(demand);
    var basePatch = {
      assinaturas_realizadas:progress.realizadas,
      primeiro_atendimento_em:clean_(demand.primeiro_atendimento_em) || now_(),
      atualizado_em:now_()
    };
    if(!progress.concluida){
      var pendingAreaId = progress.areas_pendentes[0] || clean_(demand.area_atual_id);
      var waitingPatch = Object.assign({}, basePatch, {
        status:TECH_DEMAND_STATUS.AGUARDANDO_ASSINATURA,
        area_atual_id:pendingAreaId,
        cargo_atual_id:"",
        responsavel_atual_id:""
      });
      update_("demandas_tecnicas", demand.__rowIndex, waitingPatch);
      technicalAppendTransition_(Object.assign({}, demand, waitingPatch), "ASSINADA_PARCIALMENTE", identity, {
        area_id:pendingAreaId
      }, "ASSINAR", p.parecer, "");
      progress.areas_pendentes.forEach(function(areaId){
        if(String(areaId) === String(identity.area_id)) return;
        technicalNotify_({area_id:areaId}, "ASSINATURA_PENDENTE", demand.titulo, "A primeira validação foi concluída. Falta a assinatura da sua área.", "demandas_tecnicas", demand.id, demand.prioridade);
      });
      return {
        validated:true,
        already_validated:!!existingSignature,
        completed:false,
        assinatura:strip_(signature),
        assinaturas_pendentes:Math.max(0, progress.necessarias - progress.realizadas),
        demanda:technicalDemandPublic_(Object.assign({}, demand, waitingPatch))
      };
    }

    var isOperationalOrder = upper_(demand.entidade_tipo) === "ORDEM_SERVICO_RASCUNHO";
    var technicalBrief = isOperationalOrder
      ? technicalAttachBriefToDemandEntity_(demand, p.relatorio_tecnico, p.parecer)
      : null;
    technicalApplyApprovedEntity_(demand, identity);
    var finalPatch = Object.assign({}, basePatch, {
      status:isOperationalOrder ? TECH_DEMAND_STATUS.LIBERADA_OPERACAO : TECH_DEMAND_STATUS.APROVADA,
      concluido_em:now_()
    });
    update_("demandas_tecnicas", demand.__rowIndex, finalPatch);
    technicalCloseDemandNotifications_(demand.id);
    technicalAppendTransition_(Object.assign({}, demand, finalPatch), "VALIDADA_E_ASSINADA", identity, {}, "APROVAR", p.parecer, "");
    technicalNotify_(
      {perfil:ROLE.ADMIN},
      "DECISAO_TECNICA",
      demand.titulo,
      "Validação concluída com todas as assinaturas obrigatórias.",
      demand.entidade_tipo,
      demand.entidade_id,
      demand.prioridade
    );
    audit_(auth, "TECH_DEMAND_VALIDATED", "demandas_tecnicas", demand.id, strip_(demand), Object.assign({}, strip_(demand), finalPatch, {relatorio_tecnico:technicalBrief}), clean_(p.user_agent));
    return {
      validated:true,
      already_validated:!!existingSignature,
      completed:true,
      assinatura:strip_(signature),
      demanda:technicalDemandPublic_(Object.assign({}, demand, finalPatch)),
      relatorio_tecnico:technicalBrief
    };
  } finally {
    lock.releaseLock();
  }
}

function technicalApplyApprovedEntity_(demand, identity){
  var type = upper_(demand.entidade_tipo);
  if(["CHECKLIST_MODELO","PLANO_MANUTENCAO","PLANO_CHECKLIST"].indexOf(type) >= 0){
    var plan = find_("planos_manutencao", "id", demand.entidade_id);
    if(plan){
      update_("planos_manutencao", plan.__rowIndex, {
        workflow_status:ST.VALIDADO, validado_gestao:"SIM", validado_por:identity.usuario_id,
        validado_em:now_(), status:ST.ATIVO, atualizado_em:now_()
      });
      if(typeof adminIntervencaoCriarDaOcorrenciaAprovada_ === "function"){
        adminIntervencaoCriarDaOcorrenciaAprovada_(Object.assign({}, plan, {
          workflow_status:ST.VALIDADO,
          validado_gestao:"SIM",
          status:ST.ATIVO
        }), demand, identity);
      }
    }
  }
  if(type === "ORDEM_SERVICO_RASCUNHO" && typeof adminIntervencaoLiberarOperacao_ === "function"){
    adminIntervencaoLiberarOperacao_(demand, identity);
  }
}

function technicalApplyReturnedEntity_(demand, identity){
  var type = upper_(demand.entidade_tipo);
  if(type === "ORDEM_SERVICO_RASCUNHO" && typeof adminIntervencaoDevolver_ === "function"){
    adminIntervencaoDevolver_(demand, identity);
  }
}

function technicalAttachBriefToDemandEntity_(demand, brief, opinion){
  var type = upper_(demand.entidade_tipo);
  if(type !== "ORDEM_SERVICO_RASCUNHO") return null;
  var order = find_("ordens_servico", "id", demand.entidade_id);
  if(!order) err_("INTERVENTION_NOT_FOUND", "A intervenção vinculada à demanda não existe.", 404);
  var normalized = technicalNormalizeBrief_(brief, {
    situacao:clean_(demand.descricao || order.descricao || order.titulo),
    causa_provavel:"A confirmar na inspeção inicial do equipamento.",
    resultado_esperado:"Concluir " + clean_(order.titulo || "a intervenção") + " em condição segura e operacional.",
    criterio_aceite:clean_(opinion) || "Serviço concluído, condição segura confirmada e evidências registradas."
  });
  update_("ordens_servico", order.__rowIndex, {
    analise_tecnica_json:JSON.stringify(normalized),
    atualizado_em:now_()
  });
  return normalized;
}

function gestorDemandaDecidir_(p, auth){
  technicalRequireManager_(auth);
  technicalEnsureSchema_();
  req_(p, ["demanda_id","decisao","parecer"]);
  var identity = technicalIdentity_(auth);
  var demand = technicalRequireDemand_(p.demanda_id, identity);
  identity = technicalAssertValidationIdentity_(auth, demand);
  technicalAssertDemandOpen_(demand);
  var decision = upper_(p.decisao);
  if(["APROVAR","DEVOLVER_ADMIN","LIBERAR_OPERACAO"].indexOf(decision) < 0){
    err_("TECH_DECISION_INVALID", "Decisão deve ser APROVAR, DEVOLVER_ADMIN ou LIBERAR_OPERACAO.", 400);
  }
  if(clean_(p.parecer).length < 5) err_("TECH_OPINION_REQUIRED", "Registre um parecer técnico objetivo.", 400);
  if(bool_(demand.exige_segregacao) && String(demand.criado_por) === String(identity.usuario_id)){
    err_("TECH_DECISION_SEGREGATION", "O autor não pode aprovar a própria demanda.", 409);
  }
  if(decision !== "DEVOLVER_ADMIN" && bool_(demand.exige_assinatura) && !technicalSignatureProgress_(demand).concluida){
    err_("TECH_SIGNATURES_PENDING", "Ainda existem assinaturas técnicas obrigatórias pendentes.", 409);
  }
  var status = decision === "DEVOLVER_ADMIN"
    ? TECH_DEMAND_STATUS.DEVOLVIDA_ADMIN
    : (decision === "LIBERAR_OPERACAO" ? TECH_DEMAND_STATUS.LIBERADA_OPERACAO : TECH_DEMAND_STATUS.APROVADA);
  var patch = {
    status:status, primeiro_atendimento_em:clean_(demand.primeiro_atendimento_em) || now_(),
    concluido_em:now_(), atualizado_em:now_()
  };
  var technicalBrief = decision === "LIBERAR_OPERACAO"
    ? technicalAttachBriefToDemandEntity_(demand, p.relatorio_tecnico, p.parecer)
    : null;
  if(decision !== "DEVOLVER_ADMIN") technicalApplyApprovedEntity_(demand, identity);
  update_("demandas_tecnicas", demand.__rowIndex, patch);
  technicalCloseDemandNotifications_(demand.id);
  technicalAppendTransition_(Object.assign({}, demand, patch), "DECIDIDA", identity, {}, decision, p.parecer, p.motivo);
  if(decision === "DEVOLVER_ADMIN") technicalApplyReturnedEntity_(demand, identity);
  technicalNotify_(
    {perfil:ROLE.ADMIN},
    "DECISAO_TECNICA",
    demand.titulo,
    "Decisão: " + decision + ". Parecer: " + clean_(p.parecer),
    demand.entidade_tipo,
    demand.entidade_id,
    demand.prioridade
  );
  audit_(auth, "TECH_DEMAND_DECIDED", "demandas_tecnicas", demand.id, strip_(demand), Object.assign({}, strip_(demand), patch, {relatorio_tecnico:technicalBrief}), clean_(p.user_agent));
  return {decided:true, decisao:decision, demanda:technicalDemandPublic_(Object.assign({}, demand, patch)), relatorio_tecnico:technicalBrief};
}

function gestorAnaliseSalvar_(p, auth){
  technicalRequireManager_(auth);
  technicalEnsureSchema_();
  var data = Object.assign({}, p.analise || p.dados || p);
  req_(data, ["ocorrencia_id","titulo","diagnostico","recomendacao"]);
  var identity = technicalIdentity_(auth);
  var occurrence = find_("ocorrencias_operacionais", "id", data.ocorrencia_id);
  if(!occurrence) err_("OCCURRENCE_NOT_FOUND", "Ocorrência operacional não encontrada.", 404);
  var old = data.id ? find_("analises_tecnicas", "id", data.id) : null;
  if(old && String(old.autor_id) !== String(identity.usuario_id) && identity.perfil !== ROLE.ADMIN){
    err_("TECH_ANALYSIS_FORBIDDEN", "Somente o autor pode editar esta análise.", 403);
  }
  if(old && upper_(old.status) !== ST.RASCUNHO) err_("TECH_ANALYSIS_LOCKED", "Análise enviada não pode ser alterada.", 409);
  var saved = fit_("analises_tecnicas", Object.assign({}, old || {}, {
    id:old ? old.id : uuid_("ANT"), demanda_id:clean_(data.demanda_id),
    ocorrencia_id:occurrence.id, ativo_id:clean_(data.ativo_id || occurrence.ativo_id),
    componente_id:clean_(data.componente_id || occurrence.componente_id), autor_id:identity.usuario_id,
    area_id:identity.area_id, cargo_id:identity.cargo_id, titulo:clean_(data.titulo),
    diagnostico:clean_(data.diagnostico), risco:clean_(data.risco),
    causa_provavel:clean_(data.causa_provavel), recomendacao:clean_(data.recomendacao),
    recomenda_checklist:bool_(data.recomenda_checklist) ? "SIM" : "NAO",
    recomenda_os:bool_(data.recomenda_os) ? "SIM" : "NAO",
    prioridade:upper_(data.prioridade || occurrence.severidade || "MEDIA"), status:ST.RASCUNHO,
    enviado_admin_em:"", criado_em:old ? old.criado_em : now_(), atualizado_em:now_(),
    relatorio_tecnico_json:technicalSerializeBrief_(data.relatorio_tecnico, {
      situacao:clean_(data.diagnostico || occurrence.descricao || occurrence.titulo),
      causa_provavel:clean_(data.causa_provavel),
      resultado_esperado:clean_(data.recomendacao),
      riscos:[{tipo:upper_(data.prioridade || occurrence.severidade || "OPERACIONAL"), titulo:"Risco operacional", descricao:clean_(data.risco)}]
    })
  }));
  if(old) update_("analises_tecnicas", old.__rowIndex, saved); else append_("analises_tecnicas", saved);
  update_("ocorrencias_operacionais", occurrence.__rowIndex, {
    status:"EM_ANALISE_TECNICA",
    analise_tecnica_id:saved.id,
    tratamento_status:"EM_ANALISE_TECNICA",
    atualizado_em:now_()
  });
  audit_(auth, old ? "TECH_ANALYSIS_UPDATED" : "TECH_ANALYSIS_CREATED", "analises_tecnicas", saved.id, old && strip_(old), saved, clean_(p.user_agent));
  return {saved:true, analise:saved};
}

function gestorParadaCriarTratamento_(p, auth){
  req_(p, ["parada_id"]);
  auth = auth || p.__auth || {};
  if([ROLE.GESTOR, ROLE.ADMIN].indexOf(upper_(auth.perfil)) < 0){
    err_("FORBIDDEN", "Somente Gestor ou Administrador pode criar tratamento para parada.", 403);
  }
  technicalEnsureSchema_();

  var stop = find_("paradas_equipamento", "id", p.parada_id);
  if(!stop) err_("STOP_NOT_FOUND", "Parada técnica não encontrada.", 404);

  var openStatuses = [
    "PARADA_ABERTA",
    "MANUTENCAO_EM_EXECUCAO",
    "AGUARDANDO_RETORNO_OPERACIONAL"
  ];
  if(openStatuses.indexOf(upper_(stop.status)) < 0){
    err_("STOP_ALREADY_CLOSED", "A parada já foi encerrada e não aceita novo tratamento.", 409);
  }

  var existing = rows_("ocorrencias_operacionais").filter(function(occurrence){
    return String(occurrence.parada_id) === String(stop.id) &&
      upper_(occurrence.status) === ST.AGUARDANDO_ANALISE;
  }).sort(sortByDateDesc_("criado_em"))[0];
  if(existing){
    return {
      created:false,
      already_exists:true,
      parada_id:stop.id,
      occurrence:strip_(existing)
    };
  }

  var asset = find_("ativos", "id", stop.ativo_id);
  var assetLabel = asset ? clean_(asset.tag || asset.nome || asset.id) : clean_(stop.ativo_id);
  var createdAt = now_();
  var row = fit_("ocorrencias_operacionais", {
    id:uuid_("OCR"),
    ativo_id:clean_(stop.ativo_id),
    componente_id:clean_(stop.componente_id),
    tipo:"PARADA_TECNICA",
    titulo:"Tratar parada técnica - "+(assetLabel || "equipamento"),
    descricao:clean_(stop.motivo_parada || "Equipamento indisponível aguardando diagnóstico técnico."),
    severidade:"ALTA",
    status:ST.AGUARDANDO_ANALISE,
    usuario_id:clean_(auth.usuario_id),
    perfil:upper_(auth.perfil),
    os_id:clean_(stop.os_id),
    acao_id:clean_(stop.acao_id),
    parada_id:clean_(stop.id),
    criado_em:createdAt,
    atualizado_em:createdAt
  });
  row = append_("ocorrencias_operacionais", row);

  hist_({
    ativo_id:row.ativo_id,
    componente_id:row.componente_id,
    os_id:row.os_id,
    acao_id:row.acao_id,
    evento:"TRATAMENTO_PARADA_CRIADO",
    descricao:"Parada "+stop.id+" encaminhada para análise técnica.",
    usuario_id:auth.usuario_id || "",
    perfil:auth.perfil || ROLE.GESTOR
  });

  return {
    created:true,
    already_exists:false,
    parada_id:stop.id,
    occurrence:strip_(row)
  };
}

function gestorAnaliseEnviarAdmin_(p, auth){
  technicalRequireManager_(auth);
  technicalEnsureSchema_();
  req_(p, ["analise_id"]);
  var identity = technicalIdentity_(auth);
  var analysis = find_("analises_tecnicas", "id", p.analise_id);
  if(!analysis) err_("TECH_ANALYSIS_NOT_FOUND", "Análise técnica não encontrada.", 404);
  if(String(analysis.autor_id) !== String(identity.usuario_id) && identity.perfil !== ROLE.ADMIN){
    err_("TECH_ANALYSIS_FORBIDDEN", "Somente o autor pode enviar esta análise.", 403);
  }
  if(upper_(analysis.status) !== ST.RASCUNHO) return {sent:true, already_sent:true, analise:strip_(analysis)};
  var patch = {status:"ENVIADA_ADMIN", enviado_admin_em:now_(), atualizado_em:now_()};
  update_("analises_tecnicas", analysis.__rowIndex, patch);
  var occurrence = find_("ocorrencias_operacionais", "id", analysis.ocorrencia_id);
  if(occurrence) update_("ocorrencias_operacionais", occurrence.__rowIndex, {
    status:"EM_TRATAMENTO_ADMIN",
    analise_tecnica_id:analysis.id,
    tratamento_status:"AGUARDANDO_ADMIN",
    atualizado_em:now_()
  });
  var notificationType = bool_(analysis.recomenda_checklist)
    ? "SOLICITACAO_CHECKLIST"
    : (bool_(analysis.recomenda_os) ? "SOLICITACAO_INTERVENCAO" : "ANALISE_TECNICA");
  var notificationMessage = notificationType === "SOLICITACAO_CHECKLIST"
    ? "O Gestor enviou uma análise com solicitação de checklist. O construtor será aberto com o contexto técnico preenchido."
    : (notificationType === "SOLICITACAO_INTERVENCAO"
      ? "O Gestor solicitou uma inspeção ou intervenção baseada em análise técnica."
      : "Análise técnica recebida com recomendação para decisão administrativa.");
  technicalNotify_(
    {perfil:ROLE.ADMIN},
    notificationType,
    analysis.titulo,
    notificationMessage,
    "analises_tecnicas",
    analysis.id,
    analysis.prioridade
  );
  audit_(auth, "TECH_ANALYSIS_SENT_ADMIN", "analises_tecnicas", analysis.id, strip_(analysis), Object.assign({}, strip_(analysis), patch), clean_(p.user_agent));
  return {sent:true, already_sent:false, analise:Object.assign({}, strip_(analysis), patch)};
}

function adminAnalisesTecnicasListar_(p, auth){
  technicalRequireAdmin_(auth);
  technicalEnsureSchema_();
  var status = upper_(p.status);
  var analyses = rows_("analises_tecnicas", true).filter(function(item){ return !status || upper_(item.status) === status; }).sort(sortByDateDesc_("atualizado_em")).map(strip_);
  return {total:analyses.length, analises:analyses};
}

function adminAnaliseConverterChecklist_(p, auth){
  technicalRequireAdmin_(auth);
  technicalEnsureSchema_();
  req_(p, ["analise_id","plano","itens"]);
  var analysis = find_("analises_tecnicas", "id", p.analise_id);
  if(!analysis) err_("TECH_ANALYSIS_NOT_FOUND", "Análise técnica não encontrada.", 404);
  if(["ENVIADA_ADMIN","EM_TRATAMENTO_ADMIN"].indexOf(upper_(analysis.status)) < 0){
    err_("TECH_ANALYSIS_STATUS_INVALID", "A análise não está disponível para conversão.", 409);
  }
  var plan = Object.assign({}, p.plano || {});
  plan.ativo_id = clean_(plan.ativo_id || analysis.ativo_id);
  plan.componente_id = clean_(plan.componente_id || analysis.componente_id);
  plan.nome = clean_(plan.nome || analysis.titulo);
  plan.analise_tecnica_json = clean_(analysis.relatorio_tecnico_json);
  plan.analise_origem_id = analysis.id;
  plan.ocorrencia_origem_id = clean_(analysis.ocorrencia_id);
  var saved = adminSalvarModeloChecklist_({plano:plan, itens:p.itens, __auth:auth});
  update_("analises_tecnicas", analysis.__rowIndex, {status:"CONVERTIDA_CHECKLIST", atualizado_em:now_()});
  var occurrence = analysis.ocorrencia_id
    ? find_("ocorrencias_operacionais", "id", analysis.ocorrencia_id)
    : null;
  if(occurrence){
    update_("ocorrencias_operacionais", occurrence.__rowIndex, {
      status:"EM_PREPARACAO_CHECKLIST",
      analise_tecnica_id:analysis.id,
      tratamento_status:"CHECKLIST_EM_PREPARACAO",
      atualizado_em:now_()
    });
  }
  audit_(auth, "TECH_ANALYSIS_CONVERTED_CHECKLIST", "analises_tecnicas", analysis.id, strip_(analysis), {status:"CONVERTIDA_CHECKLIST", plano_id:saved.plano.id}, clean_(p.user_agent));
  return {converted:true, analise_id:analysis.id, plano:saved.plano, itens:saved.itens};
}

function gestorNotificacoesListar_(p, auth){
  technicalRequireManager_(auth);
  technicalEnsureSchema_();
  var status = upper_(p.status);
  var identity = technicalIdentity_(auth);
  var items = rows_("notificacoes", true).filter(function(item){
    if(String(item.usuario_id) !== String(identity.usuario_id)) return false;
    return !status || upper_(item.status) === status;
  }).sort(sortByDateDesc_("criado_em"));
  var limit = Math.max(1, Math.min(num_(p.limite, 100), 300));
  return {total:items.length, notificacoes:items.slice(0, limit).map(strip_)};
}

function gestorNotificacaoMarcarLida_(p, auth){
  technicalRequireManager_(auth);
  technicalEnsureSchema_();
  var identity = technicalIdentity_(auth);
  var notificationId = clean_(p.notificacao_id);
  var entityType = upper_(p.entidade_tipo);
  var entityId = clean_(p.entidade_id);
  if(!notificationId && (!entityType || !entityId)){
    err_("NOTIFICATION_REFERENCE_REQUIRED", "Informe a notificação ou o contexto operacional lido.", 400);
  }
  var item = notificationId
    ? find_("notificacoes", "id", notificationId)
    : rows_("notificacoes", true).filter(function(candidate){
        return String(candidate.usuario_id) === String(identity.usuario_id) &&
          upper_(candidate.entidade_tipo) === entityType &&
          String(candidate.entidade_id) === String(entityId);
      })[0];
  if(notificationId && (!item || String(item.usuario_id) !== String(identity.usuario_id))){
    err_("NOTIFICATION_NOT_FOUND", "Notificação não encontrada.", 404);
  }
  if(!item){
    var acknowledged = fit_("notificacoes", {
      id:uuid_("NOT"), usuario_id:identity.usuario_id, perfil:identity.perfil,
      area_id:identity.area_id, tipo:upper_(p.tipo || "CONTEXTO_OPERACIONAL"),
      titulo:clean_(p.titulo || "Contexto operacional consultado"),
      mensagem:clean_(p.mensagem), entidade_tipo:entityType, entidade_id:entityId,
      prioridade:upper_(p.prioridade || "MEDIA"), status:"LIDA",
      lida_em:now_(), criado_em:now_()
    });
    append_("notificacoes", acknowledged);
    return {
      read:true,
      already_read:false,
      context_acknowledged:true,
      notificacao_id:acknowledged.id
    };
  }
  if(upper_(item.status) === "LIDA") return {read:true, already_read:true, notificacao_id:item.id};
  update_("notificacoes", item.__rowIndex, {status:"LIDA", lida_em:now_()});
  return {read:true, already_read:false, notificacao_id:item.id};
}

function technicalSecondsBetween_(start, end){
  var startMs = new Date(clean_(start)).getTime();
  var endMs = new Date(clean_(end)).getTime();
  return startMs && endMs && endMs >= startMs ? Math.round((endMs - startMs) / 1000) : 0;
}

function technicalClamp_(value, minimum, maximum){
  return Math.max(minimum, Math.min(maximum, value));
}

function technicalAverage_(values){
  return values.length ? values.reduce(function(sum, value){ return sum + value; }, 0) / values.length : null;
}

function technicalAggregateKpis_(input){
  var observationSeconds = Math.max(0, num_(input.observation_seconds, 0));
  var downtimeSeconds = Math.max(0, num_(input.downtime_seconds, 0));
  var operatingSeconds = Math.max(0, observationSeconds - downtimeSeconds);
  var failures = Math.max(0, num_(input.failures, 0));
  var repairSeconds = Math.max(0, num_(input.repair_seconds, 0));
  var production = input.production || [];
  var plannedProduction = production.reduce(function(sum, row){ return sum + Math.max(0, num_(row.tempo_planejado_segundos,0)); },0);
  var operationProduction = production.reduce(function(sum, row){ return sum + Math.max(0, num_(row.tempo_operacao_segundos,0)); },0);
  var idealOutputSeconds = production.reduce(function(sum, row){
    return sum + Math.max(0, num_(row.ciclo_ideal_segundos,0)) * Math.max(0, num_(row.quantidade_total,0));
  },0);
  var totalQuantity = production.reduce(function(sum, row){ return sum + Math.max(0, num_(row.quantidade_total,0)); },0);
  var goodQuantity = production.reduce(function(sum, row){ return sum + Math.max(0, num_(row.quantidade_boas,0)); },0);
  var oeeAvailable = plannedProduction > 0 && operationProduction > 0 && totalQuantity > 0;
  var availability = oeeAvailable ? technicalClamp_(operationProduction / plannedProduction, 0, 1) : null;
  var performance = oeeAvailable ? technicalClamp_(idealOutputSeconds / operationProduction, 0, 1) : null;
  var quality = oeeAvailable ? technicalClamp_(goodQuantity / totalQuantity, 0, 1) : null;
  var slaResponseEligible = (input.sla_response || []).filter(function(item){ return item.eligible; });
  var slaResolutionEligible = (input.sla_resolution || []).filter(function(item){ return item.eligible; });
  return {
    disponibilidade_pct:observationSeconds > 0 ? technicalClamp_(operatingSeconds / observationSeconds * 100, 0, 100) : null,
    tempo_observado_segundos:observationSeconds,
    tempo_operacao_segundos:operatingSeconds,
    tempo_parada_segundos:downtimeSeconds,
    falhas_nao_planejadas:failures,
    mttr_segundos:failures > 0 ? Math.round(repairSeconds / failures) : null,
    mtbf_segundos:failures > 0 ? Math.round(operatingSeconds / failures) : null,
    lead_time_os_segundos:technicalAverage_(input.os_lead_times || []),
    lead_time_demanda_segundos:technicalAverage_(input.demand_lead_times || []),
    sla_resposta_pct:slaResponseEligible.length ? slaResponseEligible.filter(function(item){ return item.met; }).length / slaResponseEligible.length * 100 : null,
    sla_resolucao_pct:slaResolutionEligible.length ? slaResolutionEligible.filter(function(item){ return item.met; }).length / slaResolutionEligible.length * 100 : null,
    sla_resposta_amostra:slaResponseEligible.length,
    sla_resolucao_amostra:slaResolutionEligible.length,
    oee_disponivel:oeeAvailable,
    oee_pct:oeeAvailable ? availability * performance * quality * 100 : null,
    oee_disponibilidade_pct:oeeAvailable ? availability * 100 : null,
    oee_performance_pct:oeeAvailable ? performance * 100 : null,
    oee_qualidade_pct:oeeAvailable ? quality * 100 : null,
    producao_amostra:production.length
  };
}

function cmmsKpisTecnicos_(p, auth){
  technicalRequireManager_(auth);
  technicalEnsureSchema_();
  var endMs = clean_(p.fim_em) ? new Date(clean_(p.fim_em)).getTime() : Date.now();
  var defaultWindowDays = Math.max(1, Math.min(365, num_(configurationRuntimeValue_("kpi.janela_padrao_dias", 30), 30)));
  var startMs = clean_(p.inicio_em) ? new Date(clean_(p.inicio_em)).getTime() : endMs - defaultWindowDays * 86400000;
  if(!startMs || !endMs || startMs >= endMs) err_("KPI_PERIOD_INVALID", "Período de indicadores inválido.", 400);
  var assetId = clean_(p.ativo_id);
  var componentId = clean_(p.componente_id);
  if(componentId){
    var component = find_("componentes", "id", componentId);
    if(!component) err_("COMPONENT_NOT_FOUND", "Componente não encontrado para calcular indicadores.", 404);
    if(assetId && String(component.ativo_id) !== String(assetId)){
      err_("COMPONENT_ASSET_MISMATCH", "Componente não pertence ao equipamento filtrado.", 400);
    }
    assetId = clean_(component.ativo_id);
  }
  var activeAssets = rows_("ativos", true).filter(function(asset){
    return (!assetId || String(asset.id) === String(assetId)) && upper_(asset.status || ST.ATIVO) !== ST.INATIVO;
  });
  var assetCount = Math.max(1, activeAssets.length);
  var stops = rows_("paradas_equipamento", true).filter(function(stop){
    if(assetId && String(stop.ativo_id) !== String(assetId)) return false;
    if(componentId && String(stop.componente_id) !== String(componentId)) return false;
    var started = new Date(clean_(stop.iniciada_em)).getTime();
    return started && started >= startMs && started <= endMs;
  });
  var unplanned = stops.filter(function(stop){
    var classification = upper_(stop.tipo || stop.origem);
    return classification.indexOf("PLANEJ") < 0 && classification.indexOf("PREVENT") < 0;
  });
  var downtime = unplanned.reduce(function(sum, stop){
    return sum + Math.max(0, num_(stop.tempo_parada_segundos, technicalSecondsBetween_(stop.iniciada_em, stop.finalizada_em || iso_(new Date(endMs)))));
  },0);
  var repair = unplanned.reduce(function(sum, stop){
    return sum + Math.max(0, num_(stop.tempo_execucao_segundos, technicalSecondsBetween_(stop.manutencao_iniciada_em, stop.manutencao_finalizada_em)));
  },0);
  var orders = rows_("ordens_servico", true).filter(function(order){
    if(assetId && String(order.ativo_id) !== String(assetId)) return false;
    if(componentId && String(order.componente_id) !== String(componentId)) return false;
    var closed = new Date(clean_(order.finalizada_em)).getTime();
    return closed && closed >= startMs && closed <= endMs;
  });
  var demands = rows_("demandas_tecnicas", true).filter(function(demand){
    if(componentId && String(demand.componente_id) !== String(componentId)) return false;
    var closed = new Date(clean_(demand.concluido_em)).getTime();
    return closed && closed >= startMs && closed <= endMs;
  });
  var nowMs = Date.now();
  var slaResponse = rows_("demandas_tecnicas", true).map(function(demand){
    var deadline = new Date(clean_(demand.prazo_primeira_resposta_em)).getTime();
    var actual = new Date(clean_(demand.primeiro_atendimento_em)).getTime();
    return {eligible:!!deadline && (!!actual || deadline < nowMs), met:!!actual && actual <= deadline};
  });
  var slaResolution = rows_("demandas_tecnicas", true).map(function(demand){
    var deadline = new Date(clean_(demand.prazo_resolucao_em)).getTime();
    var actual = new Date(clean_(demand.concluido_em)).getTime();
    return {eligible:!!deadline && (!!actual || deadline < nowMs), met:!!actual && actual <= deadline};
  });
  var production = (componentId ? [] : rows_("apontamentos_producao", true)).filter(function(row){
    if(assetId && String(row.ativo_id) !== String(assetId)) return false;
    var started = new Date(clean_(row.inicio_em)).getTime();
    return started && started >= startMs && started <= endMs;
  });
  var metrics = technicalAggregateKpis_({
    observation_seconds:Math.round((endMs - startMs) / 1000) * assetCount,
    downtime_seconds:downtime,
    repair_seconds:repair,
    failures:unplanned.length,
    os_lead_times:orders.map(function(order){ return technicalSecondsBetween_(order.aberta_em, order.finalizada_em); }).filter(function(value){ return value > 0; }),
    demand_lead_times:demands.map(function(demand){ return technicalSecondsBetween_(demand.criado_em, demand.concluido_em); }).filter(function(value){ return value > 0; }),
    sla_response:slaResponse,
    sla_resolution:slaResolution,
    production:production
  });
  return Object.assign({
    ativo_id:assetId || "TODOS", componente_id:componentId, inicio_em:iso_(new Date(startMs)), fim_em:iso_(new Date(endMs)),
    ativos_considerados:activeAssets.length,
    metas:{
      disponibilidade_pct:num_(configurationRuntimeValue_("kpi.meta.disponibilidade_pct", 90), 90),
      oee_pct:num_(configurationRuntimeValue_("kpi.meta.oee_pct", 75), 75)
    },
    metodologia:componentId
      ? "MTBF/MTTR do componente por falhas não planejadas vinculadas; OEE não se aplica ao componente."
      : "MTBF/MTTR por falhas não planejadas; OEE somente com apontamento de produção."
  }, metrics);
}
