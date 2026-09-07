function cmmsMotorRecalcular_(p){
  var alvo = clean_(p.ativo_id);
  var ativos = (alvo ? rows_("ativos").filter(function(a){ return String(a.id) === alvo; }) : rows_("ativos"))
    .filter(function(a){ return upper_(a.status) !== ST.INATIVO; });
  var componentesAtivos = {};
  rows_("componentes").forEach(function(component){
    componentesAtivos[String(component.id)] = upper_(component.status) !== ST.INATIVO;
  });
  var criadas = [];

  ativos.forEach(function(ativo){
    rows_("planos_manutencao").filter(function(pl){
      return String(pl.ativo_id) === String(ativo.id) &&
        isPlanoOperacional_(pl) &&
        (!clean_(pl.componente_id) || componentesAtivos[String(pl.componente_id)] === true);
    }).forEach(function(plano){
      ensureDefaultPlanoItem_(plano);

      var decision = shouldGenerate_(ativo, plano);
      if(!decision.generate) return;

      var open = findOpenActionForPlan_(plano.id);
      if(open) return;

      var os = createOs_(ativo, plano);
      var acao = createAction_(ativo, plano, os.id, decision);
      updatePlanoControleAfterGenerate_(plano, decision.current, decision.nextAfter, acao);
      criadas.push(acao);

      hist_({ativo_id:acao.ativo_id, componente_id:acao.componente_id, os_id:os.id, acao_id:acao.id, evento:"ACAO_GERADA_MOTOR", descricao:"Ação gerada: "+acao.titulo, usuario_id:"SISTEMA", perfil:ROLE.SISTEMA});
    });
  });

  return {recalculated:true, ativos_processados:ativos.length, acoes_criadas:criadas.length, novas_acoes:criadas.map(strip_)};
}

function shouldGenerate_(ativo, plano){
  var tipo = upper_(plano.gatilho_tipo);
  var gat = num_(plano.gatilho_valor,0);
  if(gat <= 0) return {generate:false, reason:"gatilho_invalido"};

  if(tipo === "HORAS"){
    var comp = plano.componente_id ? find_("componentes","id",plano.componente_id) : null;
    var current = comp ? num_(comp.horas_acumuladas,0) : num_(ativo.horimetro_atual,0);
    var ctl = getPlanoControle_(plano);
    var nextTarget = num_(ctl.proximo_valor_gatilho, 0) || gat;

    if(current < nextTarget * FAB.MOTOR_THRESHOLD_RATIO) return {generate:false, reason:"abaixo_threshold", current:current, nextTarget:nextTarget};

    if(num_(ctl.ultimo_valor_processado,0) >= current && clean_(ctl.ultima_acao_id)) return {generate:false, reason:"ciclo_ja_processado", current:current};

    return {generate:true, current:current, target:nextTarget, nextAfter:nextTarget + gat};
  }

  if(tipo === "DIAS"){
    var ctlD = getPlanoControle_(plano);
    var last = ctlD.atualizado_em ? new Date(ctlD.atualizado_em).getTime() : 0;
    var days = last ? (Date.now()-last)/86400000 : 99999;
    if(days < gat) return {generate:false, reason:"dias_nao_atingido"};
    return {generate:true, current:days, target:gat, nextAfter:gat};
  }

  if(tipo === "PARAMETRO"){
    var params = rows_("parametros").filter(function(x){ return String(x.ativo_id)===String(plano.ativo_id) && (!plano.componente_id || String(x.componente_id)===String(plano.componente_id)); }).sort(sortByDateDesc_("registrado_em"));
    var lastP = params[0];
    if(!lastP || num_(lastP.valor,0) < gat) return {generate:false, reason:"parametro_nao_atingido"};
    var ctlP = getPlanoControle_(plano);
    if(String(ctlP.ultima_acao_id||"") && num_(ctlP.ultimo_valor_processado,0) >= num_(lastP.valor,0)) return {generate:false, reason:"parametro_ja_processado"};
    return {generate:true, current:num_(lastP.valor,0), target:gat, nextAfter:gat};
  }

  return {generate:false, reason:"tipo_nao_suportado"};
}

function getPlanoControle_(plano){
  var ctl = find_("plano_controle","plano_id",plano.id);
  if(ctl) return ctl;

  var initialTarget = upper_(plano.gatilho_tipo) === "HORAS" ? num_(plano.gatilho_valor,0) : num_(plano.gatilho_valor,0);
  var row = fit_("plano_controle", {
    plano_id:plano.id,
    ativo_id:plano.ativo_id,
    componente_id:plano.componente_id || "",
    gatilho_tipo:upper_(plano.gatilho_tipo),
    gatilho_valor:num_(plano.gatilho_valor,0),
    ultimo_valor_processado:0,
    proximo_valor_gatilho:initialTarget,
    ultima_acao_id:"",
    ultima_acao_status:"",
    atualizado_em:now_()
  });
  append_("plano_controle", row);
  return row;
}

function updatePlanoControleAfterGenerate_(plano, current, nextAfter, acao){
  var ctl = getPlanoControle_(plano);
  update_("plano_controle", ctl.__rowIndex, {
    ultimo_valor_processado:current,
    proximo_valor_gatilho:nextAfter,
    ultima_acao_id:acao.id,
    ultima_acao_status:acao.status,
    atualizado_em:now_()
  });
  var old = find_("planos_manutencao","id",plano.id);
  if(old) update_("planos_manutencao", old.__rowIndex, {ultimo_disparo_em:now_(), atualizado_em:now_()});
}

function refreshPlanoControleStatus_(acao){
  if(!acao || !acao.plano_id) return;
  var ctl = find_("plano_controle","plano_id",acao.plano_id);
  if(ctl && String(ctl.ultima_acao_id) === String(acao.id)){
    update_("plano_controle", ctl.__rowIndex, {ultima_acao_status:acao.status, atualizado_em:now_()});
  }
}

function findOpenActionForPlan_(planoId){
  return rows_("os_acoes").find(function(a){ return String(a.plano_id) === String(planoId) && acaoAberta_(a); }) || null;
}

function createOs_(ativo, plano){
  var row = fit_("ordens_servico", {
    id:uuid_("OS"),
    codigo:"OS-"+Utilities.formatDate(new Date(), FAB.TZ, "yyyyMMdd-HHmmss"),
    ativo_id:ativo.id,
    componente_id:plano.componente_id||"",
    plano_id:plano.id,
    origem:"MOTOR",
    tipo:plano.tipo,
    titulo:plano.nome,
    descricao:"OS automática do plano "+plano.nome,
    prioridade:plano.criticidade || "MEDIA",
    status:ST.ABERTA,
    solicitante_id:"SISTEMA",
    responsavel_id:"",
    aberta_em:now_(),
    planejada_para:"",
    iniciada_em:"",
    finalizada_em:"",
    criado_em:now_(),
    atualizado_em:now_()
  });
  append_("ordens_servico", row);
  return row;
}

