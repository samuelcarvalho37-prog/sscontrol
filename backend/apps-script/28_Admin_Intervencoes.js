/**
 * Intervenções administrativas protegidas pelo filtro técnico.
 * O rascunho não cria os_acoes; o Operador só recebe a ação após decisão do Gestor.
 */

const ADMIN_INTERVENTION_DRAFT = "RASCUNHO";
const ADMIN_INTERVENTION_WAITING = "AGUARDANDO_VALIDACAO";
const ADMIN_INTERVENTION_RETURNED = "DEVOLVIDA_ADMIN";
const ADMIN_INTERVENTION_TYPES = ["CORRETIVA","PREVENTIVA","PREDITIVA","INSPECAO","QUALIDADE","SEGURANCA"];
const ADMIN_INTERVENTION_PRIORITIES = ["BAIXA","MEDIA","ALTA","CRITICA"];

function adminIntervencaoEnsureSchema_(){
  ensureSheet_(getSpreadsheet_(), "ordens_servico", SH.ordens_servico);
}

function adminIntervencaoRequireExecutablePlan_(planId, assetId, componentId){
  planId = clean_(planId);
  if(!planId){
    err_("INTERVENTION_CHECKLIST_REQUIRED", "Vincule um checklist validado antes de enviar ou liberar a intervenção.", 409);
  }
  var plan = find_("planos_manutencao", "id", planId);
  if(!plan) err_("INTERVENTION_CHECKLIST_NOT_FOUND", "Checklist vinculado não encontrado: "+planId, 404);
  if(String(plan.ativo_id) !== String(assetId)){
    err_("INTERVENTION_CHECKLIST_ASSET_MISMATCH", "O checklist selecionado pertence a outro equipamento.", 409);
  }
  var planComponentId = clean_(plan.componente_id);
  var interventionComponentId = clean_(componentId);
  if(planComponentId && String(planComponentId) !== String(interventionComponentId)){
    err_("INTERVENTION_CHECKLIST_COMPONENT_MISMATCH", "O checklist selecionado pertence a outro componente.", 409);
  }
  if(!isPlanoOperacional_(plan)){
    err_("INTERVENTION_CHECKLIST_NOT_VALIDATED", "O checklist precisa estar validado e ativo antes da liberação.", 409);
  }
  var items = rows_("plano_itens", true).filter(function(item){
    return String(item.plano_id) === String(plan.id) &&
      upper_(item.status || ST.ATIVO) === ST.ATIVO;
  });
  if(!items.length){
    err_("INTERVENTION_CHECKLIST_EMPTY", "O checklist vinculado não possui etapas executáveis.", 409);
  }
  return {plan:plan, items:items};
}

function adminIntervencaoAssertEditable_(order){
  if(!order) return true;
  if(upper_(order.origem) !== "ADMIN"){
    err_("ADMIN_INTERVENTION_ORIGIN_PROTECTED", "Somente intervenções criadas pelo Admin podem ser editadas neste módulo.", 409);
  }
  if([ADMIN_INTERVENTION_DRAFT, ADMIN_INTERVENTION_RETURNED].indexOf(upper_(order.status)) < 0){
    err_("ADMIN_INTERVENTION_LOCKED", "A intervenção em validação ou liberada não pode ser alterada.", 409);
  }
  return true;
}

