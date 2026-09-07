/**
 * FAB Control 1.0.8.3
 * Blindagem final de execução de checklist e payload limpo para UI.
 *
 * Regras:
 * - Checklist operacional só é respondido/finalizado por OPERADOR.
 * - Gestor não aprova ação se a execução estiver incompleta.
 * - Item obrigatório pendente, evidência obrigatória ausente ou item bloqueante não conforme impedem finalização.
 */

function cmmsExecucaoChecklistSchemaUpgrade1083_(p, usuario){
  var auth = usuario || p.__auth || {};
  if(upper_(auth.perfil) !== ROLE.ADMIN){
    err_("FORBIDDEN", "Somente ADMIN pode executar upgrade de execução de checklist.", 403);
  }

  var ss = getSpreadsheet_();
  Object.keys(SH).forEach(function(name){ ensureSheet_(ss, name, SH[name]); });

  syncReleaseVersionConfig_();

  invalidateRuntimeCache_();

  return {
    upgraded:true,
    version:FAB.VERSION,
    sheets:Object.keys(SH).length,
    regra:"Finalização e aprovação dependem de checklist completo, evidência obrigatória anexada e ausência de bloqueio técnico.",
    endpoints:[
      "operador.detalhar_checklist_execucao",
      "operador.validar_finalizacao_acao",
      "gestor.auditoria_execucao_checklist",
      "gestor.validar_acao",
      "operador.finalizar_acao"
    ]
  };
}

function operadorDetalharChecklistExecucao1083_(p, usuario){
  var auth = usuario || p.__auth || {};
  var ctx = CMMS1083_resolveExecucaoContext_(p);
  CMMS1083_requireReadAccess_(ctx.ex, auth);

  var validacao = CMMS1083_validateChecklistExecution_(ctx.ex.id);
  return CMMS1083_buildChecklistPayload_(ctx, validacao, auth);
}

function operadorValidarFinalizacaoAcao1083_(p, usuario){
  var auth = usuario || p.__auth || {};
  var ctx = CMMS1083_resolveExecucaoContext_(p);
  CMMS1083_requireReadAccess_(ctx.ex, auth);

  var validacao = CMMS1083_validateChecklistExecution_(ctx.ex.id);
  return {
    ok:true,
    acao_id:ctx.acao ? ctx.acao.id : ctx.ex.acao_id,
    execucao_id:ctx.ex.id,
    operador_id:ctx.ex.operador_id,
    finalizacao:validacao.finalizacao,
    can_finalize:validacao.can_finalize,
    message:validacao.can_finalize ? "Checklist liberado para finalização." : CMMS1083_buildChecklistBlockMessage_(validacao),
    pendencias:{
      obrigatorias:validacao.pendentes,
      evidencias:validacao.evidencias_pendentes,
      bloqueios:validacao.bloqueios
    }
  };
}