function createAction_(ativo, plano, osId, decision){
  var desc = upper_(plano.gatilho_tipo) === "HORAS"
    ? "Gatilho HORAS: "+decision.target+" "+(plano.unidade||"h")
    : "Gatilho "+upper_(plano.gatilho_tipo)+": "+decision.target+" "+(plano.unidade||"");

  var row = fit_("os_acoes", {
    id:uuid_("ACT"),
    os_id:osId,
    ativo_id:ativo.id,
    componente_id:plano.componente_id||"",
    plano_id:plano.id,
    origem:"MOTOR",
    tipo:plano.tipo,
    titulo:plano.nome,
    descricao:desc,
    prioridade:plano.criticidade || "MEDIA",
    modo_parada_manutencao:normalizaModoParadaManutencao115_(
      plano.modo_parada_manutencao
    ),
    status:ST.PENDENTE,
    responsavel_id:"",
    gerado_em:now_(),
    iniciado_em:"",
    finalizado_em:"",
    atualizado_em:now_()
  });
  append_("os_acoes", row);
  return row;
}

function ensureDefaultPlanoItem_(plano){
  var itens = rows_("plano_itens").filter(function(i){ return String(i.plano_id) === String(plano.id); });
  if(itens.length) return;

  append_("plano_itens", fit_("plano_itens", {
    id:eid_("PIT", plano.id+"-1-EXECUCAO"),
    plano_id:plano.id,
    ordem:1,
    titulo:"Executar procedimento técnico",
    instrucao:plano.nome + ". Registrar condição encontrada e justificar qualquer anomalia.",
    tipo_resposta:"OK_NOK",
    obrigatorio:"SIM",
    evidencia_obrigatoria:bool_(plano.requer_evidencia) ? "SIM" : "NAO",
    foto_referencia_url:"",
    limite_min:"",
    limite_max:"",
    unidade:plano.unidade || "",
    criado_em:now_(),
    atualizado_em:now_()
  }));
}

function acaoDisponivelInicioQr119_(acao){
  return [
    ST.PENDENTE,
    ST.ABERTA,
    "AGUARDANDO_INICIO",
    "LIBERADA"
  ].indexOf(upper_(acao && acao.status)) >= 0;
}

function operadorHistoricoQr119_(p){
  req_(p,["ativo_id"]);

  var limit = Math.max(1, Math.min(20, num_(p.limite || p.limit, FAB.QR_HISTORY_PAGE_SIZE || 4)));
  var componentId = clean_(p.componente_id);
  var sh = sheet_("historico");
  var lastRow = sh.getLastRow();
  var lastColumn = sh.getLastColumn();
  var headers = headers_("historico");

  if(lastRow < 2 || lastColumn < 1){
    return {
      items:[],
      next_cursor:"",
      has_more:false,
      limit:limit,
      ativo_id:p.ativo_id,
      componente_id:componentId
    };
  }

  var cursor = Math.min(Math.max(1, num_(p.cursor, lastRow)), lastRow);
  var blockSize = Math.max(40, Math.min(300, num_(FAB.QR_HISTORY_SCAN_BLOCK, 120)));
  var maxScanRows = Math.max(blockSize, Math.min(1200, num_(FAB.QR_HISTORY_MAX_SCAN_ROWS, 480)));
  var matches = [];
  var scanEnd = cursor;
  var scannedRows = 0;

  // A leitura é limitada por página. Mesmo em históricos muito grandes, uma
  // consulta nunca percorre a aba inteira. O cursor continua do ponto exato.
  while(scanEnd >= 2 && matches.length < limit && scannedRows < maxScanRows){
    var allowed = Math.min(blockSize, maxScanRows - scannedRows);
    var scanStart = Math.max(2, scanEnd - allowed + 1);
    var rowCount = scanEnd - scanStart + 1;
    var values = sh.getRange(scanStart, 1, rowCount, lastColumn).getValues();
    scannedRows += rowCount;

    for(var index = values.length - 1; index >= 0; index--){
      var rowIndex = scanStart + index;
      var row = {};
      headers.forEach(function(header, column){ row[header] = normCell_(values[index][column]); });

      if(String(row.ativo_id) !== String(p.ativo_id)) continue;
      if(componentId && String(row.componente_id) !== String(componentId)) continue;

      row.__rowIndex = rowIndex;
      matches.push(row);
      if(matches.length >= limit){
        scanEnd = rowIndex - 1;
        break;
      }
    }

    if(matches.length < limit) scanEnd = scanStart - 1;
  }

  var hasMore = scanEnd >= 2;
  return {
    items:matches.slice(0, limit).map(strip_),
    next_cursor:hasMore ? String(scanEnd) : "",
    has_more:hasMore,
    limit:limit,
    scanned_rows:scannedRows,
    ativo_id:p.ativo_id,
    componente_id:componentId
  };
}

function operadorContextoQr_(p){
  req_(p,["qr_payload"]);
  var qr = clean_(p.qr_payload);

  var ctx = resolveQr_(qr);
  if(!ctx.found){
    return {
      found:false,
      tipo_contexto:"NAO_ENCONTRADO",
      mensagem_operador:"QR/TAG não encontrado.",
      ativo:null,
      componente:null,
      componentes:[],
      acoes_pendentes:[],
      proxima_acao:null,
      historico_recente:[],
      historico_paginacao:{next_cursor:"",has_more:false,limit:FAB.QR_HISTORY_PAGE_SIZE || 4},
      parametros_recentes:[],
      parametros_atuais:[],
      parada_ativa:null,
      ocorrencias_abertas:[],
      saude:null
    };
  }

  function availableActions(){
    return rows_("os_acoes").filter(function(a){
      return String(a.ativo_id) === String(ctx.ativo.id) &&
        (!ctx.componente || String(a.componente_id) === String(ctx.componente.id)) &&
        acaoDisponivelInicioQr119_(a);
    }).sort(function(a,b){
      return priorityScore_(b.prioridade)-priorityScore_(a.prioridade) ||
        String(a.gerado_em).localeCompare(String(b.gerado_em));
    });
  }

  var acoes = availableActions();
  if(
    !acoes.length &&
    p.motor !== false &&
    typeof fastNeedsMotorForContext_ === "function" &&
    fastNeedsMotorForContext_(ctx)
  ){
    cmmsMotorRecalcular_({ativo_id:ctx.ativo.id, __auth:p.__auth});
    DB_CACHE["os_acoes"] = null;
    safeCacheRemove_(tableCacheKey_("os_acoes"));
    acoes = availableActions();
  }

  var comps = rows_("componentes").filter(function(c){
    return String(c.ativo_id) === String(ctx.ativo.id) && isValidComponent_(c);
  }).map(strip_);

  var historyPage = operadorHistoricoQr119_({
    ativo_id:ctx.ativo.id,
    componente_id:ctx.componente ? ctx.componente.id : "",
    limite:FAB.QR_HISTORY_PAGE_SIZE || 4
  });

  var parametrosRecentes = rows_("parametros").filter(function(r){
    return String(r.ativo_id) === String(ctx.ativo.id) &&
      (!ctx.componente || !clean_(r.componente_id) || String(r.componente_id) === String(ctx.componente.id));
  }).sort(sortByDateDesc_("registrado_em")).slice(0,30).map(strip_);

  var parametrosMapa = {};
  parametrosRecentes.forEach(function(r){
    var chave = String(r.componente_id || "") + "|" + upper_(r.parametro || "");
    if(!parametrosMapa[chave]) parametrosMapa[chave] = r;
  });
  var parametrosAtuais = Object.keys(parametrosMapa).map(function(k){ return parametrosMapa[k]; });

  var saude = saudeAtivo_(ctx.ativo.id);
  var paradaAtiva = typeof paradaAtivaPorAtivo114_ === "function" ? paradaAtivaPorAtivo114_(ctx.ativo.id) : null;
  var ocorrenciasAbertas = rows_("ocorrencias_operacionais").filter(function(o){
    return String(o.ativo_id) === String(ctx.ativo.id) &&
      ["FINALIZADA","CANCELADA"].indexOf(upper_(o.status)) < 0;
  }).sort(sortByDateDesc_("criado_em")).slice(0,20).map(strip_);

  return {
    found:true,
    tipo_contexto:ctx.tipo,
    ativo:strip_(ctx.ativo),
    horimetro:typeof horimetroResumo116_ === "function" ? horimetroResumo116_(ctx.ativo) : null,
    componente:ctx.componente ? strip_(ctx.componente) : null,
    componentes:comps,
    acoes_pendentes:acoes.map(enrichAction_),
    proxima_acao:acoes.length ? enrichAction_(acoes[0]) : null,
    historico_recente:historyPage.items,
    historico_paginacao:{
      next_cursor:historyPage.next_cursor,
      has_more:historyPage.has_more,
      limit:historyPage.limit
    },
    parametros_recentes:parametrosRecentes,
    parametros_atuais:parametrosAtuais,
    parada_ativa:paradaAtiva ? paradaSerializada114_(paradaAtiva) : null,
    ocorrencias_abertas:ocorrenciasAbertas,
    saude:saude,
    mensagem_operador:acoes.length
      ? "Existem ações disponíveis para iniciar neste equipamento."
      : "Equipamento sem ações disponíveis para início."
  };
}

