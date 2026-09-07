/**
 * FAB Control 1.0.8.3
 * Checklist dinâmico + governança ADMIN -> GESTÃO -> OPERADOR.
 */

const CHECKLIST_TYPES = ["CONFIRMACAO","OK_NOK","NUMERO","PARAMETRO","TEXTO","SELECAO","EVIDENCIA","LEITURA_OPERACIONAL","INSTRUCAO"];

function cmmsSchemaUpgrade_(p){
  var ss = getSpreadsheet_();
  Object.keys(SH).forEach(function(name){ ensureSheet_(ss, name, SH[name]); });

  // Preserva planos legados já ativos: eles viram VALIDADO para não quebrar a operação existente.
  var upgraded = 0;
  rows_("planos_manutencao", true).forEach(function(pl){
    if(!clean_(pl.workflow_status)){
      update_("planos_manutencao", pl.__rowIndex, {
        workflow_status:ST.VALIDADO,
        validado_gestao:"SIM",
        validado_por:"SISTEMA_LEGADO",
        validado_em:now_(),
        revisao:num_(pl.revisao,1) || 1,
        atualizado_em:now_()
      });
      upgraded++;
    }
  });

  // Normaliza trilha de revisão formal. O modelo-base passa a ser o próprio id nos registros antigos.
  rows_("planos_manutencao", true).forEach(function(pl){
    var patch = {};
    if(!clean_(pl.modelo_base_id)) patch.modelo_base_id = clean_(pl.id);
    if(Object.keys(patch).length){
      patch.atualizado_em = now_();
      update_("planos_manutencao", pl.__rowIndex, patch);
    }
  });

  invalidateRuntimeCache_();
  return {upgraded:true, version:FAB.VERSION, sheets:Object.keys(SH).length, planos_legados_validados:upgraded};
}

function normalizaTipoChecklist_(tipo){
  tipo = upper_(tipo || "OK_NOK");
  if(CHECKLIST_TYPES.indexOf(tipo) < 0) err_("CHECKLIST_TYPE_INVALID","Tipo de checklist inválido: "+tipo,400);
  return tipo;
}

function normalizaOpcoesJson_(v){
  if(v === undefined || v === null || clean_(v) === "") return "";
  if(Array.isArray(v)) return JSON.stringify(v.map(clean_).filter(Boolean));
  if(typeof v === "object") return JSON.stringify(v);
  var s = clean_(v);
  try { JSON.parse(s); return s; } catch(e){}
  return JSON.stringify(s.split("|").map(clean_).filter(Boolean));
}

function parseOpcoes_(json){
  if(!clean_(json)) return [];
  try {
    var v = JSON.parse(json);
    return Array.isArray(v) ? v.map(clean_) : [];
  } catch(e){ return []; }
}

function isPlanoOperacional_(pl){
  if(!pl) return false;
  var st = upper_(pl.status);
  var wf = upper_(pl.workflow_status || ST.VALIDADO); // compatibilidade: legado sem coluna é tratado como validado depois do upgrade.
  var okStatus = st === ST.ATIVO;
  var okWorkflow = wf === ST.VALIDADO || wf === ST.ATIVO;
  var okGestao = clean_(pl.validado_gestao) === "" ? okWorkflow : bool_(pl.validado_gestao);
  return okStatus && okWorkflow && okGestao;
}

