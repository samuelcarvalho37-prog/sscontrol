function gestorListarAcoes_(p){
  var statuses = clean_(p.status || "PENDENTE,EM_EXECUCAO,AGUARDANDO_VALIDACAO,BLOQUEADA").split(",").map(upper_);
  var rows = rows_("os_acoes").filter(function(a){ return statuses.indexOf(upper_(a.status)) >= 0; })
    .sort(function(a,b){ return priorityScore_(b.prioridade)-priorityScore_(a.prioridade) || String(b.gerado_em).localeCompare(String(a.gerado_em)); })
    .slice(0, Math.min(num_(p.limite,100),300))
    .map(enrichGestorAction_);
  return {total:rows.length, status:statuses, acoes:rows};
}

function enrichGestorAction_(a){
  var atv = find_("ativos","id",a.ativo_id);
  var comp = a.componente_id ? find_("componentes","id",a.componente_id) : null;
  var responsibleId = clean_(a.responsavel_id || a.executor_id);
  var responsible = responsibleId ? find_("usuarios","id",responsibleId) : null;
  var line = atv && atv.linha_id ? find_("linhas","id",atv.linha_id) : null;
  var sector = line && line.setor_id ? find_("setores","id",line.setor_id) : null;
  var out = strip_(a);
  out.ativo_tag = atv ? atv.tag : "";
  out.ativo_nome = atv ? atv.nome : "";
  out.ativo_localizacao = atv ? clean_(atv.localizacao_tecnica) : "";
  out.linha_nome = line ? clean_(line.nome) : "";
  out.setor_nome = sector ? clean_(sector.nome) : "";
  out.componente_nome = comp ? comp.nome : "";
  out.responsavel_nome = responsible ? clean_(responsible.nome) : clean_(a.responsavel_nome);
  out.responsavel_perfil = responsible ? clean_(responsible.perfil) : clean_(a.responsavel_perfil);
  out.locks_ativos = activeLocks_(a.id).length;
  return out;
}

function gestorEvidencePublic_(evidence){
  var out = strip_(evidence);
  var fileId = clean_(out.arquivo_id);
  if(!out.url && fileId){
    out.url = "https://drive.google.com/file/d/"+encodeURIComponent(fileId)+"/view";
  }
  if(!out.thumbnail_url && fileId && String(out.mime_type || "").toLowerCase().indexOf("image/") === 0){
    out.thumbnail_url = "https://drive.google.com/thumbnail?id="+encodeURIComponent(fileId)+"&sz=w800";
  }
  return out;
}

function gestorDetalheAcao_(p){
  req_(p,["acao_id"]);
  var a = find_("os_acoes","id",p.acao_id);
  if(!a) err_("ACTION_NOT_FOUND","Ação não encontrada.",404);
  return {
    acao:strip_(a),
    os:a.os_id ? strip_(find_("ordens_servico","id",a.os_id)) : null,
    ativo:strip_(find_("ativos","id",a.ativo_id)),
    componente:a.componente_id ? strip_(find_("componentes","id",a.componente_id)) : null,
    execucoes:rows_("execucoes").filter(function(e){ return String(e.acao_id)===String(a.id); }).map(strip_),
    checklist:rows_("checklist_execucao").filter(function(c){ return String(c.acao_id)===String(a.id); }).map(strip_),
    evidencias:rows_("evidencias").filter(function(e){ return String(e.acao_id)===String(a.id); }).map(gestorEvidencePublic_),
    materiais:rows_("materiais_uso").filter(function(m){ return String(m.acao_id)===String(a.id); }).map(strip_),
    locks:activeLocks_(a.id).map(strip_),
    historico:rows_("historico").filter(function(h){ return String(h.acao_id)===String(a.id); }).sort(sortByDateDesc_("criado_em")).slice(0,30).map(strip_)
  };
}

