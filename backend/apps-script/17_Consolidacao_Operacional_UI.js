/**
 * FAB Control 1.1.0
 * Consolidação operacional para UI real.
 *
 * Regras do pacote:
 * - A tela não depende de IDs internos manuais para o operador.
 * - O lote aceita checklist_execucao_id, id, plano_item_id, item_id ou ordem.
 * - Operador só responde execução própria e ação iniciada.
 * - Gestor recebe auditoria de execução com checklist, evidências, pendências e decisão possível.
 */

function cmmsOperacionalUiSchemaUpgrade110_(p, usuario){
  var auth = usuario || p.__auth || {};
  if(upper_(auth.perfil) !== ROLE.ADMIN){
    err_("FORBIDDEN", "Somente ADMIN pode executar upgrade do pacote operacional 1.1.0.", 403);
  }

  var ss = getSpreadsheet_();
  Object.keys(SH).forEach(function(name){ ensureSheet_(ss, name, SH[name]); });

  syncReleaseVersionConfig_();

  upsert_("config", "chave", {
    chave:"ui.operacional.contrato",
    valor:"1.1.0",
    descricao:"Tela operacional consolidada: fila, tela de ação, lote amigável, auditoria e blindagem de finalização.",
    atualizado_em:now_()
  });

  invalidateRuntimeCache_();

  return {
    upgraded:true,
    version:FAB.VERSION,
    sheets:Object.keys(SH).length,
    regra:"UI operacional não exige CHK/PIT manual; backend resolve item por ordem, id ou plano_item_id e mantém blindagem de checklist completo.",
    endpoints:[
      "operador.minhas_acoes",
      "operador.tela_acao",
      "operador.salvar_checklist_lote",
      "operador.detalhar_checklist_execucao",
      "operador.validar_finalizacao_acao",
      "operador.registrar_evidencia",
      "operador.finalizar_acao",
      "gestor.auditoria_execucao_checklist",
      "gestor.validar_acao"
    ]
  };
}

function operadorMinhasAcoes110_(p, usuario){
  var auth = requireOperadorAuth1081_(usuario || p.__auth || {}, "operador.minhas_acoes");
  var limite = Math.min(Math.max(num_(p.limite, 50), 1), 200);
  var rawStatus = clean_(p.status || "PENDENTE,EM_EXECUCAO,AGUARDANDO_VALIDACAO");
  var statuses = rawStatus === "TODAS" || rawStatus === "ALL"
    ? []
    : rawStatus.split(",").map(upper_).filter(Boolean);
  if(bool_(p.incluir_concluidas) && statuses.indexOf(ST.CONCLUIDA) < 0) statuses.push(ST.CONCLUIDA);

  var ativoId = clean_(p.ativo_id);
  var componenteId = clean_(p.componente_id);
  var operadorId = clean_(auth.usuario_id);
  var operationalPlanIds = {};
  rows_("planos_manutencao", true).forEach(function(plan){
    if(isPlanoOperacional_(plan)) operationalPlanIds[String(plan.id)] = true;
  });
  var planItemCounts = {};
  rows_("plano_itens", true).forEach(function(item){
    if(upper_(item.status || ST.ATIVO) !== ST.ATIVO) return;
    var planId = String(item.plano_id || "");
    planItemCounts[planId] = (planItemCounts[planId] || 0) + 1;
  });

  var cards = rows_("os_acoes").filter(function(a){
    var st = upper_(a.status);
    if(statuses.length && statuses.indexOf(st) < 0) return false;
    if(ativoId && String(a.ativo_id) !== String(ativoId)) return false;
    if(componenteId && String(a.componente_id) !== String(componenteId)) return false;
    if(terminal_(st) && !bool_(p.incluir_concluidas)) return false;
    if(!clean_(a.plano_id) || !operationalPlanIds[String(a.plano_id)] || !planItemCounts[String(a.plano_id)]) return false;

    var resp = clean_(a.responsavel_id);
    if(st === ST.PENDENTE) return !resp || String(resp) === String(operadorId);
    if([ST.EM_EXECUCAO, ST.AGUARDANDO_VALIDACAO, ST.CONCLUIDA, ST.BLOQUEADA].indexOf(st) >= 0){
      return !resp || String(resp) === String(operadorId);
    }
    return false;
  }).sort(function(a,b){
    var pa = CMMS110_prioridadePeso_(a.prioridade);
    var pb = CMMS110_prioridadePeso_(b.prioridade);
    if(pa !== pb) return pb - pa;
    return String(a.gerado_em || "").localeCompare(String(b.gerado_em || ""));
  }).slice(0, limite).map(function(a){
    return CMMS110_buildActionCard_(a, auth);
  });

  var resumo = {total:cards.length, aguardando_inicio:0, em_execucao:0, aguardando_validacao:0, concluidas:0, bloqueadas:0};
  cards.forEach(function(c){
    var state = upper_(c.ui && c.ui.state);
    if(state === "AGUARDANDO_INICIO") resumo.aguardando_inicio++;
    else if(state === ST.EM_EXECUCAO) resumo.em_execucao++;
    else if(state === ST.AGUARDANDO_VALIDACAO) resumo.aguardando_validacao++;
    else if(state === ST.CONCLUIDA) resumo.concluidas++;
    else if(state.indexOf("BLOQUE") >= 0 || upper_(c.acao && c.acao.status) === ST.BLOQUEADA) resumo.bloqueadas++;
  });

  return {
    ok:true,
    version:FAB.VERSION,
    operador_id:operadorId,
    filtro:{status:statuses.length ? statuses : ["TODAS"], ativo_id:ativoId, componente_id:componenteId, limite:limite},
    resumo:resumo,
    total:cards.length,
    acoes:cards
  };
}

