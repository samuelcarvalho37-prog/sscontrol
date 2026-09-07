/**
 * FAB Control 1.1.1
 * Contrato de frontend para operação e gestão.
 *
 * Este pacote não altera o motor operacional validado em 1.1.0.
 * Ele normaliza retorno para UI real: cards, tela única, ações permitidas,
 * progresso, bloqueios legíveis e decisão de gestor.
 */

function cmmsContratoFrontendSchemaUpgrade111_(p, usuario){
  var auth = usuario || p.__auth || {};
  if(upper_(auth.perfil) !== ROLE.ADMIN){
    err_("FORBIDDEN", "Somente ADMIN pode executar upgrade do contrato frontend 1.1.1.", 403);
  }

  var ss = getSpreadsheet_();
  Object.keys(SH).forEach(function(name){ ensureSheet_(ss, name, SH[name]); });

  syncReleaseVersionConfig_();

  upsert_("config", "chave", {
    chave:"ui.frontend.contract.version",
    valor:FAB.CONTRACT_VERSION,
    descricao:"Contrato de UI: cards, tela de ação, progresso, bloqueios e decisão de gestor normalizados.",
    atualizado_em:now_()
  });

  upsert_("config", "chave", {
    chave:"ui.frontend.contract.rule",
    valor:"Frontend não manipula regra interna; backend entrega ui_actions, ui_badges, ui_progress e ui_blockers.",
    descricao:"Regra de integração frontend/backend",
    atualizado_em:now_()
  });

  invalidateRuntimeCache_();

  return {
    upgraded:true,
    version:FAB.VERSION,
    contract_version:FAB.CONTRACT_VERSION,
    sheets:Object.keys(SH).length,
    regra:"Contrato de UI consolidado. Tela consome cards, actions, badges, progress e blockers sem conhecer regra interna.",
    endpoints:[
      "operador.minhas_acoes",
      "operador.tela_acao",
      "operador.salvar_checklist_lote",
      "operador.detalhar_checklist_execucao",
      "operador.validar_finalizacao_acao",
      "gestor.auditoria_execucao_checklist",
      "gestor.validar_acao"
    ]
  };
}

function operadorMinhasAcoes111_(p, usuario){
  var base = operadorMinhasAcoes110_(p, usuario || p.__auth || {});
  var cards = (base.acoes || []).map(function(item){
    return CMMS111_actionCard_(item);
  });

  return {
    ok:true,
    version:FAB.VERSION,
    contract_version:FAB.CONTRACT_VERSION,
    operador_id:base.operador_id,
    filtro:base.filtro,
    resumo:base.resumo,
    total:cards.length,
    cards:cards,
    acoes:cards,
    ui_collection:{
      type:"action_queue",
      empty_message:"Nenhuma ação operacional encontrada para o filtro informado.",
      refresh_hint_seconds:30,
      default_sort:"prioridade_desc_gerado_em_asc"
    }
  };
}

function operadorTelaAcao111_(p, usuario){
  var base = operadorTelaAcao110_(p, usuario || p.__auth || {});
  return CMMS111_actionScreen_(base, usuario || p.__auth || {});
}

function operadorDetalharChecklistExecucao111_(p, usuario){
  var base = operadorDetalharChecklistExecucao110_(p, usuario || p.__auth || {});
  return CMMS111_actionScreen_(base, usuario || p.__auth || {});
}

function operadorSalvarChecklistLote111_(p, usuario){
  var base = operadorSalvarChecklistLote110_(p, usuario || p.__auth || {});
  var progress = CMMS111_progressFromFinalizacao_(base.finalizacao);
  var blockers = CMMS111_blockersFromFinalizacao_(base.finalizacao);
  var saved = (base.salvos || []).map(function(s){ return CMMS111_savedItem_(s); });
  var errors = (base.erros || []).map(function(e){ return CMMS111_errorItem_(e); });

  return Object.assign({}, base, {
    version:FAB.VERSION,
    contract_version:FAB.CONTRACT_VERSION,
    salvos:saved,
    erros:errors,
    ui_result:{
      status:base.ok ? "OK" : "PARCIAL",
      saved_count:base.saved_count || 0,
      error_count:base.error_count || 0,
      progress:progress,
      blockers:blockers,
      can_finalize:!!base.can_finalize,
      message:base.ok ? "Respostas salvas." : "Alguns itens não foram salvos. Corrija os itens indicados.",
      next_actions:CMMS111_nextAfterSave_(base)
    }
  });
}

