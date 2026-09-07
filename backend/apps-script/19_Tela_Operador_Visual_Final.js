/**
 * FAB Control 1.1.2b
 * Tela real do operador / contrato visual final.
 *
 * Este pacote mantém o motor validado na 1.1.1a e cria uma camada limpa para UI:
 * - Home/fila operacional em cards.
 * - Tela de ação com header, progresso, blocos visuais de checklist, botões e rodapé fixo.
 * - Salvamento em lote com retorno pronto para toast, progresso e próxima ação.
 * - Auditoria da gestão com visão visual de aprovação.
 */

var CMMS112B_CONTRACT_VERSION = FAB.CONTRACT_VERSION;
var CMMS112B_OPERATOR_SCHEMA = "operator_screen_1.1.2b";

function cmmsOperadorTelaRealSchemaUpgrade112_(p, usuario){
  var auth = usuario || p.__auth || {};
  if(upper_(auth.perfil) !== ROLE.ADMIN){
    err_("FORBIDDEN", "Somente ADMIN pode executar upgrade do pacote de normalização visual 1.1.2b.", 403);
  }

  var ss = getSpreadsheet_();
  Object.keys(SH).forEach(function(name){ ensureSheet_(ss, name, SH[name]); });

  syncReleaseVersionConfig_();

  upsert_("config", "chave", {
    chave:"ui.operador.visual.version",
    valor:CMMS112B_CONTRACT_VERSION,
    descricao:"Normalização final do contrato visual: mensagens coerentes e ui_blockers restrito a bloqueios técnicos reais.",
    atualizado_em:now_()
  });

  upsert_("config", "chave", {
    chave:"ui.operador.visual.rule",
    valor:"Frontend consome contrato visual normalizado: respostas e evidências pendentes ficam separadas; ui_blockers contém somente bloqueios técnicos reais. Motor de validação permanece no backend.",
    descricao:"Regra de integração da tela real do operador",
    atualizado_em:now_()
  });

  invalidateRuntimeCache_();

  return {
    upgraded:true,
    version:FAB.VERSION,
    contract_version:CMMS112B_CONTRACT_VERSION,
    sheets:Object.keys(SH).length,
    regra:"Tela operacional final com mensagens coerentes e bloqueio técnico separado de respostas e evidências pendentes.",
    endpoints:[
      "operador.home",
      "operador.painel",
      "operador.minhas_acoes",
      "operador.tela_acao",
      "operador.salvar_checklist_lote",
      "operador.registrar_evidencia",
      "operador.validar_finalizacao_acao",
      "operador.finalizar_acao",
      "gestor.auditoria_execucao_checklist",
      "gestor.validar_acao"
    ],
    ui_contract:{
      home:"operator_home",
      cards:"visual_cards",
      action_screen:"operator_screen",
      checklist:"checklist_blocks",
      buttons:"action_bar.buttons",
      footer:"sticky_footer",
      mobile_ready:true,
      tablet_ready:true
    }
  };
}

function operadorHome112_(p, usuario){
  var base = operadorMinhasAcoes111_(p, usuario || p.__auth || {});
  var cards = (base.cards || base.acoes || []).map(function(c){ return CMMS112_visualCard_(c); });
  var resumo = CMMS112_homeResumo_(cards, base.resumo);
  var user = usuario || p.__auth || {};

  return {
    ok:true,
    version:FAB.VERSION,
    contract_version:CMMS112B_CONTRACT_VERSION,
    screen:"operador.home",
    operador_id:base.operador_id || clean_(user.usuario_id),
    header:{
      title:"Minhas ações",
      subtitle:"Fila operacional do operador",
      refresh_hint_seconds:30,
      server_time:now_()
    },
    tabs:CMMS112_tabs_(resumo),
    resumo_cards:[
      {key:"pendentes", label:"Pendentes", value:resumo.pendentes, tone:"warning", icon:"clock"},
      {key:"em_execucao", label:"Em execução", value:resumo.em_execucao, tone:"info", icon:"play"},
      {key:"aguardando_validacao", label:"Aguardando validação", value:resumo.aguardando_validacao, tone:"warning", icon:"shield"},
      {key:"concluidas", label:"Concluídas", value:resumo.concluidas, tone:"success", icon:"check"}
    ],
    visual_cards:cards,
    cards:cards,
    empty_state:{
      show:cards.length === 0,
      title:"Nenhuma ação operacional encontrada",
      message:"Quando houver ação liberada para operação, ela aparecerá nesta fila.",
      primary_action:{label:"Atualizar", endpoint:"operador.home", payload:{}}
    },
    quick_actions:[
      {id:"refresh", label:"Atualizar", endpoint:"operador.home", enabled:true, tone:"neutral"},
      {id:"scan_qr", label:"Ler QR/TAG", endpoint:"operador.contexto_qr_fast", enabled:true, tone:"primary"}
    ],
    mobile:{
      layout:"one_column_cards",
      card_density:"compact",
      primary_gesture:"tap_card_to_open"
    }
  };
}

function operadorMinhasAcoes112_(p, usuario){
  var base = operadorMinhasAcoes111_(p, usuario || p.__auth || {});
  var visual = (base.cards || base.acoes || []).map(function(c){ return CMMS112_visualCard_(c); });
  var resposta = Object.assign({}, base, {
    version:FAB.VERSION,
    contract_version:CMMS112B_CONTRACT_VERSION,
    screen:"operador.minhas_acoes",
    visual_cards:visual,
    cards:visual,
    acoes:visual,
    ui_collection:Object.assign({}, base.ui_collection || {}, {
      type:"operator_action_cards",
      empty_message:"Nenhuma ação para exibir.",
      card_schema:CMMS112B_CONTRACT_VERSION
    })
  });

  if(bool_(p.debug_payload) || bool_(p.incluir_raw)){
    resposta.raw_contract_111 = base;
  }

  return resposta;
}

function operadorTelaAcao112_(p, usuario){
  var base = operadorTelaAcao111_(p, usuario || p.__auth || {});
  return CMMS112_wrapActionScreen_(base, p, usuario || p.__auth || {});
}