function adminIntervencaoNormalize_(input, auth, old){
  var data = Object.assign({}, input || {});
  req_(data, ["ativo_id","plano_id","titulo","descricao","tipo","prioridade"]);
  var asset = find_("ativos", "id", data.ativo_id);
  if(!asset) err_("ASSET_NOT_FOUND", "Ativo não encontrado: "+data.ativo_id, 404);
  if(upper_(asset.status) === ST.INATIVO) err_("ASSET_INACTIVE", "Reative o equipamento antes de criar uma nova intervenção.", 409);
  if(data.componente_id){
    var component = find_("componentes", "id", data.componente_id);
    if(!component || String(component.ativo_id) !== String(asset.id)){
      err_("COMPONENT_ASSET_MISMATCH", "O componente não pertence ao ativo selecionado.", 400);
    }
    if(upper_(component.status) === ST.INATIVO) err_("COMPONENT_INACTIVE", "Reative o componente antes de vinculá-lo à intervenção.", 409);
  }
  var type = upper_(data.tipo);
  if(ADMIN_INTERVENTION_TYPES.indexOf(type) < 0) err_("INTERVENTION_TYPE_INVALID", "Tipo de intervenção inválido.", 400);
  var priority = upper_(data.prioridade);
  if(ADMIN_INTERVENTION_PRIORITIES.indexOf(priority) < 0) err_("INTERVENTION_PRIORITY_INVALID", "Prioridade inválida.", 400);
  if(clean_(data.titulo).length < 3) err_("INTERVENTION_TITLE_REQUIRED", "Informe um título objetivo.", 400);
  if(clean_(data.descricao).length < 5) err_("INTERVENTION_DESCRIPTION_REQUIRED", "Descreva o serviço que precisa ser executado.", 400);
  var executablePlan = adminIntervencaoRequireExecutablePlan_(
    data.plano_id,
    asset.id,
    data.componente_id
  );
  var id = old ? old.id : uuid_("OS");
  return fit_("ordens_servico", Object.assign({}, old || {}, {
    id:id,
    codigo:old ? old.codigo : "OS-ADM-"+Utilities.formatDate(new Date(), FAB.TZ, "yyyyMMdd-HHmmss"),
    ativo_id:asset.id,
    componente_id:clean_(data.componente_id),
    plano_id:executablePlan.plan.id,
    origem:"ADMIN",
    tipo:type,
    titulo:clean_(data.titulo),
    descricao:clean_(data.descricao),
    prioridade:priority,
    status:ADMIN_INTERVENTION_DRAFT,
    solicitante_id:old ? old.solicitante_id : auth.usuario_id,
    responsavel_id:"",
    aberta_em:"",
    planejada_para:clean_(data.planejada_para),
    iniciada_em:"",
    finalizada_em:"",
    criado_em:old ? old.criado_em : now_(),
    atualizado_em:now_(),
    modo_parada_manutencao:normalizaModoParadaManutencao115_(data.modo_parada_manutencao),
    analise_tecnica_json:clean_(data.analise_tecnica_json || (old && old.analise_tecnica_json))
  }));
}

function adminIntervencoesListar_(p, auth){
  adminRequireIdentityAdmin_(auth);
  adminIntervencaoEnsureSchema_();
  var status = upper_(p.status);
  var assetId = clean_(p.ativo_id);
  var demands = rows_("demandas_tecnicas", true).filter(function(item){
    return upper_(item.entidade_tipo) === "ORDEM_SERVICO_RASCUNHO";
  }).sort(sortByDateDesc_("criado_em"));
  var assets = {};
  rows_("ativos", true).forEach(function(item){ assets[String(item.id)] = item; });
  var components = {};
  rows_("componentes", true).forEach(function(item){ components[String(item.id)] = item; });
  var plans = {};
  rows_("planos_manutencao", true).forEach(function(item){ plans[String(item.id)] = item; });
  var planItemCounts = {};
  rows_("plano_itens", true).forEach(function(item){
    if(upper_(item.status || ST.ATIVO) !== ST.ATIVO) return;
    var planId = String(item.plano_id || "");
    planItemCounts[planId] = (planItemCounts[planId] || 0) + 1;
  });
  var actionsByOrder = {};
  rows_("os_acoes", true).forEach(function(item){
    var orderId = clean_(item.os_id);
    if(!orderId || actionsByOrder[orderId]) return;
    actionsByOrder[orderId] = item;
  });
  var orders = rows_("ordens_servico", true).filter(function(order){
    if(upper_(order.origem) !== "ADMIN") return false;
    if(status && upper_(order.status) !== status) return false;
    return !assetId || String(order.ativo_id) === String(assetId);
  }).sort(sortByDateDesc_("atualizado_em")).slice(0, Math.min(num_(p.limite, 300), 500)).map(function(order){
    var out = strip_(order);
    var asset = assets[String(order.ativo_id)];
    var component = components[String(order.componente_id)];
    var plan = plans[String(order.plano_id)];
    var demand = demands.find(function(item){ return String(item.entidade_id) === String(order.id); });
    out.ativo_tag = clean_(asset && asset.tag);
    out.ativo_nome = clean_(asset && asset.nome);
    out.componente_tag = clean_(component && component.tag);
    out.componente_nome = clean_(component && component.nome);
    out.plano_nome = clean_(plan && plan.nome);
    out.plano_revisao = num_(plan && plan.revisao, 1);
    out.plano_itens_count = planItemCounts[String(order.plano_id)] || 0;
    out.acao_id = clean_(actionsByOrder[String(order.id)] && actionsByOrder[String(order.id)].id);
    out.acao_status = clean_(actionsByOrder[String(order.id)] && actionsByOrder[String(order.id)].status);
    out.demanda = demand ? technicalDemandPublic_(demand) : null;
    return out;
  });
  return {total:orders.length, intervencoes:orders};
}