function operadorValidarFinalizacaoAcao111_(p, usuario){
  var base = operadorValidarFinalizacaoAcao110_(p, usuario || p.__auth || {});
  var progress = CMMS111_progressFromFinalizacao_(base.finalizacao);
  var blockers = CMMS111_blockersFromFinalizacao_(base.finalizacao);
  return Object.assign({}, base, {
    version:FAB.VERSION,
    contract_version:FAB.CONTRACT_VERSION,
    ui_validation:{
      can_finalize:!!base.can_finalize,
      progress:progress,
      blockers:blockers,
      primary_action:base.can_finalize ? "operador.finalizar_acao" : "operador.salvar_checklist_lote",
      message:base.can_finalize ? "Checklist completo. Finalização liberada." : "Checklist ainda possui pendências."
    }
  });
}

function gestorAuditoriaExecucaoChecklist111_(p, usuario){
  var base = gestorAuditoriaExecucaoChecklist110_(p, usuario || p.__auth || {});
  var progress = CMMS111_progressFromFinalizacao_(base.finalizacao);
  var blockers = CMMS111_blockersFromFinalizacao_(base.finalizacao);
  var decision = CMMS111_decisionContract_(base);

  return Object.assign({}, base, {
    version:FAB.VERSION,
    contract_version:FAB.CONTRACT_VERSION,
    approval_screen:{
      header:CMMS111_headerFromBase_(base),
      progress:progress,
      blockers:blockers,
      checklist:CMMS111_checklistRows_(base.checklist),
      evidencias:CMMS111_evidenceRows_(base.evidencias),
      historico:CMMS111_historyRows_(base.historico),
      decision:decision,
      primary_action:decision.can_approve ? "APROVAR" : (decision.can_return ? "DEVOLVER" : "BLOQUEADO"),
      message:decision.message
    }
  });
}

function CMMS111_actionScreen_(base, auth){
  var progress = CMMS111_progressFromFinalizacao_(base.finalizacao);
  var blockers = CMMS111_blockersFromFinalizacao_(base.finalizacao);
  var actions = CMMS111_uiActions_(base.ui, base.finalizacao, auth);
  var header = CMMS111_headerFromBase_(base);
  var badge = CMMS111_badgeFromState_(base.ui && base.ui.state, base.acao && base.acao.status);

  return Object.assign({}, base, {
    version:FAB.VERSION,
    contract_version:FAB.CONTRACT_VERSION,
    header:header,
    ui_badge:badge,
    ui_actions:actions,
    ui_progress:progress,
    ui_blockers:blockers,
    ui_sections:{
      show_action_header:true,
      show_asset:true,
      show_checklist:true,
      show_evidence:true,
      show_history:false,
      readonly:!actions.pode_salvar && !actions.pode_iniciar && !actions.pode_finalizar
    },
    frontend_contract:{
      screen:"operador.tela_acao",
      lote_endpoint:"operador.salvar_checklist_lote",
      lote_payload_minimo:{acao_id:base.acao ? base.acao.id : "", itens:[{ordem:1, resposta:"OK", observacao:""}]},
      evidencia_endpoint:"operador.registrar_evidencia",
      finalizar_endpoint:"operador.finalizar_acao",
      regra:"A tela usa ordem/plano_item_id/ui_key para salvar; não exige CHK manual do operador."
    }
  });
}

function CMMS111_actionCard_(item){
  var acao = item.acao || {};
  var os = item.os || {};
  var ativo = item.ativo || {};
  var componente = item.componente || {};
  var plano = item.plano || {};
  var finalizacao = item.finalizacao || {};
  var ui = item.ui || {};
  var progress = CMMS111_progressFromFinalizacao_(finalizacao);
  var badge = CMMS111_badgeFromState_(ui.state, acao.status);
  var actions = CMMS111_uiActions_(ui, finalizacao, null);

  return {
    id:acao.id || "",
    acao_id:acao.id || "",
    os_id:acao.os_id || os.id || "",
    execucao_id:item.execucao ? item.execucao.id : "",
    titulo:acao.titulo || plano.nome || "Ação operacional",
    subtitulo:CMMS111_join_([ativo.tag || ativo.nome, componente.tag || componente.nome, acao.tipo]),
    descricao:acao.descricao || "",
    prioridade:acao.prioridade || "",
    status:acao.status || "",
    ui_state:ui.state || acao.status || "",
    ui_badge:badge,
    ui_progress:progress,
    ui_actions:actions,
    bloqueios:CMMS111_blockersFromFinalizacao_(finalizacao),
    ativo:{id:ativo.id || "", tag:ativo.tag || "", nome:ativo.nome || "", status:ativo.status || ""},
    componente:{id:componente.id || "", tag:componente.tag || "", nome:componente.nome || ""},
    datas:{
      gerado_em:acao.gerado_em || "",
      planejada_para:os.planejada_para || "",
      iniciado_em:acao.iniciado_em || "",
      finalizado_em:acao.finalizado_em || ""
    },
    availability:item.disponibilidade || null,
    route:{endpoint:"operador.tela_acao", payload:{acao_id:acao.id || ""}},
    next_actions:item.next_actions || []
  };
}

