/**
 * FAB Control 1.0.8
 * Execução operacional do checklist dinâmico validado.
 * Foco: ADMIN cria ação controlada de teste; OPERADOR executa; GESTOR valida.
 */

function cmmsExecucaoChecklistSchemaUpgrade108_(p, usuario){
  var auth = usuario || p.__auth || {};
  if(auth.perfil !== ROLE.ADMIN) err_("FORBIDDEN","Somente ADMIN pode executar upgrade de execução de checklist.",403);
  var ss = getSpreadsheet_();
  Object.keys(SH).forEach(function(name){ ensureSheet_(ss, name, SH[name]); });
  syncReleaseVersionConfig_();
  invalidateRuntimeCache_();
  return {
    upgraded:true,
    version:FAB.VERSION,
    sheets:Object.keys(SH).length,
    endpoints:[
      "admin.gerar_acao_teste_checklist",
      "operador.detalhar_checklist_execucao",
      "operador.validar_finalizacao_acao",
      "operador.salvar_checklist_item",
      "operador.registrar_evidencia",
      "operador.finalizar_acao",
      "gestor.validar_acao"
    ]
  };
}

function adminGerarAcaoTesteChecklist108_(p, usuario){
  var auth = usuario || p.__auth || {};
  if(auth.perfil !== ROLE.ADMIN) err_("FORBIDDEN","Somente ADMIN pode gerar ação técnica de teste.",403);
  req_(p,["plano_id"]);

  var plano = find_("planos_manutencao","id",p.plano_id);
  if(!plano) err_("PLAN_NOT_FOUND","Modelo/plano não encontrado: "+p.plano_id,404);
  if(!isPlanoOperacional_(plano)) err_("PLANO_NAO_OPERACIONAL","Modelo precisa estar VALIDADO/ATIVO para gerar ação de teste.",400);

  var ativo = find_("ativos","id",plano.ativo_id);
  if(!ativo) err_("ASSET_NOT_FOUND","Ativo do plano não encontrado: "+plano.ativo_id,404);

  var itens = rows_("plano_itens").filter(function(i){
    return String(i.plano_id) === String(plano.id) && upper_(i.status || ST.ATIVO) === ST.ATIVO;
  }).sort(function(a,b){ return num_(a.ordem,0)-num_(b.ordem,0); });
  if(!itens.length) err_("CHECKLIST_MODELO_VAZIO","Modelo validado não possui itens de checklist.",400);

  var forcarNova = bool_(p.forcar_nova || p.force_new || p.nova_acao);
  var aberta = rows_("os_acoes").find(function(a){ return String(a.plano_id) === String(plano.id) && acaoAberta_(a); });
  if(aberta && !forcarNova){
    return {
      created:false,
      already_open:true,
      acao:strip_(aberta),
      plano_id:plano.id,
      mensagem:"Já existe ação aberta para este modelo. Use forcar_nova=true apenas em teste controlado."
    };
  }

  var os = fit_("ordens_servico", {
    id:uuid_("OS"),
    codigo:"OS-TESTE-"+Utilities.formatDate(new Date(), FAB.TZ, "yyyyMMdd-HHmmss"),
    ativo_id:ativo.id,
    componente_id:plano.componente_id||"",
    origem:"TESTE",
    tipo:plano.tipo,
    titulo:plano.nome,
    descricao:"OS técnica de teste do checklist validado "+plano.id,
    prioridade:plano.criticidade || "MEDIA",
    status:ST.ABERTA,
    solicitante_id:auth.usuario_id || "ADMIN",
    responsavel_id:"",
    aberta_em:now_(),
    planejada_para:"",
    iniciada_em:"",
    finalizada_em:"",
    criado_em:now_(),
    atualizado_em:now_()
  });
  append_("ordens_servico", os);

  var acao = fit_("os_acoes", {
    id:uuid_("ACT"),
    os_id:os.id,
    ativo_id:ativo.id,
    componente_id:plano.componente_id||"",
    plano_id:plano.id,
    origem:"TESTE",
    tipo:plano.tipo,
    titulo:plano.nome,
    descricao:"Ação manual de teste do checklist validado. Não altera gatilho do plano.",
    prioridade:plano.criticidade || "MEDIA",
    status:ST.PENDENTE,
    responsavel_id:"",
    gerado_em:now_(),
    iniciado_em:"",
    finalizado_em:"",
    atualizado_em:now_()
  });
  append_("os_acoes", acao);

  hist_({
    ativo_id:acao.ativo_id,
    componente_id:acao.componente_id,
    os_id:os.id,
    acao_id:acao.id,
    execucao_id:"",
    evento:"ACAO_TESTE_CHECKLIST_GERADA",
    descricao:"Ação de teste gerada para o modelo "+plano.id,
    usuario_id:auth.usuario_id||"",
    perfil:auth.perfil||ROLE.ADMIN
  });

  return {
    created:true,
    plano_id:plano.id,
    os:strip_(os),
    acao:strip_(acao),
    checklist_modelo_itens:itens.length,
    proximo_passo:"operador.iniciar_acao"
  };
}

