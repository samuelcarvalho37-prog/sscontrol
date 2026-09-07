/**
 * FAB Control 1.0.9
 * Contrato de tela do operador + salvamento em lote de checklist.
 *
 * Objetivo:
 * - Reduzir quantidade de chamadas do app/Postman.
 * - Entregar payload pronto para UI operacional.
 * - Manter a regra: quem responde checklist operacional é sempre OPERADOR.
 */

function cmmsOperadorUiSchemaUpgrade109_(p, usuario){
  var auth = usuario || p.__auth || {};
  if(upper_(auth.perfil) !== ROLE.ADMIN){
    err_("FORBIDDEN", "Somente ADMIN pode executar upgrade do pacote de UI do operador.", 403);
  }

  var ss = getSpreadsheet_();
  Object.keys(SH).forEach(function(name){ ensureSheet_(ss, name, SH[name]); });

  syncReleaseVersionConfig_();

  invalidateRuntimeCache_();

  return {
    upgraded:true,
    version:FAB.VERSION,
    sheets:Object.keys(SH).length,
    regra:"UI operacional usa tela consolidada, fila de ações e salvamento em lote sem liberar finalização incompleta.",
    endpoints:[
      "operador.minhas_acoes",
      "operador.tela_acao",
      "operador.salvar_checklist_lote",
      "operador.detalhar_checklist_execucao",
      "operador.validar_finalizacao_acao",
      "operador.finalizar_acao"
    ]
  };
}

function operadorMinhasAcoes109_(p, usuario){
  var auth = requireOperadorAuth1081_(usuario || p.__auth || {}, "operador.minhas_acoes");
  var limite = Math.min(num_(p.limite, 50), 200);
  var statuses = clean_(p.status || "PENDENTE,EM_EXECUCAO").split(",").map(upper_).filter(Boolean);
  var ativoId = clean_(p.ativo_id);
  var componenteId = clean_(p.componente_id);

  var acoes = rows_("os_acoes").filter(function(a){
    var st = upper_(a.status);
    if(statuses.length && statuses.indexOf(st) < 0) return false;
    if(ativoId && String(a.ativo_id) !== String(ativoId)) return false;
    if(componenteId && String(a.componente_id) !== String(componenteId)) return false;

    // Ação pendente sem responsável pode aparecer para o operador.
    // Ação já em execução só aparece para o operador dono.
    if(st === ST.EM_EXECUCAO && clean_(a.responsavel_id) && String(clean_(a.responsavel_id)) !== String(clean_(auth.usuario_id))) return false;
    return true;
  }).sort(function(a,b){
    var pa = CMMS109_prioridadePeso_(a.prioridade);
    var pb = CMMS109_prioridadePeso_(b.prioridade);
    if(pa !== pb) return pb - pa;
    return String(a.gerado_em || "").localeCompare(String(b.gerado_em || ""));
  }).slice(0, limite).map(function(a){
    return CMMS109_buildActionCard_(a, auth);
  });

  return {
    ok:true,
    version:FAB.VERSION,
    operador_id:auth.usuario_id,
    total:acoes.length,
    status:statuses,
    acoes:acoes
  };
}

