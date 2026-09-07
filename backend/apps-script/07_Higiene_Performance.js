function cmmsHigieneDiagnosticar_(p){
  var issues = [];

  rows_("ativos").forEach(function(a){
    if(!isValidAtivo_(a)) issues.push(issue_("ATIVO_INVALIDO","ativos",a.__rowIndex,a.id,"Ativo fora do padrão CMMS novo."));
  });

  rows_("componentes").forEach(function(c){
    if(!isValidComponent_(c)) issues.push(issue_("COMPONENTE_LEGADO_OU_DESLOCADO","componentes",c.__rowIndex,c.id,"Componente antigo/deslocado. Não será usado pelo contexto QR novo."));
  });

  rows_("planos_manutencao").forEach(function(pl){
    if(!isValidPlan_(pl)) issues.push(issue_("PLANO_LEGADO_OU_DESLOCADO","planos_manutencao",pl.__rowIndex,pl.id,"Plano antigo/deslocado."));
    var itens = rows_("plano_itens").filter(function(i){ return String(i.plano_id) === String(pl.id); });
    if(isValidPlan_(pl) && !itens.length) issues.push(issue_("PLANO_SEM_ITENS","planos_manutencao",pl.__rowIndex,pl.id,"Plano válido sem itens técnicos de checklist."));
  });

  var byPlan = {};
  rows_("os_acoes").forEach(function(a){
    if(!a.plano_id) return;
    byPlan[a.plano_id] = byPlan[a.plano_id] || [];
    byPlan[a.plano_id].push(a);
  });

  Object.keys(byPlan).forEach(function(pid){
    var group = byPlan[pid];
    var abertas = group.filter(acaoAberta_);
    var concluidas = group.filter(function(a){ return upper_(a.status) === ST.CONCLUIDA; });
    if(abertas.length && concluidas.length){
      abertas.forEach(function(a){ issues.push(issue_("ACAO_DUPLICADA_CICLO","os_acoes",a.__rowIndex,a.id,"Ação aberta duplicada para plano que já possui ação concluída no ciclo.")); });
    }
    if(abertas.length > 1){
      abertas.slice(1).forEach(function(a){ issues.push(issue_("ACOES_ABERTAS_DUPLICADAS","os_acoes",a.__rowIndex,a.id,"Mais de uma ação aberta para o mesmo plano.")); });
    }
  });

  rows_("ordens_servico").forEach(function(os){
    var acoes = rows_("os_acoes").filter(function(a){ return String(a.os_id) === String(os.id); });
    if(acoes.length && acoes.every(function(a){ return terminal_(a.status); }) && !terminal_(os.status)){
      issues.push(issue_("OS_STATUS_INCOERENTE","ordens_servico",os.__rowIndex,os.id,"OS aberta com todas as ações terminais."));
    }
  });

  var oldSheets = ["acoes_pendentes","tokens_sessao","sessoes_operador","parametros_leitura","cache_contexto_ativo","sessoes_ciclos","sessoes_eventos","acao_config","acao_colaboradores"];
  oldSheets.forEach(function(s){
    if(sheetExists_(s)) issues.push(issue_("ABA_LEGADA_PRESENTE",s,0,s,"Aba legada detectada. Não é fonte operacional da API CMMS nova."));
  });

  return {
    dry_run:true,
    total_issues:issues.length,
    by_code:countBy_(issues,"code"),
    issues:issues.slice(0,300)
  };
}

function cmmsHigienizarStatus_(p){
  var dry = p.dry_run !== false;
  var ops = [];

  rows_("ordens_servico").forEach(function(os){
    var acoes = rows_("os_acoes").filter(function(a){ return String(a.os_id) === String(os.id); });
    if(!acoes.length) return;
    if(acoes.every(function(a){ return terminal_(a.status); }) && !terminal_(os.status)){
      var anyDone = acoes.some(function(a){ return upper_(a.status) === ST.CONCLUIDA; });
      var novo = anyDone ? ST.CONCLUIDA : ST.CANCELADA;
      ops.push({tipo:"SYNC_OS_STATUS", os_id:os.id, de:os.status, para:novo});
      if(!dry){
        update_("ordens_servico", os.__rowIndex, {status:novo, finalizada_em:now_(), atualizado_em:now_()});
        hist_({ativo_id:os.ativo_id, componente_id:os.componente_id, os_id:os.id, evento:"HIGIENE_STATUS_OS", descricao:"Status corrigido de "+os.status+" para "+novo, usuario_id:p.__auth.usuario_id, perfil:p.__auth.perfil});
      }
    }
  });

  return {dry_run:dry, operations:ops.length, items:ops};
}