function adminSalvarModeloChecklist_(p){
  req_(p,["plano"]);
  var auth = p.__auth || {};
  var planoInput = Object.assign({}, p.plano || {});
  var itensInput = p.itens || planoInput.itens || [];
  if(!Array.isArray(itensInput) || !itensInput.length) err_("CHECKLIST_MODELO_VAZIO","Modelo precisa ter pelo menos 1 item.",400);

  var old = planoInput.id ? find_("planos_manutencao","id",planoInput.id) : null;
  if(old && [ST.EM_VALIDACAO_GESTAO, ST.VALIDADO, ST.ATIVO, ST.OBSOLETO].indexOf(upper_(old.workflow_status)) >= 0){
    err_("MODELO_BLOQUEADO","Modelo em validação/validado não pode ser alterado diretamente. Devolva para correção ou crie nova revisão.",400);
  }

  planoInput.workflow_status = ST.RASCUNHO;
  planoInput.validado_gestao = "NAO";
  planoInput.status = ST.INATIVO;
  adminAssertEntityReferences_("planos", planoInput);
  planoInput.revisao = old
    ? (bool_(p.incrementar_revisao) ? Math.max(1,num_(old.revisao,1)) + 1 : Math.max(Math.max(1,num_(old.revisao,1)), Math.max(1,num_(planoInput.revisao,1))))
    : Math.max(1,num_(planoInput.revisao,1));

  var saved = adminSalvar_({entidade:"planos", dados:planoInput, __auth:auth}).row;

  // Regrava itens do modelo para a revisão atual: remove itens antigos do plano e recria em ordem.
  rows_("plano_itens", true).filter(function(i){ return String(i.plano_id) === String(saved.id); })
    .sort(function(a,b){ return num_(b.__rowIndex,0)-num_(a.__rowIndex,0); })
    .forEach(function(i){ deleteRow_("plano_itens", i.__rowIndex); });

  var itens = itensInput.map(function(item, idx){
    var d = Object.assign({}, item || {});
    d.plano_id = saved.id;
    d.ordem = num_(d.ordem, idx+1);
    d.status = ST.ATIVO;
    return adminSalvar_({entidade:"plano_itens", dados:d, __auth:auth}).row;
  });

  hist_({ativo_id:saved.ativo_id, componente_id:saved.componente_id, evento:"MODELO_CHECKLIST_RASCUNHO_SALVO", descricao:"Modelo salvo em rascunho: "+saved.nome, usuario_id:auth.usuario_id||"", perfil:auth.perfil||ROLE.ADMIN});
  invalidateRuntimeCache_();
  return {saved:true, plano:saved, itens:itens, workflow_status:ST.RASCUNHO};
}

function adminEnviarModeloChecklistValidacao_(p){
  req_(p,["plano_id"]);
  var auth = p.__auth || {};
  var plano = find_("planos_manutencao","id",p.plano_id);
  if(!plano) err_("PLAN_NOT_FOUND","Plano/checklist não encontrado.",404);
  var wf = upper_(plano.workflow_status || ST.RASCUNHO);
  if([ST.RASCUNHO, ST.DEVOLVIDO_CORRECAO].indexOf(wf) < 0) err_("INVALID_WORKFLOW_STATUS","Modelo não pode ser enviado neste status: "+wf,400);

  var itens = rows_("plano_itens").filter(function(i){ return String(i.plano_id) === String(plano.id) && upper_(i.status || ST.ATIVO) === ST.ATIVO; });
  validarModeloChecklistEstrutura_(plano, itens);

  update_("planos_manutencao", plano.__rowIndex, {
    workflow_status:ST.EM_VALIDACAO_GESTAO,
    status:ST.INATIVO,
    validado_gestao:"NAO",
    enviado_validacao_em:now_(),
    atualizado_em:now_()
  });

  append_("checklist_modelo_validacoes", fit_("checklist_modelo_validacoes", {
    id:uuid_("VMOD"), plano_id:plano.id, revisao:num_(plano.revisao,1), decisao:"ENVIADO", justificativa:clean_(p.comentario), usuario_id:auth.usuario_id||"", perfil:auth.perfil||ROLE.ADMIN, criado_em:now_()
  }));

  hist_({ativo_id:plano.ativo_id, componente_id:plano.componente_id, evento:"MODELO_CHECKLIST_ENVIADO_GESTAO", descricao:"Modelo enviado para validação da gestão.", usuario_id:auth.usuario_id||"", perfil:auth.perfil||ROLE.ADMIN});
  var technicalDemand = adminDemandasTecnicasEnviar_({
    demanda:{
      tipo:"VALIDACAO_CHECKLIST",
      entidade_tipo:"CHECKLIST_MODELO",
      entidade_id:plano.id,
      origem_tipo:plano.ocorrencia_origem_id ? "OCORRENCIA" : "",
      origem_id:clean_(plano.ocorrencia_origem_id),
      titulo:"Validar checklist: " + clean_(plano.nome),
      descricao:clean_(p.comentario),
      prioridade:upper_(plano.criticidade || "MEDIA"),
      area_atual_id:clean_(p.area_atual_id),
      cargo_atual_id:clean_(p.cargo_atual_id),
      responsavel_atual_id:clean_(p.responsavel_atual_id),
      politica_assinatura:clean_(p.politica_assinatura),
      areas_validadoras:p.areas_validadoras,
      usuarios_validadores:p.usuarios_validadores,
      exige_assinatura:"SIM",
      assinaturas_necessarias:p.assinaturas_necessarias,
      exige_segregacao:p.exige_segregacao,
      versao_entidade:num_(plano.revisao,1)
    },
    __auth:auth,
    user_agent:p.user_agent
  }, auth).demanda;
  if(plano.ocorrencia_origem_id){
    var occurrence = find_("ocorrencias_operacionais", "id", plano.ocorrencia_origem_id);
    if(occurrence){
      update_("ocorrencias_operacionais", occurrence.__rowIndex, {
        status:"EM_VALIDACAO_TECNICA",
        demanda_tecnica_id:technicalDemand.id,
        tratamento_status:"AGUARDANDO_ASSINATURA",
        atualizado_em:now_()
      });
    }
  }
  invalidateRuntimeCache_();
  return {sent:true, plano_id:plano.id, workflow_status:ST.EM_VALIDACAO_GESTAO, demanda_tecnica:technicalDemand};
}

