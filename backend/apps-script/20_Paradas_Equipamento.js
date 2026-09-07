/**
 * FAB Control 1.1.4
 * Parada única do equipamento, ocorrências e vínculo com execução.
 */

function ensureParadasOperacionaisSchema114_(){
  var ss = getSpreadsheet_();
  ensureSheet_(ss, "planos_manutencao", SH.planos_manutencao);
  ensureSheet_(ss, "os_acoes", SH.os_acoes);
  ensureSheet_(ss, "execucoes", SH.execucoes);
  ensureSheet_(ss, "paradas_equipamento", SH.paradas_equipamento);
  ensureSheet_(ss, "paradas_manutencao", SH.paradas_manutencao);
  ensureSheet_(ss, "ocorrencias_operacionais", SH.ocorrencias_operacionais);

  var cfg = find_("config", "chave", "parada.tolerancia_retorno_min");
  if(!cfg){
    append_("config", fit_("config", {
      chave:"parada.tolerancia_retorno_min",
      valor:10,
      descricao:"Tolerância em minutos entre fim da manutenção e retorno operacional.",
      atualizado_em:now_()
    }));
  }
}

function backfillModoParadaManutencao115_(){
  rows_("planos_manutencao", true).forEach(function(plano){
    if(clean_(plano.modo_parada_manutencao)) return;
    update_("planos_manutencao", plano.__rowIndex, {
      modo_parada_manutencao:"DECISAO_EXECUTOR",
      atualizado_em:now_()
    });
  });

  rows_("os_acoes", true).forEach(function(acao){
    if(clean_(acao.modo_parada_manutencao)) return;
    var plano = clean_(acao.plano_id)
      ? find_("planos_manutencao","id",acao.plano_id)
      : null;
    update_("os_acoes", acao.__rowIndex, {
      modo_parada_manutencao:normalizaModoParadaManutencao115_(
        plano && plano.modo_parada_manutencao
      ),
      atualizado_em:now_()
    });
  });
}

function cmmsParadasOperacionaisSchemaUpgrade114_(p, auth){
  auth = auth || p.__auth || {};
  if(upper_(auth.perfil) !== ROLE.ADMIN){
    err_("FORBIDDEN_ADMIN_REQUIRED", "Upgrade de paradas exige perfil ADMIN.", 403);
  }

  ensureParadasOperacionaisSchema114_();
  if(typeof ensureHorimetroEvidenciasSchema116_ === "function") ensureHorimetroEvidenciasSchema116_();
  backfillModoParadaManutencao115_();

  return {
    upgraded:true,
    version:FAB.VERSION,
    sheets:[
      "paradas_equipamento",
      "paradas_manutencao",
      "ocorrencias_operacionais"
    ],
    total_sheets:Object.keys(SH).length,
    maintenance_stop_modes:[
      "OBRIGATORIA",
      "DECISAO_EXECUTOR",
      "SEM_PARADA"
    ],
    tolerance_minutes:paradaToleranciaMin114_()
  };
}

function paradaToleranciaMin114_(){
  return Math.max(0, num_(configurationRuntimeValue_("parada.tolerancia_retorno_min", 10), 10));
}

function paradaStatusAberto114_(status){
  return [
    ST.PARADA_ABERTA,
    ST.MANUTENCAO_EM_EXECUCAO,
    ST.AGUARDANDO_RETORNO_OPERACIONAL
  ].indexOf(upper_(status)) >= 0;
}

function paradaAtivaPorAtivo114_(ativoId){
  return rows_("paradas_equipamento")
    .filter(function(r){
      return String(r.ativo_id) === String(ativoId) &&
        paradaStatusAberto114_(r.status);
    })
    .sort(sortByDateDesc_("iniciada_em"))[0] || null;
}

function paradaAtivaPorAcao114_(acaoId){
  return rows_("paradas_equipamento")
    .filter(function(r){
      return String(r.acao_id) === String(acaoId) &&
        paradaStatusAberto114_(r.status);
    })
    .sort(sortByDateDesc_("iniciada_em"))[0] || null;
}

function secondsBetween114_(startValue, endValue){
  if(!clean_(startValue)) return 0;
  var start = new Date(startValue).getTime();
  var end = clean_(endValue) ? new Date(endValue).getTime() : Date.now();
  if(isNaN(start) || isNaN(end)) return 0;
  return Math.max(0, Math.floor((end - start) / 1000));
}