function gestorAuditoriaExecucaoChecklist1083_(p, usuario){
  var auth = usuario || p.__auth || {};
  if([ROLE.ADMIN, ROLE.GESTOR].indexOf(upper_(auth.perfil)) < 0){
    err_("FORBIDDEN", "Somente ADMIN ou GESTOR pode consultar auditoria de execução.", 403);
  }

  var ctx = CMMS1083_resolveExecucaoContext_(p);
  var validacao = CMMS1083_validateChecklistExecution_(ctx.ex.id);
  var itens = CMMS1083_itemsByExecucao_(ctx.ex.id);
  var evs = rows_("evidencias").filter(function(e){ return String(e.execucao_id) === String(ctx.ex.id); });
  var hist = rows_("historico").filter(function(h){
    return String(h.execucao_id) === String(ctx.ex.id) || String(h.acao_id) === String(ctx.ex.acao_id);
  }).sort(sortByDateDesc_("criado_em")).map(strip_);

  var operadorId = clean_(ctx.ex.operador_id);
  var checklistDivergente = itens.filter(function(i){
    return clean_(i.responsavel_id) && String(clean_(i.responsavel_id)) !== String(operadorId);
  }).map(function(i){ return {id:i.id, ordem:i.ordem, titulo:i.titulo, responsavel_id:i.responsavel_id, esperado:operadorId}; });

  var evidenciasDivergentes = evs.filter(function(e){
    return clean_(e.usuario_id) && String(clean_(e.usuario_id)) !== String(operadorId);
  }).map(function(e){ return {id:e.id, checklist_execucao_id:e.checklist_execucao_id, usuario_id:e.usuario_id, esperado:operadorId}; });

  var histFinalizacao = hist.filter(function(h){ return upper_(h.evento) === "ACAO_FINALIZADA_OPERADOR"; });
  var historicoDivergente = histFinalizacao.filter(function(h){
    return String(clean_(h.usuario_id)) !== String(operadorId) || upper_(h.perfil) !== ROLE.OPERADOR;
  }).map(function(h){ return {id:h.id, evento:h.evento, usuario_id:h.usuario_id, perfil:h.perfil, esperado_usuario_id:operadorId, esperado_perfil:ROLE.OPERADOR}; });

  var auditoriaOk = checklistDivergente.length === 0 && evidenciasDivergentes.length === 0 && historicoDivergente.length === 0;

  return {
    ok:true,
    acao:ctx.acao ? strip_(ctx.acao) : null,
    os:ctx.os ? strip_(ctx.os) : null,
    execucao:strip_(ctx.ex),
    operador_id:operadorId,
    finalizacao:validacao.finalizacao,
    auditoria:{
      integridade_ok:auditoriaOk,
      checklist_autoria_ok:checklistDivergente.length === 0,
      evidencias_autoria_ok:evidenciasDivergentes.length === 0,
      historico_finalizacao_ok:historicoDivergente.length === 0,
      divergencias:{
        checklist:checklistDivergente,
        evidencias:evidenciasDivergentes,
        historico:historicoDivergente
      }
    },
    historico:hist
  };
}

function gestorValidarAcao1083_(p){
  req_(p, ["acao_id", "decisao"]);
  var auth = p.__auth || {};
  var acao = find_("os_acoes", "id", p.acao_id);
  if(!acao) err_("ACTION_NOT_FOUND", "Ação não encontrada.", 404);

  var dec = upper_(p.decisao);
  if(["APROVAR", "REPROVAR"].indexOf(dec) < 0){
    err_("INVALID_DECISION", "Decisão deve ser APROVAR ou REPROVAR.", 400);
  }

  var st = upper_(acao.status);
  if(dec === "APROVAR" && st === ST.CONCLUIDA){
    syncOsStatus_(acao.os_id);
    return {
      validated:true,
      already_validated:true,
      acao_id:acao.id,
      decisao:dec,
      status:ST.CONCLUIDA
    };
  }
  if(dec === "REPROVAR" && st === ST.PENDENTE){
    return {
      validated:true,
      already_validated:true,
      acao_id:acao.id,
      decisao:dec,
      status:ST.PENDENTE
    };
  }
  if(st !== ST.AGUARDANDO_VALIDACAO){
    err_(
      "INVALID_STATUS",
      "Ação não está aguardando validação. Status atual: "+acao.status,
      400
    );
  }

  if(dec === "APROVAR"){
    var ctx = CMMS1083_resolveExecucaoContext_({acao_id:acao.id});
    var resultadoOperacional = typeof resultadoOperacionalDaObservacao120_ === "function"
      ? resultadoOperacionalDaObservacao120_(ctx.ex.observacao)
      : "";

    if(resultadoOperacional){
      validarFinalizacaoOperacional120_(
        ctx.ex.id,
        resultadoOperacional,
        ctx.ex.observacao
      );
    } else {
      var validacao = CMMS1083_validateChecklistExecution_(ctx.ex.id);
      if(!validacao.can_finalize){
        err_(
          "CHECKLIST_INCOMPLETO_GESTOR",
          "Gestor não pode aprovar ação com checklist incompleto. "+
            CMMS1083_buildChecklistBlockMessage_(validacao),
          400
        );
      }
    }
  }

  var novo = dec === "APROVAR" ? ST.CONCLUIDA : ST.PENDENTE;
  update_("os_acoes", acao.__rowIndex, {status:novo, atualizado_em:now_()});
  acao.status = novo;
  refreshPlanoControleStatus_(acao);
  syncOsStatus_(acao.os_id);
  releaseLocksForAction_(acao.id, "VALIDACAO_GESTOR");

  hist_({
    ativo_id:acao.ativo_id,
    componente_id:acao.componente_id,
    os_id:acao.os_id,
    acao_id:acao.id,
    evento:dec === "APROVAR" ? "ACAO_APROVADA" : "ACAO_REPROVADA",
    descricao:clean_(p.comentario),
    usuario_id:auth.usuario_id||"",
    perfil:auth.perfil||ROLE.GESTOR
  });

  return {
    validated:true,
    acao_id:acao.id,
    decisao:dec,
    status:novo
  };
}