function validarModeloChecklistEstrutura_(plano, itens){
  if(!itens.length) err_("CHECKLIST_MODELO_VAZIO","Modelo precisa ter itens ativos.",400);
  var ordens = {};
  itens.forEach(function(i){
    if(ordens[String(i.ordem)]) err_("CHECKLIST_ORDEM_DUPLICADA","Ordem duplicada no checklist: "+i.ordem,400);
    ordens[String(i.ordem)] = true;
    var tipo = normalizaTipoChecklist_(i.tipo_resposta);
    if(["NUMERO","PARAMETRO"].indexOf(tipo) >= 0 && !clean_(i.unidade)) err_("UNIDADE_REQUIRED","Item numérico/paramétrico exige unidade: "+i.titulo,400);
    if(tipo === "PARAMETRO" && !clean_(i.parametro_nome)) err_("PARAMETRO_REQUIRED","Item PARAMETRO exige parametro_nome: "+i.titulo,400);
    if(tipo === "SELECAO" && !parseOpcoes_(i.opcoes_json).length) err_("OPCOES_REQUIRED","Item SELECAO exige opções: "+i.titulo,400);
    if(tipo === "EVIDENCIA" && !bool_(i.evidencia_obrigatoria)) err_("EVIDENCIA_CONFIG_INVALIDA","Item EVIDENCIA deve ter evidencia_obrigatoria=SIM: "+i.titulo,400);
  });
  return true;
}