function operadorDetalharChecklistExecucao112_(p, usuario){
  var base = operadorDetalharChecklistExecucao111_(p, usuario || p.__auth || {});
  return CMMS112_wrapActionScreen_(base, p, usuario || p.__auth || {});
}

function operadorSalvarChecklistLote112_(p, usuario){
  var base = operadorSalvarChecklistLote111_(p, usuario || p.__auth || {});
  var progress = CMMS112_progress_(base.ui_result && base.ui_result.progress ? base.ui_result.progress : CMMS111_progressFromFinalizacao_(base.finalizacao));
  var legacyIssues = base.ui_result && base.ui_result.blockers ? base.ui_result.blockers : CMMS111_blockersFromFinalizacao_(base.finalizacao);
  var issues = CMMS112_issueBuckets_(base.finalizacao, legacyIssues);

  return Object.assign({}, base, {
    version:FAB.VERSION,
    contract_version:CMMS112B_CONTRACT_VERSION,
    ui_feedback:{
      toast:{
        type:base.error_count > 0 ? "warning" : "success",
        title:base.error_count > 0 ? "Lote parcialmente salvo" : "Checklist salvo",
        message:base.error_count > 0 ? "Alguns itens exigem correção antes de finalizar." : "Todas as respostas foram salvas com sucesso."
      },
      progress:progress,
      blockers:issues.technical_blockers,
      pending_responses:issues.pending_responses,
      pending_evidence:issues.pending_evidence,
      issues:issues,
      next_step:base.can_finalize ? {
        id:"validar_finalizacao",
        label:"Validar finalização",
        endpoint:"operador.validar_finalizacao_acao",
        payload:{acao_id:base.acao_id || ""}
      } : {
        id:"continuar_checklist",
        label:"Continuar checklist",
        endpoint:"operador.tela_acao",
        payload:{acao_id:base.acao_id || ""}
      }
    }
  });
}

function operadorValidarFinalizacaoAcao112_(p, usuario){
  var base = operadorValidarFinalizacaoAcao111_(p, usuario || p.__auth || {});
  var progress = CMMS112_progress_(base.ui_validation && base.ui_validation.progress ? base.ui_validation.progress : CMMS111_progressFromFinalizacao_(base.finalizacao));
  var legacyIssues = base.ui_validation && base.ui_validation.blockers ? base.ui_validation.blockers : CMMS111_blockersFromFinalizacao_(base.finalizacao);
  var issues = CMMS112_issueBuckets_(base.finalizacao, legacyIssues);

  return Object.assign({}, base, {
    version:FAB.VERSION,
    contract_version:CMMS112B_CONTRACT_VERSION,
    finalization_screen:{
      can_finalize:!!base.can_finalize,
      progress:progress,
      blockers:issues.technical_blockers,
      pending_responses:issues.pending_responses,
      pending_evidence:issues.pending_evidence,
      issues:issues,
      banner:{
        tone:base.can_finalize ? "success" : (issues.technical_blockers.length ? "danger" : "warning"),
        title:base.can_finalize ? "Finalização liberada" : (issues.technical_blockers.length ? "Finalização bloqueada" : "Finalização pendente"),
        message:base.can_finalize ? "Checklist completo. O operador pode finalizar a ação." : CMMS112_finalizationReason_(progress, issues)
      },
      primary_button:{
        id:"finalizar",
        label:"Finalizar ação",
        endpoint:"operador.finalizar_acao",
        enabled:!!base.can_finalize,
        payload:{acao_id:base.acao_id || ""},
        disabled_reason:base.can_finalize ? "" : CMMS112_finalizationReason_(progress, issues)
      }
    }
  });
}

function gestorAuditoriaExecucaoChecklist112_(p, usuario){
  var base = gestorAuditoriaExecucaoChecklist111_(p, usuario || p.__auth || {});
  var approval = base.approval_screen || {};
  var decision = approval.decision || {};
  var legacyIssues = approval.blockers || CMMS111_blockersFromFinalizacao_(base.finalizacao);
  var issues = CMMS112_issueBuckets_(base.finalizacao, legacyIssues);
  var checklistRows = CMMS112_richChecklistRows_(base.checklist || {itens:approval.checklist || []});

  return Object.assign({}, base, {
    version:FAB.VERSION,
    contract_version:CMMS112B_CONTRACT_VERSION,
    gestor_screen:{
      screen:"gestor.auditoria_execucao_checklist",
      header:approval.header || CMMS111_headerFromBase_(base),
      status_badge:CMMS111_badgeFromState_(base.acao && base.acao.status, base.acao && base.acao.status),
      progress:CMMS112_progress_(approval.progress),
      checklist_blocks:CMMS112_groupChecklistBlocks_(checklistRows),
      evidence_gallery:CMMS112_evidenceGallery_(approval.evidencias || base.evidencias || []),
      blockers:issues.technical_blockers,
      pending_responses:issues.pending_responses,
      pending_evidence:issues.pending_evidence,
      issues:issues,
      decision_panel:{
        can_approve:!!decision.can_approve,
        can_return:!!decision.can_return,
        requires_justificativa_on_return:true,
        buttons:[
          {id:"aprovar", label:"Aprovar execução", endpoint:"gestor.validar_acao", enabled:!!decision.can_approve, tone:"success", payload:decision.approve_payload || {}},
          {id:"devolver", label:"Devolver para correção", endpoint:"gestor.validar_acao", enabled:!!decision.can_return, tone:"warning", payload:decision.return_payload || {}}
        ],
        message:decision.message || ""
      }
    }
  });
}

function CMMS112_wrapActionScreen_(base, p, auth){
  var operatorScreen = CMMS112_operatorScreen_(base, auth || {});
  var normalizedBase = CMMS112B_normalizeLegacyContract_(base, operatorScreen);
  var compact = bool_(p.compact) || upper_(p.modo_payload) === "COMPACTO" || upper_(p.modo) === "COMPACTO";

  if(compact){
    return {
      ok:true,
      version:FAB.VERSION,
      contract_version:CMMS112B_CONTRACT_VERSION,
      screen:"operador.tela_acao",
      operator_screen:operatorScreen
    };
  }

  return Object.assign({}, normalizedBase, {
    version:FAB.VERSION,
    contract_version:CMMS112B_CONTRACT_VERSION,
    screen:"operador.tela_acao",
    operator_screen:operatorScreen,
    visual_contract:{
      schema:CMMS112B_OPERATOR_SCHEMA,
      use:"operator_screen",
      raw_payload_available:true,
      compact_param:"compact=true"
    }
  });
}