function adminIntervencaoSalvar_(p, auth){
  adminRequireIdentityAdmin_(auth);
  adminIntervencaoEnsureSchema_();
  var data = Object.assign({}, p.dados || p.intervencao || {});
  var old = data.id ? find_("ordens_servico", "id", data.id) : null;
  if(data.id && !old) err_("INTERVENTION_NOT_FOUND", "Intervenção não encontrada.", 404);
  adminIntervencaoAssertEditable_(old);
  var normalized = adminIntervencaoNormalize_(data, auth, old);
  var before = old ? strip_(old) : null;
  var lock = LockService.getScriptLock();
  if(!lock.tryLock(10000)) err_("ADMIN_WRITE_BUSY", "Outra alteração administrativa está em andamento.", 409);
  try{
    if(old) update_("ordens_servico", old.__rowIndex, normalized); else append_("ordens_servico", normalized);
    audit_(auth, old ? "ADMIN_INTERVENTION_UPDATED" : "ADMIN_INTERVENTION_CREATED", "ordens_servico", normalized.id, before, normalized, clean_(p.user_agent));
    return {saved:true, mode:old ? "update" : "insert", intervencao:strip_(normalized)};
  } finally {
    lock.releaseLock();
  }
}

function adminIntervencaoEnviarValidacao_(p, auth){
  adminRequireIdentityAdmin_(auth);
  technicalEnsureSchema_();
  req_(p, ["intervencao_id"]);
  var lock = LockService.getScriptLock();
  if(!lock.tryLock(10000)) err_("ADMIN_WRITE_BUSY", "Outra alteração administrativa está em andamento.", 409);
  try{
    var order = find_("ordens_servico", "id", p.intervencao_id);
    if(!order) err_("INTERVENTION_NOT_FOUND", "Intervenção não encontrada.", 404);
    adminIntervencaoAssertEditable_(order);
    adminIntervencaoRequireExecutablePlan_(order.plano_id, order.ativo_id, order.componente_id);
    var openDemand = rows_("demandas_tecnicas", true).find(function(item){
      return upper_(item.entidade_tipo) === "ORDEM_SERVICO_RASCUNHO" &&
        String(item.entidade_id) === String(order.id) &&
        TECH_FINAL_STATUSES.indexOf(upper_(item.status)) < 0;
    });
    if(openDemand) err_("INTERVENTION_VALIDATION_EXISTS", "A intervenção já possui validação técnica aberta.", 409);
    var previousStatus = order.status;
    var before = strip_(order);
    update_("ordens_servico", order.__rowIndex, {status:ADMIN_INTERVENTION_WAITING, atualizado_em:now_()});
    try{
      var sent = adminDemandasTecnicasEnviar_({
        demanda:{
          tipo:"VALIDACAO_ORDEM_SERVICO",
          entidade_tipo:"ORDEM_SERVICO_RASCUNHO",
          entidade_id:order.id,
          titulo:"Validar intervenção: "+clean_(order.titulo),
          descricao:clean_(p.comentario || order.descricao),
          prioridade:upper_(order.prioridade || "MEDIA"),
          area_atual_id:clean_(p.area_atual_id),
          cargo_atual_id:clean_(p.cargo_atual_id),
          responsavel_atual_id:clean_(p.responsavel_atual_id),
          politica_assinatura:clean_(p.politica_assinatura),
          areas_validadoras:p.areas_validadoras,
          usuarios_validadores:p.usuarios_validadores,
          exige_assinatura:"SIM",
          assinaturas_necessarias:p.assinaturas_necessarias,
          exige_segregacao:p.exige_segregacao,
          versao_entidade:clean_(order.atualizado_em || "1")
        },
        __auth:auth,
        user_agent:p.user_agent
      }, auth);
      audit_(auth, "ADMIN_INTERVENTION_SENT", "ordens_servico", order.id, before, Object.assign({}, before, {status:ADMIN_INTERVENTION_WAITING}), clean_(p.user_agent));
      return {sent:true, intervencao_id:order.id, status:ADMIN_INTERVENTION_WAITING, demanda:sent.demanda};
    } catch(error){
      update_("ordens_servico", order.__rowIndex, {status:previousStatus, atualizado_em:now_()});
      throw error;
    }
  } finally {
    lock.releaseLock();
  }
}