function paradaMetricas114_(row, finalTime){
  if(!row) return null;
  var end = finalTime || row.finalizada_em || "";
  var total = secondsBetween114_(row.iniciada_em, end);
  var esperaFim = row.manutencao_iniciada_em || end || "";
  var espera = secondsBetween114_(row.iniciada_em, esperaFim);

  var execucao = 0;
  if(clean_(row.manutencao_iniciada_em)){
    execucao = secondsBetween114_(
      row.manutencao_iniciada_em,
      row.manutencao_finalizada_em || end || ""
    );
  }

  var retorno = 0;
  if(clean_(row.manutencao_finalizada_em)){
    retorno = secondsBetween114_(row.manutencao_finalizada_em, end || "");
  }

  return {
    tempo_parada_segundos:total,
    tempo_espera_manutencao_segundos:espera,
    tempo_execucao_segundos:execucao,
    tempo_retorno_operacional_segundos:retorno
  };
}

function paradaSerializada114_(row){
  if(!row) return null;
  var out = strip_(row);
  var metrics = paradaMetricas114_(row);
  Object.keys(metrics).forEach(function(k){ out[k] = metrics[k]; });
  out.elapsed_seconds = metrics.tempo_parada_segundos;
  out.server_time = now_();
  out.requires_return_confirmation = upper_(row.status) === ST.AGUARDANDO_RETORNO_OPERACIONAL;
  return out;
}

function histFast119_(d){
  var row = fit_("historico", {
    id:uuid_("HIS"),
    ativo_id:d.ativo_id||"",
    componente_id:d.componente_id||"",
    os_id:d.os_id||"",
    acao_id:d.acao_id||"",
    execucao_id:d.execucao_id||"",
    evento:d.evento||"",
    descricao:d.descricao||"",
    usuario_id:d.usuario_id||"",
    perfil:d.perfil||"",
    criado_em:now_()
  });
  return typeof appendRowsFast118_ === "function"
    ? appendRowsFast118_("historico", [row])[0]
    : append_("historico", row);
}

function validarAtivoComponente114_(ativoId, componenteId){
  var ativo = find_("ativos", "id", ativoId);
  if(!ativo) err_("ASSET_NOT_FOUND", "Equipamento não encontrado.", 404);

  var componente = null;
  if(clean_(componenteId)){
    componente = find_("componentes", "id", componenteId);
    if(!componente || String(componente.ativo_id) !== String(ativo.id)){
      err_("COMPONENT_ASSET_MISMATCH", "Componente não pertence ao equipamento.", 400);
    }
  }
  return {ativo:ativo, componente:componente};
}

function atualizarStatusAtivo114_(ativo, status){
  if(!ativo) return null;
  if(typeof patchRowFast118_ === "function") return patchRowFast118_("ativos", ativo, {status:status, atualizado_em:now_()});
  update_("ativos", ativo.__rowIndex, {status:status, atualizado_em:now_()});
  return Object.assign({}, ativo, {status:status});
}

function criarParada114_(input, auth, skipExistingCheck){
  var refs = validarAtivoComponente114_(input.ativo_id, input.componente_id);
  if(!skipExistingCheck){
    var existente = paradaAtivaPorAtivo114_(refs.ativo.id);
    if(existente) return existente;
  }

  var row = fit_("paradas_equipamento", {
    id:uuid_("STP"),
    ativo_id:refs.ativo.id,
    componente_id:refs.componente ? refs.componente.id : "",
    os_id:input.os_id || "",
    acao_id:input.acao_id || "",
    execucao_id:input.execucao_id || "",
    origem:upper_(input.origem || "OPERADOR"),
    tipo:upper_(input.tipo || "NAO_PROGRAMADA"),
    status:ST.PARADA_ABERTA,
    iniciada_em:now_(),
    iniciada_por:auth && auth.usuario_id || "",
    manutencao_iniciada_em:"",
    manutencao_finalizada_em:"",
    finalizada_em:"",
    finalizada_por:"",
    tempo_parada_segundos:0,
    tempo_espera_manutencao_segundos:0,
    tempo_execucao_segundos:0,
    tempo_retorno_operacional_segundos:0,
    motivo_parada:clean_(input.motivo_parada || "Parada registrada pelo operador."),
    categoria_retorno:"",
    justificativa_divergencia:"",
    tolerancia_retorno_min:paradaToleranciaMin114_(),
    criado_em:now_(),
    atualizado_em:now_()
  });

  var inserted = typeof appendRowsFast118_ === "function"
    ? appendRowsFast118_("paradas_equipamento", [row])[0]
    : append_("paradas_equipamento", row);
  if(!inserted) err_("STOP_CREATE_FAILED", "Falha ao registrar parada operacional.", 500);
  atualizarStatusAtivo114_(refs.ativo, ST.PARADO);

  histFast119_({
    ativo_id:refs.ativo.id,
    componente_id:refs.componente ? refs.componente.id : "",
    os_id:row.os_id,
    acao_id:row.acao_id,
    execucao_id:row.execucao_id,
    evento:"PARADA_INICIADA",
    descricao:row.motivo_parada,
    usuario_id:auth && auth.usuario_id || "",
    perfil:auth && auth.perfil || ROLE.OPERADOR
  });

  return inserted;
}