function resolveQr_(qr){
  var atv = rows_("ativos").find(function(a){ return isValidAtivo_(a) && (String(a.qr_payload)===qr || String(a.tag)===qr || String(a.id)===qr); });
  if(atv) return {found:true, tipo:"ATIVO", ativo:atv, componente:null};

  var comp = rows_("componentes").find(function(c){ return isValidComponent_(c) && (String(c.qr_payload)===qr || String(c.tag)===qr || String(c.id)===qr); });
  if(comp){
    var a = find_("ativos","id",comp.ativo_id);
    return {found:!!a, tipo:"COMPONENTE", ativo:a, componente:comp};
  }

  var os = rows_("ordens_servico").find(function(o){ return String(o.codigo)===qr || String(o.id)===qr; });
  if(os){
    var ao = find_("ativos","id",os.ativo_id);
    var co = os.componente_id ? find_("componentes","id",os.componente_id) : null;
    return {found:!!ao, tipo:"OS", ativo:ao, componente:co};
  }
  return {found:false};
}

function isValidAtivo_(a){
  return String(a.id||"").indexOf("ATV-") === 0 && clean_(a.tag) && clean_(a.nome);
}
function isValidComponent_(c){
  return String(c.id||"").indexOf("CMP-ATV-") === 0 && String(c.ativo_id||"").indexOf("ATV-") === 0 && clean_(c.nome);
}

function enrichAction_(a){
  var comp = a.componente_id ? find_("componentes","id",a.componente_id) : null;
  var plano = a.plano_id ? find_("planos_manutencao","id",a.plano_id) : null;
  var out = strip_(a);
  out.componente_nome = comp ? comp.nome : "";
  out.plano = plano ? strip_(plano) : null;
  out.locks_ativos = activeLocks_(a.id).length;
  out.max_sessoes = plano ? Math.max(1,num_(plano.max_sessoes,1)) : 1;
  return out;
}


function requireOperadorAuth1081_(auth, actionName){
  auth = auth || {};
  if(upper_(auth.perfil) !== ROLE.OPERADOR){
    err_("FORBIDDEN_OPERADOR_REQUIRED", "Ação operacional exige token de OPERADOR: "+actionName, 403);
  }
  if(!clean_(auth.usuario_id)) err_("AUTH_USER_REQUIRED", "Token operacional sem usuário vinculado.", 403);
  return auth;
}

function requireExecucaoDoOperador1081_(ex, auth){
  if(!ex) err_("EXECUTION_NOT_FOUND", "Execução não encontrada para validar autoria operacional.", 404);
  var operadorId = clean_(ex.operador_id);
  var usuarioId = clean_(auth.usuario_id);
  if(!operadorId) err_("EXECUTION_OPERATOR_REQUIRED", "Execução sem operador responsável vinculado.", 400);
  if(String(operadorId) !== String(usuarioId)){
    err_("EXECUTION_OWNERSHIP_MISMATCH", "Execução pertence ao operador "+operadorId+". Token informado: "+usuarioId, 403);
  }
}

function latestExecucaoAcao1081_(acaoId){
  var execs = rows_("execucoes").filter(function(e){ return String(e.acao_id) === String(acaoId); }).sort(sortByDateDesc_("criado_em"));
  return execs.length ? execs[0] : null;
}

/**
 * Operador 1.1.8 - helpers de escrita usados somente nos fluxos críticos.
 * Reduz chamadas ao Sheets sem regravar a linha inteira como texto.
 */
function patchRowFast118_(name, row, patch){
  if(!row || !row.__rowIndex){
    if(row && row.__rowIndex) update_(name, row.__rowIndex, patch);
    return Object.assign({}, row || {}, patch || {});
  }

  var headers = SH[name] || headers_(name);
  var indexes = Object.keys(patch || {}).map(function(key){ return headers.indexOf(key); })
    .filter(function(index){ return index >= 0; });
  if(!indexes.length) return Object.assign({}, row, patch || {});

  var minIndex = Math.min.apply(null, indexes);
  var maxIndex = Math.max.apply(null, indexes);
  var range = sheet_(name).getRange(row.__rowIndex, minIndex + 1, 1, maxIndex - minIndex + 1);
  var values = range.getValues()[0];

  Object.keys(patch).forEach(function(key){
    var column = headers.indexOf(key);
    if(column >= minIndex && column <= maxIndex){
      values[column - minIndex] = patch[key];
    }
  });

  range.setValues([values]);
  invalidateSheetCache_(name);
  return Object.assign({}, row, patch);
}

function appendRowsFast118_(name, objects){
  objects = Array.isArray(objects) ? objects : [];
  if(!objects.length) return [];

  var sh = sheet_(name);
  var headers = SH[name] || headers_(name);
  var startRow = sh.getLastRow() + 1;
  var values = objects.map(function(object){
    return headers.map(function(key){
      return object[key] === undefined ? "" : object[key];
    });
  });

  sh.getRange(startRow, 1, values.length, headers.length).setValues(values);
  invalidateSheetCache_(name);

  return objects.map(function(object, index){
    return Object.assign({}, object, {__rowIndex:startRow + index});
  });
}