function CMMS1083_validateChecklistExecution_(execId){
  var ex = find_("execucoes", "id", execId);
  if(!ex) err_("EXECUTION_NOT_FOUND", "Execução não encontrada: "+execId, 404);

  var itens = CMMS1083_itemsByExecucao_(ex.id);
  if(!itens.length) err_("CHECKLIST_VAZIO", "Execução não possui checklist gerado.", 400);

  var evs = rows_("evidencias").filter(function(e){ return String(e.execucao_id) === String(ex.id); });
  var evByItem = {};
  evs.forEach(function(e){
    var k = String(clean_(e.checklist_execucao_id));
    if(!k) return;
    evByItem[k] = evByItem[k] || [];
    evByItem[k].push(e);
  });

  var pendentes = [];
  var evidenciasPendentes = [];
  var bloqueios = [];
  var respondidos = 0;

  itens.forEach(function(i){
    var tipo = upper_(i.tipo_resposta);
    var evidenciasItem = evByItem[String(i.id)] || [];
    var respondido = CMMS1083_itemRespondido_(i, evidenciasItem);
    var obrigatorio = bool_(i.obrigatorio);
    var exigeEvidencia = CMMS1083_itemExigeEvidencia_(i);

    if(respondido) respondidos++;

    if(obrigatorio && tipo !== "INSTRUCAO" && !respondido){
      pendentes.push(CMMS1083_pendenciaItem_(i, "RESPOSTA_PENDENTE"));
    }

    var minimoEvidencias = typeof evidenciaMinFotos116_ === "function" ? evidenciaMinFotos116_(i) : (exigeEvidencia ? 1 : 0);
    if(exigeEvidencia && evidenciasItem.length < minimoEvidencias){
      var pendenciaEvidencia = CMMS1083_pendenciaItem_(i, "EVIDENCIA_PENDENTE");
      pendenciaEvidencia.evidencias_count = evidenciasItem.length;
      pendenciaEvidencia.evidencia_min_fotos = minimoEvidencias;
      evidenciasPendentes.push(pendenciaEvidencia);
    }

    if(bool_(i.bloqueia_finalizacao) && upper_(i.conforme) === "NAO"){
      bloqueios.push(CMMS1083_pendenciaItem_(i, "ITEM_BLOQUEANTE_NAO_CONFORME"));
    }
  });

  var canFinalize = pendentes.length === 0 && evidenciasPendentes.length === 0 && bloqueios.length === 0;

  return {
    ok:true,
    execucao_id:ex.id,
    acao_id:ex.acao_id,
    can_finalize:canFinalize,
    total:itens.length,
    respondidos:respondidos,
    pendentes:pendentes,
    evidencias_pendentes:evidenciasPendentes,
    bloqueios:bloqueios,
    finalizacao:{
      ok:true,
      can_finalize:canFinalize,
      total:itens.length,
      respondidos:respondidos,
      pendentes:pendentes,
      evidencias_pendentes:evidenciasPendentes,
      bloqueios:bloqueios
    }
  };
}

function CMMS1083_buildChecklistBlockMessage_(v){
  var partes = [];
  if(v.pendentes && v.pendentes.length){
    partes.push("Itens obrigatórios pendentes: "+v.pendentes.map(function(i){ return i.titulo; }).join("; "));
  }
  if(v.evidencias_pendentes && v.evidencias_pendentes.length){
    partes.push("Evidências obrigatórias pendentes: "+v.evidencias_pendentes.map(function(i){ return i.titulo; }).join("; "));
  }
  if(v.bloqueios && v.bloqueios.length){
    partes.push("Itens bloqueantes não conformes: "+v.bloqueios.map(function(i){ return i.titulo; }).join("; "));
  }
  return partes.length ? partes.join(" | ") : "Checklist não liberado para finalização.";
}