function listarModelosChecklistBase_(p, defaultStatus){
  var statuses = clean_(p.status || defaultStatus || "EM_VALIDACAO_GESTAO,DEVOLVIDO_CORRECAO,VALIDADO,RASCUNHO").split(",").map(upper_).filter(Boolean);
  var limite = Math.min(num_(p.limite,100),300);
  var ativoId = clean_(p.ativo_id);
  var componenteId = clean_(p.componente_id);

  var ativos = {};
  rows_("ativos").forEach(function(a){ ativos[String(a.id)] = a; });
  var componentes = {};
  rows_("componentes").forEach(function(c){ componentes[String(c.id)] = c; });
  var itensCount = {};
  rows_("plano_itens").forEach(function(i){
    if(upper_(i.status || ST.ATIVO) !== ST.ATIVO) return;
    itensCount[String(i.plano_id)] = (itensCount[String(i.plano_id)] || 0) + 1;
  });
  var ultimasValidacoes = {};
  rows_("checklist_modelo_validacoes").sort(sortByDateDesc_("criado_em")).forEach(function(v){
    if(!ultimasValidacoes[String(v.plano_id)]) ultimasValidacoes[String(v.plano_id)] = strip_(v);
  });

  var auth = p.__auth || {};
  var identity = technicalIdentity_(auth);
  var routed = (sheetExists_("demandas_tecnicas") ? rows_("demandas_tecnicas") : []).filter(function(demand){
    return upper_(demand.entidade_tipo) === "CHECKLIST_MODELO" && TECH_FINAL_STATUSES.indexOf(upper_(demand.status)) < 0;
  });
  var modelos = rows_("planos_manutencao").filter(function(pl){
    var wf = upper_(pl.workflow_status || ST.RASCUNHO);
    if(statuses.length && statuses.indexOf(wf) < 0) return false;
    if(ativoId && String(pl.ativo_id) !== String(ativoId)) return false;
    if(componenteId && String(pl.componente_id) !== String(componenteId)) return false;
    var demand = routed.find(function(item){ return String(item.entidade_id) === String(pl.id); });
    if(demand && identity.perfil !== ROLE.ADMIN && !technicalDemandAccessible_(demand, identity)) return false;
    return true;
  }).sort(sortByDateDesc_("atualizado_em")).slice(0, limite).map(function(pl){
    var atv = ativos[String(pl.ativo_id)];
    var comp = pl.componente_id ? componentes[String(pl.componente_id)] : null;
    var out = strip_(pl);
    out.ativo_tag = atv ? atv.tag : "";
    out.ativo_nome = atv ? atv.nome : "";
    out.componente_tag = comp ? comp.tag : "";
    out.componente_nome = comp ? comp.nome : "";
    out.itens_count = itensCount[String(pl.id)] || 0;
    out.operacional = isPlanoOperacional_(pl);
    out.ultimo_parecer = ultimasValidacoes[String(pl.id)] || null;
    return out;
  });

  return {total:modelos.length, status:statuses, modelos:modelos};
}

function gestorListarModelosChecklist_(p){
  return listarModelosChecklistBase_(p, "EM_VALIDACAO_GESTAO,DEVOLVIDO_CORRECAO,VALIDADO,RASCUNHO");
}

function gestorModelosEmValidacao_(p){
  return listarModelosChecklistBase_(p, "EM_VALIDACAO_GESTAO");
}

function adminListarModelosChecklist_(p){
  return listarModelosChecklistBase_(p, "RASCUNHO,DEVOLVIDO_CORRECAO,EM_VALIDACAO_GESTAO,VALIDADO");
}

function adminModelosDevolvidos_(p){
  return listarModelosChecklistBase_(p, "DEVOLVIDO_CORRECAO");
}

function adminCorrigirModeloChecklist_(p){
  req_(p,["plano_id"]);
  var auth = p.__auth || {};
  var old = find_("planos_manutencao","id",p.plano_id);
  if(!old) err_("PLAN_NOT_FOUND","Plano/checklist não encontrado.",404);
  if(upper_(old.workflow_status) !== ST.DEVOLVIDO_CORRECAO) err_("INVALID_WORKFLOW_STATUS","Somente modelo devolvido para correção pode usar esta action. Status atual: "+old.workflow_status,400);

  var planoInput = Object.assign({}, strip_(old), p.plano || {});
  planoInput.id = old.id;
  planoInput.workflow_status = ST.RASCUNHO;
  planoInput.validado_gestao = "NAO";
  planoInput.status = ST.INATIVO;
  planoInput.devolvido_motivo = "";

  var itensInput = p.itens;
  if(!Array.isArray(itensInput) || !itensInput.length){
    itensInput = rows_("plano_itens").filter(function(i){ return String(i.plano_id) === String(old.id) && upper_(i.status || ST.ATIVO) === ST.ATIVO; })
      .sort(function(a,b){ return num_(a.ordem,0)-num_(b.ordem,0); })
      .map(strip_);
  }

  var saved = adminSalvarModeloChecklist_({plano:planoInput, itens:itensInput, incrementar_revisao:true, __auth:auth});
  append_("checklist_modelo_validacoes", fit_("checklist_modelo_validacoes", {
    id:uuid_("VMOD"), plano_id:old.id, revisao:saved.plano.revisao, decisao:"CORRIGIDO", justificativa:clean_(p.comentario || p.justificativa || "Correção aplicada pelo administrador."), usuario_id:auth.usuario_id||"", perfil:auth.perfil||ROLE.ADMIN, criado_em:now_()
  }));
  hist_({ativo_id:old.ativo_id, componente_id:old.componente_id, evento:"MODELO_CHECKLIST_CORRIGIDO_ADMIN", descricao:clean_(p.comentario || p.justificativa || "Modelo corrigido e voltou para rascunho."), usuario_id:auth.usuario_id||"", perfil:auth.perfil||ROLE.ADMIN});
  invalidateRuntimeCache_();
  return {corrigido:true, plano_id:old.id, revisao:saved.plano.revisao, workflow_status:ST.RASCUNHO, plano:saved.plano, itens:saved.itens};
}