function CMMS112B_normalizeLegacyContract_(base, operatorScreen){
  base = base || {};
  operatorScreen = operatorScreen || {};
  var issues = operatorScreen.issues || CMMS112_issueBuckets_(base.finalizacao, base.ui_blockers || []);
  var progress = operatorScreen.progress || CMMS112_progress_(base.ui_progress || CMMS111_progressFromFinalizacao_(base.finalizacao));
  var message = CMMS112B_summaryMessage_(base, progress, issues);
  var normalized = Object.assign({}, base);

  normalized.ui = Object.assign({}, base.ui || {}, {message:message});
  normalized.ui_actions = Object.assign({}, base.ui_actions || {}, {mensagem:message});
  normalized.ui_progress = Object.assign({}, base.ui_progress || {}, {bloqueios:issues.technical_blockers.length});
  normalized.ui_blockers = (issues.technical_blockers || []).slice();

  return normalized;
}

function CMMS112B_summaryMessage_(base, progress, issues){
  base = base || {};
  progress = progress || {};
  issues = issues || {pending_responses:[], pending_evidence:[], technical_blockers:[]};

  var existing = clean_(base.ui && base.ui.message || base.ui_actions && base.ui_actions.mensagem || "");
  var state = upper_(base.ui && base.ui.state || base.acao && base.acao.status || "");
  if(state !== ST.EM_EXECUCAO) return existing;
  if(progress.completo) return "Checklist completo. Finalização liberada.";

  var hasResponses = (issues.pending_responses || []).length > 0;
  var hasEvidence = (issues.pending_evidence || []).length > 0;
  var hasTechnical = (issues.technical_blockers || []).length > 0;
  var clauses = [];

  if(hasResponses && hasEvidence) clauses.push("respostas ou evidências pendentes");
  else if(hasResponses) clauses.push("respostas pendentes");
  else if(hasEvidence) clauses.push("evidências pendentes");
  if(hasTechnical) clauses.push("bloqueios técnicos");

  if(!clauses.length) return "Checklist em execução.";
  return "Checklist em execução. Existem " + CMMS112B_joinClauses_(clauses) + ".";
}

function CMMS112B_joinClauses_(items){
  items = items || [];
  if(items.length <= 1) return items[0] || "";
  if(items.length === 2) return items[0] + " e " + items[1];
  return items.slice(0, -1).join(", ") + " e " + items[items.length - 1];
}

function CMMS112_operatorScreen_(base, auth){
  var header = CMMS112_screenHeader_(base);
  var actions = base.ui_actions || CMMS111_uiActions_(base.ui, base.finalizacao, auth);
  var progress = CMMS112_progress_(base.ui_progress || CMMS111_progressFromFinalizacao_(base.finalizacao));
  var legacyIssues = base.ui_blockers || CMMS111_blockersFromFinalizacao_(base.finalizacao);
  var issues = CMMS112_issueBuckets_(base.finalizacao, legacyIssues);
  var checklistRows = CMMS112_richChecklistRows_(base.checklist || {itens:[]});

  return {
    header:header,
    status_badge:base.ui_badge || CMMS111_badgeFromState_(base.ui && base.ui.state, base.acao && base.acao.status),
    progress:progress,
    messages:CMMS112_messages_(base, progress, issues),
    action_bar:CMMS112_actionBar_(base, actions, progress, issues),
    asset_card:CMMS112_assetCard_(base),
    checklist_summary:{
      total:progress.total,
      respondidos:progress.respondidos,
      pendentes:progress.pendentes,
      evidencias_pendentes:progress.evidencias_pendentes,
      bloqueios:issues.technical_blockers.length,
      percentual:progress.percentual,
      response_pending_count:issues.pending_responses.length,
      evidence_pending_count:issues.pending_evidence.length,
      technical_blockers_count:issues.technical_blockers.length
    },
    checklist_blocks:CMMS112_groupChecklistBlocks_(checklistRows),
    evidence_gallery:CMMS112_evidenceGallery_(base.evidencias || []),
    blockers:issues.technical_blockers,
    pending_responses:issues.pending_responses,
    pending_evidence:issues.pending_evidence,
    issues:issues,
    sticky_footer:CMMS112_stickyFooter_(base, actions, progress, issues),
    payload_hints:CMMS112_payloadHints_(base, checklistRows),
    mobile:{
      layout:"single_column",
      primary_area:"checklist_blocks",
      sticky_footer:true,
      min_touch_target_px:44,
      recommended_device:"tablet_ou_celular_industrial"
    }
  };
}