function operadorTelaAcao110_(p, usuario){
  var auth = usuario || p.__auth || {};
  req_(p, ["acao_id"]);
  var acao = find_("os_acoes", "id", p.acao_id);
  if(!acao) err_("ACTION_NOT_FOUND", "Ação não encontrada: "+p.acao_id, 404);

  var ex = latestExecucaoAcao1081_(acao.id);
  if(ex) CMMS1083_requireReadAccess_(ex, auth);

  if(!ex && upper_(auth.perfil) === ROLE.OPERADOR){
    var resp = clean_(acao.responsavel_id);
    if(resp && String(resp) !== String(clean_(auth.usuario_id))){
      err_("ACTION_ASSIGNED_TO_OTHER", "Ação vinculada a outro operador: "+resp, 403);
    }
  }

  return CMMS110_buildActionScreen_(acao, auth, ex);
}

function operadorDetalharChecklistExecucao110_(p, usuario){
  var auth = usuario || p.__auth || {};
  var ctx = CMMS1083_resolveExecucaoContext_(p);
  CMMS1083_requireReadAccess_(ctx.ex, auth);
  return CMMS110_buildActionScreen_(ctx.acao, auth, ctx.ex);
}

function operadorValidarFinalizacaoAcao110_(p, usuario){
  var auth = usuario || p.__auth || {};
  var ctx = CMMS1083_resolveExecucaoContext_(p);
  CMMS1083_requireReadAccess_(ctx.ex, auth);
  var validacao = CMMS1083_validateChecklistExecution_(ctx.ex.id);
  var finalizacao = CMMS110_compactFinalizacao_(validacao);
  var acao = ctx.acao || find_("os_acoes", "id", ctx.ex.acao_id);
  var ui = acao ? CMMS110_uiState_(acao, ctx.ex, auth, finalizacao) : null;

  return {
    ok:true,
    version:FAB.VERSION,
    acao_id:ctx.ex.acao_id,
    execucao_id:ctx.ex.id,
    operador_id:ctx.ex.operador_id,
    can_finalize:finalizacao.can_finalize,
    finalizacao:finalizacao,
    ui:ui,
    next_actions:ui ? CMMS110_nextActions_(ui) : [],
    message:finalizacao.can_finalize ? "Checklist liberado para finalização." : CMMS1083_buildChecklistBlockMessage_(validacao)
  };
}