function detalheModeloChecklist_(p){
  req_(p,["plano_id"]);
  var pl = find_("planos_manutencao","id",p.plano_id);
  if(!pl) err_("PLAN_NOT_FOUND","Plano/checklist não encontrado.",404);
  var atv = find_("ativos","id",pl.ativo_id);
  var comp = pl.componente_id ? find_("componentes","id",pl.componente_id) : null;
  var itens = rows_("plano_itens").filter(function(i){ return String(i.plano_id) === String(pl.id); }).sort(function(a,b){ return num_(a.ordem,0)-num_(b.ordem,0); }).map(strip_);
  var validacoes = rows_("checklist_modelo_validacoes").filter(function(v){ return String(v.plano_id) === String(pl.id); }).sort(sortByDateDesc_("criado_em")).map(strip_);
  return {
    plano:strip_(pl),
    ativo:atv?strip_(atv):null,
    componente:comp?strip_(comp):null,
    itens:itens,
    validacoes:validacoes,
    ultimo_parecer:validacoes.length ? validacoes[0] : null,
    correcoes_pendentes:upper_(pl.workflow_status) === ST.DEVOLVIDO_CORRECAO,
    operacional:isPlanoOperacional_(pl)
  };
}

function gestorValidarModeloChecklist_(p){
  req_(p,["plano_id","decisao"]);
  var auth = p.__auth || {};
  technicalAssertValidationIdentity_(auth);
  var pl = find_("planos_manutencao","id",p.plano_id);
  if(!pl) err_("PLAN_NOT_FOUND","Plano/checklist não encontrado.",404);
  var routedDemand = sheetExists_("demandas_tecnicas") ? rows_("demandas_tecnicas", true).find(function(demand){
    return upper_(demand.entidade_tipo) === "CHECKLIST_MODELO" &&
      String(demand.entidade_id) === String(pl.id) &&
      TECH_FINAL_STATUSES.indexOf(upper_(demand.status)) < 0;
  }) : null;
  if(routedDemand){
    err_("TECH_WORKFLOW_REQUIRED", "Este checklist possui rota tecnica. Use a Fila tecnica para assinar, encaminhar ou decidir.", 409);
  }
  var dec = upper_(p.decisao);
  if(["APROVAR","DEVOLVER"].indexOf(dec) < 0) err_("INVALID_DECISION","Decisão deve ser APROVAR ou DEVOLVER.",400);
  if(upper_(pl.workflow_status) !== ST.EM_VALIDACAO_GESTAO) err_("INVALID_WORKFLOW_STATUS","Modelo não está em validação da gestão. Status atual: "+pl.workflow_status,400);

  var itens = rows_("plano_itens").filter(function(i){ return String(i.plano_id) === String(pl.id) && upper_(i.status || ST.ATIVO) === ST.ATIVO; });

  if(dec === "APROVAR"){
    validarModeloChecklistEstrutura_(pl, itens);
    update_("planos_manutencao", pl.__rowIndex, {
      workflow_status:ST.VALIDADO,
      validado_gestao:"SIM",
      validado_por:auth.usuario_id||"",
      validado_em:now_(),
      devolvido_por:"",
      devolvido_em:"",
      devolvido_motivo:"",
      status:ST.ATIVO,
      atualizado_em:now_()
    });
    aplicarSubstituicaoRevisaoAprovada_(pl, auth);
  } else {
    if(clean_(p.justificativa).length < 5) err_("JUSTIFICATIVA_REQUIRED","Devolução exige justificativa técnica.",400);
    update_("planos_manutencao", pl.__rowIndex, {
      workflow_status:ST.DEVOLVIDO_CORRECAO,
      validado_gestao:"NAO",
      devolvido_por:auth.usuario_id||"",
      devolvido_em:now_(),
      devolvido_motivo:clean_(p.justificativa),
      status:ST.INATIVO,
      atualizado_em:now_()
    });
  }

  append_("checklist_modelo_validacoes", fit_("checklist_modelo_validacoes", {
    id:uuid_("VMOD"), plano_id:pl.id, revisao:num_(pl.revisao,1), decisao:dec, justificativa:clean_(p.justificativa||p.comentario), usuario_id:auth.usuario_id||"", perfil:auth.perfil||ROLE.GESTOR, criado_em:now_()
  }));

  hist_({ativo_id:pl.ativo_id, componente_id:pl.componente_id, evento:dec==="APROVAR"?"MODELO_CHECKLIST_VALIDADO":"MODELO_CHECKLIST_DEVOLVIDO", descricao:clean_(p.justificativa||p.comentario), usuario_id:auth.usuario_id||"", perfil:auth.perfil||ROLE.GESTOR});
  invalidateRuntimeCache_();
  return {validated:true, plano_id:pl.id, decisao:dec, workflow_status:dec==="APROVAR"?ST.VALIDADO:ST.DEVOLVIDO_CORRECAO, status:dec==="APROVAR"?ST.ATIVO:ST.INATIVO};
}