function CMMS111_headerFromBase_(base){
  var acao = base.acao || {};
  var os = base.os || {};
  var ativo = base.ativo || {};
  var componente = base.componente || {};
  return {
    acao_id:acao.id || "",
    os_id:acao.os_id || os.id || "",
    os_codigo:os.codigo || "",
    titulo:acao.titulo || os.titulo || "Ação operacional",
    descricao:acao.descricao || os.descricao || "",
    status:acao.status || "",
    prioridade:acao.prioridade || os.prioridade || "",
    ativo_label:CMMS111_join_([ativo.tag, ativo.nome]),
    componente_label:CMMS111_join_([componente.tag, componente.nome]),
    responsavel_id:acao.responsavel_id || ""
  };
}

function CMMS111_uiActions_(ui, finalizacao, auth){
  ui = ui || {};
  finalizacao = finalizacao || {};
  return {
    pode_iniciar:!!ui.can_start,
    pode_responder:!!ui.can_answer,
    pode_salvar:!!ui.can_save_batch,
    pode_anexar:!!ui.can_register_evidence,
    pode_finalizar:!!ui.can_finalize,
    pode_validar:!!ui.can_validate,
    finalizar_liberado:!!finalizacao.can_finalize,
    endpoints:{
      iniciar:"operador.iniciar_acao",
      salvar_lote:"operador.salvar_checklist_lote",
      anexar_evidencia:"operador.registrar_evidencia",
      validar_finalizacao:"operador.validar_finalizacao_acao",
      finalizar:"operador.finalizar_acao",
      auditar:"gestor.auditoria_execucao_checklist",
      validar_gestor:"gestor.validar_acao"
    },
    mensagem:ui.message || ""
  };
}

function CMMS111_badgeFromState_(state, status){
  var st = upper_(state || status || "");
  var label = st;
  var tone = "neutral";
  var icon = "circle";

  if(st === "AGUARDANDO_INICIO" || st === ST.PENDENTE){ label = "Pendente"; tone = "warning"; icon = "clock"; }
  else if(st === ST.EM_EXECUCAO){ label = "Em execução"; tone = "info"; icon = "play"; }
  else if(st === ST.AGUARDANDO_VALIDACAO){ label = "Aguardando validação"; tone = "warning"; icon = "shield"; }
  else if(st === ST.CONCLUIDA){ label = "Concluída"; tone = "success"; icon = "check"; }
  else if(st === ST.BLOQUEADA || st.indexOf("BLOQUE") >= 0){ label = "Bloqueada"; tone = "danger"; icon = "lock"; }
  else if(st === ST.CANCELADA){ label = "Cancelada"; tone = "muted"; icon = "x"; }

  return {state:st, label:label, tone:tone, icon:icon};
}

function CMMS111_progressFromFinalizacao_(f){
  f = f || {};
  var total = num_(f.total, 0);
  var respondidos = num_(f.respondidos, 0);
  var pendentes = num_(f.pending_count, 0);
  var evidenciasPendentes = num_(f.evidence_missing_count, 0);
  var bloqueios = num_(f.blockers_count, 0);
  var pct = total > 0 ? Math.round((respondidos / total) * 100) : 0;
  if(pct < 0) pct = 0;
  if(pct > 100) pct = 100;

  return {
    total:total,
    respondidos:respondidos,
    pendentes:pendentes,
    percentual:pct,
    evidencias_pendentes:evidenciasPendentes,
    bloqueios:bloqueios,
    completo:total > 0 && respondidos >= total && pendentes === 0 && evidenciasPendentes === 0 && bloqueios === 0,
    label:respondidos + "/" + total + " respondidos"
  };
}

function CMMS111_blockersFromFinalizacao_(f){
  f = f || {};
  var out = [];
  (f.pendentes || []).forEach(function(x){ out.push(CMMS111_blocker_("RESPOSTA_PENDENTE", x, "Responder item obrigatório.")); });
  (f.evidencias_pendentes || []).forEach(function(x){ out.push(CMMS111_blocker_("EVIDENCIA_PENDENTE", x, "Anexar evidência obrigatória.")); });
  (f.bloqueios || []).forEach(function(x){ out.push(CMMS111_blocker_("BLOQUEIO_TECNICO", x, "Corrigir item bloqueante antes de finalizar.")); });
  return out;
}