function checklistExecucaoResumo118_(execucaoId, rows){
  var itens = (rows || rows_("checklist_execucao").filter(function(item){
    return String(item.execucao_id) === String(execucaoId);
  })).slice().sort(function(a,b){ return num_(a.ordem,0)-num_(b.ordem,0); });

  var respondidos = itens.filter(function(item){
    return upper_(item.status) === ST.RESPONDIDO || clean_(item.resposta) !== "" || clean_(item.valor_numero) !== "";
  }).length;

  return {
    modelo:false,
    execucao_id:execucaoId,
    total:itens.length,
    respondidos:respondidos,
    pending_count:Math.max(0, itens.length - respondidos),
    itens:itens.map(strip_)
  };
}

function validarChecklistParaInicio119_(acao){
  var plano = acao.plano_id ? find_("planos_manutencao", "id", acao.plano_id) : null;
  if(!plano) err_("PLAN_NOT_FOUND", "Ação sem plano técnico vinculado.", 404);
  if(!isPlanoOperacional_(plano)) err_("PLANO_NAO_VALIDADO", "Plano/checklist ainda não validado pela gestão.", 400);
  var itens = rows_("plano_itens").filter(function(item){
    return String(item.plano_id) === String(acao.plano_id) &&
      upper_(item.status || ST.ATIVO) === ST.ATIVO;
  });
  if(!itens.length) err_("CHECKLIST_MODELO_VAZIO", "Plano validado não possui itens de checklist.", 400);
}

function operadorIniciarAcao_(p){
  req_(p,["acao_id"]);
  var auth = requireOperadorAuth1081_(p.__auth || {}, "operador.iniciar_acao");
  var acao = find_("os_acoes","id",p.acao_id);
  if(!acao) err_("ACTION_NOT_FOUND","Ação não encontrada.",404);
  if(!acaoDisponivelInicioQr119_(acao) && upper_(acao.status) !== ST.EM_EXECUCAO){
    err_("ACTION_INVALID_STATUS","Ação não pode iniciar. Status atual: "+acao.status,400);
  }
  validarChecklistParaInicio119_(acao);

  var open = rows_("execucoes").find(function(e){
    return String(e.acao_id)===String(acao.id) && upper_(e.status) !== ST.FINALIZADA;
  });

  if(open){
    requireExecucaoDoOperador1081_(open, auth);

    var existingPolicy = clean_(open.modo_execucao_manutencao)
      ? {
          modo_configurado:modoParadaAcao115_(acao),
          decisao:upper_(open.modo_execucao_manutencao) === "SEM_PARADA"
            ? "SEM_PARADA"
            : "PARAR_EQUIPAMENTO",
          parada_operacional:paradaAtivaPorAtivo114_(acao.ativo_id)
        }
      : resolverDecisaoInicioManutencao115_(acao, p);

    var existingUnifiedStop = iniciarCondicaoManutencao115_(
      acao,
      open,
      auth,
      existingPolicy
    );
    var existingOperationalStop = existingUnifiedStop || (
      existingPolicy.parada_operacional
        ? paradaSerializada114_(existingPolicy.parada_operacional)
        : null
    );
    var existingChecklist = criarChecklistExec_(acao, open);

    return {
      started:true,
      already_started:true,
      acao_id:acao.id,
      execucao_id:open.id,
      status:ST.EM_EXECUCAO,
      execucao:strip_(Object.assign({}, open, {
        modo_execucao_manutencao:existingPolicy.decisao === "SEM_PARADA" ? "SEM_PARADA" : "COM_PARADA"
      })),
      checklist:existingChecklist,
      modo_parada_manutencao:existingPolicy.modo_configurado,
      decisao_parada_manutencao:existingPolicy.decisao,
      modo_execucao_manutencao:existingPolicy.decisao === "SEM_PARADA"
        ? "SEM_PARADA"
        : "COM_PARADA",
      parada_operacional:existingOperationalStop,
      parada_manutencao:null
    };
  }

  var policy = resolverDecisaoInicioManutencao115_(acao, p);
  var startedAt = now_();

  var ex = fit_("execucoes", {
    id:uuid_("EXE"),
    acao_id:acao.id,
    os_id:acao.os_id,
    ativo_id:acao.ativo_id,
    componente_id:acao.componente_id,
    operador_id:auth.usuario_id || "",
    resultado:"",
    observacao:"",
    duracao_segundos:0,
    modo_execucao_manutencao:policy.decisao === "SEM_PARADA" ? "SEM_PARADA" : "COM_PARADA",
    abriu_em:startedAt,
    iniciou_em:startedAt,
    finalizou_em:"",
    status:ST.EM_EXECUCAO,
    criado_em:startedAt,
    atualizado_em:startedAt
  });
  ex = appendRowsFast118_("execucoes", [ex])[0];

  // A parada física é criada ou reutilizada imediatamente após abrir a
  // execução. Isso atualiza o status do equipamento antes das atualizações
  // secundárias da ação, da OS e da preparação do checklist.
  var unifiedStop = iniciarCondicaoManutencao115_(acao, ex, auth, policy);
  var operationalStop = unifiedStop || (
    policy.parada_operacional
      ? paradaSerializada114_(policy.parada_operacional)
      : null
  );

  acao = patchRowFast118_("os_acoes", acao, {
    status:ST.EM_EXECUCAO,
    responsavel_id:auth.usuario_id||"",
    iniciado_em:acao.iniciado_em||startedAt,
    modo_parada_manutencao:policy.modo_configurado,
    atualizado_em:startedAt
  });
  rows_("ocorrencias_operacionais", true).filter(function(occurrence){
    return String(occurrence.acao_id) === String(acao.id);
  }).forEach(function(occurrence){
    update_("ocorrencias_operacionais", occurrence.__rowIndex, {
      status:"EM_EXECUCAO",
      tratamento_status:"EM_EXECUCAO",
      atualizado_em:startedAt
    });
  });

  var os = acao.os_id ? find_("ordens_servico","id",acao.os_id) : null;
  if(os && upper_(os.status) === ST.ABERTA){
    patchRowFast118_("ordens_servico", os, {
      status:ST.EM_EXECUCAO,
      iniciada_em:startedAt,
      atualizado_em:startedAt
    });
  }

  var checklist = criarChecklistExec_(acao, ex);

  (typeof histFast119_ === "function" ? histFast119_ : hist_)({
    ativo_id:acao.ativo_id,
    componente_id:acao.componente_id,
    os_id:acao.os_id,
    acao_id:acao.id,
    execucao_id:ex.id,
    evento:"ACAO_INICIADA",
    descricao:"Operador iniciou: "+acao.titulo+
      ". Modo: "+(policy.decisao === "SEM_PARADA" ? "SEM_PARADA" : "COM_PARADA"),
    usuario_id:auth.usuario_id||"",
    perfil:auth.perfil||ROLE.OPERADOR
  });

  return {
    started:true,
    already_started:false,
    acao_id:acao.id,
    execucao_id:ex.id,
    status:ST.EM_EXECUCAO,
    execucao:strip_(ex),
    checklist:checklist,
    modo_parada_manutencao:policy.modo_configurado,
    decisao_parada_manutencao:policy.decisao,
    modo_execucao_manutencao:policy.decisao === "SEM_PARADA" ? "SEM_PARADA" : "COM_PARADA",
    parada_operacional:operationalStop,
    parada_manutencao:null
  };
}