function operadorDetalharChecklistExecucao108_(p, usuario){
  var auth = usuario || p.__auth || {};
  var ids = CMMS108_resolveExecutionIds_(p);
  var acao = ids.acao;
  var ex = ids.execucao;
  var itens = ex ? CMMS108_itensExecucaoDetalhados_(ex.id) : [];
  var finalizacao = ex ? CMMS108_validateChecklistExecution_(ex.id) : {can_finalize:false, reason:"execucao_nao_iniciada"};

  return {
    acao:acao ? strip_(acao) : null,
    execucao:ex ? strip_(ex) : null,
    checklist_total:itens.length,
    checklist:itens,
    finalizacao:finalizacao,
    usuario:{id:auth.usuario_id||"", perfil:auth.perfil||""}
  };
}

function operadorValidarFinalizacaoAcao108_(p, usuario){
  var ids = CMMS108_resolveExecutionIds_(p);
  if(!ids.execucao) err_("EXECUTION_NOT_FOUND","Execução não encontrada para validar finalização.",404);
  var v = CMMS108_validateChecklistExecution_(ids.execucao.id);
  return {
    acao_id:ids.acao ? ids.acao.id : "",
    execucao_id:ids.execucao.id,
    can_finalize:v.can_finalize,
    total:v.total,
    respondidos:v.respondidos,
    pendentes:v.pendentes,
    evidencias_pendentes:v.evidencias_pendentes,
    bloqueios:v.bloqueios,
    mensagem:v.can_finalize ? "Checklist liberado para finalização." : "Checklist ainda bloqueia finalização."
  };
}

function CMMS108_resolveExecutionIds_(p){
  var acao = null;
  var ex = null;
  if(clean_(p.execucao_id)){
    ex = find_("execucoes","id",p.execucao_id);
    if(!ex) err_("EXECUTION_NOT_FOUND","Execução não encontrada: "+p.execucao_id,404);
    acao = ex.acao_id ? find_("os_acoes","id",ex.acao_id) : null;
  } else {
    req_(p,["acao_id"]);
    acao = find_("os_acoes","id",p.acao_id);
    if(!acao) err_("ACTION_NOT_FOUND","Ação não encontrada: "+p.acao_id,404);
    var execs = rows_("execucoes").filter(function(e){ return String(e.acao_id) === String(acao.id); }).sort(sortByDateDesc_("criado_em"));
    ex = execs.length ? execs[0] : null;
  }
  return {acao:acao, execucao:ex};
}

function CMMS108_itensExecucaoDetalhados_(execId){
  var evs = rows_("evidencias");
  return rows_("checklist_execucao").filter(function(c){ return String(c.execucao_id) === String(execId); })
    .sort(function(a,b){ return num_(a.ordem,0)-num_(b.ordem,0); })
    .map(function(i){
      var out = strip_(i);
      var itemEvs = evs.filter(function(e){ return String(e.checklist_execucao_id) === String(i.id); }).map(strip_);
      out.evidencias_count = itemEvs.length;
      out.evidencia_min_fotos = typeof evidenciaMinFotos116_ === "function" ? evidenciaMinFotos116_(i) : ((bool_(i.evidencia_obrigatoria) || upper_(i.tipo_resposta) === "EVIDENCIA") ? 1 : 0);
      out.evidencias = itemEvs;
      out.eh_obrigatorio = bool_(i.obrigatorio);
      out.eh_bloqueante = bool_(i.bloqueia_finalizacao);
      out.exige_evidencia = bool_(i.evidencia_obrigatoria) || upper_(i.tipo_resposta) === "EVIDENCIA";
      out.respondido = CMMS108_itemRespondido_(i, itemEvs);
      return out;
    });
}