function adminIntervencaoCriarDaOcorrenciaAprovada_(plan, demand, identity){
  var occurrenceId = clean_(plan && plan.ocorrencia_origem_id);
  if(!occurrenceId) return null;
  var occurrence = find_("ocorrencias_operacionais", "id", occurrenceId);
  if(!occurrence) return null;

  var existingOrder = rows_("ordens_servico", true).find(function(order){
    if(String(order.plano_id) !== String(plan.id)) return false;
    var action = rows_("os_acoes", true).find(function(item){
      return String(item.os_id) === String(order.id);
    });
    return !!action || ["RASCUNHO","AGUARDANDO_VALIDACAO","ABERTA"].indexOf(upper_(order.status)) >= 0;
  });
  if(existingOrder){
    var existingAction = rows_("os_acoes", true).find(function(item){
      return String(item.os_id) === String(existingOrder.id);
    }) || null;
    update_("ocorrencias_operacionais", occurrence.__rowIndex, {
      status:existingAction ? "LIBERADA_OPERACAO" : "EM_VALIDACAO_TECNICA",
      os_id:existingOrder.id,
      acao_id:existingAction ? existingAction.id : clean_(occurrence.acao_id),
      tratamento_status:existingAction ? "LIBERADA_OPERACAO" : "AGUARDANDO_ASSINATURA",
      atualizado_em:now_()
    });
    return {order:existingOrder, action:existingAction, already_created:true};
  }

  var order = fit_("ordens_servico", {
    id:uuid_("OS"),
    codigo:"OS-TRAT-"+Utilities.formatDate(new Date(), FAB.TZ, "yyyyMMdd-HHmmss"),
    ativo_id:plan.ativo_id,
    componente_id:clean_(plan.componente_id),
    plano_id:plan.id,
    origem:"ADMIN",
    tipo:upper_(plan.tipo || occurrence.tipo || "CORRETIVA"),
    titulo:clean_(plan.nome || occurrence.titulo),
    descricao:clean_(occurrence.descricao || plan.nome),
    prioridade:upper_(occurrence.severidade || plan.criticidade || "MEDIA"),
    status:ADMIN_INTERVENTION_WAITING,
    solicitante_id:clean_(demand.criado_por),
    responsavel_id:"",
    aberta_em:"",
    planejada_para:"",
    iniciada_em:"",
    finalizada_em:"",
    criado_em:now_(),
    atualizado_em:now_(),
    modo_parada_manutencao:normalizaModoParadaManutencao115_(plan.modo_parada_manutencao),
    analise_tecnica_json:clean_(plan.analise_tecnica_json)
  });
  append_("ordens_servico", order);
  var syntheticDemand = Object.assign({}, demand, {
    entidade_tipo:"ORDEM_SERVICO_RASCUNHO",
    entidade_id:order.id
  });
  var action = adminIntervencaoLiberarOperacao_(syntheticDemand, identity);
  update_("ocorrencias_operacionais", occurrence.__rowIndex, {
    status:"LIBERADA_OPERACAO",
    demanda_tecnica_id:demand.id,
    os_id:order.id,
    acao_id:action.id,
    tratamento_status:"LIBERADA_OPERACAO",
    atualizado_em:now_()
  });
  hist_({
    ativo_id:order.ativo_id,
    componente_id:order.componente_id,
    os_id:order.id,
    acao_id:action.id,
    evento:"OCORRENCIA_CONVERTIDA_EM_INTERVENCAO",
    descricao:"Checklist aprovado e liberado ao Operador após validação técnica.",
    usuario_id:identity.usuario_id || "",
    perfil:identity.perfil || ROLE.GESTOR
  });
  return {order:order, action:action, already_created:false};
}