function operadorEstadoAcao118_(p){
  req_(p,["acao_id"]);
  var auth = requireOperadorAuth1081_(p.__auth || {}, "operador.estado_acao");
  var acao = find_("os_acoes","id",p.acao_id);
  if(!acao) err_("ACTION_NOT_FOUND","Ação não encontrada.",404);

  var ex = latestExecucaoAcao1081_(acao.id);
  if(ex) requireExecucaoDoOperador1081_(ex, auth);

  var started = !!ex && upper_(ex.status) !== ST.FINALIZADA && upper_(acao.status) === ST.EM_EXECUCAO;
  var operationalStop = paradaAtivaPorAtivo114_(acao.ativo_id);

  return {
    ok:true,
    started:started,
    acao_id:acao.id,
    status:acao.status,
    execucao_id:ex ? ex.id : "",
    execucao:ex ? strip_(ex) : null,
    checklist:ex ? checklistExecucaoResumo118_(ex.id) : null,
    modo_execucao_manutencao:ex ? upper_(ex.modo_execucao_manutencao || "") : "",
    parada_operacional:operationalStop ? paradaSerializada114_(operationalStop) : null,
    // Mantido no contrato somente por compatibilidade. Novas execuções usam
    // exclusivamente parada_operacional/paradas_equipamento.
    parada_manutencao:null,
    server_time:now_()
  };
}

function keepZero_(v){
  return (v === undefined || v === null) ? "" : v;
}

function criarChecklistExec_(acao, ex){
  var plano = acao.plano_id ? find_("planos_manutencao","id",acao.plano_id) : null;
  if(!plano) err_("PLAN_NOT_FOUND","Ação sem plano técnico vinculado.",404);
  if(!isPlanoOperacional_(plano)) err_("PLANO_NAO_VALIDADO","Plano/checklist ainda não validado pela gestão.",400);

  var itens = rows_("plano_itens").filter(function(i){
    return String(i.plano_id) === String(acao.plano_id) && upper_(i.status || ST.ATIVO) === ST.ATIVO;
  }).sort(function(a,b){ return num_(a.ordem,0)-num_(b.ordem,0); });

  if(!itens.length) err_("CHECKLIST_MODELO_VAZIO","Plano validado não possui itens de checklist.",400);

  var existentes = rows_("checklist_execucao").filter(function(item){
    return String(item.execucao_id) === String(ex.id);
  });
  var porPlanoItem = {};
  existentes.forEach(function(item){ porPlanoItem[String(item.plano_item_id)] = item; });

  var ativoChecklist = find_("ativos","id",acao.ativo_id);
  var novos = [];

  itens.forEach(function(i){
    if(porPlanoItem[String(i.id)]) return;
    novos.push(fit_("checklist_execucao", {
      id:uuid_("CHK"),
      execucao_id:ex.id,
      acao_id:acao.id,
      plano_item_id:i.id,
      ordem:i.ordem,
      titulo:i.titulo,
      instrucao:i.instrucao,
      tipo_resposta:normalizaTipoChecklist_(i.tipo_resposta),
      obrigatorio:i.obrigatorio,
      resposta:"",
      observacao:"",
      evidencia_obrigatoria:i.evidencia_obrigatoria,
      status:ST.PENDENTE,
      responsavel_id:ex.operador_id,
      data_hora:"",
      criado_em:now_(),
      atualizado_em:now_(),
      parametro_nome:i.parametro_nome || "",
      valor_esperado:i.valor_esperado || "",
      opcoes_json:i.opcoes_json || "",
      limite_min:(typeof itemEhHorimetro116_ === "function" && itemEhHorimetro116_(i))
        ? Math.max(num_(i.limite_min,0), num_(ativoChecklist && ativoChecklist.horimetro_atual,0))
        : keepZero_(i.limite_min),
      limite_max:keepZero_(i.limite_max),
      unidade:i.unidade || "",
      valor_numero:"",
      conforme:"",
      bloqueia_finalizacao:bool_(i.bloqueia_finalizacao) ? "SIM" : "NAO",
      validacao_msg:"",
      evidencias_count:0,
      categoria:i.categoria || "",
      evidencia_min_fotos:typeof evidenciaMinFotos116_ === "function"
        ? evidenciaMinFotos116_(i)
        : (bool_(i.evidencia_obrigatoria) ? 1 : 0)
    }));
  });

  var inseridos = appendRowsFast118_("checklist_execucao", novos);
  return checklistExecucaoResumo118_(ex.id, existentes.concat(inseridos));
}

function operadorSalvarChecklistItem_(p){
  var auth = requireOperadorAuth1081_(p.__auth || {}, "operador.salvar_checklist_item");
  req_(p,["checklist_execucao_id"]);
  var item = find_("checklist_execucao","id",p.checklist_execucao_id);
  if(!item) err_("CHECKLIST_NOT_FOUND","Item de checklist não encontrado.",404);
  var acao = find_("os_acoes","id",item.acao_id);
  if(!acao) err_("ACTION_NOT_FOUND","Ação vinculada ao checklist não encontrada.",404);
  if([ST.PENDENTE,ST.EM_EXECUCAO].indexOf(upper_(acao.status)) < 0) err_("ACTION_INVALID_STATUS","Checklist não editável. Status da ação: "+acao.status,400);
  var exItem = item.execucao_id ? find_("execucoes","id",item.execucao_id) : latestExecucaoAcao1081_(acao.id);
  requireExecucaoDoOperador1081_(exItem, auth);

  var val = validarRespostaChecklistItem_(item, p);

  patchRowFast118_("checklist_execucao", item, {
    resposta:val.resposta,
    observacao:clean_(p.observacao),
    status:ST.RESPONDIDO,
    responsavel_id:auth.usuario_id,
    data_hora:now_(),
    atualizado_em:now_(),
    valor_numero:val.valor_numero,
    conforme:val.conforme,
    validacao_msg:val.validacao_msg
  });

  return {saved:true, checklist_execucao_id:item.id, tipo_resposta:upper_(item.tipo_resposta), conforme:val.conforme, validacao_msg:val.validacao_msg};
}

var FINAL_OUTCOME_MARKER_120_ = "[RESULTADO_OPERACIONAL:";