function CMMS108_validateChecklistExecution_(execId){
  var itens = rows_("checklist_execucao").filter(function(c){ return String(c.execucao_id) === String(execId); })
    .sort(function(a,b){ return num_(a.ordem,0)-num_(b.ordem,0); });
  if(!itens.length){
    return {ok:false, can_finalize:false, total:0, respondidos:0, pendentes:[{titulo:"Checklist vazio"}], evidencias_pendentes:[], bloqueios:[]};
  }

  var evs = rows_("evidencias");
  var pendentes = [];
  var evidenciasPendentes = [];
  var bloqueios = [];
  var respondidos = 0;

  itens.forEach(function(i){
    var itemEvs = evs.filter(function(e){ return String(e.checklist_execucao_id) === String(i.id); });
    var respondido = CMMS108_itemRespondido_(i, itemEvs);
    if(respondido) respondidos++;

    if(bool_(i.obrigatorio) && !respondido){
      pendentes.push(CMMS108_itemResumo_(i, "RESPOSTA_PENDENTE"));
    }

    var minimoEvidencias = typeof evidenciaMinFotos116_ === "function" ? evidenciaMinFotos116_(i) : ((bool_(i.evidencia_obrigatoria) || upper_(i.tipo_resposta) === "EVIDENCIA") ? 1 : 0);
    if(minimoEvidencias > 0 && itemEvs.length < minimoEvidencias){
      var pendenciaEvidencia = CMMS108_itemResumo_(i, "EVIDENCIA_PENDENTE");
      pendenciaEvidencia.evidencias_count = itemEvs.length;
      pendenciaEvidencia.evidencia_min_fotos = minimoEvidencias;
      evidenciasPendentes.push(pendenciaEvidencia);
    }

    if(bool_(i.bloqueia_finalizacao) && upper_(i.conforme) === "NAO"){
      bloqueios.push(CMMS108_itemResumo_(i, "NAO_CONFORME_BLOQUEANTE"));
    }
  });

  return {
    ok:true,
    can_finalize:pendentes.length === 0 && evidenciasPendentes.length === 0 && bloqueios.length === 0,
    total:itens.length,
    respondidos:respondidos,
    pendentes:pendentes,
    evidencias_pendentes:evidenciasPendentes,
    bloqueios:bloqueios
  };
}

function CMMS108_itemRespondido_(i, itemEvs){
  var tipo = upper_(i.tipo_resposta);
  if(tipo === "INSTRUCAO") return clean_(i.resposta) !== "" || upper_(i.status) === ST.RESPONDIDO;
  if(tipo === "EVIDENCIA"){
    var minimo = typeof evidenciaMinFotos116_ === "function" ? evidenciaMinFotos116_(i) : 1;
    return (itemEvs || []).length >= minimo;
  }
  return clean_(i.resposta) !== "" || upper_(i.status) === ST.RESPONDIDO;
}

function CMMS108_itemResumo_(i, motivo){
  return {
    id:i.id,
    ordem:num_(i.ordem,0),
    titulo:i.titulo,
    tipo_resposta:upper_(i.tipo_resposta),
    motivo:motivo,
    bloqueia_finalizacao:bool_(i.bloqueia_finalizacao) ? "SIM" : "NAO",
    evidencia_obrigatoria:bool_(i.evidencia_obrigatoria) ? "SIM" : "NAO",
    evidencia_min_fotos:typeof evidenciaMinFotos116_ === "function" ? evidenciaMinFotos116_(i) : (bool_(i.evidencia_obrigatoria) ? 1 : 0),
    conforme:upper_(i.conforme || "")
  };
}