function gestorValidarAcao_(p){
  req_(p,["acao_id","decisao"]);
  var auth = p.__auth || {};
  technicalAssertValidationIdentity_(auth);
  var acao = find_("os_acoes","id",p.acao_id);
  if(!acao) err_("ACTION_NOT_FOUND","Ação não encontrada.",404);

  var dec = upper_(p.decisao);
  if(["APROVAR","REPROVAR"].indexOf(dec) < 0) err_("INVALID_DECISION","Decisão deve ser APROVAR ou REPROVAR.",400);

  var st = upper_(acao.status);

  // Idempotência: aprovar ação já concluída não deve quebrar tela.
  if(dec === "APROVAR" && st === ST.CONCLUIDA){
    syncOsStatus_(acao.os_id);
    return {validated:true, already_validated:true, acao_id:acao.id, decisao:dec, status:ST.CONCLUIDA};
  }

  // Idempotência de reprovação.
  if(dec === "REPROVAR" && st === ST.PENDENTE){
    return {validated:true, already_validated:true, acao_id:acao.id, decisao:dec, status:ST.PENDENTE};
  }

  if(st !== ST.AGUARDANDO_VALIDACAO) err_("INVALID_STATUS","Ação não está aguardando validação. Status atual: "+acao.status,400);

  if(dec === "APROVAR") validateGestorAcaoBeforeApproval_(acao);

  var novo = dec === "APROVAR" ? ST.CONCLUIDA : ST.PENDENTE;
  update_("os_acoes", acao.__rowIndex, {status:novo, atualizado_em:now_()});
  acao.status = novo;
  if(dec === "APROVAR"){
    rows_("ocorrencias_operacionais", true).filter(function(occurrence){
      return String(occurrence.acao_id) === String(acao.id);
    }).forEach(function(occurrence){
      update_("ocorrencias_operacionais", occurrence.__rowIndex, {
        status:ST.FINALIZADA,
        tratamento_status:"FINALIZADA",
        atualizado_em:now_()
      });
    });
  }
  refreshPlanoControleStatus_(acao);
  syncOsStatus_(acao.os_id);
  releaseLocksForAction_(acao.id, "VALIDACAO_GESTOR");

  hist_({ativo_id:acao.ativo_id, componente_id:acao.componente_id, os_id:acao.os_id, acao_id:acao.id, evento:dec==="APROVAR"?"ACAO_APROVADA":"ACAO_REPROVADA", descricao:clean_(p.comentario), usuario_id:auth.usuario_id||"", perfil:auth.perfil||ROLE.GESTOR});
  return {validated:true, acao_id:acao.id, decisao:dec, status:novo};
}

function syncOsStatus_(osId){
  if(!osId) return {changed:false};
  var os = find_("ordens_servico","id",osId);
  if(!os) return {changed:false, reason:"os_not_found"};

  var acoes = rows_("os_acoes").filter(function(a){ return String(a.os_id) === String(osId); });
  if(!acoes.length) return {changed:false, reason:"no_actions"};

  var allTerminal = acoes.every(function(a){ return terminal_(a.status); });
  if(!allTerminal) return {changed:false, status:os.status};

  var anyDone = acoes.some(function(a){ return upper_(a.status) === ST.CONCLUIDA; });
  var novo = anyDone ? ST.CONCLUIDA : ST.CANCELADA;

  if(upper_(os.status) !== novo){
    update_("ordens_servico", os.__rowIndex, {status:novo, finalizada_em:now_(), atualizado_em:now_()});
    hist_({ativo_id:os.ativo_id, componente_id:os.componente_id, os_id:os.id, evento:"OS_STATUS_SINCRONIZADO", descricao:"OS alterada para "+novo, usuario_id:"SISTEMA", perfil:ROLE.SISTEMA});
    return {changed:true, status:novo};
  }
  return {changed:false, status:novo};
}

function gestorConfigurarSessoes_(p){
  req_(p,["acao_id","max_sessoes"]);
  var acao = find_("os_acoes","id",p.acao_id);
  if(!acao || !acao.plano_id) err_("PLAN_NOT_FOUND","Ação sem plano vinculado.",404);
  var plano = find_("planos_manutencao","id",acao.plano_id);
  if(!plano) err_("PLAN_NOT_FOUND","Plano não encontrado.",404);
  var max = Math.max(1,num_(p.max_sessoes,1));
  update_("planos_manutencao", plano.__rowIndex, {max_sessoes:max, atualizado_em:now_()});
  return {saved:true, plano_id:plano.id, max_sessoes:max};
}