function CMMS112_richChecklistRows_(checklist){
  return ((checklist && checklist.itens) || []).map(function(i){
    i = i || {};
    var input = i.input || {};
    var estado = i.estado || {};
    var options = CMMS112_options_(CMMS112_hasValue_(i.opcoes) ? i.opcoes : (CMMS112_hasValue_(input.opcoes) ? input.opcoes : i.opcoes_json));
    var unit = clean_(CMMS112_hasValue_(i.unidade) ? i.unidade : input.unidade);
    var min = CMMS112_value_(CMMS112_hasValue_(i.limite_min) ? i.limite_min : input.limite_min);
    var max = CMMS112_value_(CMMS112_hasValue_(i.limite_max) ? i.limite_max : input.limite_max);
    var tipo = upper_(i.tipo_resposta || input.tipo_resposta || "");

    return {
      id:i.id || i.ui_key || "",
      ui_key:i.ui_key || i.id || ("ordem:" + (i.ordem || "")),
      execucao_id:i.execucao_id || "",
      acao_id:i.acao_id || "",
      plano_item_id:i.plano_item_id || i.modelo_item_id || "",
      ordem:CMMS112_value_(i.ordem),
      titulo:i.titulo || "",
      instrucao:i.instrucao || "",
      tipo_resposta:tipo,
      componente_ui:input.componente || CMMS112_typeMeta_(tipo).component,
      categoria:i.categoria || "",
      resposta:CMMS112_value_(i.resposta),
      valor_numero:CMMS112_value_(i.valor_numero),
      observacao:i.observacao || "",
      conforme:i.conforme || estado.conforme || "",
      respondido:bool_(estado.respondido) || bool_(i.respondido),
      obrigatorio:bool_(i.obrigatorio),
      evidencia_obrigatoria:bool_(i.evidencia_obrigatoria),
      bloqueia_finalizacao:bool_(i.bloqueia_finalizacao),
      evidencias_count:num_(i.evidencias_count, 0),
      evidencias:i.evidencias || [],
      opcoes:options,
      options:options,
      unidade:unit,
      limite_min:min,
      limite_max:max,
      parametro_nome:i.parametro_nome || "",
      valor_esperado:i.valor_esperado || "",
      foto_referencia_url:i.foto_referencia_url || "",
      validacao_msg:i.validacao_msg || "",
      status:i.status || "",
      input:{
        tipo_resposta:tipo,
        componente:input.componente || CMMS112_typeMeta_(tipo).component,
        requer_resposta:CMMS112_hasValue_(input.requer_resposta) ? bool_(input.requer_resposta) : bool_(i.obrigatorio),
        requer_valor:bool_(input.requer_valor),
        requer_opcoes:bool_(input.requer_opcoes),
        suporta_evidencia:CMMS112_hasValue_(input.suporta_evidencia) ? bool_(input.suporta_evidencia) : true,
        placeholder:input.placeholder || CMMS112_typeMeta_(tipo).placeholder,
        opcoes:options,
        unidade:unit,
        limite_min:min,
        limite_max:max
      },
      save_hint:i.save_hint || {checklist_execucao_id:i.id || "", ordem:i.ordem || "", plano_item_id:i.plano_item_id || i.modelo_item_id || ""}
    };
  });
}

function CMMS112_options_(value){
  if(value === undefined || value === null || value === "") return [];
  var raw = value;
  if(typeof raw === "string"){
    var text = clean_(raw);
    if(!text) return [];
    try{
      var parsed = JSON.parse(text);
      if(Array.isArray(parsed)) raw = parsed;
      else raw = text.split(/[;|,\n]+/);
    } catch(e){
      raw = text.split(/[;|,\n]+/);
    }
  }
  if(!Array.isArray(raw)) raw = [raw];
  var seen = {};
  return raw.map(function(x){
    if(x && typeof x === "object") x = x.value || x.label || x.nome || x.name || "";
    return clean_(x);
  }).filter(function(x){
    if(!x || seen[x]) return false;
    seen[x] = true;
    return true;
  });
}

function CMMS112_issueBuckets_(finalizacao, legacyIssues){
  var f = finalizacao || {};
  var pendingResponses = [];
  var pendingEvidence = [];
  var technicalBlockers = [];

  (f.pendentes || []).forEach(function(x){
    pendingResponses.push(CMMS111_blocker_("RESPOSTA_PENDENTE", x, "Responder item obrigatório."));
  });
  (f.evidencias_pendentes || []).forEach(function(x){
    pendingEvidence.push(CMMS111_blocker_("EVIDENCIA_PENDENTE", x, "Anexar evidência obrigatória."));
  });
  (f.bloqueios || []).forEach(function(x){
    technicalBlockers.push(CMMS111_blocker_("BLOQUEIO_TECNICO", x, "Corrigir item bloqueante antes de finalizar."));
  });

  (legacyIssues || []).forEach(function(x){
    x = x || {};
    var code = upper_(x.code || "");
    if(code === "RESPOSTA_PENDENTE") pendingResponses.push(x);
    else if(code === "EVIDENCIA_PENDENTE") pendingEvidence.push(x);
    else if(code === "BLOQUEIO_TECNICO") technicalBlockers.push(x);
    else {
      var hint = upper_((x.required_action || "") + " " + (x.motivo || "") + " " + (x.message || ""));
      if(hint.indexOf("EVID") >= 0) pendingEvidence.push(Object.assign({code:"EVIDENCIA_PENDENTE"}, x));
      else if(hint.indexOf("RESPOND") >= 0 || hint.indexOf("RESPOSTA") >= 0) pendingResponses.push(Object.assign({code:"RESPOSTA_PENDENTE"}, x));
      else technicalBlockers.push(Object.assign({code:"BLOQUEIO_TECNICO"}, x));
    }
  });

  pendingResponses = CMMS112_dedupeIssues_(pendingResponses);
  pendingEvidence = CMMS112_dedupeIssues_(pendingEvidence);
  technicalBlockers = CMMS112_dedupeIssues_(technicalBlockers);

  return {
    pending_responses:pendingResponses,
    pending_evidence:pendingEvidence,
    technical_blockers:technicalBlockers,
    response_pending_count:pendingResponses.length,
    evidence_pending_count:pendingEvidence.length,
    technical_blockers_count:technicalBlockers.length,
    has_pending_responses:pendingResponses.length > 0,
    has_pending_evidence:pendingEvidence.length > 0,
    has_technical_blockers:technicalBlockers.length > 0,
    all:pendingResponses.concat(pendingEvidence, technicalBlockers)
  };
}

function CMMS112_dedupeIssues_(items){
  var seen = {};
  return (items || []).filter(function(x){
    x = x || {};
    var key = [upper_(x.code || ""), clean_(x.item_id || x.id || x.checklist_execucao_id || ""), clean_(x.ordem || ""), clean_(x.titulo || x.item || x.nome || "")].join("|");
    if(seen[key]) return false;
    seen[key] = true;
    return true;
  });
}

