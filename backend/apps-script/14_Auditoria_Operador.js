/**
 * FAB Control 1.0.8.3
 * Correção de autoria operacional e reparo de auditoria de checklist.
 * Regra: execução de checklist é ato de OPERADOR; ADMIN cria/configura, GESTOR valida.
 */

function cmmsAuditoriaOperadorSchemaUpgrade1081_(p, usuario){
  var auth = usuario || p.__auth || {};
  if(auth.perfil !== ROLE.ADMIN) err_("FORBIDDEN", "Somente ADMIN pode executar upgrade de auditoria operacional.", 403);
  var ss = getSpreadsheet_();
  Object.keys(SH).forEach(function(name){ ensureSheet_(ss, name, SH[name]); });
  syncReleaseVersionConfig_();
  invalidateRuntimeCache_();
  return {
    upgraded:true,
    version:FAB.VERSION,
    sheets:Object.keys(SH).length,
    regra:"Checklist operacional só pode ser respondido/finalizado por OPERADOR.",
    endpoints:[
      "admin.corrigir_auditoria_execucao_operador",
      "operador.iniciar_acao",
      "operador.salvar_checklist_item",
      "operador.registrar_evidencia",
      "operador.finalizar_acao"
    ]
  };
}

function adminCorrigirAuditoriaExecucaoOperador1081_(p, usuario){
  var auth = usuario || p.__auth || {};
  if(auth.perfil !== ROLE.ADMIN) err_("FORBIDDEN", "Somente ADMIN pode executar reparo formal de auditoria.", 403);
  if(!clean_(p.acao_id) && !clean_(p.execucao_id)) err_("ID_REQUIRED", "Informe acao_id ou execucao_id.", 400);

  var ex = null;
  var acao = null;

  if(clean_(p.execucao_id)){
    ex = find_("execucoes", "id", p.execucao_id);
    if(!ex) err_("EXECUTION_NOT_FOUND", "Execução não encontrada: "+p.execucao_id, 404);
    acao = ex.acao_id ? find_("os_acoes", "id", ex.acao_id) : null;
  } else {
    acao = find_("os_acoes", "id", p.acao_id);
    if(!acao) err_("ACTION_NOT_FOUND", "Ação não encontrada: "+p.acao_id, 404);
    var execs = rows_("execucoes").filter(function(e){ return String(e.acao_id) === String(acao.id); }).sort(sortByDateDesc_("criado_em"));
    if(!execs.length) err_("EXECUTION_NOT_FOUND", "Nenhuma execução vinculada à ação: "+acao.id, 404);
    ex = execs[0];
  }

  var operadorId = clean_(ex.operador_id || (acao ? acao.responsavel_id : ""));
  if(!operadorId) err_("OPERATOR_NOT_FOUND", "Execução sem operador_id para reparo de auditoria.", 400);

  var dryRun = bool_(p.dry_run);
  var checklistCorrigidos = 0;
  var evidenciasCorrigidas = 0;
  var historicoCorrigido = 0;

  rows_("checklist_execucao").forEach(function(i){
    if(String(i.execucao_id) !== String(ex.id)) return;
    if(String(clean_(i.responsavel_id)) === String(operadorId)) return;
    checklistCorrigidos++;
    if(!dryRun) update_("checklist_execucao", i.__rowIndex, {responsavel_id:operadorId, atualizado_em:now_()});
  });

  rows_("evidencias").forEach(function(e){
    if(String(e.execucao_id) !== String(ex.id)) return;
    if(String(clean_(e.usuario_id)) === String(operadorId)) return;
    evidenciasCorrigidas++;
    if(!dryRun) update_("evidencias", e.__rowIndex, {usuario_id:operadorId});
  });

  rows_("historico").forEach(function(h){
    if(String(h.execucao_id) !== String(ex.id)) return;
    if(upper_(h.evento) !== "ACAO_FINALIZADA_OPERADOR") return;
    if(String(clean_(h.usuario_id)) === String(operadorId) && upper_(h.perfil) === ROLE.OPERADOR) return;
    historicoCorrigido++;
    if(!dryRun) update_("historico", h.__rowIndex, {usuario_id:operadorId, perfil:ROLE.OPERADOR});
  });

  if(!dryRun){
    hist_({
      ativo_id:ex.ativo_id,
      componente_id:ex.componente_id,
      os_id:ex.os_id,
      acao_id:ex.acao_id,
      execucao_id:ex.id,
      evento:"AUDITORIA_OPERADOR_CORRIGIDA",
      descricao:"Autoria operacional normalizada para "+operadorId+".",
      usuario_id:auth.usuario_id||"",
      perfil:auth.perfil||ROLE.ADMIN
    });
  }

  return {
    repaired:!dryRun,
    dry_run:dryRun,
    acao_id:acao ? acao.id : ex.acao_id,
    execucao_id:ex.id,
    operador_id:operadorId,
    checklist_corrigidos:checklistCorrigidos,
    evidencias_corrigidas:evidenciasCorrigidas,
    historico_corrigido:historicoCorrigido
  };
}