function operadorSalvarChecklistLote110_(p, usuario){
  var auth = requireOperadorAuth1081_(usuario || p.__auth || {}, "operador.salvar_checklist_lote");
  var rawItems = Array.isArray(p.itens) ? p.itens : (Array.isArray(p.respostas) ? p.respostas : []);
  if(!rawItems.length){
    err_("CHECKLIST_BATCH_EMPTY", "Informe itens[] com pelo menos um item de checklist.", 400);
  }

  var ctx = CMMS110_resolveBatchContext_(p, auth, rawItems);
  var maps = ctx ? CMMS110_buildChecklistMaps_(ctx.itens) : null;
  var salvos = [];
  var erros = [];

  rawItems.forEach(function(raw, idx){
    var itemPayload = Object.assign({}, raw || {});
    itemPayload.__auth = auth;

    try{
      if(!clean_(itemPayload.checklist_execucao_id)){
        itemPayload.checklist_execucao_id = CMMS110_resolveChecklistExecucaoId_(raw || {}, maps);
      }
      if(!clean_(itemPayload.checklist_execucao_id)){
        err_("CHECKLIST_ITEM_UNRESOLVED", "Não foi possível resolver o item do checklist. Informe checklist_execucao_id, id, plano_item_id, item_id ou ordem.", 400);
      }

      if(ctx && !CMMS110_checklistIdBelongsToExec_(itemPayload.checklist_execucao_id, ctx.execucao.id)){
        err_("CHECKLIST_EXECUTION_MISMATCH", "Item não pertence à execução atual: "+itemPayload.checklist_execucao_id, 400);
      }

      var saved = operadorSalvarChecklistItem_(itemPayload);
      saved.index = idx;
      saved.ui_key = itemPayload.checklist_execucao_id;
      salvos.push(saved);
    } catch(e){
      var er = CMMS109_normErr_(e);
      erros.push({
        index:idx,
        id:clean_(raw && raw.id),
        ordem:raw && raw.ordem !== undefined ? raw.ordem : "",
        plano_item_id:clean_(raw && raw.plano_item_id),
        checklist_execucao_id:clean_(itemPayload.checklist_execucao_id),
        code:er.code,
        message:er.message,
        status:er.status
      });
    }
  });

  var execucaoId = ctx && ctx.execucao ? ctx.execucao.id : "";
  var acaoId = ctx && ctx.acao ? ctx.acao.id : clean_(p.acao_id);
  if(!execucaoId && salvos.length){
    var first = find_("checklist_execucao", "id", salvos[0].checklist_execucao_id);
    if(first){ execucaoId = first.execucao_id; acaoId = first.acao_id; }
  }

  var validacao = execucaoId ? CMMS1083_validateChecklistExecution_(execucaoId) : null;
  var finalizacao = validacao ? CMMS110_compactFinalizacao_(validacao) : null;

  return {
    ok:erros.length === 0,
    version:FAB.VERSION,
    acao_id:acaoId,
    execucao_id:execucaoId,
    saved_count:salvos.length,
    error_count:erros.length,
    salvos:salvos,
    erros:erros,
    finalizacao:finalizacao,
    can_finalize:finalizacao ? finalizacao.can_finalize : false,
    message:erros.length ? "Lote salvo parcialmente. Corrija os itens com erro." : "Lote salvo com sucesso."
  };
}

function gestorAuditoriaExecucaoChecklist110_(p, usuario){
  var auth = usuario || p.__auth || {};
  if([ROLE.ADMIN, ROLE.GESTOR].indexOf(upper_(auth.perfil)) < 0){
    err_("FORBIDDEN", "Somente ADMIN ou GESTOR pode consultar auditoria de execução.", 403);
  }

  var base = gestorAuditoriaExecucaoChecklist1083_(p, auth);
  var ctx = CMMS1083_resolveExecucaoContext_(p);
  var validacao = CMMS1083_validateChecklistExecution_(ctx.ex.id);
  var finalizacao = CMMS110_compactFinalizacao_(validacao);
  var checklist = CMMS110_buildChecklistExecucao_(ctx.ex.id, finalizacao);
  var evidencias = rows_("evidencias").filter(function(e){ return String(e.execucao_id) === String(ctx.ex.id); }).map(strip_);
  var statusAcao = upper_(ctx.acao && ctx.acao.status);
  var integridadeOk = !!(base.auditoria && base.auditoria.integridade_ok);
  var canApprove = statusAcao === ST.AGUARDANDO_VALIDACAO && finalizacao.can_finalize && integridadeOk;
  var canReturn = statusAcao === ST.AGUARDANDO_VALIDACAO;

  return {
    ok:true,
    version:FAB.VERSION,
    perfil:auth.perfil || "",
    acao:ctx.acao ? CMMS109_cleanAcao_(ctx.acao) : base.acao,
    os:ctx.os ? CMMS109_cleanOs_(ctx.os) : base.os,
    ativo:ctx.ativo ? CMMS109_cleanAtivo_(ctx.ativo) : null,
    componente:ctx.componente ? CMMS109_cleanComponente_(ctx.componente) : null,
    execucao:CMMS109_cleanExecucao_(ctx.ex),
    checklist:checklist,
    evidencias:evidencias,
    finalizacao:finalizacao,
    auditoria:base.auditoria,
    decisao:{
      can_validate:canApprove || canReturn,
      can_approve:canApprove,
      can_return:canReturn,
      approve_action:"gestor.validar_acao",
      reject_action:"gestor.validar_acao",
      mensagem:canApprove ? "Execução apta para aprovação." : (canReturn ? "Execução pode ser devolvida/reprovada ou bloqueada por pendência." : "Ação fora do status de validação.")
    },
    historico:base.historico || []
  };
}