function CMMS112_visualCard_(card){
  card = card || {};
  var badge = card.ui_badge || CMMS111_badgeFromState_(card.ui_state, card.status);
  var progress = CMMS112_progress_(card.ui_progress);
  var actions = card.ui_actions || {};
  var primary = CMMS112_primaryCardAction_(card, actions, badge);
  var issues = CMMS112_issueBuckets_(null, card.bloqueios || []);

  return {
    id:card.id || card.acao_id || "",
    acao_id:card.acao_id || card.id || "",
    title:card.titulo || "Ação operacional",
    subtitle:card.subtitulo || "",
    description:card.descricao || "",
    priority:{value:card.prioridade || "", label:CMMS112_priorityLabel_(card.prioridade), tone:CMMS112_priorityTone_(card.prioridade)},
    status:badge,
    progress:progress,
    primary_action:primary,
    secondary_actions:CMMS112_secondaryCardActions_(card, actions),
    asset:{
      id:card.ativo && card.ativo.id || "",
      tag:card.ativo && card.ativo.tag || "",
      name:card.ativo && card.ativo.nome || "",
      label:CMMS112_join_([card.ativo && card.ativo.tag, card.ativo && card.ativo.nome])
    },
    component:{
      id:card.componente && card.componente.id || "",
      tag:card.componente && card.componente.tag || "",
      name:card.componente && card.componente.nome || "",
      label:CMMS112_join_([card.componente && card.componente.tag, card.componente && card.componente.nome])
    },
    dates:card.datas || {},
    availability:card.availability || null,
    route:card.route || {endpoint:"operador.tela_acao", payload:{acao_id:card.acao_id || card.id || ""}},
    blockers:issues.technical_blockers,
    pending_responses:issues.pending_responses,
    pending_evidence:issues.pending_evidence,
    issues:issues,
    is_blocked:issues.technical_blockers.length > 0,
    ui_density:"card_operador_v1"
  };
}

function CMMS112_screenHeader_(base){
  var h = base.header || CMMS111_headerFromBase_(base);
  return {
    acao_id:h.acao_id || (base.acao && base.acao.id) || "",
    execucao_id:base.execucao && base.execucao.id || "",
    os_id:h.os_id || "",
    os_codigo:h.os_codigo || "",
    title:h.titulo || "Ação operacional",
    subtitle:CMMS112_join_([h.ativo_label, h.componente_label]),
    description:h.descricao || "",
    priority:{value:h.prioridade || "", label:CMMS112_priorityLabel_(h.prioridade), tone:CMMS112_priorityTone_(h.prioridade)},
    status:h.status || (base.acao && base.acao.status) || "",
    responsavel_id:h.responsavel_id || ""
  };
}

function CMMS112_assetCard_(base){
  var ativo = base.ativo || {};
  var componente = base.componente || {};
  return {
    title:"Equipamento",
    ativo:{
      id:ativo.id || "",
      tag:ativo.tag || "",
      nome:ativo.nome || "",
      tipo:ativo.tipo || "",
      criticidade:ativo.criticidade || "",
      status:ativo.status || "",
      saude_pct:CMMS112_value_(ativo.saude_pct),
      horimetro_atual:CMMS112_value_(ativo.horimetro_atual)
    },
    componente:{
      id:componente.id || "",
      tag:componente.tag || "",
      nome:componente.nome || "",
      tipo:componente.tipo || "",
      criticidade:componente.criticidade || "",
      status:componente.status || ""
    }
  };
}

function CMMS112_actionBar_(base, actions, progress, issues){
  actions = actions || {};
  issues = issues || CMMS112_issueBuckets_(base.finalizacao, []);
  var technicalBlockers = issues.technical_blockers || [];
  var acaoId = base.acao && base.acao.id || base.acao_id || "";
  var execId = base.execucao && base.execucao.id || base.execucao_id || "";
  var buttons = [];
  var finalReason = CMMS112_finalizationReason_(progress, issues);
  var finalizeEnabled = !!actions.pode_finalizar && !!progress.completo && technicalBlockers.length === 0;

  buttons.push(CMMS112_button_("iniciar", "Iniciar", "operador.iniciar_acao", actions.pode_iniciar, "primary", {acao_id:acaoId}, "Ação já iniciada ou indisponível."));
  buttons.push(CMMS112_button_("salvar", "Salvar checklist", "operador.salvar_checklist_lote", actions.pode_salvar, "primary", {acao_id:acaoId, itens:[]}, "Checklist não está editável."));
  buttons.push(CMMS112_button_("anexar", "Anexar evidência", "operador.registrar_evidencia", actions.pode_anexar, "secondary", {acao_id:acaoId, execucao_id:execId}, "Evidência não liberada neste status."));
  buttons.push(CMMS112_button_("validar_finalizacao", "Validar finalização", "operador.validar_finalizacao_acao", actions.pode_salvar || actions.pode_finalizar, "secondary", {acao_id:acaoId}, "Ação não está em execução."));
  buttons.push(CMMS112_button_("finalizar", "Finalizar", "operador.finalizar_acao", finalizeEnabled, "success", {acao_id:acaoId, resultado:"OK", observacao:"Checklist técnico executado conforme procedimento."}, finalReason));
  buttons.push(CMMS112_button_("auditar", "Auditar", "gestor.auditoria_execucao_checklist", actions.pode_validar, "secondary", {acao_id:acaoId}, "Disponível apenas para gestão."));

  return {
    buttons:buttons,
    primary:CMMS112_firstEnabledButton_(buttons),
    disabled_reason:finalizeEnabled ? "" : finalReason,
    issue_counts:{
      pending_responses:issues.pending_responses.length,
      pending_evidence:issues.pending_evidence.length,
      technical_blockers:technicalBlockers.length
    }
  };
}

function CMMS112_stickyFooter_(base, actions, progress, issues){
  var bar = CMMS112_actionBar_(base, actions, progress, issues);
  var technicalBlockers = issues.technical_blockers || [];
  var canFinalize = progress.completo && technicalBlockers.length === 0 && !!(actions && actions.pode_finalizar);
  return {
    visible:true,
    progress_label:progress.label,
    can_finalize:canFinalize,
    primary_button:bar.primary,
    secondary_button:bar.buttons.filter(function(b){ return b.id === "salvar" || b.id === "validar_finalizacao"; })[0] || null,
    message:canFinalize ? "Checklist completo. Finalização liberada." : CMMS112_finalizationReason_(progress, issues),
    issue_counts:bar.issue_counts
  };
}