function normalizaResultadoOperacional120_(value, legacyResult){
  var normalized = upper_(clean_(value)).replace(/[^A-Z0-9_]/g, "");
  var allowed = [
    "CONFORME",
    "DIFERENCAS_JUSTIFICADAS",
    "PARCIAL",
    "NAO_EXECUTADO",
    "OUTRO"
  ];
  if(allowed.indexOf(normalized) >= 0) return normalized;
  return upper_(legacyResult) === "OK" ? "CONFORME" : "";
}

function resultadoOperacionalDaObservacao120_(observacao){
  var match = clean_(observacao).match(/\[RESULTADO_OPERACIONAL:([A-Z0-9_]+)\]/);
  return match ? normalizaResultadoOperacional120_(match[1], "") : "";
}

function observacaoComResultadoOperacional120_(outcome, observacao){
  var cleaned = clean_(observacao)
    .replace(/\[RESULTADO_OPERACIONAL:[A-Z0-9_]+\]\s*/g, "")
    .trim();
  return FINAL_OUTCOME_MARKER_120_ + outcome + "]" + (cleaned ? " " + cleaned : "");
}

function observacaoFinalInformada120_(observacao){
  var text = clean_(observacao);
  var marker = "Observação final:";
  var start = text.indexOf(marker);
  if(start < 0) return "";
  var value = text.substring(start + marker.length);
  var next = value.indexOf("Justificativas do checklist:");
  if(next >= 0) value = value.substring(0, next);
  return clean_(value).replace(/[.\s]+$/, "");
}

function itemExigeJustificativa120_(item){
  var resposta = upper_(clean_(item && item.resposta)).replace(/[^A-Z0-9]/g, "");
  return resposta === "NOK" ||
    resposta === "NA" ||
    resposta === "NAOAPLICAVEL" ||
    upper_(item && item.conforme) === "NAO";
}

function validarFinalizacaoOperacional120_(execId, outcome, observacao){
  var normalized = normalizaResultadoOperacional120_(outcome, "");
  if(!normalized){
    err_("RESULTADO_OPERACIONAL_INVALIDO", "Informe um resultado operacional válido.", 400);
  }

  if(typeof CMMS1083_validateChecklistExecution_ !== "function"){
    err_(
      "FINALIZATION_VALIDATOR_UNAVAILABLE",
      "Validador operacional de checklist indisponível.",
      500
    );
  }

  var validation = CMMS1083_validateChecklistExecution_(execId);
  var items = rows_("checklist_execucao").filter(function(item){
    return String(item.execucao_id) === String(execId);
  });

  var unjustified = items.filter(function(item){
    return itemExigeJustificativa120_(item) && clean_(item.observacao).length < 5;
  });
  if(unjustified.length){
    err_(
      "JUSTIFICATIVA_CHECKLIST_OBRIGATORIA",
      "Itens não conformes, NOK ou N/A exigem justificativa técnica: " +
        unjustified.map(function(item){ return item.titulo; }).join("; "),
      400
    );
  }

  var pending = validation.pendentes || [];
  var evidencePending = validation.evidencias_pendentes || [];
  var blockers = validation.bloqueios || [];

  if(normalized === "CONFORME"){
    if(pending.length || evidencePending.length || blockers.length){
      err_(
        "RESULTADO_CONFORME_INCOMPATIVEL",
        "Resultado conforme exige checklist completo, evidências atendidas e ausência de bloqueio técnico. " +
          CMMS1083_buildChecklistBlockMessage_(validation),
        400
      );
    }
  }

  if(normalized === "DIFERENCAS_JUSTIFICADAS"){
    if(pending.length || evidencePending.length){
      err_(
        "DIFERENCAS_COM_PENDENCIAS",
        "Diferenças justificadas exigem todos os itens obrigatórios e evidências obrigatórias concluídos. " +
          CMMS1083_buildChecklistBlockMessage_(validation),
        400
      );
    }
  }

  if(["PARCIAL", "NAO_EXECUTADO", "OUTRO"].indexOf(normalized) >= 0){
    if(observacaoFinalInformada120_(observacao).length < 5){
      err_(
        "OBSERVACAO_FINAL_OBRIGATORIA",
        "O resultado informado exige observação final com pelo menos 5 caracteres.",
        400
      );
    }
  }

  return {
    ok:true,
    resultado_operacional:normalized,
    pendentes:pending,
    evidencias_pendentes:evidencePending,
    bloqueios:blockers,
    justificativas_validas:true
  };
}