function operadorParadaAtiva114_(p, auth){
  var ativoId = clean_(p.ativo_id);

  if(!ativoId && clean_(p.acao_id)){
    var acao = find_("os_acoes", "id", p.acao_id);
    if(!acao) err_("ACTION_NOT_FOUND", "Ação não encontrada.", 404);
    ativoId = acao.ativo_id;
  }

  if(!ativoId) err_("FIELD_REQUIRED", "Informe ativo_id ou acao_id.", 400);
  var refs = validarAtivoComponente114_(ativoId, "");
  var row = paradaAtivaPorAtivo114_(refs.ativo.id);

  return {
    found:!!row,
    ativo_id:refs.ativo.id,
    parada_ativa:paradaSerializada114_(row),
    server_time:now_()
  };
}

function operadorIniciarParada114_(p, auth){
  auth = requireOperadorAuth1081_(auth || p.__auth || {}, "operador.iniciar_parada");
  req_(p, ["ativo_id"]);

  var existente = paradaAtivaPorAtivo114_(p.ativo_id);
  if(existente){
    return {
      started:true,
      already_open:true,
      parada:paradaSerializada114_(existente),
      notified_profiles:[ROLE.ADMIN, ROLE.GESTOR]
    };
  }

  var row = criarParada114_({
    ativo_id:p.ativo_id,
    componente_id:p.componente_id || "",
    origem:"OPERADOR",
    tipo:p.tipo || "NAO_PROGRAMADA",
    motivo_parada:p.motivo_parada || "Parada operacional iniciada."
  }, auth, true);

  return {
    started:true,
    already_open:false,
    parada:paradaSerializada114_(row),
    notified_profiles:[ROLE.ADMIN, ROLE.GESTOR]
  };
}

function operadorFinalizarParada114_(p, auth){
  auth = requireOperadorAuth1081_(auth || p.__auth || {}, "operador.finalizar_parada");

  var row = null;
  if(clean_(p.parada_id)) row = find_("paradas_equipamento", "id", p.parada_id);
  if(!row && clean_(p.ativo_id)) row = paradaAtivaPorAtivo114_(p.ativo_id);
  if(!row) err_("STOP_NOT_FOUND", "Parada ativa não encontrada.", 404);
  if(!paradaStatusAberto114_(row.status)){
    return {closed:true, already_closed:true, parada:paradaSerializada114_(row)};
  }
  if(upper_(row.status) === ST.MANUTENCAO_EM_EXECUCAO){
    err_("STOP_MAINTENANCE_RUNNING", "A manutenção ainda está em execução. Finalize o serviço técnico antes de liberar o equipamento.", 409);
  }

  var now = now_();
  var metrics = paradaMetricas114_(row, now);
  var tolerance = Math.max(0, num_(row.tolerancia_retorno_min, paradaToleranciaMin114_()));
  var requiresJustification =
    clean_(row.manutencao_finalizada_em) &&
    metrics.tempo_retorno_operacional_segundos > tolerance * 60;

  var category = upper_(p.categoria_retorno);
  var justification = clean_(p.justificativa_divergencia);

  if(requiresJustification && (!category || justification.length < 5)){
    return {
      closed:false,
      requires_justification:true,
      tolerance_minutes:tolerance,
      delay_seconds:metrics.tempo_retorno_operacional_segundos,
      parada:paradaSerializada114_(row),
      categories:[
        "LIMPEZA_AREA",
        "TESTE_PRODUCAO",
        "AJUSTE_PROCESSO",
        "FALTA_MATERIA_PRIMA",
        "AGUARDANDO_QUALIDADE",
        "AGUARDANDO_OPERADOR",
        "OUTRO"
      ]
    };
  }

  var closedPatch = {
    status:ST.FINALIZADA,
    finalizada_em:now,
    finalizada_por:auth.usuario_id || "",
    tempo_parada_segundos:metrics.tempo_parada_segundos,
    tempo_espera_manutencao_segundos:metrics.tempo_espera_manutencao_segundos,
    tempo_execucao_segundos:metrics.tempo_execucao_segundos,
    tempo_retorno_operacional_segundos:metrics.tempo_retorno_operacional_segundos,
    categoria_retorno:category,
    justificativa_divergencia:justification,
    atualizado_em:now
  };
  var updated = typeof patchRowFast118_ === "function"
    ? patchRowFast118_("paradas_equipamento", row, closedPatch)
    : Object.assign({}, row, closedPatch);
  if(typeof patchRowFast118_ !== "function") update_("paradas_equipamento", row.__rowIndex, closedPatch);

  var ativo = find_("ativos", "id", row.ativo_id);
  var maintenanceStop = typeof paradaManutencaoAtivaPorAtivo115_ === "function"
    ? paradaManutencaoAtivaPorAtivo115_(row.ativo_id)
    : null;
  atualizarStatusAtivo114_(ativo, maintenanceStop ? ST.PARADO : ST.OPERANDO);

  histFast119_({
    ativo_id:row.ativo_id,
    componente_id:row.componente_id,
    os_id:row.os_id,
    acao_id:row.acao_id,
    execucao_id:row.execucao_id,
    evento:"PARADA_FINALIZADA",
    descricao:"Equipamento voltou a operar. Tempo total: "+metrics.tempo_parada_segundos+" s. Retorno após manutenção: "+metrics.tempo_retorno_operacional_segundos+" s. "+justification,
    usuario_id:auth.usuario_id || "",
    perfil:auth.perfil || ROLE.OPERADOR
  });

  return {
    closed:true,
    requires_justification:false,
    parada:paradaSerializada114_(updated),
    metricas:metrics
  };
}