function operadorTelaAcao109_(p, usuario){
  var auth = usuario || p.__auth || {};
  req_(p, ["acao_id"]);

  var acao = find_("os_acoes", "id", p.acao_id);
  if(!acao) err_("ACTION_NOT_FOUND", "Ação não encontrada: "+p.acao_id, 404);

  var execs = rows_("execucoes").filter(function(e){ return String(e.acao_id) === String(acao.id); }).sort(sortByDateDesc_("criado_em"));
  var ex = execs.length ? execs[0] : null;

  if(ex){
    CMMS1083_requireReadAccess_(ex, auth);
    var payload = operadorDetalharChecklistExecucao1083_({acao_id:acao.id, __auth:auth}, auth);
    payload.ui = CMMS109_uiState_(acao, ex, auth, payload.finalizacao);
    payload.next_actions = CMMS109_nextActions_(payload.ui);
    return payload;
  }

  if(upper_(auth.perfil) === ROLE.OPERADOR){
    var resp = clean_(acao.responsavel_id);
    if(resp && String(resp) !== String(clean_(auth.usuario_id))){
      err_("ACTION_ASSIGNED_TO_OTHER", "Ação vinculada a outro operador: "+resp, 403);
    }
  }

  var ctx = CMMS109_actionContext_(acao);
  var itensModelo = rows_("plano_itens").filter(function(i){
    return String(i.plano_id) === String(acao.plano_id) && upper_(i.status || ST.ATIVO) === ST.ATIVO;
  }).sort(function(a,b){ return num_(a.ordem,0)-num_(b.ordem,0); }).map(CMMS109_cleanPlanoItem_);

  return {
    ok:true,
    version:FAB.VERSION,
    perfil:auth.perfil || "",
    acao:CMMS109_cleanAcao_(acao),
    os:ctx.os ? CMMS109_cleanOs_(ctx.os) : null,
    ativo:ctx.ativo ? CMMS109_cleanAtivo_(ctx.ativo) : null,
    componente:ctx.componente ? CMMS109_cleanComponente_(ctx.componente) : null,
    plano:ctx.plano ? CMMS109_cleanPlano_(ctx.plano) : null,
    execucao:null,
    checklist:{
      modelo:true,
      total:itensModelo.length,
      itens:itensModelo
    },
    finalizacao:{
      ok:true,
      can_finalize:false,
      total:itensModelo.length,
      respondidos:0,
      pendentes:itensModelo.filter(function(i){ return i.obrigatorio && i.tipo_resposta !== "INSTRUCAO"; })
    },
    ui:{
      state:"AGUARDANDO_INICIO",
      can_start:upper_(acao.status) === ST.PENDENTE,
      can_answer:false,
      can_finalize:false,
      can_register_evidence:false,
      message:"Inicie a ação para gerar a execução e o checklist operacional."
    },
    next_actions:["operador.iniciar_acao"]
  };
}

function operadorSalvarChecklistLote109_(p, usuario){
  var auth = requireOperadorAuth1081_(usuario || p.__auth || {}, "operador.salvar_checklist_lote");
  req_(p, ["itens"]);
  if(!Array.isArray(p.itens) || !p.itens.length){
    err_("CHECKLIST_BATCH_EMPTY", "Informe itens[] com pelo menos um item de checklist.", 400);
  }

  var salvos = [];
  var erros = [];
  p.itens.forEach(function(raw, idx){
    var itemPayload = Object.assign({}, raw || {});
    itemPayload.__auth = auth;
    if(!itemPayload.checklist_execucao_id && itemPayload.id) itemPayload.checklist_execucao_id = itemPayload.id;

    try{
      var saved = operadorSalvarChecklistItem_(itemPayload);
      saved.index = idx;
      salvos.push(saved);
    } catch(e){
      var er = CMMS109_normErr_(e);
      erros.push({
        index:idx,
        checklist_execucao_id:itemPayload.checklist_execucao_id || "",
        code:er.code,
        message:er.message,
        status:er.status
      });
    }
  });

  var acaoId = clean_(p.acao_id);
  var execucaoId = clean_(p.execucao_id);
  if(!acaoId && salvos.length){
    var first = find_("checklist_execucao", "id", salvos[0].checklist_execucao_id);
    if(first){ acaoId = first.acao_id; execucaoId = first.execucao_id; }
  }

  var validacao = null;
  if(execucaoId){
    validacao = CMMS1083_validateChecklistExecution_(execucaoId);
  } else if(acaoId){
    var ex = latestExecucaoAcao1081_(acaoId);
    if(ex){ execucaoId = ex.id; validacao = CMMS1083_validateChecklistExecution_(ex.id); }
  }

  return {
    ok:erros.length === 0,
    version:FAB.VERSION,
    saved_count:salvos.length,
    error_count:erros.length,
    salvos:salvos,
    erros:erros,
    acao_id:acaoId,
    execucao_id:execucaoId,
    finalizacao:validacao ? validacao.finalizacao : null,
    can_finalize:validacao ? validacao.can_finalize : false,
    message:erros.length ? "Lote salvo parcialmente. Corrija os itens com erro." : "Lote salvo com sucesso."
  };
}

