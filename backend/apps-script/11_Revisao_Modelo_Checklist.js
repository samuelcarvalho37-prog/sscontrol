/**
 * FAB Control 10.6
 * Revisão formal de modelo de checklist validado.
 *
 * Regra CMMS:
 * - Modelo VALIDADO não é editado diretamente.
 * - O ADMIN cria uma nova revisão em RASCUNHO a partir do modelo validado.
 * - A revisão nova segue o fluxo normal: enviar para gestão -> aprovar/devolver.
 * - Quando a revisão nova é aprovada, ela substitui a versão anterior e preserva o controle operacional.
 */

function modeloBaseId_(pl){
  if(!pl) return "";
  var base = clean_(pl.modelo_base_id);
  if(base) return base;

  var anteriorId = clean_(pl.substitui_plano_id || pl.revisao_origem_id);
  if(anteriorId){
    var anterior = find_("planos_manutencao", "id", anteriorId);
    if(anterior && clean_(anterior.modelo_base_id)) return clean_(anterior.modelo_base_id);
    if(anterior && clean_(anterior.id)) return clean_(anterior.id);
  }

  return clean_(pl.id);
}

function revisoesRelacionadasModelo_(modeloBaseId, planoId){
  modeloBaseId = clean_(modeloBaseId);
  planoId = clean_(planoId);
  return rows_("planos_manutencao").filter(function(pl){
    return String(pl.id) === String(modeloBaseId) ||
      String(pl.id) === String(planoId) ||
      String(pl.modelo_base_id) === String(modeloBaseId) ||
      String(pl.substitui_plano_id) === String(planoId) ||
      String(pl.revisao_origem_id) === String(planoId);
  });
}

function proximaRevisaoModelo_(modeloBaseId, planoAtual){
  var maxRev = Math.max(1, num_(planoAtual.revisao, 1));
  revisoesRelacionadasModelo_(modeloBaseId, planoAtual.id).forEach(function(pl){
    maxRev = Math.max(maxRev, num_(pl.revisao, 1));
  });
  return maxRev + 1;
}

function novoPlanoIdRevisao_(modeloBaseId, revisao, idSolicitado){
  var id = clean_(idSolicitado) || (clean_(modeloBaseId) + "-REV-" + String(revisao));
  while(find_("planos_manutencao", "id", id)){
    revisao++;
    id = clean_(modeloBaseId) + "-REV-" + String(revisao);
  }
  return id;
}

function revisaoAbertaParaModelo_(planoAtual, modeloBaseId){
  var abertos = [ST.RASCUNHO, ST.EM_VALIDACAO_GESTAO, ST.DEVOLVIDO_CORRECAO];
  return rows_("planos_manutencao").find(function(pl){
    if(String(pl.id) === String(planoAtual.id)) return false;
    var wf = upper_(pl.workflow_status || "");
    if(abertos.indexOf(wf) < 0) return false;
    return String(pl.substitui_plano_id) === String(planoAtual.id) ||
      String(pl.revisao_origem_id) === String(planoAtual.id) ||
      (clean_(pl.modelo_base_id) && String(pl.modelo_base_id) === String(modeloBaseId));
  }) || null;
}

function cloneItensPlanoParaRevisao_(planoOrigemId){
  return rows_("plano_itens")
    .filter(function(i){ return String(i.plano_id) === String(planoOrigemId) && upper_(i.status || ST.ATIVO) === ST.ATIVO; })
    .sort(function(a,b){ return num_(a.ordem,0)-num_(b.ordem,0); })
    .map(function(i){
      var item = strip_(i);
      delete item.id;
      delete item.criado_em;
      delete item.atualizado_em;
      return item;
    });
}