function CMMS112_finalizationReason_(progress, issues){
  progress = progress || {};
  issues = issues || {pending_responses:[], pending_evidence:[], technical_blockers:[]};
  var reasons = [];
  var responseCount = (issues.pending_responses || []).length || num_(progress.pendentes, 0);
  var evidenceCount = (issues.pending_evidence || []).length || num_(progress.evidencias_pendentes, 0);
  var technicalCount = (issues.technical_blockers || []).length || num_(progress.bloqueios, 0);

  if(responseCount > 0) reasons.push(responseCount + " resposta(s) obrigatória(s) pendente(s)");
  if(evidenceCount > 0) reasons.push(evidenceCount + " evidência(s) obrigatória(s) pendente(s)");
  if(technicalCount > 0) reasons.push(technicalCount + " bloqueio(s) técnico(s)");
  if(reasons.length) return "Finalização indisponível: " + reasons.join("; ") + ".";
  if(!progress.completo) return "Checklist ainda não está completo.";
  return "Ação não está liberada para finalização neste status.";
}

function CMMS112_groupChecklistBlocks_(items){
  var order = ["OK_NOK", "CONFIRMACAO", "NUMERO", "PARAMETRO", "LEITURA_OPERACIONAL", "SELECAO", "EVIDENCIA", "TEXTO", "INSTRUCAO", "OUTROS"];
  var map = {};
  (items || []).forEach(function(item){
    var tipo = upper_(item.tipo_resposta || "OUTROS") || "OUTROS";
    if(order.indexOf(tipo) < 0) tipo = "OUTROS";
    if(!map[tipo]){
      var meta = CMMS112_typeMeta_(tipo);
      map[tipo] = {id:"block_" + tipo.toLowerCase(), tipo_resposta:tipo, title:meta.title, description:meta.description, component:meta.component, total:0, respondidos:0, pendentes:0, items:[]};
    }
    var visual = CMMS112_visualChecklistItem_(item);
    map[tipo].items.push(visual);
    map[tipo].total++;
    if(visual.state.respondido) map[tipo].respondidos++;
    else if(visual.required || visual.evidence_pending) map[tipo].pendentes++;
  });

  return order.filter(function(t){ return !!map[t]; }).map(function(t){
    var b = map[t];
    b.progress = {
      total:b.total,
      respondidos:b.respondidos,
      pendentes:b.pendentes,
      percentual:b.total ? Math.round((b.respondidos / b.total) * 100) : 0
    };
    return b;
  });
}

function CMMS112_visualChecklistItem_(item){
  item = item || {};
  var tipo = upper_(item.tipo_resposta);
  var meta = CMMS112_typeMeta_(tipo);
  var saveHint = item.save_hint || {checklist_execucao_id:item.id || "", ordem:item.ordem || "", plano_item_id:item.plano_item_id || ""};
  var value = CMMS112_responseValue_(item, tipo);
  var options = CMMS112_options_(CMMS112_hasValue_(item.opcoes) ? item.opcoes : (item.input && item.input.opcoes));
  var unit = clean_(CMMS112_hasValue_(item.unidade) ? item.unidade : (item.input && item.input.unidade));
  var min = CMMS112_value_(CMMS112_hasValue_(item.limite_min) ? item.limite_min : (item.input && item.input.limite_min));
  var max = CMMS112_value_(CMMS112_hasValue_(item.limite_max) ? item.limite_max : (item.input && item.input.limite_max));
  var required = bool_(item.obrigatorio);
  var evidenceRequired = bool_(item.evidencia_obrigatoria);

  return {
    id:item.id || item.ui_key || "",
    ui_key:item.ui_key || item.id || ("ordem:" + (item.ordem || "")),
    ordem:item.ordem || "",
    title:item.titulo || "",
    instruction:item.instrucao || "",
    tipo_resposta:tipo,
    component:meta.component,
    category:item.categoria || "",
    required:required,
    evidence_required:evidenceRequired,
    evidence_count:num_(item.evidencias_count, 0),
    evidence_pending:evidenceRequired && num_(item.evidencias_count, 0) === 0,
    completion_required:required || evidenceRequired,
    value:value,
    options:options,
    opcoes:options,
    placeholder:(item.input && item.input.placeholder) || meta.placeholder,
    unit:unit,
    unidade:unit,
    limits:{min:min, max:max},
    limite_min:min,
    limite_max:max,
    has_limits:CMMS112_hasValue_(min) || CMMS112_hasValue_(max),
    range_label:CMMS112_rangeLabel_(min, max, unit),
    parameter_name:item.parametro_nome || "",
    expected_value:item.valor_esperado || "",
    reference_photo_url:item.foto_referencia_url || "",
    validation_message:item.validacao_msg || "",
    state:{
      respondido:bool_(item.respondido),
      conforme:item.conforme || "",
      tone:CMMS112_itemTone_(item),
      label:CMMS112_itemStateLabel_(item)
    },
    save_hint:saveHint,
    evidence_hint:{
      endpoint:"operador.registrar_evidencia",
      payload:{checklist_execucao_id:item.id || "", tipo:"FOTO", nome_arquivo:"", url:"", observacao:""}
    }
  };
}

function CMMS112_rangeLabel_(min, max, unit){
  var hasMin = CMMS112_hasValue_(min);
  var hasMax = CMMS112_hasValue_(max);
  if(!hasMin && !hasMax) return "";
  var suffix = unit ? " " + unit : "";
  if(hasMin && hasMax) return String(min) + " a " + String(max) + suffix;
  if(hasMin) return "Mínimo " + String(min) + suffix;
  return "Máximo " + String(max) + suffix;
}

function CMMS112_evidenceGallery_(evidencias){
  return (evidencias || []).map(function(e){
    return {
      id:e.id || "",
      title:e.nome_arquivo || "Evidência",
      subtitle:e.tipo || "",
      checklist_execucao_id:e.checklist_execucao_id || "",
      url:e.url || "",
      thumbnail_url:e.url || "",
      observacao:e.observacao || "",
      criado_em:e.criado_em || "",
      usuario_id:e.usuario_id || "",
      open_action:{label:"Abrir evidência", url:e.url || ""}
    };
  });
}