function CMMS110_buildActionCard_(acao, auth){
  var ex = latestExecucaoAcao1081_(acao.id);
  var ctx = CMMS109_actionContext_(acao);
  var finalizacao = null;

  if(ex){
    try{
      finalizacao = CMMS110_compactFinalizacao_(CMMS1083_validateChecklistExecution_(ex.id));
    } catch(e){
      finalizacao = {ok:false, can_finalize:false, error:CMMS109_normErr_(e)};
    }
  } else {
    var totalModelo = CMMS110_modelItemsForPlan_(acao.plano_id).length;
    finalizacao = {ok:true, can_finalize:false, total:totalModelo, respondidos:0, pending_count:totalModelo, evidence_missing_count:0, blockers_count:0, pendentes:[], evidencias_pendentes:[], bloqueios:[]};
  }

  var disponibilidade = typeof disponibilidadeAcao120_ === "function"
    ? disponibilidadeAcao120_(acao, ctx.os)
    : null;
  var ui = CMMS110_uiState_(acao, ex, auth, finalizacao, disponibilidade);

  return {
    acao:CMMS109_cleanAcao_(acao),
    os:ctx.os ? CMMS109_cleanOs_(ctx.os) : null,
    ativo:ctx.ativo ? CMMS109_cleanAtivo_(ctx.ativo) : null,
    componente:ctx.componente ? CMMS109_cleanComponente_(ctx.componente) : null,
    plano:ctx.plano ? CMMS109_cleanPlano_(ctx.plano) : null,
    execucao:ex ? CMMS109_cleanExecucao_(ex) : null,
    finalizacao:finalizacao,
    disponibilidade:disponibilidade,
    ui:ui,
    next_actions:CMMS110_nextActions_(ui)
  };
}