function CMMS109_buildActionCard_(acao, auth){
  var ctx = CMMS109_actionContext_(acao);
  var ex = latestExecucaoAcao1081_(acao.id);
  var validacao = null;
  var progress = null;

  if(ex){
    try{
      validacao = CMMS1083_validateChecklistExecution_(ex.id);
      progress = validacao.finalizacao;
    } catch(e){
      progress = {ok:false, error:CMMS109_normErr_(e)};
    }
  } else {
    var totalModelo = rows_("plano_itens").filter(function(i){
      return String(i.plano_id) === String(acao.plano_id) && upper_(i.status || ST.ATIVO) === ST.ATIVO;
    }).length;
    progress = {ok:true, total:totalModelo, respondidos:0, pendentes_count:totalModelo, can_finalize:false};
  }

  var ui = CMMS109_uiState_(acao, ex, auth, progress);

  return {
    acao:CMMS109_cleanAcao_(acao),
    os:ctx.os ? CMMS109_cleanOs_(ctx.os) : null,
    ativo:ctx.ativo ? CMMS109_cleanAtivo_(ctx.ativo) : null,
    componente:ctx.componente ? CMMS109_cleanComponente_(ctx.componente) : null,
    plano:ctx.plano ? CMMS109_cleanPlano_(ctx.plano) : null,
    execucao:ex ? CMMS109_cleanExecucao_(ex) : null,
    checklist_progress:progress,
    ui:ui,
    next_actions:CMMS109_nextActions_(ui)
  };
}

function CMMS109_actionContext_(acao){
  return {
    os:acao.os_id ? find_("ordens_servico", "id", acao.os_id) : null,
    ativo:acao.ativo_id ? find_("ativos", "id", acao.ativo_id) : null,
    componente:acao.componente_id ? find_("componentes", "id", acao.componente_id) : null,
    plano:acao.plano_id ? find_("planos_manutencao", "id", acao.plano_id) : null
  };
}

function CMMS109_uiState_(acao, ex, auth, finalizacao){
  var st = upper_(acao.status);
  var perfil = upper_(auth && auth.perfil);
  var userId = clean_(auth && auth.usuario_id);
  var dono = ex ? clean_(ex.operador_id) : clean_(acao.responsavel_id);
  var own = !dono || String(dono) === String(userId);
  var canFinalize = !!(finalizacao && (finalizacao.can_finalize || finalizacao.can_finalize === true));

  if(!ex && typeof acaoDisponivelInicioQr119_ === "function" && acaoDisponivelInicioQr119_(acao)){
    return {state:"AGUARDANDO_INICIO", can_start:perfil === ROLE.OPERADOR && own, can_answer:false, can_finalize:false, can_register_evidence:false, message:"Ação pendente. Inicie para gerar o checklist."};
  }
  if(st === ST.EM_EXECUCAO && ex && own){
    return {state:"EM_EXECUCAO", can_start:false, can_answer:perfil === ROLE.OPERADOR, can_finalize:perfil === ROLE.OPERADOR && canFinalize, can_register_evidence:perfil === ROLE.OPERADOR, message:canFinalize ? "Checklist completo. Finalização liberada." : "Checklist em execução. Existem pendências ou bloqueios."};
  }
  if(st === ST.AGUARDANDO_VALIDACAO){
    return {state:"AGUARDANDO_VALIDACAO", can_start:false, can_answer:false, can_finalize:false, can_register_evidence:false, message:"Execução finalizada. Aguardando validação da gestão."};
  }
  if(st === ST.CONCLUIDA){
    return {state:"CONCLUIDA", can_start:false, can_answer:false, can_finalize:false, can_register_evidence:false, message:"Ação concluída."};
  }
  if(!own){
    return {state:"BLOQUEADA_POR_OUTRO_OPERADOR", can_start:false, can_answer:false, can_finalize:false, can_register_evidence:false, message:"Ação vinculada a outro operador."};
  }
  return {state:st || "INDEFINIDO", can_start:false, can_answer:false, can_finalize:false, can_register_evidence:false, message:"Status operacional não editável: "+st};
}

function CMMS109_nextActions_(ui){
  var out = [];
  if(ui.can_start) out.push("operador.iniciar_acao");
  if(ui.can_answer) out.push("operador.salvar_checklist_lote");
  if(ui.can_register_evidence) out.push("operador.registrar_evidencia");
  if(ui.can_finalize) out.push("operador.finalizar_acao");
  return out;
}

function CMMS109_prioridadePeso_(p){
  p = upper_(p);
  if(p === "CRITICA") return 4;
  if(p === "ALTA") return 3;
  if(p === "MEDIA") return 2;
  if(p === "BAIXA") return 1;
  return 0;
}