function CMMS1083_resolveExecucaoContext_(p){
  var execId = clean_(p.execucao_id);
  var acaoId = clean_(p.acao_id);

  if(!execId && !acaoId) err_("ID_REQUIRED", "Informe execucao_id ou acao_id.", 400);

  var ex = null;
  var acao = null;

  if(execId){
    ex = find_("execucoes", "id", execId);
    if(!ex) err_("EXECUTION_NOT_FOUND", "Execução não encontrada: "+execId, 404);
    acao = ex.acao_id ? find_("os_acoes", "id", ex.acao_id) : null;
  } else {
    acao = find_("os_acoes", "id", acaoId);
    if(!acao) err_("ACTION_NOT_FOUND", "Ação não encontrada: "+acaoId, 404);
    var execs = rows_("execucoes").filter(function(e){ return String(e.acao_id) === String(acao.id); }).sort(sortByDateDesc_("criado_em"));
    if(!execs.length) err_("EXECUTION_NOT_FOUND", "Ação ainda não possui execução iniciada: "+acao.id, 404);
    ex = execs[0];
  }

  if(!acao && ex.acao_id) acao = find_("os_acoes", "id", ex.acao_id);
  var os = acao && acao.os_id ? find_("ordens_servico", "id", acao.os_id) : null;
  var ativo = ex.ativo_id ? find_("ativos", "id", ex.ativo_id) : null;
  var componente = ex.componente_id ? find_("componentes", "id", ex.componente_id) : null;

  return {execucao:ex, ex:ex, acao:acao, os:os, ativo:ativo, componente:componente};
}

function CMMS1083_requireReadAccess_(ex, auth){
  auth = auth || {};
  if(upper_(auth.perfil) === ROLE.OPERADOR){
    if(String(clean_(ex.operador_id)) !== String(clean_(auth.usuario_id))){
      err_("EXECUTION_OWNERSHIP_MISMATCH", "Execução pertence ao operador "+ex.operador_id+". Token informado: "+auth.usuario_id, 403);
    }
  }
}

function CMMS1083_itemsByExecucao_(execId){
  return rows_("checklist_execucao").filter(function(i){
    return String(i.execucao_id) === String(execId);
  }).sort(function(a,b){ return num_(a.ordem,0)-num_(b.ordem,0); });
}

function CMMS1083_itemRespondido_(i, evidenciasItem){
  var tipo = upper_(i.tipo_resposta);
  if(tipo === "INSTRUCAO") return true;
  if(tipo === "EVIDENCIA"){
    var minimo = typeof evidenciaMinFotos116_ === "function" ? evidenciaMinFotos116_(i) : 1;
    return (evidenciasItem || []).length >= minimo;
  }
  if(upper_(i.status) === ST.RESPONDIDO) return true;
  if(clean_(i.resposta) !== "") return true;
  return false;
}

function CMMS1083_itemExigeEvidencia_(i){
  return (typeof evidenciaMinFotos116_ === "function" ? evidenciaMinFotos116_(i) : (upper_(i.tipo_resposta) === "EVIDENCIA" || bool_(i.evidencia_obrigatoria) ? 1 : 0)) > 0;
}

function CMMS1083_pendenciaItem_(i, motivo){
  return {
    id:i.id,
    ordem:num_(i.ordem,0),
    titulo:i.titulo,
    tipo_resposta:upper_(i.tipo_resposta),
    obrigatorio:bool_(i.obrigatorio),
    evidencia_obrigatoria:CMMS1083_itemExigeEvidencia_(i),
    evidencia_min_fotos:typeof evidenciaMinFotos116_ === "function" ? evidenciaMinFotos116_(i) : (CMMS1083_itemExigeEvidencia_(i) ? 1 : 0),
    bloqueia_finalizacao:bool_(i.bloqueia_finalizacao),
    motivo:motivo
  };
}