function CMMS110_technicalBrief_(acao, ctx, checklist){
  ctx = ctx || {};
  checklist = checklist || {itens:[]};
  var raw = clean_(
    acao && acao.analise_tecnica_json ||
    ctx.os && ctx.os.analise_tecnica_json ||
    ctx.plano && ctx.plano.analise_tecnica_json
  );
  var modelSteps = (checklist.itens || []).map(function(item, index){
    return {
      ordem:index + 1,
      titulo:clean_(item.titulo || "Etapa " + (index + 1)),
      descricao:clean_(item.instrucao || "Executar conforme o procedimento aprovado.")
    };
  }).filter(function(item){ return item.titulo && item.descricao; });
  var requiresLock = upper_(ctx.plano && ctx.plano.requer_bloqueio) === "SIM";
  var fallback = {
    situacao:clean_(acao && acao.descricao || ctx.os && ctx.os.descricao || acao && acao.titulo),
    causa_provavel:"A confirmar na inspeção inicial do equipamento.",
    resultado_esperado:"Concluir " + clean_(acao && acao.titulo || "a atividade") + " em condição segura e operacional.",
    riscos:[{
      tipo:upper_(acao && acao.prioridade || ctx.plano && ctx.plano.criticidade || "OPERACIONAL"),
      titulo:"Risco operacional",
      descricao:"Interromper a atividade se a condição encontrada exceder o escopo autorizado."
    }],
    seguranca:[
      "Confirmar autorização, identificação do ativo e condição segura da área.",
      requiresLock
        ? "Aplicar bloqueio e confirmar energia zero antes da intervenção."
        : "Isolar as fontes de energia aplicáveis antes de acessar a zona de risco.",
      "Registrar e comunicar qualquer desvio do escopo aprovado."
    ],
    nrs:["NR-12"],
    ferramentas:[],
    etapas:modelSteps,
    evidencias_requeridas:upper_(ctx.plano && ctx.plano.requer_evidencia) === "SIM"
      ? ["Condição encontrada", "Teste ou condição final"]
      : ["Registro da condição final"],
    criterio_aceite:"Serviço concluído, condição segura confirmada e evidências obrigatórias registradas."
  };
  if(typeof technicalNormalizeBrief_ === "function"){
    return technicalNormalizeBrief_(raw, fallback);
  }
  var parsed = {};
  if(raw){
    try{ parsed = JSON.parse(raw); } catch(e){ parsed = {}; }
  }
  return Object.assign({}, fallback, parsed, {
    etapas:Array.isArray(parsed.etapas) && parsed.etapas.length ? parsed.etapas : (modelSteps.length ? modelSteps : [
      {ordem:1, titulo:"Preparar e isolar", descricao:"Confirmar o equipamento, a autorização e as medidas de segurança."},
      {ordem:2, titulo:"Inspecionar", descricao:"Verificar a condição informada e registrar a evidência inicial."},
      {ordem:3, titulo:"Executar", descricao:"Realizar somente o serviço aprovado e comunicar qualquer desvio."},
      {ordem:4, titulo:"Testar e liberar", descricao:"Validar o resultado e registrar a condição operacional final."}
    ])
  });
}

function CMMS110_buildActionScreen_(acao, auth, ex){
  if(!acao) err_("ACTION_NOT_FOUND", "Ação não encontrada para montar tela.", 404);
  var ctx = CMMS109_actionContext_(acao);
  ex = ex || latestExecucaoAcao1081_(acao.id);

  var finalizacao = null;
  var checklist = null;

  if(ex){
    var validacao = CMMS1083_validateChecklistExecution_(ex.id);
    finalizacao = CMMS110_compactFinalizacao_(validacao);
    checklist = CMMS110_buildChecklistExecucao_(ex.id, finalizacao);
  } else {
    var itensModelo = CMMS110_modelItemsForPlan_(acao.plano_id).map(function(i){ return CMMS110_cleanModeloItem_(i); });
    finalizacao = {ok:true, can_finalize:false, total:itensModelo.length, respondidos:0, pending_count:itensModelo.filter(function(i){ return i.obrigatorio && i.tipo_resposta !== "INSTRUCAO"; }).length, evidence_missing_count:0, blockers_count:0, pendentes:[], evidencias_pendentes:[], bloqueios:[]};
    checklist = {modelo:true, execucao_id:"", total:itensModelo.length, respondidos:0, pending_count:finalizacao.pending_count, evidence_missing_count:0, blockers_count:0, itens:itensModelo};
  }

  var disponibilidade = typeof disponibilidadeAcao120_ === "function"
    ? disponibilidadeAcao120_(acao, ctx.os)
    : null;
  var ui = CMMS110_uiState_(acao, ex, auth, finalizacao, disponibilidade);
  var executor = ex && clean_(ex.operador_id)
    ? find_("usuarios", "id", ex.operador_id)
    : null;

  return {
    ok:true,
    version:FAB.VERSION,
    perfil:auth ? auth.perfil : "",
    acao:CMMS109_cleanAcao_(acao),
    os:ctx.os ? CMMS109_cleanOs_(ctx.os) : null,
    ativo:ctx.ativo ? CMMS109_cleanAtivo_(ctx.ativo) : null,
    componente:ctx.componente ? CMMS109_cleanComponente_(ctx.componente) : null,
    plano:ctx.plano ? CMMS109_cleanPlano_(ctx.plano) : null,
    execucao:ex ? CMMS109_cleanExecucao_(ex) : null,
    executor:executor ? {id:executor.id, nome:executor.nome, email:executor.email} : null,
    checklist:checklist,
    analise_tecnica:CMMS110_technicalBrief_(acao, ctx, checklist),
    finalizacao:finalizacao,
    disponibilidade:disponibilidade,
    ui:ui,
    next_actions:CMMS110_nextActions_(ui),
    contrato_lote:{
      endpoint:"operador.salvar_checklist_lote",
      aceita:["checklist_execucao_id", "id", "plano_item_id", "item_id", "ordem"],
      formato_minimo:"{ acao_id, itens:[{ ordem, resposta|valor, observacao }] }"
    }
  };
}