function CMMS112_messages_(base, progress, issues){
  issues = issues || {pending_responses:[], pending_evidence:[], technical_blockers:[]};
  var uiMsg = base.ui && base.ui.message || base.ui_actions && base.ui_actions.mensagem || "";
  var out = [];
  if(uiMsg && uiMsg.indexOf("Existem pendências, evidências ou bloqueios") >= 0) uiMsg = "Checklist em execução.";
  if(uiMsg) out.push({type:"info", text:uiMsg});

  if(progress.completo){
    out.push({type:"success", text:"Checklist completo. Finalização liberada se o botão estiver ativo."});
  } else {
    if(issues.pending_responses.length) out.push({type:"warning", code:"RESPOSTA_PENDENTE", text:"Existem " + issues.pending_responses.length + " resposta(s) obrigatória(s) pendente(s)."});
    if(issues.pending_evidence.length) out.push({type:"warning", code:"EVIDENCIA_PENDENTE", text:"Existem " + issues.pending_evidence.length + " evidência(s) obrigatória(s) pendente(s)."});
    if(!issues.pending_responses.length && !issues.pending_evidence.length && !issues.technical_blockers.length) out.push({type:"warning", text:"Checklist ainda não está completo."});
  }

  if(issues.technical_blockers.length) out.push({type:"danger", code:"BLOQUEIO_TECNICO", text:"Há " + issues.technical_blockers.length + " bloqueio(s) técnico(s) no checklist. Corrija antes de finalizar."});
  return out;
}

function CMMS112_payloadHints_(base, checklistRows){
  var acaoId = base.acao && base.acao.id || base.acao_id || "";
  return {
    salvar_lote:{
      endpoint:"operador.salvar_checklist_lote",
      payload:{acao_id:acaoId, itens:(checklistRows || []).map(function(i){ return {ordem:i.ordem, resposta:"", valor:"", observacao:""}; })},
      aceita:["ordem", "id", "item_id", "plano_item_id", "checklist_execucao_id"]
    },
    anexar_evidencia:{
      endpoint:"operador.registrar_evidencia",
      payload:{acao_id:acaoId, checklist_execucao_id:"CHK-...", tipo:"FOTO", nome_arquivo:"foto.jpg", url:"https://...", observacao:""}
    },
    finalizar:{
      endpoint:"operador.finalizar_acao",
      payload:{acao_id:acaoId, resultado:"OK", observacao:"Checklist técnico executado conforme procedimento."}
    }
  };
}

function CMMS112_homeResumo_(cards, baseResumo){
  var resumo = {total:(cards || []).length, pendentes:0, em_execucao:0, aguardando_validacao:0, concluidas:0, bloqueadas:0};
  (cards || []).forEach(function(c){
    var state = upper_(c.status && c.status.state || c.ui_state || "");
    if(state === "AGUARDANDO_INICIO" || state === ST.PENDENTE) resumo.pendentes++;
    else if(state === ST.EM_EXECUCAO) resumo.em_execucao++;
    else if(state === ST.AGUARDANDO_VALIDACAO) resumo.aguardando_validacao++;
    else if(state === ST.CONCLUIDA) resumo.concluidas++;
    else if(state.indexOf("BLOQUE") >= 0) resumo.bloqueadas++;
  });
  if(baseResumo && resumo.total === 0){
    resumo.total = num_(baseResumo.total, 0);
    resumo.pendentes = num_(baseResumo.aguardando_inicio, 0);
    resumo.em_execucao = num_(baseResumo.em_execucao, 0);
    resumo.aguardando_validacao = num_(baseResumo.aguardando_validacao, 0);
    resumo.concluidas = num_(baseResumo.concluidas, 0);
    resumo.bloqueadas = num_(baseResumo.bloqueadas, 0);
  }
  return resumo;
}

function CMMS112_tabs_(resumo){
  return [
    {id:"ativas", label:"Ativas", count:num_(resumo.pendentes,0)+num_(resumo.em_execucao,0), status:"PENDENTE,EM_EXECUCAO", selected:true},
    {id:"validacao", label:"Validação", count:num_(resumo.aguardando_validacao,0), status:"AGUARDANDO_VALIDACAO", selected:false},
    {id:"concluidas", label:"Concluídas", count:num_(resumo.concluidas,0), status:"CONCLUIDA", selected:false}
  ];
}

function CMMS112_progress_(p){
  p = p || {};
  var total = num_(p.total, 0);
  var respondidos = num_(p.respondidos, 0);
  var pendentes = CMMS112_count_(p.pendentes, p.pending_count);
  var evidenciasPendentes = CMMS112_count_(p.evidencias_pendentes, CMMS112_hasValue_(p.evidencias_pendentes_count) ? p.evidencias_pendentes_count : p.evidence_missing_count);
  var bloqueios = CMMS112_count_(p.bloqueios, p.blockers_count);
  var percentual = p.percentual !== undefined ? num_(p.percentual, 0) : (total > 0 ? Math.round((respondidos / total) * 100) : 0);
  if(percentual < 0) percentual = 0;
  if(percentual > 100) percentual = 100;
  return {
    total:total,
    respondidos:respondidos,
    pendentes:pendentes,
    percentual:percentual,
    evidencias_pendentes:evidenciasPendentes,
    bloqueios:bloqueios,
    completo:!!p.completo || (total > 0 && respondidos >= total && pendentes === 0 && evidenciasPendentes === 0 && bloqueios === 0),
    label:p.label || (respondidos + "/" + total + " respondidos")
  };
}

function CMMS112_count_(value, fallback){
  if(Array.isArray(value)) return value.length;
  if(value && typeof value === "object") return Object.keys(value).length;
  if(CMMS112_hasValue_(value)) return num_(value, 0);
  if(Array.isArray(fallback)) return fallback.length;
  if(fallback && typeof fallback === "object") return Object.keys(fallback).length;
  return num_(fallback, 0);
}