function gestorAdicionarColaborador_(p){
  req_(p,["acao_id","usuario_id"]);
  var acao = find_("os_acoes","id",p.acao_id);
  if(!acao) err_("ACTION_NOT_FOUND","Ação não encontrada.",404);
  var plano = acao.plano_id ? find_("planos_manutencao","id",acao.plano_id) : null;
  if(plano) update_("planos_manutencao", plano.__rowIndex, {max_sessoes:Math.max(1,num_(plano.max_sessoes,1))+1, atualizado_em:now_()});
  hist_({ativo_id:acao.ativo_id, componente_id:acao.componente_id, os_id:acao.os_id, acao_id:acao.id, evento:"COLABORADOR_ADICIONADO", descricao:"Colaborador autorizado: "+p.usuario_id, usuario_id:p.__auth.usuario_id, perfil:p.__auth.perfil});
  return {saved:true, acao_id:acao.id, usuario_id:p.usuario_id};
}

function gestorLiberarLocks_(p){
  req_(p,["acao_id"]);
  return {released:releaseLocksForAction_(p.acao_id, clean_(p.motivo||"LIBERADO_GESTOR")), acao_id:p.acao_id};
}

function lockStatus_(p){ req_(p,["acao_id"]); expireLocks_(p.acao_id); var l=activeLocks_(p.acao_id); return {acao_id:p.acao_id, active_count:l.length, locks:l.map(strip_)}; }

function lockAdquirir_(p){
  req_(p,["acao_id"]);
  var auth = p.__auth || {};
  var acao = find_("os_acoes","id",p.acao_id);
  if(!acao) err_("ACTION_NOT_FOUND","Ação não encontrada.",404);
  if([ST.PENDENTE,ST.EM_EXECUCAO].indexOf(upper_(acao.status)) < 0) return {acquired:false, readonly:true, reason:"Ação não executável. Status atual: "+acao.status};

  expireLocks_(acao.id);
  var active = activeLocks_(acao.id);
  var sid = clean_(p.sessao_id || uuid_("CLI"));
  var own = active.find(function(l){ return String(l.usuario_id) === String(auth.usuario_id) || String(l.sessao_id) === String(sid); });
  if(own){
    update_("execucao_locks", own.__rowIndex, {ultimo_ping_em:now_(), expira_em:iso_(addSeconds_(new Date(),FAB.LOCK_TTL_SECONDS))});
    return {acquired:true, reused:true, lock_id:own.id, sessao_id:own.sessao_id};
  }

  var max = maxSessions_(acao);
  if(active.length >= max){
    return {acquired:false, blocked:true, reason:"Limite de operadores simultâneos atingido.", active_count:active.length, max_sessoes:max, operadores:active.map(function(l){ return {usuario_id:l.usuario_id, sessao_id:l.sessao_id, expira_em:l.expira_em}; })};
  }

  var row = fit_("execucao_locks", {id:uuid_("LCK"), ativo_id:acao.ativo_id, acao_id:acao.id, usuario_id:auth.usuario_id, sessao_id:sid, status:ST.ATIVO, adquirido_em:now_(), ultimo_ping_em:now_(), expira_em:iso_(addSeconds_(new Date(),FAB.LOCK_TTL_SECONDS)), liberado_em:"", motivo_liberacao:"", user_agent:clean_(p.user_agent)});
  append_("execucao_locks", row);
  return {acquired:true, lock_id:row.id, sessao_id:row.sessao_id, expira_em:row.expira_em};
}

function lockHeartbeat_(p){
  req_(p,["acao_id","sessao_id"]);
  var l = activeLocks_(p.acao_id).find(function(x){ return String(x.sessao_id) === String(p.sessao_id); });
  if(!l) err_("LOCK_NOT_FOUND","Lock não encontrado ou expirado.",404);
  var exp = iso_(addSeconds_(new Date(),FAB.LOCK_TTL_SECONDS));
  update_("execucao_locks", l.__rowIndex, {ultimo_ping_em:now_(), expira_em:exp});
  return {ok:true, lock_id:l.id, expira_em:exp};
}