function CMMS110_buildChecklistExecucao_(execId, finalizacao){
  var itens = CMMS1083_itemsByExecucao_(execId).map(function(i){ return CMMS110_cleanChecklistItem_(i); });
  finalizacao = finalizacao || CMMS110_compactFinalizacao_(CMMS1083_validateChecklistExecution_(execId));
  return {
    modelo:false,
    execucao_id:execId,
    total:finalizacao.total,
    respondidos:finalizacao.respondidos,
    pending_count:finalizacao.pending_count,
    evidence_missing_count:finalizacao.evidence_missing_count,
    blockers_count:finalizacao.blockers_count,
    itens:itens
  };
}

function CMMS110_cleanChecklistItem_(i){
  var item = CMMS1083_cleanChecklistItem_(i);
  item.ui_key = item.id;
  item.input = CMMS110_inputSchema_(item);
  item.estado = {
    respondido:!!item.respondido,
    exige_resposta:item.input.requer_resposta,
    exige_valor:item.input.requer_valor,
    exige_evidencia:!!item.evidencia_obrigatoria,
    bloqueante:!!item.bloqueia_finalizacao,
    conforme:item.conforme || ""
  };
  item.save_hint = {
    checklist_execucao_id:item.id,
    ordem:item.ordem,
    plano_item_id:item.plano_item_id
  };
  return item;
}

function CMMS110_cleanModeloItem_(i){
  var item = CMMS109_cleanPlanoItem_(i);
  item.modelo_item_id = item.id;
  item.ui_key = "ordem:" + item.ordem;
  item.input = CMMS110_inputSchema_(item);
  item.estado = {respondido:false, exige_resposta:item.input.requer_resposta, exige_valor:item.input.requer_valor, exige_evidencia:!!item.evidencia_obrigatoria, bloqueante:!!item.bloqueia_finalizacao, conforme:""};
  item.save_hint = {ordem:item.ordem, plano_item_id:item.id};
  return item;
}

function CMMS110_inputSchema_(item){
  var tipo = upper_(item.tipo_resposta);
  var schema = {
    tipo_resposta:tipo,
    componente:"text",
    requer_resposta:!!item.obrigatorio,
    requer_valor:false,
    requer_opcoes:false,
    suporta_evidencia:true,
    placeholder:"",
    opcoes:item.opcoes || [],
    unidade:item.unidade || "",
    limite_min:item.limite_min,
    limite_max:item.limite_max
  };

  if(tipo === "INSTRUCAO"){
    schema.componente = "readonly";
    schema.requer_resposta = false;
    schema.suporta_evidencia = false;
    schema.placeholder = "Leitura/instrução operacional.";
  } else if(tipo === "CONFIRMACAO"){
    schema.componente = "confirmacao";
    schema.opcoes = ["SIM"];
    schema.placeholder = "Confirmar execução.";
  } else if(tipo === "OK_NOK"){
    schema.componente = "ok_nok";
    schema.opcoes = ["OK", "NOK", "NA"];
    schema.placeholder = "Selecione OK, NOK ou NA.";
  } else if(tipo === "NUMERO" || tipo === "PARAMETRO" || tipo === "LEITURA_OPERACIONAL"){
    schema.componente = "numero";
    schema.requer_valor = true;
    schema.placeholder = "Informe valor numérico" + (schema.unidade ? " em " + schema.unidade : "") + ".";
  } else if(tipo === "SELECAO"){
    schema.componente = "selecao";
    schema.requer_opcoes = true;
    schema.placeholder = "Selecione uma opção.";
  } else if(tipo === "EVIDENCIA"){
    schema.componente = "evidencia";
    schema.requer_resposta = false;
    schema.placeholder = "Anexe foto/documento.";
  } else if(tipo === "TEXTO"){
    schema.componente = "texto_longo";
    schema.placeholder = "Digite observação técnica.";
  }

  return schema;
}