function cmmsHigienizarDuplicidades_(p){
  var dry = p.dry_run !== false;
  var ops = [];
  var groups = {};

  rows_("os_acoes").forEach(function(a){
    if(!a.plano_id) return;
    groups[a.plano_id] = groups[a.plano_id] || [];
    groups[a.plano_id].push(a);
  });

  Object.keys(groups).forEach(function(pid){
    var g = groups[pid].sort(sortByDateDesc_("gerado_em"));
    var concluded = g.filter(function(a){ return upper_(a.status) === ST.CONCLUIDA; }).sort(sortByDateDesc_("finalizado_em"))[0];
    var open = g.filter(acaoAberta_);

    // Regra: se já existe concluída para o ciclo, cancela abertas duplicadas do mesmo plano.
    if(concluded && open.length){
      open.forEach(function(a){
        ops.push({tipo:"CANCELAR_ACAO_DUPLICADA", acao_id:a.id, plano_id:pid, status_atual:a.status, manter:concluded.id});
        if(!dry){
          update_("os_acoes", a.__rowIndex, {status:ST.CANCELADA, atualizado_em:now_()});
          refreshPlanoControleStatus_(Object.assign({}, a, {status:ST.CANCELADA}));
          if(a.os_id){
            var os = find_("ordens_servico","id",a.os_id);
            if(os) update_("ordens_servico", os.__rowIndex, {status:ST.CANCELADA, finalizada_em:now_(), atualizado_em:now_()});
          }
          releaseLocksForAction_(a.id, "HIGIENE_DUPLICIDADE");
          hist_({ativo_id:a.ativo_id, componente_id:a.componente_id, os_id:a.os_id, acao_id:a.id, evento:"HIGIENE_DUPLICIDADE_CANCELADA", descricao:"Cancelada por duplicidade. Ação mantida: "+concluded.id, usuario_id:p.__auth.usuario_id, perfil:p.__auth.perfil});
        }
      });
    }

    // Se existem várias abertas sem concluída, mantém a mais antiga e cancela as demais.
    if(!concluded && open.length > 1){
      var keep = open.sort(function(a,b){ return String(a.gerado_em).localeCompare(String(b.gerado_em)); })[0];
      open.filter(function(a){ return a.id !== keep.id; }).forEach(function(a){
        ops.push({tipo:"CANCELAR_ACAO_ABERTA_DUPLICADA", acao_id:a.id, manter:keep.id, plano_id:pid});
        if(!dry){
          update_("os_acoes", a.__rowIndex, {status:ST.CANCELADA, atualizado_em:now_()});
          releaseLocksForAction_(a.id, "HIGIENE_DUPLICIDADE");
          syncOsStatus_(a.os_id);
        }
      });
    }
  });

  return {dry_run:dry, operations:ops.length, items:ops};
}

function cmmsHigienizarBase_(p){
  var dry = p.dry_run !== false;
  var ops = [];

  // 1. Cria item técnico padrão para plano válido sem itens.
  rows_("planos_manutencao").forEach(function(pl){
    if(isValidPlan_(pl)){
      var itens = rows_("plano_itens").filter(function(i){ return String(i.plano_id) === String(pl.id); });
      if(!itens.length){
        ops.push({tipo:"CRIAR_ITEM_PADRAO_PLANO", plano_id:pl.id});
        if(!dry) ensureDefaultPlanoItem_(pl);
      }

      // 2. Inicializa controle de ciclo com base em ações concluídas existentes.
      var ctl = getPlanoControle_(pl);
      var latestDone = rows_("os_acoes").filter(function(a){ return String(a.plano_id) === String(pl.id) && upper_(a.status) === ST.CONCLUIDA; }).sort(sortByDateDesc_("finalizado_em"))[0];
      if(latestDone && num_(ctl.ultimo_valor_processado,0) === 0){
        var current = currentValueForPlan_(pl);
        var gat = num_(pl.gatilho_valor,0);
        var next = upper_(pl.gatilho_tipo)==="HORAS" ? (Math.ceil(current / gat) * gat + gat) : gat;
        ops.push({tipo:"INICIALIZAR_PLANO_CONTROLE", plano_id:pl.id, ultima_acao_id:latestDone.id, ultimo_valor_processado:current, proximo_valor_gatilho:next});
        if(!dry){
          update_("plano_controle", ctl.__rowIndex, {ultimo_valor_processado:current, proximo_valor_gatilho:next, ultima_acao_id:latestDone.id, ultima_acao_status:latestDone.status, atualizado_em:now_()});
        }
      }
    }
  });

  var stOps = cmmsHigienizarStatus_(Object.assign({}, p, {dry_run:dry}));
  var dupOps = cmmsHigienizarDuplicidades_(Object.assign({}, p, {dry_run:dry}));

  return {
    dry_run:dry,
    base_operations:ops.length,
    status_operations:stOps.operations,
    duplicate_operations:dupOps.operations,
    items:ops.concat(stOps.items || []).concat(dupOps.items || [])
  };
}

function currentValueForPlan_(pl){
  if(upper_(pl.gatilho_tipo) === "HORAS"){
    var comp = pl.componente_id ? find_("componentes","id",pl.componente_id) : null;
    if(comp) return num_(comp.horas_acumuladas,0);
    var atv = find_("ativos","id",pl.ativo_id);
    return atv ? num_(atv.horimetro_atual,0) : 0;
  }
  return 0;
}

function isValidPlan_(pl){
  return String(pl.id||"").indexOf("PLN-ATV-") === 0 &&
    String(pl.ativo_id||"").indexOf("ATV-") === 0 &&
    clean_(pl.nome) &&
    clean_(pl.gatilho_tipo) &&
    num_(pl.gatilho_valor,0) > 0 &&
    ["ATIVO","INATIVO"].indexOf(upper_(pl.status)) >= 0;
}

function issue_(code,sheet,row,id,msg){
  return {code:code, sheet:sheet, row:row, id:id||"", message:msg};
}

function countBy_(arr,key){
  var out = {};
  arr.forEach(function(x){ out[x[key]] = (out[x[key]] || 0) + 1; });
  return out;
}