function CMMS109_cleanAcao_(a){
  return {
    id:a.id, os_id:a.os_id, ativo_id:a.ativo_id, componente_id:a.componente_id, plano_id:a.plano_id,
    origem:a.origem, tipo:a.tipo, titulo:a.titulo, descricao:a.descricao, prioridade:a.prioridade,
    status:a.status, responsavel_id:a.responsavel_id, gerado_em:a.gerado_em, iniciado_em:a.iniciado_em,
    finalizado_em:a.finalizado_em, atualizado_em:a.atualizado_em,
    modo_parada_manutencao:normalizaModoParadaManutencao115_(a.modo_parada_manutencao),
    analise_tecnica_json:a.analise_tecnica_json
  };
}

function CMMS109_cleanOs_(o){
  return {id:o.id, codigo:o.codigo, titulo:o.titulo, descricao:o.descricao, prioridade:o.prioridade, status:o.status, aberta_em:o.aberta_em, planejada_para:o.planejada_para, iniciada_em:o.iniciada_em, finalizada_em:o.finalizada_em, analise_tecnica_json:o.analise_tecnica_json};
}

function CMMS109_cleanAtivo_(a){
  return {id:a.id, linha_id:a.linha_id, tag:a.tag, qr_payload:a.qr_payload, nome:a.nome, tipo:a.tipo, criticidade:a.criticidade, status:a.status, saude_pct:a.saude_pct, horimetro_atual:a.horimetro_atual, horimetro_modo:a.horimetro_modo, horimetro_atualizado_em:a.horimetro_atualizado_em, fabricante:a.fabricante, modelo:a.modelo, numero_serie:a.numero_serie, localizacao_tecnica:a.localizacao_tecnica};
}

function CMMS109_cleanComponente_(c){
  return {id:c.id, ativo_id:c.ativo_id, tag:c.tag, qr_payload:c.qr_payload, nome:c.nome, tipo:c.tipo, criticidade:c.criticidade, status:c.status, vida_util_horas:c.vida_util_horas, horas_acumuladas:c.horas_acumuladas, fabricante:c.fabricante, modelo:c.modelo, numero_serie:c.numero_serie, localizacao_tecnica:c.localizacao_tecnica};
}

function CMMS109_cleanPlano_(p){
  return {id:p.id, nome:p.nome, tipo:p.tipo, criticidade:p.criticidade, gatilho_tipo:p.gatilho_tipo, gatilho_valor:p.gatilho_valor, unidade:p.unidade, tempo_estimado_min:p.tempo_estimado_min, requer_bloqueio:p.requer_bloqueio, requer_evidencia:p.requer_evidencia, max_sessoes:p.max_sessoes, status:p.status, workflow_status:p.workflow_status, revisao:p.revisao, modo_parada_manutencao:normalizaModoParadaManutencao115_(p.modo_parada_manutencao), analise_tecnica_json:p.analise_tecnica_json};
}

function CMMS109_cleanExecucao_(e){
  return {id:e.id, acao_id:e.acao_id, os_id:e.os_id, ativo_id:e.ativo_id, componente_id:e.componente_id, operador_id:e.operador_id, resultado:e.resultado, observacao:e.observacao, duracao_segundos:e.duracao_segundos, abriu_em:e.abriu_em, iniciou_em:e.iniciou_em, finalizou_em:e.finalizou_em, status:e.status, modo_execucao_manutencao:e.modo_execucao_manutencao};
}

function CMMS109_cleanPlanoItem_(i){
  return {
    id:i.id, ordem:num_(i.ordem,0), titulo:i.titulo, instrucao:i.instrucao,
    tipo_resposta:upper_(i.tipo_resposta), obrigatorio:bool_(i.obrigatorio), evidencia_obrigatoria:bool_(i.evidencia_obrigatoria),
    foto_referencia_url:i.foto_referencia_url || "", limite_min:i.limite_min, limite_max:i.limite_max,
    unidade:i.unidade || "", parametro_nome:i.parametro_nome || "", valor_esperado:i.valor_esperado || "",
    opcoes:parseOpcoes_(i.opcoes_json), bloqueia_finalizacao:bool_(i.bloqueia_finalizacao), categoria:i.categoria || "", peso:num_(i.peso,1)
  };
}

function CMMS109_normErr_(e){
  if(typeof normErr_ === "function") return normErr_(e);
  if(e && typeof e === "object"){
    return {status:e.status || 500, code:e.code || "ERROR", message:e.message || String(e)};
  }
  try{
    var parsed = JSON.parse(String(e));
    return {status:parsed.status || 500, code:parsed.code || "ERROR", message:parsed.message || String(e)};
  } catch(x){
    return {status:500, code:"ERROR", message:String(e)};
  }
}