function CMMS110_resolveBatchContext_(p, auth, rawItems){
  var execId = clean_(p.execucao_id);
  var acaoId = clean_(p.acao_id);

  if(!execId && !acaoId){
    var allDirect = rawItems.every(function(x){
      var cid = clean_(x && x.checklist_execucao_id);
      var id = clean_(x && (x.id || x.item_id));
      return !!cid || id.indexOf("CHK-") === 0;
    });
    if(allDirect) return null;
    err_("ACTION_OR_EXECUTION_REQUIRED", "Para salvar por ordem/plano_item_id informe acao_id ou execucao_id.", 400);
  }

  var ex = null;
  var acao = null;
  if(execId){
    ex = find_("execucoes", "id", execId);
    if(!ex) err_("EXECUTION_NOT_FOUND", "Execução não encontrada: "+execId, 404);
    acao = ex.acao_id ? find_("os_acoes", "id", ex.acao_id) : null;
  } else {
    acao = find_("os_acoes", "id", acaoId);
    if(!acao) err_("ACTION_NOT_FOUND", "Ação não encontrada: "+acaoId, 404);
    ex = latestExecucaoAcao1081_(acao.id);
    if(!ex){
      err_("ACTION_NOT_STARTED", "Inicie a ação antes de salvar checklist em lote. Use operador.iniciar_acao para gerar execução e itens CHK.", 400);
    }
  }

  requireExecucaoDoOperador1081_(ex, auth);
  var itens = CMMS1083_itemsByExecucao_(ex.id);
  if(!itens.length) err_("CHECKLIST_VAZIO", "Execução não possui checklist operacional gerado.", 400);
  return {acao:acao, execucao:ex, itens:itens};
}

function CMMS110_buildChecklistMaps_(itens){
  var maps = {byId:{}, byOrdem:{}, byPlanoItemId:{}, byTitulo:{}};
  (itens || []).forEach(function(i){
    var id = clean_(i.id);
    var ordem = String(num_(i.ordem, 0));
    var planoItemId = clean_(i.plano_item_id);
    var titulo = slug_(i.titulo || "");
    if(id) maps.byId[id] = i;
    if(ordem !== "0") maps.byOrdem[ordem] = i;
    if(planoItemId) maps.byPlanoItemId[planoItemId] = i;
    if(titulo) maps.byTitulo[titulo] = i;
  });
  return maps;
}

function CMMS110_resolveChecklistExecucaoId_(raw, maps){
  if(!maps) return clean_(raw.checklist_execucao_id || raw.id || raw.item_id);
  var direct = clean_(raw.checklist_execucao_id || "");
  if(direct && maps.byId[direct]) return direct;

  var id = clean_(raw.id || raw.item_id || "");
  if(id && maps.byId[id]) return id;
  if(id && maps.byPlanoItemId[id]) return maps.byPlanoItemId[id].id;

  var pit = clean_(raw.plano_item_id || raw.modelo_item_id || "");
  if(pit && maps.byPlanoItemId[pit]) return maps.byPlanoItemId[pit].id;

  var ordem = raw.ordem !== undefined && raw.ordem !== null ? String(num_(raw.ordem, 0)) : "";
  if(ordem && maps.byOrdem[ordem]) return maps.byOrdem[ordem].id;

  var titulo = slug_(raw.titulo || raw.nome || "");
  if(titulo && maps.byTitulo[titulo]) return maps.byTitulo[titulo].id;

  return direct || id;
}

function CMMS110_checklistIdBelongsToExec_(checklistId, execId){
  var item = find_("checklist_execucao", "id", checklistId);
  return !!(item && String(item.execucao_id) === String(execId));
}

function CMMS110_modelItemsForPlan_(planoId){
  return rows_("plano_itens").filter(function(i){
    return String(i.plano_id) === String(planoId) && upper_(i.status || ST.ATIVO) === ST.ATIVO;
  }).sort(function(a,b){ return num_(a.ordem,0)-num_(b.ordem,0); });
}