function operadorRegistrarOcorrencia114_(p, auth){
  auth = requireOperadorAuth1081_(auth || p.__auth || {}, "operador.registrar_ocorrencia");
  req_(p, ["ativo_id", "titulo", "descricao"]);

  var target = upper_(p.alvo_ocorrencia || p.alvo || p.tipo || "EQUIPAMENTO");
  if(["EQUIPAMENTO","COMPONENTE"].indexOf(target) < 0){
    err_("OCCURRENCE_TARGET_INVALID", "Escolha EQUIPAMENTO ou COMPONENTE.", 400);
  }
  if(target === "COMPONENTE" && !clean_(p.componente_id)){
    err_("OCCURRENCE_COMPONENT_REQUIRED", "Selecione o componente da ocorrência.", 400);
  }

  var refs = validarAtivoComponente114_(
    p.ativo_id,
    target === "COMPONENTE" ? p.componente_id : ""
  );
  var createdAt = now_();
  var row = fit_("ocorrencias_operacionais", {
    id:uuid_("OCR"),
    ativo_id:refs.ativo.id,
    componente_id:refs.componente ? refs.componente.id : "",
    tipo:target,
    titulo:clean_(p.titulo),
    descricao:clean_(p.descricao),
    severidade:upper_(p.severidade || "MEDIA"),
    status:ST.AGUARDANDO_ANALISE,
    usuario_id:auth.usuario_id || "",
    perfil:auth.perfil || ROLE.OPERADOR,
    os_id:"",
    acao_id:"",
    criado_em:createdAt,
    atualizado_em:createdAt
  });
  row = typeof appendRowsFast118_ === "function"
    ? appendRowsFast118_("ocorrencias_operacionais", [row])[0]
    : append_("ocorrencias_operacionais", row);

  histFast119_({
    ativo_id:row.ativo_id,
    componente_id:row.componente_id,
    evento:"OCORRENCIA_OPERACIONAL_REGISTRADA",
    descricao:(target === "COMPONENTE" ? "Ocorrência em componente: " : "Ocorrência no equipamento: ")+row.titulo+". "+row.descricao,
    usuario_id:auth.usuario_id || "",
    perfil:auth.perfil || ROLE.OPERADOR
  });

  return {
    saved:true,
    occurrence:strip_(row),
    alvo_ocorrencia:target,
    notified_profiles:[ROLE.ADMIN, ROLE.GESTOR]
  };
}