function operadorFinalizarAcao_(p){
  req_(p,["acao_id","resultado"]);
  var auth = requireOperadorAuth1081_(p.__auth || {}, "operador.finalizar_acao");
  var acao = find_("os_acoes","id",p.acao_id);
  if(!acao) err_("ACTION_NOT_FOUND","Ação não encontrada.",404);

  var execs = rows_("execucoes")
    .filter(function(e){ return String(e.acao_id)===String(acao.id); })
    .sort(sortByDateDesc_("criado_em"));
  if(!execs.length) err_("EXECUTION_NOT_FOUND","Execução não encontrada.",404);

  var ex = execs[0];
  requireExecucaoDoOperador1081_(ex, auth);

  if(
    upper_(ex.status) === ST.FINALIZADA &&
    [ST.AGUARDANDO_VALIDACAO,ST.BLOQUEADA,ST.CONCLUIDA].indexOf(
      upper_(acao.status)
    ) >= 0
  ){
    finalizarCondicaoManutencao115_(acao, ex, auth);
    var existingOperationalStop = paradaAtivaPorAtivo114_(acao.ativo_id);
    return {
      finalized:true,
      already_finalized:true,
      acao_id:acao.id,
      execucao_id:ex.id,
      status_acao:acao.status,
      resultado:upper_(ex.resultado),
      resultado_operacional:resultadoOperacionalDaObservacao120_(ex.observacao),
      requires_manager_validation:upper_(acao.status) === ST.AGUARDANDO_VALIDACAO,
      parada_operacional:existingOperationalStop
        ? paradaSerializada114_(existingOperationalStop)
        : null,
      parada_manutencao:null
    };
  }

  if([ST.PENDENTE,ST.EM_EXECUCAO].indexOf(upper_(acao.status)) < 0){
    err_("ACTION_INVALID_STATUS","Ação não pode finalizar. Status atual: "+acao.status,400);
  }

  var explicitOutcome = clean_(p.resultado_operacional) !== "";
  var resultadoOperacional = normalizaResultadoOperacional120_(
    p.resultado_operacional,
    p.resultado
  );
  var validation;

  if(explicitOutcome){
    if(!resultadoOperacional){
      err_("RESULTADO_OPERACIONAL_INVALIDO", "Resultado operacional não reconhecido.", 400);
    }
    validation = validarFinalizacaoOperacional120_(
      ex.id,
      resultadoOperacional,
      p.observacao
    );
  } else {
    validation = validateChecklist_(ex.id);
    resultadoOperacional = upper_(p.resultado) === "OK"
      ? "CONFORME"
      : "DIFERENCAS_JUSTIFICADAS";
  }

  if(resultadoOperacional === "CONFORME" && upper_(p.resultado) !== "OK"){
    err_("RESULTADO_INCOMPATIVEL", "Resultado conforme deve ser enviado como OK.", 400);
  }
  if(resultadoOperacional !== "CONFORME" && upper_(p.resultado) !== "NOK"){
    err_(
      "RESULTADO_INCOMPATIVEL",
      "Resultados com diferença, parcial ou impedimento devem ser enviados como NOK.",
      400
    );
  }

  if(respostaCritica_(p.resultado) && clean_(p.observacao).length < 5){
    err_("OBS_REQUIRED","Resultado crítico exige observação.",400);
  }

  var horimetroFinal = typeof sincronizarHorimetroChecklist116_ === "function"
    ? sincronizarHorimetroChecklist116_(ex, auth)
    : null;

  var novo = explicitOutcome
    ? ST.AGUARDANDO_VALIDACAO
    : (upper_(p.resultado) === "OK" ? ST.AGUARDANDO_VALIDACAO : ST.BLOQUEADA);
  var observacaoFinal = explicitOutcome
    ? observacaoComResultadoOperacional120_(resultadoOperacional, p.observacao)
    : clean_(p.observacao);
  var finalizedAt = now_();

  patchRowFast118_("execucoes", ex, {
    resultado:upper_(p.resultado),
    observacao:observacaoFinal,
    duracao_segundos:num_(p.duracao_segundos,0),
    finalizou_em:finalizedAt,
    status:ST.FINALIZADA,
    atualizado_em:finalizedAt
  });
  patchRowFast118_("os_acoes", acao, {
    status:novo,
    finalizado_em:finalizedAt,
    atualizado_em:finalizedAt
  });
  releaseLocksForAction_(acao.id, "ACAO_FINALIZADA");

  finalizarCondicaoManutencao115_(acao, ex, auth);
  var operationalStop = paradaAtivaPorAtivo114_(acao.ativo_id);

  (typeof histFast119_ === "function" ? histFast119_ : hist_)({
    ativo_id:acao.ativo_id,
    componente_id:acao.componente_id,
    os_id:acao.os_id,
    acao_id:acao.id,
    execucao_id:ex.id,
    evento:"ACAO_FINALIZADA_OPERADOR",
    descricao:
      "Resultado operacional: "+resultadoOperacional+
      ". Resultado técnico: "+upper_(p.resultado)+
      ". "+clean_(p.observacao),
    usuario_id:auth.usuario_id||"",
    perfil:auth.perfil||ROLE.OPERADOR
  });

  return {
    finalized:true,
    already_finalized:false,
    acao_id:acao.id,
    execucao_id:ex.id,
    status_acao:novo,
    resultado:upper_(p.resultado),
    resultado_operacional:resultadoOperacional,
    requires_manager_validation:novo === ST.AGUARDANDO_VALIDACAO,
    pendencias_registradas:{
      obrigatorias:(validation.pendentes || []).length,
      evidencias:(validation.evidencias_pendentes || []).length,
      bloqueios:(validation.bloqueios || []).length
    },
    parada_operacional:operationalStop
      ? paradaSerializada114_(operationalStop)
      : null,
    parada_manutencao:null,
    horimetro:horimetroFinal
  };
}

function validateChecklist_(execId){
  if(typeof CMMS1083_validateChecklistExecution_ === "function"){
    var v1083 = CMMS1083_validateChecklistExecution_(execId);
    if(!v1083.can_finalize){
      err_("CHECKLIST_INCOMPLETO", CMMS1083_buildChecklistBlockMessage_(v1083), 400);
    }
    return v1083;
  }

  if(typeof CMMS108_validateChecklistExecution_ === "function"){
    var v108 = CMMS108_validateChecklistExecution_(execId);
    if(!v108.can_finalize){
      if(v108.pendentes.length) err_("CHECKLIST_INCOMPLETO","Existem itens obrigatórios pendentes: "+v108.pendentes.map(function(i){return i.titulo;}).join("; "),400);
      if(v108.evidencias_pendentes.length) err_("EVIDENCIA_OBRIGATORIA","Item obrigatório exige evidência antes da finalização: "+v108.evidencias_pendentes.map(function(i){return i.titulo;}).join("; "),400);
      if(v108.bloqueios.length) err_("CHECKLIST_BLOQUEANTE","Existem itens bloqueantes não conformes: "+v108.bloqueios.map(function(i){return i.titulo;}).join("; "),400);
      err_("CHECKLIST_INVALIDO","Checklist não liberado para finalização.",400);
    }
    return v108;
  }

  var itens = rows_("checklist_execucao").filter(function(c){ return String(c.execucao_id) === String(execId); });
  if(!itens.length) err_("CHECKLIST_VAZIO","Execução não possui checklist gerado.",400);

  var pend = itens.filter(function(i){
    if(upper_(i.tipo_resposta) === "INSTRUCAO") return false;
    return bool_(i.obrigatorio) && !clean_(i.resposta);
  });
  if(pend.length) err_("CHECKLIST_INCOMPLETO","Existem itens obrigatórios pendentes: "+pend.map(function(i){return i.titulo;}).join("; "),400);

  var evs = rows_("evidencias");
  var evPend = itens.filter(function(i){
    var minimo = typeof evidenciaMinFotos116_ === "function" ? evidenciaMinFotos116_(i) : (bool_(i.evidencia_obrigatoria) ? 1 : 0);
    if(minimo <= 0) return false;
    var count = evs.filter(function(e){ return String(e.checklist_execucao_id) === String(i.id); }).length;
    return count < minimo;
  });
  if(evPend.length) err_("EVIDENCIA_OBRIGATORIA","Item obrigatório exige evidência antes da finalização: "+evPend.map(function(i){return i.titulo;}).join("; "),400);

  var bloqueios = itens.filter(function(i){
    return bool_(i.bloqueia_finalizacao) && clean_(i.conforme) === "NAO";
  });
  if(bloqueios.length) err_("CHECKLIST_BLOQUEANTE","Existem itens fora do limite configurado: "+bloqueios.map(function(i){return i.titulo;}).join("; "),400);

  return {ok:true, total:itens.length, pendentes:0, evidencias_pendentes:0, bloqueios:0};
}