function CMMS110_compactFinalizacao_(validacao){
  validacao = validacao || {};
  var finalizacao = validacao.finalizacao || validacao;
  var pendentes = finalizacao.pendentes || validacao.pendentes || [];
  var evidencias = finalizacao.evidencias_pendentes || validacao.evidencias_pendentes || [];
  var bloqueios = finalizacao.bloqueios || validacao.bloqueios || [];
  return {
    ok:validacao.ok !== false,
    can_finalize:!!(validacao.can_finalize || finalizacao.can_finalize),
    total:num_(validacao.total || finalizacao.total, 0),
    respondidos:num_(validacao.respondidos || finalizacao.respondidos, 0),
    pending_count:pendentes.length,
    evidence_missing_count:evidencias.length,
    blockers_count:bloqueios.length,
    pendentes:pendentes,
    evidencias_pendentes:evidencias,
    bloqueios:bloqueios
  };
}

function CMMS110_uiState_(acao, ex, auth, finalizacao, disponibilidade){
  var st = upper_(acao && acao.status);
  var perfil = upper_(auth && auth.perfil);
  var userId = clean_(auth && auth.usuario_id);
  var dono = ex ? clean_(ex.operador_id) : clean_(acao && acao.responsavel_id);
  var own = !dono || String(dono) === String(userId);
  var canFinalize = !!(finalizacao && finalizacao.can_finalize);

  var base = {state:st || "INDEFINIDO", can_start:false, can_answer:false, can_save_batch:false, can_finalize:false, can_register_evidence:false, can_validate:false, message:""};

  if(!own && perfil === ROLE.OPERADOR){
    base.state = "BLOQUEADA_POR_OUTRO_OPERADOR";
    base.message = "Ação vinculada a outro operador.";
    return base;
  }

  if(st === ST.PENDENTE && !ex){
    disponibilidade = disponibilidade || (typeof disponibilidadeAcao120_ === "function"
      ? disponibilidadeAcao120_(acao)
      : {pode_iniciar:true, estado:"SEM_AGENDAMENTO", mensagem:"Ação pendente."});
    base.state = disponibilidade.pode_iniciar ? "AGUARDANDO_INICIO" : disponibilidade.estado;
    base.can_start = perfil === ROLE.OPERADOR && disponibilidade.pode_iniciar;
    base.message = disponibilidade.pode_iniciar
      ? "Ação pendente e disponível para início."
      : disponibilidade.mensagem;
    return base;
  }

  if(st === ST.EM_EXECUCAO && ex){
    base.state = ST.EM_EXECUCAO;
    base.can_answer = perfil === ROLE.OPERADOR;
    base.can_save_batch = perfil === ROLE.OPERADOR;
    base.can_register_evidence = perfil === ROLE.OPERADOR;
    base.can_finalize = perfil === ROLE.OPERADOR && canFinalize;
    base.message = canFinalize ? "Checklist completo. Finalização liberada." : "Checklist em execução. Existem pendências, evidências ou bloqueios.";
    return base;
  }

  if(st === ST.AGUARDANDO_VALIDACAO){
    base.state = ST.AGUARDANDO_VALIDACAO;
    base.can_validate = perfil === ROLE.GESTOR || perfil === ROLE.ADMIN;
    base.message = "Execução finalizada. Aguardando validação da gestão.";
    return base;
  }

  if(st === ST.CONCLUIDA){
    base.state = ST.CONCLUIDA;
    base.message = "Ação concluída.";
    return base;
  }

  if(st === ST.BLOQUEADA){
    base.state = ST.BLOQUEADA;
    base.message = "Ação bloqueada por resultado ou não conformidade.";
    return base;
  }

  base.message = "Status operacional não editável: " + st;
  return base;
}

function CMMS110_nextActions_(ui){
  var out = [];
  if(ui.can_start) out.push("operador.iniciar_acao");
  if(ui.can_save_batch) out.push("operador.salvar_checklist_lote");
  if(ui.can_register_evidence) out.push("operador.registrar_evidencia");
  if(ui.can_finalize) out.push("operador.finalizar_acao");
  if(ui.can_validate) out.push("gestor.auditoria_execucao_checklist", "gestor.validar_acao");
  return out;
}

function CMMS110_prioridadePeso_(p){
  if(typeof CMMS109_prioridadePeso_ === "function") return CMMS109_prioridadePeso_(p);
  p = upper_(p);
  if(p === "CRITICA") return 4;
  if(p === "ALTA") return 3;
  if(p === "MEDIA") return 2;
  if(p === "BAIXA") return 1;
  return 0;
}