function CMMS1083_buildChecklistPayload_(ctx, validacao, auth){
  var itens = CMMS1083_itemsByExecucao_(ctx.ex.id).map(function(i){
    return CMMS1083_cleanChecklistItem_(i);
  });

  return {
    ok:true,
    version:FAB.VERSION,
    perfil:auth ? auth.perfil : "",
    acao:ctx.acao ? {
      id:ctx.acao.id,
      os_id:ctx.acao.os_id,
      plano_id:ctx.acao.plano_id,
      titulo:ctx.acao.titulo,
      descricao:ctx.acao.descricao,
      tipo:ctx.acao.tipo,
      prioridade:ctx.acao.prioridade,
      status:ctx.acao.status,
      responsavel_id:ctx.acao.responsavel_id,
      gerado_em:ctx.acao.gerado_em,
      iniciado_em:ctx.acao.iniciado_em,
      finalizado_em:ctx.acao.finalizado_em
    } : null,
    os:ctx.os ? {
      id:ctx.os.id,
      codigo:ctx.os.codigo,
      status:ctx.os.status,
      prioridade:ctx.os.prioridade,
      titulo:ctx.os.titulo
    } : null,
    ativo:ctx.ativo ? {
      id:ctx.ativo.id,
      tag:ctx.ativo.tag,
      nome:ctx.ativo.nome,
      tipo:ctx.ativo.tipo,
      criticidade:ctx.ativo.criticidade,
      status:ctx.ativo.status,
      saude_pct:ctx.ativo.saude_pct,
      horimetro_atual:ctx.ativo.horimetro_atual,
      horimetro_modo:ctx.ativo.horimetro_modo || "MANUAL",
      horimetro_atualizado_em:ctx.ativo.horimetro_atualizado_em || "",
      horimetro_base_servico:ctx.ativo.horimetro_base_servico,
      horimetro_base_servico_em:ctx.ativo.horimetro_base_servico_em || ""
    } : null,
    horimetro:ctx.ativo && typeof horimetroResumo116_ === "function" ? horimetroResumo116_(ctx.ativo) : null,
    componente:ctx.componente ? {
      id:ctx.componente.id,
      tag:ctx.componente.tag,
      nome:ctx.componente.nome,
      tipo:ctx.componente.tipo,
      criticidade:ctx.componente.criticidade,
      status:ctx.componente.status
    } : null,
    execucao:{
      id:ctx.ex.id,
      acao_id:ctx.ex.acao_id,
      operador_id:ctx.ex.operador_id,
      status:ctx.ex.status,
      resultado:ctx.ex.resultado,
      observacao:ctx.ex.observacao,
      abriu_em:ctx.ex.abriu_em,
      iniciou_em:ctx.ex.iniciou_em,
      finalizou_em:ctx.ex.finalizou_em,
      duracao_segundos:ctx.ex.duracao_segundos
    },
    finalizacao:validacao.finalizacao,
    itens:itens
  };
}

function CMMS1083_cleanChecklistItem_(i){
  var evidencias = rows_("evidencias").filter(function(e){
    return String(e.checklist_execucao_id) === String(i.id);
  }).map(strip_);

  var tipo = upper_(i.tipo_resposta);
  return {
    id:i.id,
    execucao_id:i.execucao_id,
    acao_id:i.acao_id,
    plano_item_id:i.plano_item_id,
    ordem:num_(i.ordem,0),
    titulo:i.titulo,
    instrucao:i.instrucao,
    tipo_resposta:tipo,
    categoria:i.categoria || "",
    obrigatorio:bool_(i.obrigatorio),
    evidencia_obrigatoria:CMMS1083_itemExigeEvidencia_(i),
    evidencia_min_fotos:typeof evidenciaMinFotos116_ === "function" ? evidenciaMinFotos116_(i) : (CMMS1083_itemExigeEvidencia_(i) ? 1 : 0),
    bloqueia_finalizacao:bool_(i.bloqueia_finalizacao),
    parametro_nome:i.parametro_nome || "",
    valor_esperado:i.valor_esperado || "",
    opcoes:parseOpcoes_(i.opcoes_json),
    limite_min:i.limite_min,
    limite_max:i.limite_max,
    unidade:i.unidade || "",
    resposta:i.resposta,
    valor_numero:i.valor_numero,
    observacao:i.observacao,
    conforme:i.conforme,
    validacao_msg:i.validacao_msg,
    status:i.status,
    responsavel_id:i.responsavel_id,
    data_hora:i.data_hora,
    respondido:CMMS1083_itemRespondido_(i, evidencias),
    evidencias_count:evidencias.length,
    evidencias:evidencias
  };
}