function operadorListarChecklistExecucao_(p){
  var execId = clean_(p.execucao_id);
  var acaoId = clean_(p.acao_id);
  if(!execId && !acaoId) err_("FIELD_REQUIRED","Informe execucao_id ou acao_id.",400);
  var itens = rows_("checklist_execucao").filter(function(i){
    return (execId && String(i.execucao_id) === String(execId)) || (acaoId && String(i.acao_id) === String(acaoId));
  }).sort(function(a,b){ return num_(a.ordem,0)-num_(b.ordem,0); }).map(enrichChecklistExecItem_);
  return {total:itens.length, itens:itens};
}

function enrichChecklistExecItem_(i){
  var out = strip_(i);
  out.opcoes = parseOpcoes_(i.opcoes_json);
  out.evidencias = rows_("evidencias").filter(function(e){ return String(e.checklist_execucao_id) === String(i.id); }).map(strip_);
  out.evidencias_count = out.evidencias.length;
  return out;
}

function validarRespostaChecklistItem_(item, p){
  var tipo = normalizaTipoChecklist_(item.tipo_resposta);
  var resposta = clean_(p.resposta !== undefined ? p.resposta : (p.valor !== undefined ? p.valor : (p.valor_numero !== undefined ? p.valor_numero : (p.opcao !== undefined ? p.opcao : p.texto))));
  var valorNumero = "";
  var conforme = "SIM";
  var msg = "";

  if(tipo === "INSTRUCAO"){
    resposta = resposta || "LIDO";
    return {resposta:resposta, valor_numero:"", conforme:"SIM", validacao_msg:"Instrução marcada como lida."};
  }

  if(tipo === "EVIDENCIA"){
    resposta = resposta || "EVIDENCIA_ANEXADA";
    return {resposta:resposta, valor_numero:"", conforme:"SIM", validacao_msg:"A evidência será validada na finalização."};
  }

  if(bool_(item.obrigatorio) && clean_(resposta) === "") err_("RESPOSTA_REQUIRED","Resposta obrigatória para item: "+item.titulo,400);
  if(!bool_(item.obrigatorio) && clean_(resposta) === "") return {resposta:"", valor_numero:"", conforme:"SIM", validacao_msg:"Item opcional sem resposta."};

  if(tipo === "OK_NOK"){
    resposta = upper_(resposta);
    if(["OK","NOK","NA","N/A","NAO_APLICA"].indexOf(resposta) < 0) err_("RESPOSTA_INVALIDA","OK_NOK aceita OK, NOK ou NA.",400);
    if(resposta === "NOK" && clean_(p.observacao).length < 5) err_("OBS_REQUIRED","Resposta NOK exige observação técnica.",400);
    conforme = resposta === "OK" || resposta === "NA" || resposta === "N/A" || resposta === "NAO_APLICA" ? "SIM" : "NAO";
    if(conforme === "NAO") msg = "Resposta não conforme.";
  }

  if(tipo === "CONFIRMACAO"){
    resposta = upper_(resposta);
    if(["SIM","CONFIRMADO","OK","TRUE"].indexOf(resposta) < 0) err_("CONFIRMACAO_INVALIDA","Confirmação exige SIM/CONFIRMADO/OK.",400);
    conforme = "SIM";
  }

  if(tipo === "TEXTO"){
    if(bool_(item.obrigatorio) && resposta.length < 2) err_("TEXTO_CURTO","Resposta textual obrigatória muito curta.",400);
    conforme = "SIM";
  }

  if(tipo === "SELECAO"){
    var op = parseOpcoes_(item.opcoes_json).map(upper_);
    if(op.length && op.indexOf(upper_(resposta)) < 0) err_("OPCAO_INVALIDA","Opção não permitida: "+resposta+". Permitidas: "+op.join(", "),400);
    conforme = "SIM";
  }

  if(tipo === "NUMERO" || tipo === "PARAMETRO" || tipo === "LEITURA_OPERACIONAL"){
    var rawNumero = clean_(p.valor !== undefined ? p.valor : (p.valor_numero !== undefined ? p.valor_numero : resposta)).replace(",", ".");
    valorNumero = Number(rawNumero);
    if(isNaN(valorNumero)) err_("VALOR_NUMERICO_INVALIDO","Item exige valor numérico: "+item.titulo,400);
    resposta = String(valorNumero);
    var minSet = clean_(item.limite_min) !== "";
    var maxSet = clean_(item.limite_max) !== "";
    var min = num_(item.limite_min,0);
    var max = num_(item.limite_max,0);
    var okMin = !minSet || valorNumero >= min;
    var okMax = !maxSet || valorNumero <= max;
    conforme = (okMin && okMax) ? "SIM" : "NAO";
    if(conforme === "NAO") msg = "Valor fora do limite. Valor="+valorNumero+" "+clean_(item.unidade)+"; min="+(minSet?min:"-")+"; max="+(maxSet?max:"-");
    else msg = "Valor dentro do limite.";

    if((tipo === "PARAMETRO" || tipo === "LEITURA_OPERACIONAL") && clean_(item.parametro_nome || item.titulo)){
      var acao = find_("os_acoes","id",item.acao_id);
      if(acao){
        append_("parametros", fit_("parametros", {id:uuid_("PAR"), ativo_id:acao.ativo_id, componente_id:acao.componente_id, parametro:upper_(item.parametro_nome || item.titulo), valor:valorNumero, unidade:item.unidade||"", origem:"CHECKLIST", registrado_por:p.__auth.usuario_id||"", registrado_em:now_(), criado_em:now_()}));
      }
    }

    if(conforme === "NAO" && bool_(item.bloqueia_finalizacao) && clean_(p.observacao).length < 5){
      err_("OBS_REQUIRED","Valor fora do limite e bloqueante exige observação técnica.",400);
    }
  }

  return {resposta:resposta, valor_numero:valorNumero, conforme:conforme, validacao_msg:msg};
}

function validateGestorAcaoBeforeApproval_(acao){
  var execs = rows_("execucoes").filter(function(e){ return String(e.acao_id) === String(acao.id); }).sort(sortByDateDesc_("criado_em"));
  if(!execs.length) err_("EXECUTION_NOT_FOUND","Gestor não pode aprovar ação sem execução.",400);
  validateChecklist_(execs[0].id);
  return true;
}