function CMMS112_typeMeta_(tipo){
  tipo = upper_(tipo || "OUTROS");
  var map = {
    CONFIRMACAO:{title:"Confirmações", description:"Itens simples de confirmação operacional.", component:"confirmacao", placeholder:"Confirmar execução."},
    OK_NOK:{title:"Condição OK/NOK", description:"Itens binários de inspeção técnica.", component:"ok_nok", placeholder:"Selecione OK, NOK ou NA."},
    NUMERO:{title:"Medições numéricas", description:"Medições com valor numérico e limite técnico.", component:"number", placeholder:"Informe o valor medido."},
    PARAMETRO:{title:"Parâmetros técnicos", description:"Parâmetros operacionais com unidade e faixa esperada.", component:"number", placeholder:"Informe o parâmetro."},
    LEITURA_OPERACIONAL:{title:"Leituras operacionais", description:"Leituras de campo como horímetro, pressão, temperatura ou corrente.", component:"number", placeholder:"Informe a leitura."},
    SELECAO:{title:"Seleções", description:"Escolha entre opções cadastradas.", component:"select", placeholder:"Selecione uma opção."},
    EVIDENCIA:{title:"Evidências", description:"Fotos ou documentos obrigatórios.", component:"evidence", placeholder:"Anexe evidência."},
    TEXTO:{title:"Observações", description:"Campo livre para observação técnica.", component:"textarea", placeholder:"Digite a observação."},
    INSTRUCAO:{title:"Instruções", description:"Orientações de leitura para o operador.", component:"readonly", placeholder:"Leia a instrução."},
    OUTROS:{title:"Outros itens", description:"Itens operacionais complementares.", component:"text", placeholder:"Preencha o item."}
  };
  return map[tipo] || map.OUTROS;
}

function CMMS112_button_(id, label, endpoint, enabled, tone, payload, disabledReason){
  return {id:id, label:label, endpoint:endpoint, enabled:!!enabled, tone:tone || "neutral", payload:payload || {}, disabled_reason:enabled ? "" : (disabledReason || "Indisponível neste momento.")};
}

function CMMS112_firstEnabledButton_(buttons){
  var preferred = ["finalizar", "salvar", "iniciar", "validar_finalizacao", "auditar"];
  for(var i=0;i<preferred.length;i++){
    var b = (buttons || []).filter(function(x){ return x.id === preferred[i] && x.enabled; })[0];
    if(b) return b;
  }
  return (buttons || []).filter(function(x){ return x.enabled; })[0] || null;
}

function CMMS112_primaryCardAction_(card, actions, badge){
  var acaoId = card.acao_id || card.id || "";
  if(actions && actions.pode_iniciar) return {label:"Iniciar", endpoint:"operador.iniciar_acao", payload:{acao_id:acaoId}, tone:"primary"};
  if(actions && actions.pode_salvar) return {label:"Abrir checklist", endpoint:"operador.tela_acao", payload:{acao_id:acaoId}, tone:"primary"};
  if(actions && actions.pode_finalizar) return {label:"Finalizar", endpoint:"operador.finalizar_acao", payload:{acao_id:acaoId}, tone:"success"};
  if(actions && actions.pode_validar) return {label:"Auditar", endpoint:"gestor.auditoria_execucao_checklist", payload:{acao_id:acaoId}, tone:"secondary"};
  return {label:"Ver detalhes", endpoint:"operador.tela_acao", payload:{acao_id:acaoId}, tone:"neutral"};
}

function CMMS112_secondaryCardActions_(card, actions){
  var acaoId = card.acao_id || card.id || "";
  var out = [{label:"Detalhes", endpoint:"operador.tela_acao", payload:{acao_id:acaoId}, enabled:true}];
  if(actions && actions.pode_anexar) out.push({label:"Anexar", endpoint:"operador.registrar_evidencia", payload:{acao_id:acaoId}, enabled:true});
  return out;
}

function CMMS112_responseValue_(item, tipo){
  if(tipo === "NUMERO" || tipo === "PARAMETRO" || tipo === "LEITURA_OPERACIONAL"){
    return CMMS112_value_(item.valor_numero !== undefined && item.valor_numero !== "" ? item.valor_numero : item.resposta);
  }
  return CMMS112_value_(item.resposta);
}

function CMMS112_itemTone_(item){
  var conf = upper_(item.conforme);
  var responded = bool_(item.respondido);
  var responsePending = !responded && bool_(item.obrigatorio);
  var evidencePending = bool_(item.evidencia_obrigatoria) && num_(item.evidencias_count, 0) === 0;
  if(responsePending || evidencePending) return "warning";
  if(conf === "NAO" || conf === "NOK") return "danger";
  if(conf === "SIM") return "success";
  return responded ? "neutral" : "muted";
}

function CMMS112_itemStateLabel_(item){
  var responded = bool_(item.respondido);
  if(bool_(item.evidencia_obrigatoria) && num_(item.evidencias_count, 0) === 0) return "Evidência pendente";
  if(!responded && bool_(item.obrigatorio)) return "Resposta pendente";
  if(!responded) return "Não respondido";
  var conf = upper_(item.conforme);
  if(conf === "SIM") return "Conforme";
  if(conf === "NAO") return "Não conforme";
  return "Respondido";
}

function CMMS112_priorityLabel_(p){
  var v = upper_(p);
  if(v === "CRITICA") return "Crítica";
  if(v === "ALTA") return "Alta";
  if(v === "MEDIA") return "Média";
  if(v === "BAIXA") return "Baixa";
  return clean_(p || "Normal");
}

function CMMS112_priorityTone_(p){
  var v = upper_(p);
  if(v === "CRITICA") return "danger";
  if(v === "ALTA") return "warning";
  if(v === "MEDIA") return "info";
  if(v === "BAIXA") return "neutral";
  return "neutral";
}

function CMMS112_hasValue_(v){
  return !(v === undefined || v === null || v === "");
}

function CMMS112_value_(v){
  return (v === 0 || v === "0") ? 0 : (v === undefined || v === null ? "" : v);
}

function CMMS112_join_(arr){
  return (arr || []).map(function(x){ return clean_(x); }).filter(Boolean).join(" — ");
}