function paradaVincularInicioManutencao114_(acao, ex, auth){
  if(!acao || !ex) return null;

  var row = paradaAtivaPorAtivo114_(acao.ativo_id);
  if(row && upper_(row.status) === ST.MANUTENCAO_EM_EXECUCAO &&
     clean_(row.acao_id) && String(row.acao_id) !== String(acao.id)){
    err_("ASSET_MAINTENANCE_ALREADY_RUNNING", "Equipamento já possui manutenção em execução.", 409);
  }

  if(!row){
    row = criarParada114_({
      ativo_id:acao.ativo_id,
      componente_id:acao.componente_id,
      os_id:acao.os_id,
      acao_id:acao.id,
      execucao_id:ex.id,
      origem:"MANUTENCAO",
      tipo:"TECNICA",
      motivo_parada:"Equipamento parado para execução da manutenção."
    }, auth);
  }

  var linkedPatch = {
    componente_id:row.componente_id || acao.componente_id || "",
    os_id:acao.os_id || row.os_id || "",
    acao_id:acao.id,
    execucao_id:ex.id,
    status:ST.MANUTENCAO_EM_EXECUCAO,
    manutencao_iniciada_em:row.manutencao_iniciada_em || now_(),
    atualizado_em:now_()
  };
  var linkedRow = typeof patchRowFast118_ === "function"
    ? patchRowFast118_("paradas_equipamento", row, linkedPatch)
    : Object.assign({}, row, linkedPatch);
  if(typeof patchRowFast118_ !== "function") update_("paradas_equipamento", row.__rowIndex, linkedPatch);

  var ativo = find_("ativos", "id", acao.ativo_id);
  atualizarStatusAtivo114_(ativo, ST.PARADO);

  return paradaSerializada114_(linkedRow);
}

function paradaRegistrarFimManutencao114_(acao, ex, auth){
  if(!acao || !ex) return null;

  var row = paradaAtivaPorAcao114_(acao.id) || paradaAtivaPorAtivo114_(acao.ativo_id);
  if(!row) return null;

  var endPatch = {
    os_id:acao.os_id || row.os_id || "",
    acao_id:acao.id,
    execucao_id:ex.id,
    status:ST.AGUARDANDO_RETORNO_OPERACIONAL,
    manutencao_iniciada_em:row.manutencao_iniciada_em || ex.iniciou_em || acao.iniciado_em || "",
    manutencao_finalizada_em:now_(),
    atualizado_em:now_()
  };
  var endedRow = typeof patchRowFast118_ === "function"
    ? patchRowFast118_("paradas_equipamento", row, endPatch)
    : Object.assign({}, row, endPatch);
  if(typeof patchRowFast118_ !== "function") update_("paradas_equipamento", row.__rowIndex, endPatch);

  var ativo = find_("ativos", "id", acao.ativo_id);
  atualizarStatusAtivo114_(ativo, ST.PARADO);

  histFast119_({
    ativo_id:acao.ativo_id,
    componente_id:acao.componente_id,
    os_id:acao.os_id,
    acao_id:acao.id,
    execucao_id:ex.id,
    evento:"MANUTENCAO_FINALIZADA_AGUARDANDO_RETORNO",
    descricao:"Manutenção finalizada. Equipamento permanece parado até confirmação da produção.",
    usuario_id:auth && auth.usuario_id || "",
    perfil:auth && auth.perfil || ROLE.OPERADOR
  });

  return paradaSerializada114_(endedRow);
}

function gestorListarParadas114_(p, auth){
  var status = upper_(p.status);
  var ativoId = clean_(p.ativo_id);
  var lista = rows_("paradas_equipamento").filter(function(r){
    return (!status || upper_(r.status) === status) &&
      (!ativoId || String(r.ativo_id) === String(ativoId));
  }).sort(sortByDateDesc_("iniciada_em"));

  return {
    total:lista.length,
    paradas:lista.slice(0, Math.max(1, Math.min(200, num_(p.limite, 100)))).map(paradaSerializada114_)
  };
}

function gestorListarOcorrencias114_(p, auth){
  var status = upper_(p.status);
  var ativoId = clean_(p.ativo_id);
  var lista = rows_("ocorrencias_operacionais").filter(function(r){
    return (!status || upper_(r.status) === status) &&
      (!ativoId || String(r.ativo_id) === String(ativoId));
  }).sort(sortByDateDesc_("criado_em"));

  return {
    total:lista.length,
    ocorrencias:lista.slice(0, Math.max(1, Math.min(200, num_(p.limite, 100)))).map(strip_)
  };
}