function lockLiberar_(p){
  req_(p,["acao_id"]);
  var auth = p.__auth || {};
  var count = 0;
  activeLocks_(p.acao_id).forEach(function(l){
    if(!p.sessao_id || String(l.sessao_id) === String(p.sessao_id) || auth.perfil !== ROLE.OPERADOR){
      update_("execucao_locks", l.__rowIndex, {status:"LIBERADO", liberado_em:now_(), motivo_liberacao:clean_(p.motivo||"LIBERADO")});
      count++;
    }
  });
  return {released:count};
}

function activeLocks_(acaoId){
  expireLocks_(acaoId);
  return rows_("execucao_locks").filter(function(l){ return String(l.acao_id) === String(acaoId) && upper_(l.status) === ST.ATIVO; });
}

function expireLocks_(acaoId){
  rows_("execucao_locks").forEach(function(l){
    if(String(l.acao_id) === String(acaoId) && upper_(l.status) === ST.ATIVO && new Date(l.expira_em).getTime() < Date.now()){
      update_("execucao_locks", l.__rowIndex, {status:"EXPIRADO", liberado_em:now_(), motivo_liberacao:"TTL_EXPIRADO"});
    }
  });
}

function releaseLocksForAction_(acaoId, motivo){
  var count = 0;
  rows_("execucao_locks").forEach(function(l){
    if(String(l.acao_id) === String(acaoId) && upper_(l.status) === ST.ATIVO){
      update_("execucao_locks", l.__rowIndex, {status:"LIBERADO", liberado_em:now_(), motivo_liberacao:motivo||"LIBERADO"});
      count++;
    }
  });
  return count;
}

function maxSessions_(acao){
  var plano = acao.plano_id ? find_("planos_manutencao","id",acao.plano_id) : null;
  return plano ? Math.max(1,num_(plano.max_sessoes,1)) : 1;
}

function telemetriaIniciar_(p){ return telemetry_("INICIAR", p); }
function telemetriaEvento_(p){ return telemetry_(upper_(p.evento||"EVENTO"), p); }
function telemetriaFinalizar_(p){ return telemetry_("FINALIZAR", p); }

function telemetry_(evento,p){
  var auth = p.__auth || {};
  var sid = clean_(p.sessao_id || uuid_("TEL"));
  append_("telemetria_sessoes", fit_("telemetria_sessoes", {id:uuid_("TEL"), sessao_id:sid, usuario_id:auth.usuario_id||"", ativo_id:clean_(p.ativo_id), acao_id:clean_(p.acao_id), evento:evento, visibilidade:clean_(p.visibilidade), delta_segundos:num_(p.delta_segundos,0), tempo_total_segundos:num_(p.tempo_total_segundos,0), tempo_visivel_segundos:num_(p.tempo_visivel_segundos,0), tempo_oculto_segundos:num_(p.tempo_oculto_segundos,0), user_agent:clean_(p.user_agent), criado_em:now_()}));
  return {saved:true, sessao_id:sid, evento:evento};
}

function cmmsKpisBase_(p){
  var ativoId = clean_(p.ativo_id);
  var ex = rows_("execucoes").filter(function(e){ return !ativoId || String(e.ativo_id) === String(ativoId); });
  var fin = ex.filter(function(e){ return upper_(e.status) === ST.FINALIZADA; });
  var dur = fin.reduce(function(s,e){ return s + num_(e.duracao_segundos,0); },0);
  var falhas = fin.filter(function(e){ return respostaCritica_(e.resultado); });
  var abertas = rows_("os_acoes").filter(function(a){ return (!ativoId || String(a.ativo_id)===String(ativoId)) && acaoAberta_(a); });
  return {ativo_id:ativoId||"TODOS", total_execucoes:ex.length, execucoes_finalizadas:fin.length, falhas_registradas:falhas.length, acoes_abertas:abertas.length, mttr_segundos:fin.length?Math.round(dur/fin.length):0, disponibilidade_base_pct:Math.max(0, Math.min(100, 100 - abertas.length*3 - falhas.length*5)), observacao:"KPI base. Refinar com apontamento formal de paradas."};
}

function cmmsDiagnostico_(p){
  return {resumo:adminResumo_(), higiene:cmmsHigieneDiagnosticar_(Object.assign({}, p, {dry_run:true}))};
}