function operadorRegistrarEvidencia_(p){
  req_(p,["acao_id","nome_arquivo","url"]);
  var auth = requireOperadorAuth1081_(p.__auth || {}, "operador.registrar_evidencia");
  var acao = find_("os_acoes","id",p.acao_id);
  if(!acao) err_("ACTION_NOT_FOUND","Ação não encontrada.",404);
  if([ST.PENDENTE, ST.EM_EXECUCAO].indexOf(upper_(acao.status)) < 0){
    err_("ACTION_INVALID_STATUS","Evidência não editável. Status da ação: "+acao.status,400);
  }

  var checklistId = clean_(p.checklist_execucao_id);
  var item = checklistId ? find_("checklist_execucao","id",checklistId) : null;
  if(checklistId && !item) err_("CHECKLIST_NOT_FOUND","Item de checklist não encontrado para evidência.",404);
  if(item && String(item.acao_id) !== String(acao.id)) err_("CHECKLIST_ACTION_MISMATCH","Item de checklist não pertence à ação informada.",400);

  var execId = clean_(p.execucao_id);
  var exEv = null;
  if(execId){
    exEv = find_("execucoes","id",execId);
  } else {
    exEv = latestExecucaoAcao1081_(acao.id);
    execId = exEv ? exEv.id : "";
  }
  requireExecucaoDoOperador1081_(exEv, auth);

  var row = fit_("evidencias", {
    id:uuid_("EVD"),
    execucao_id:execId,
    acao_id:acao.id,
    checklist_execucao_id:checklistId,
    ativo_id:acao.ativo_id,
    componente_id:acao.componente_id,
    tipo:upper_(p.tipo||"FOTO"),
    nome_arquivo:clean_(p.nome_arquivo),
    url:clean_(p.url),
    observacao:clean_(p.observacao),
    usuario_id:auth.usuario_id||"",
    criado_em:now_(),
    arquivo_id:clean_(p.arquivo_id),
    mime_type:clean_(p.mime_type),
    tamanho_bytes:num_(p.tamanho_bytes,0),
    thumbnail_url:clean_(p.thumbnail_url)
  });
  row = appendRowsFast118_("evidencias", [row])[0];

  if(item){
    var previousCount = p.__quantidade_anterior;
    var totalEvs = previousCount !== undefined && previousCount !== null && previousCount !== ""
      ? Math.max(0, num_(previousCount, 0)) + 1
      : rows_("evidencias").filter(function(e){ return String(e.checklist_execucao_id) === String(item.id); }).length;
    var minimoEvs = typeof evidenciaMinFotos116_ === "function" ? evidenciaMinFotos116_(item) : 1;
    var completoEvs = totalEvs >= minimoEvs;
    var patch = {
      evidencias_count:totalEvs,
      atualizado_em:now_(),
      validacao_msg:completoEvs ? "Quantidade mínima de evidências atendida." : "Evidências: "+totalEvs+" de "+minimoEvs+"."
    };
    if(upper_(item.tipo_resposta) === "EVIDENCIA"){
      patch.resposta = completoEvs ? "EVIDENCIA_ANEXADA" : "";
      patch.status = completoEvs ? ST.RESPONDIDO : ST.PENDENTE;
      patch.conforme = completoEvs ? "SIM" : "";
      patch.responsavel_id = auth.usuario_id || item.responsavel_id || "";
      patch.data_hora = completoEvs ? now_() : "";
    }
    patchRowFast118_("checklist_execucao", item, patch);
  }

  return {saved:true, evidencia:strip_(row), checklist_execucao_id:checklistId, evidencias_count:item ? totalEvs : "", minimo_fotos:item && typeof evidenciaMinFotos116_ === "function" ? evidenciaMinFotos116_(item) : 0};
}

function operadorRegistrarMaterial_(p){
  var auth = requireOperadorAuth1081_(p.__auth || {}, "operador.registrar_material");
  req_(p,["acao_id","material_id","quantidade"]);
  var acao = find_("os_acoes","id",p.acao_id);
  if(!acao) err_("ACTION_NOT_FOUND","Ação não encontrada.",404);
  var exMat = clean_(p.execucao_id) ? find_("execucoes","id",p.execucao_id) : latestExecucaoAcao1081_(acao.id);
  requireExecucaoDoOperador1081_(exMat, auth);
  var mat = find_("materiais","id",p.material_id);
  if(!mat) err_("MATERIAL_NOT_FOUND","Material não encontrado.",404);
  var row = fit_("materiais_uso", {id:uuid_("MATU"), execucao_id:exMat.id, acao_id:p.acao_id, material_id:p.material_id, quantidade:num_(p.quantidade,0), unidade:p.unidade||mat.unidade||"", observacao:clean_(p.observacao), usuario_id:auth.usuario_id||"", criado_em:now_()});
  append_("materiais_uso", row);
  return {saved:true, material_uso:row};
}

function operadorRegistrarParametro_(p){
  var auth = requireOperadorAuth1081_(p.__auth || {}, "operador.registrar_parametro");
  req_(p,["ativo_id","parametro","valor"]);
  var ativoParametro = find_("ativos","id",p.ativo_id);
  if(!ativoParametro) err_("ASSET_NOT_FOUND","Equipamento não encontrado para registrar parâmetro.",404);

  var componenteParametro = null;
  if(clean_(p.componente_id)){
    componenteParametro = find_("componentes","id",p.componente_id);
    if(!componenteParametro || String(componenteParametro.ativo_id) !== String(ativoParametro.id)){
      err_("COMPONENT_ASSET_MISMATCH","Componente não pertence ao equipamento informado.",400);
    }
  }

  var parametroNome = upper_(p.parametro);
  var valor = Number(String(p.valor).replace(",", "."));
  if(!isFinite(valor)) err_("PARAMETER_VALUE_INVALID", "Valor do parâmetro deve ser numérico.", 400);

  var row;
  var horimetro = null;
  if(parametroNome === "HORIMETRO" && typeof registrarParametroHorimetro116_ === "function"){
    var resultHorimetro = registrarParametroHorimetro116_(
      ativoParametro,
      valor,
      p.origem || "OPERADOR",
      auth,
      componenteParametro ? componenteParametro.id : ""
    );
    row = resultHorimetro.parametro;
    horimetro = resultHorimetro.horimetro;
  } else {
    row = fit_("parametros", {
      id:uuid_("PAR"),
      ativo_id:ativoParametro.id,
      componente_id:componenteParametro ? componenteParametro.id : "",
      parametro:parametroNome,
      valor:valor,
      unidade:clean_(p.unidade),
      origem:clean_(p.origem||"OPERADOR"),
      registrado_por:auth.usuario_id||"",
      registrado_em:now_(),
      criado_em:now_()
    });
    append_("parametros", row);
  }

  var recalc = cmmsMotorRecalcular_({ativo_id:row.ativo_id, __auth:auth});
  return {saved:true, parametro:row, horimetro:horimetro, recalculo:recalc};
}

function calcularSaudeAtivoCMMS_(ativoId){
  var acoes = rows_("os_acoes", true).filter(function(a){
    return String(a.ativo_id) === String(ativoId) && acaoAberta_(a);
  });

  var osAbertas = rows_("ordens_servico", true).filter(function(o){
    return String(o.ativo_id) === String(ativoId) && !terminal_(o.status);
  });

  var pct = 100;
  acoes.forEach(function(a){
    var p = upper_(a.prioridade);
    pct -= p === "CRITICA" ? 25 : p === "ALTA" ? 15 : p === "MEDIA" ? 8 : 4;
  });

  pct = Math.max(0, Math.min(100, pct));
  return {
    pct:pct,
    status:pct >= 90 ? "OK" : pct >= 70 ? "ATENCAO" : "CRITICO",
    acoes_abertas:acoes.length,
    os_abertas:osAbertas.length
  };
}

function saudeAtivo_(ativoId){
  return calcularSaudeAtivoCMMS_(ativoId);
}