function adminCriarRevisaoModeloChecklist_(p){
  req_(p, ["plano_id"]);
  var auth = p.__auth || {};
  var atual = find_("planos_manutencao", "id", p.plano_id);
  if(!atual) err_("PLAN_NOT_FOUND", "Plano/checklist não encontrado.", 404);

  var wfAtual = upper_(atual.workflow_status || "");
  if(wfAtual !== ST.VALIDADO) err_("INVALID_WORKFLOW_STATUS", "Nova revisão formal só pode partir de modelo VALIDADO. Status atual: " + wfAtual, 400);
  if(!isPlanoOperacional_(atual)) err_("MODELO_NAO_OPERACIONAL", "Modelo validado precisa estar operacional antes de abrir nova revisão.", 400);

  var modeloBaseId = modeloBaseId_(atual);
  var aberta = revisaoAbertaParaModelo_(atual, modeloBaseId);
  if(aberta){
    err_("REVISAO_ABERTA_EXISTE", "Já existe revisão aberta para este modelo: " + aberta.id + " / " + aberta.workflow_status, 400);
  }

  var proximaRev = proximaRevisaoModelo_(modeloBaseId, atual);
  var novoId = novoPlanoIdRevisao_(modeloBaseId, proximaRev, p.novo_plano_id);
  var itens = Array.isArray(p.itens) && p.itens.length ? p.itens.map(function(i){ var x=Object.assign({},i||{}); delete x.id; return x; }) : cloneItensPlanoParaRevisao_(atual.id);
  if(!itens.length) err_("CHECKLIST_MODELO_VAZIO", "Não há itens ativos para clonar na nova revisão.", 400);

  var planoNovo = Object.assign({}, strip_(atual), p.plano || {});
  planoNovo.id = novoId;
  planoNovo.modelo_base_id = modeloBaseId;
  planoNovo.revisao_origem_id = atual.id;
  planoNovo.substitui_plano_id = atual.id;
  planoNovo.substituido_por = "";
  planoNovo.substituido_em = "";
  planoNovo.revisao = proximaRev;
  planoNovo.workflow_status = ST.RASCUNHO;
  planoNovo.validado_gestao = "NAO";
  planoNovo.validado_por = "";
  planoNovo.validado_em = "";
  planoNovo.devolvido_por = "";
  planoNovo.devolvido_em = "";
  planoNovo.devolvido_motivo = "";
  planoNovo.enviado_validacao_em = "";
  planoNovo.ultimo_disparo_em = "";
  planoNovo.status = ST.INATIVO;
  delete planoNovo.criado_em;
  delete planoNovo.atualizado_em;

  itens = itens.map(function(item){
    var d = Object.assign({}, item || {});
    d.plano_id = novoId;
    return d;
  });

  var saved = adminSalvarModeloChecklist_({plano:planoNovo, itens:itens, __auth:auth});

  append_("checklist_modelo_validacoes", fit_("checklist_modelo_validacoes", {
    id:uuid_("VMOD"),
    plano_id:novoId,
    revisao:proximaRev,
    decisao:"NOVA_REVISAO",
    justificativa:clean_(p.justificativa || p.comentario || "Nova revisão formal criada a partir do modelo validado " + atual.id + "."),
    usuario_id:auth.usuario_id || "",
    perfil:auth.perfil || ROLE.ADMIN,
    criado_em:now_()
  }));

  hist_({
    ativo_id:saved.plano.ativo_id,
    componente_id:saved.plano.componente_id,
    evento:"MODELO_CHECKLIST_NOVA_REVISAO",
    descricao:"Nova revisão formal criada: " + novoId + " substitui " + atual.id + " após validação.",
    usuario_id:auth.usuario_id || "",
    perfil:auth.perfil || ROLE.ADMIN
  });

  invalidateRuntimeCache_();
  return {
    created:true,
    plano_id:novoId,
    modelo_base_id:modeloBaseId,
    revisao_origem_id:atual.id,
    substitui_plano_id:atual.id,
    revisao:proximaRev,
    workflow_status:ST.RASCUNHO,
    status:ST.INATIVO,
    operacional:false,
    itens_count:saved.itens.length,
    plano:saved.plano,
    itens:saved.itens
  };
}

function migrarPlanoControleParaRevisao_(planoAnterior, planoNovo){
  if(!planoAnterior || !planoNovo) return false;
  var oldCtl = find_("plano_controle", "plano_id", planoAnterior.id);
  var newCtl = find_("plano_controle", "plano_id", planoNovo.id);
  if(!oldCtl || newCtl) return false;

  append_("plano_controle", fit_("plano_controle", {
    plano_id:planoNovo.id,
    ativo_id:planoNovo.ativo_id,
    componente_id:planoNovo.componente_id || "",
    gatilho_tipo:upper_(planoNovo.gatilho_tipo),
    gatilho_valor:num_(planoNovo.gatilho_valor,0),
    ultimo_valor_processado:oldCtl.ultimo_valor_processado || 0,
    proximo_valor_gatilho:oldCtl.proximo_valor_gatilho || planoNovo.gatilho_valor || 0,
    ultima_acao_id:oldCtl.ultima_acao_id || "",
    ultima_acao_status:oldCtl.ultima_acao_status || "",
    atualizado_em:now_()
  }));
  return true;
}

function aplicarSubstituicaoRevisaoAprovada_(planoNovo, auth){
  if(!planoNovo) return {substituiu:false};
  var anteriorId = clean_(planoNovo.substitui_plano_id || planoNovo.revisao_origem_id);
  if(!anteriorId) return {substituiu:false};

  var anterior = find_("planos_manutencao", "id", anteriorId);
  if(!anterior) return {substituiu:false, anterior_id:anteriorId, motivo:"anterior_nao_encontrado"};

  var patch = {
    status:ST.OBSOLETO,
    workflow_status:ST.OBSOLETO,
    substituido_por:planoNovo.id,
    substituido_em:now_(),
    atualizado_em:now_()
  };
  update_("planos_manutencao", anterior.__rowIndex, patch);
  var controleMigrado = migrarPlanoControleParaRevisao_(anterior, Object.assign({}, planoNovo, {status:ST.ATIVO, workflow_status:ST.VALIDADO}));

  append_("checklist_modelo_validacoes", fit_("checklist_modelo_validacoes", {
    id:uuid_("VMOD"),
    plano_id:anterior.id,
    revisao:num_(anterior.revisao,1),
    decisao:"SUBSTITUIDO",
    justificativa:"Modelo substituído pela revisão " + planoNovo.id + ".",
    usuario_id:(auth && auth.usuario_id) || "",
    perfil:(auth && auth.perfil) || ROLE.GESTOR,
    criado_em:now_()
  }));

  hist_({
    ativo_id:anterior.ativo_id,
    componente_id:anterior.componente_id,
    evento:"MODELO_CHECKLIST_SUBSTITUIDO",
    descricao:"Modelo " + anterior.id + " substituído pela revisão aprovada " + planoNovo.id + ". Controle migrado: " + (controleMigrado ? "SIM" : "NAO") + ".",
    usuario_id:(auth && auth.usuario_id) || "",
    perfil:(auth && auth.perfil) || ROLE.GESTOR
  });

  return {substituiu:true, anterior_id:anterior.id, novo_id:planoNovo.id, controle_migrado:controleMigrado};
}