function adminIntervencaoLiberarOperacao_(demand, identity){
  var order = find_("ordens_servico", "id", demand.entidade_id);
  if(!order) err_("INTERVENTION_NOT_FOUND", "A intervenção vinculada à demanda não existe.", 404);
  var executablePlan = adminIntervencaoRequireExecutablePlan_(
    order.plano_id,
    order.ativo_id,
    order.componente_id
  );
  var existing = rows_("os_acoes", true).find(function(action){
    return String(action.os_id) === String(order.id) && upper_(action.origem) === "ADMIN_APROVADA";
  });
  if(existing){
    if(String(existing.plano_id) !== String(executablePlan.plan.id)){
      err_("INTERVENTION_ACTION_CHECKLIST_MISMATCH", "A ação existente não corresponde ao checklist validado da intervenção.", 409);
    }
    if(upper_(order.status) !== ST.ABERTA) update_("ordens_servico", order.__rowIndex, {status:ST.ABERTA, atualizado_em:now_()});
    return existing;
  }
  if(upper_(order.status) !== ADMIN_INTERVENTION_WAITING){
    err_("INTERVENTION_NOT_WAITING", "A intervenção não está aguardando validação.", 409);
  }
  var action = fit_("os_acoes", {
    id:uuid_("ACT"), os_id:order.id, ativo_id:order.ativo_id, componente_id:order.componente_id,
    plano_id:executablePlan.plan.id, origem:"ADMIN_APROVADA", tipo:order.tipo, titulo:order.titulo,
    descricao:order.descricao, prioridade:order.prioridade,
    status:ST.PENDENTE, responsavel_id:"", gerado_em:now_(), iniciado_em:"", finalizado_em:"",
    atualizado_em:now_(), modo_parada_manutencao:normalizaModoParadaManutencao115_(order.modo_parada_manutencao),
    analise_tecnica_json:clean_(order.analise_tecnica_json)
  });
  append_("os_acoes", action);
  update_("ordens_servico", order.__rowIndex, {status:ST.ABERTA, aberta_em:now_(), atualizado_em:now_()});
  hist_({
    ativo_id:order.ativo_id, componente_id:order.componente_id, os_id:order.id, acao_id:action.id,
    evento:"INTERVENCAO_ADMIN_LIBERADA", descricao:"Intervenção liberada pelo filtro técnico.",
    usuario_id:identity.usuario_id || "", perfil:identity.perfil || ROLE.GESTOR
  });
  technicalNotify_({perfil:ROLE.OPERADOR}, "NOVA_INTERVENCAO", order.titulo, "Nova intervenção técnica liberada para execução.", "os_acoes", action.id, order.prioridade);
  return action;
}

function adminIntervencaoQuarentenarAcoesInvalidas_(auth){
  var checked = 0;
  var quarantined = 0;
  var manualReview = 0;
  var actionIds = [];
  rows_("os_acoes", true).forEach(function(action){
    if(upper_(action.origem) !== "ADMIN_APROVADA" || upper_(action.status) !== ST.PENDENTE) return;
    checked++;
    var plan = clean_(action.plano_id) ? find_("planos_manutencao", "id", action.plano_id) : null;
    var hasItems = plan && rows_("plano_itens", true).some(function(item){
      return String(item.plano_id) === String(plan.id) &&
        upper_(item.status || ST.ATIVO) === ST.ATIVO;
    });
    if(plan && isPlanoOperacional_(plan) && hasItems) return;
    var hasExecution = rows_("execucoes", true).some(function(execution){
      return String(execution.acao_id) === String(action.id);
    });
    if(hasExecution){
      manualReview++;
      return;
    }
    var before = strip_(action);
    update_("os_acoes", action.__rowIndex, {
      status:ST.CANCELADA,
      atualizado_em:now_()
    });
    var order = action.os_id ? find_("ordens_servico", "id", action.os_id) : null;
    if(order && upper_(order.origem) === "ADMIN"){
      update_("ordens_servico", order.__rowIndex, {
        status:ADMIN_INTERVENTION_RETURNED,
        atualizado_em:now_()
      });
    }
    hist_({
      ativo_id:action.ativo_id,
      componente_id:action.componente_id,
      os_id:action.os_id,
      acao_id:action.id,
      evento:"ACAO_SEM_CHECKLIST_QUARENTENA",
      descricao:"Ação removida da fila operacional por ausência de checklist validado.",
      usuario_id:auth.usuario_id || "",
      perfil:auth.perfil || ROLE.ADMIN
    });
    audit_(
      auth,
      "ADMIN_INTERVENTION_ACTION_QUARANTINED",
      "os_acoes",
      action.id,
      before,
      Object.assign({}, before, {status:ST.CANCELADA}),
      ""
    );
    quarantined++;
    actionIds.push(action.id);
  });
  return {
    checked:checked,
    quarantined:quarantined,
    manual_review:manualReview,
    action_ids:actionIds
  };
}

function adminIntervencaoDevolver_(demand, identity){
  var order = find_("ordens_servico", "id", demand.entidade_id);
  if(!order) return null;
  if(upper_(order.status) === ADMIN_INTERVENTION_WAITING){
    update_("ordens_servico", order.__rowIndex, {status:ADMIN_INTERVENTION_RETURNED, atualizado_em:now_()});
    hist_({
      ativo_id:order.ativo_id, componente_id:order.componente_id, os_id:order.id,
      evento:"INTERVENCAO_ADMIN_DEVOLVIDA", descricao:"Intervenção devolvida para correção pelo filtro técnico.",
      usuario_id:identity.usuario_id || "", perfil:identity.perfil || ROLE.GESTOR
    });
  }
  return order;
}