function CMMS111_blocker_(code, x, action){
  x = x || {};
  return {
    code:code,
    item_id:x.id || x.checklist_execucao_id || "",
    ordem:x.ordem || "",
    titulo:x.titulo || x.item || x.nome || "Item do checklist",
    motivo:x.motivo || x.message || x.validacao_msg || action,
    required_action:action
  };
}

function CMMS111_checklistRows_(checklist){
  return ((checklist && checklist.itens) || []).map(function(i){
    var input = i.input || {};
    var estado = i.estado || {};
    return {
      id:i.id || i.ui_key || "",
      ordem:i.ordem || "",
      titulo:i.titulo || "",
      instrucao:i.instrucao || "",
      tipo_resposta:i.tipo_resposta || input.tipo_resposta || "",
      componente_ui:input.componente || "text",
      resposta:i.resposta || "",
      valor_numero:i.valor_numero || "",
      observacao:i.observacao || "",
      conforme:i.conforme || estado.conforme || "",
      respondido:!!estado.respondido || !!i.respondido,
      obrigatorio:!!i.obrigatorio,
      evidencia_obrigatoria:!!i.evidencia_obrigatoria,
      evidencias_count:num_(i.evidencias_count, 0),
      save_hint:i.save_hint || {checklist_execucao_id:i.id || "", ordem:i.ordem || "", plano_item_id:i.plano_item_id || ""}
    };
  });
}

function CMMS111_evidenceRows_(evidencias){
  return (evidencias || []).map(function(e){
    return {
      id:e.id || "",
      checklist_execucao_id:e.checklist_execucao_id || "",
      tipo:e.tipo || "",
      nome_arquivo:e.nome_arquivo || "",
      url:e.url || "",
      observacao:e.observacao || "",
      criado_em:e.criado_em || "",
      usuario_id:e.usuario_id || ""
    };
  });
}

function CMMS111_historyRows_(hist){
  return (hist || []).map(function(h){
    return {
      id:h.id || "",
      evento:h.evento || "",
      descricao:h.descricao || "",
      usuario_id:h.usuario_id || "",
      perfil:h.perfil || "",
      criado_em:h.criado_em || ""
    };
  });
}

function CMMS111_decisionContract_(base){
  var decisao = base.decisao || {};
  var finalizacao = base.finalizacao || {};
  var canApprove = !!decisao.can_approve;
  var canReturn = !!decisao.can_return;
  return {
    can_validate:!!decisao.can_validate,
    can_approve:canApprove,
    can_return:canReturn,
    requires_justificativa_on_return:true,
    approve_payload:{acao_id:base.acao ? base.acao.id : "", decisao:"APROVAR", justificativa:"Checklist auditado e aprovado."},
    return_payload:{acao_id:base.acao ? base.acao.id : "", decisao:"DEVOLVER", justificativa:"Descrever pendência técnica encontrada."},
    message:canApprove ? "Execução apta para aprovação." : (canReturn ? "Execução pode ser devolvida pela gestão." : "Execução não está apta para decisão."),
    can_finalize:!!finalizacao.can_finalize
  };
}

function CMMS111_savedItem_(s){
  return {
    index:s.index,
    saved:!!s.saved,
    checklist_execucao_id:s.checklist_execucao_id || "",
    tipo_resposta:s.tipo_resposta || "",
    conforme:s.conforme || "",
    validacao_msg:s.validacao_msg || "",
    ui_key:s.ui_key || s.checklist_execucao_id || ""
  };
}

function CMMS111_errorItem_(e){
  return {
    index:e.index,
    id:e.id || "",
    ordem:e.ordem || "",
    plano_item_id:e.plano_item_id || "",
    checklist_execucao_id:e.checklist_execucao_id || "",
    code:e.code || "ERROR",
    message:e.message || "Erro ao salvar item.",
    status:e.status || 400
  };
}

function CMMS111_nextAfterSave_(base){
  if(base.error_count > 0) return ["corrigir_itens_com_erro", "operador.salvar_checklist_lote"];
  if(base.can_finalize) return ["operador.validar_finalizacao_acao", "operador.finalizar_acao"];
  return ["operador.tela_acao", "operador.salvar_checklist_lote"];
}

function CMMS111_join_(arr){
  return (arr || []).map(function(x){ return clean_(x); }).filter(Boolean).join(" — ");
}
