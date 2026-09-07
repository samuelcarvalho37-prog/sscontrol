/**
 * FAB Control 10.3
 * Endpoints rápidos para operador, gestor e resumo.
 * A regra CMMS completa permanece nos endpoints da 10.1.
 */

function adminResumoCache_(p){
  var key = metaCacheKey_("admin_resumo");
  if(!bool_(p.no_cache)){
    var hit = safeCacheGetJson_(key);
    if(hit) {
      hit.cache = {hit:true, ttl_seconds:60};
      return hit;
    }
  }

  var data = adminResumo_();
  safeCachePutJson_(key, data, 60);
  data.cache = {hit:false, ttl_seconds:60};
  return data;
}

function operadorContextoQrFast_(p){
  req_(p,["qr_payload"]);

  var qr = clean_(p.qr_payload);
  var key = "FAB_QR_FAST_" + FAB.VERSION + "_" + sha256_(qr).slice(0,20);

  if(!bool_(p.no_cache)){
    var hit = safeCacheGetJson_(key);
    if(hit){
      hit.cache = {hit:true, layer:"script", ttl_seconds:FAB.QR_FAST_CACHE_SECONDS || 30};
      if(hit.proxima_acao && hit.proxima_acao.id){
        hit.proxima_acao.locks_ativos = activeLocks_(hit.proxima_acao.id).length;
      }
      return hit;
    }
  }

  var ctx = resolveQrFast_(qr);
  if(!ctx.found){
    var nf = {
      found:false,
      tipo_contexto:"NAO_ENCONTRADO",
      ativo:null,
      componente:null,
      saude:null,
      proxima_acao:null,
      acoes_count:0,
      mensagem_operador:"QR/TAG não encontrado.",
      cache:{hit:false, layer:"fresh", ttl_seconds:FAB.QR_FAST_CACHE_SECONDS || 30}
    };
    safeCachePutJson_(key, nf, FAB.QR_FAST_CACHE_SECONDS || 30);
    return nf;
  }

  var abertasAntes = openActionsForContextFast_(ctx);

  // Na 10.2 o motor rodava em toda consulta sem ação aberta.
  // Na 10.3 ele só roda quando o plano_controle indica ciclo realmente próximo/vencido.
  if(!abertasAntes.length && p.motor !== false && fastNeedsMotorForContext_(ctx)){
    cmmsMotorRecalcular_({ativo_id:ctx.ativo.id, __auth:p.__auth});
    DB_CACHE["os_acoes"] = null;
    safeCacheRemove_(tableCacheKey_("os_acoes"));
    safeCacheRemove_(key);
  }

  var abertas = openActionsForContextFast_(ctx);
  var proxima = abertas.length ? actionLean_(abertas[0]) : null;

  var out = {
    found:true,
    tipo_contexto:ctx.tipo,
    ativo:assetLean_(ctx.ativo),
    horimetro:typeof horimetroResumo116_ === "function" ? horimetroResumo116_(ctx.ativo) : null,
    componente:ctx.componente ? componentLean_(ctx.componente) : null,
    componentes_count:componentesCountByAtivo_(ctx.ativo.id),
    saude:saudeAtivoFast_(ctx.ativo.id),
    proxima_acao:proxima,
    acoes_count:abertas.length,
    mensagem_operador:abertas.length ? "Existem ações pendentes para este equipamento." : "Equipamento sem ações pendentes.",
    cache:{hit:false, layer:"fresh", ttl_seconds:FAB.QR_FAST_CACHE_SECONDS || 30}
  };

  safeCachePutJson_(key, out, FAB.QR_FAST_CACHE_SECONDS || 30);
  return out;
}

function resolveQrFast_(qr){
  var idx = getQrIndex_();
  var item = idx.map[qr];
  if(!item) item = idx.map[upper_(qr)];

  if(item){
    if(item.tipo === "ATIVO"){
      var atv = find_("ativos","id",item.ativo_id);
      return {found:!!atv, tipo:"ATIVO", ativo:atv, componente:null};
    }
    if(item.tipo === "COMPONENTE"){
      var comp = find_("componentes","id",item.componente_id);
      var atvC = comp ? find_("ativos","id",comp.ativo_id) : null;
      return {found:!!atvC, tipo:"COMPONENTE", ativo:atvC, componente:comp};
    }
  }

  // Fallback para OS/código ou QR fora do índice.
  return resolveQr_(qr);
}

function getQrIndex_(){
  var key = metaCacheKey_("qr_index_v3");
  var hit = safeCacheGetJson_(key);
  if(hit && hit.map) return hit;

  var map = {};
  rows_("ativos").forEach(function(a){
    if(!isValidAtivo_(a)) return;
    ["qr_payload","tag","id"].forEach(function(k){
      var v = clean_(a[k]);
      if(v){
        map[v] = {tipo:"ATIVO", ativo_id:a.id};
        map[upper_(v)] = {tipo:"ATIVO", ativo_id:a.id};
      }
    });
  });

  rows_("componentes").forEach(function(c){
    if(!isValidComponent_(c)) return;
    ["qr_payload","tag","id"].forEach(function(k){
      var v = clean_(c[k]);
      if(v){
        map[v] = {tipo:"COMPONENTE", ativo_id:c.ativo_id, componente_id:c.id};
        map[upper_(v)] = {tipo:"COMPONENTE", ativo_id:c.ativo_id, componente_id:c.id};
      }
    });
  });

  var out = {generated_em:now_(), keys:Object.keys(map).length, map:map};
  safeCachePutJson_(key, out, FAB.WARMUP_CACHE_SECONDS || 300);
  return out;
}

function componentesCountByAtivo_(ativoId){
  return rows_("componentes").filter(function(c){
    return String(c.ativo_id) === String(ativoId) && isValidComponent_(c);
  }).length;
}

function openActionsForContextFast_(ctx){
  return rows_("os_acoes").filter(function(a){
    return String(a.ativo_id) === String(ctx.ativo.id) &&
      (!ctx.componente || String(a.componente_id) === String(ctx.componente.id)) &&
      (typeof acaoDisponivelInicioQr119_ === "function"
        ? acaoDisponivelInicioQr119_(a)
        : upper_(a.status) === ST.PENDENTE);
  }).sort(function(a,b){
    return priorityScore_(b.prioridade)-priorityScore_(a.prioridade) ||
      String(a.gerado_em).localeCompare(String(b.gerado_em));
  });
}

function fastNeedsMotorForContext_(ctx){
  var ativo = ctx.ativo;
  if(!ativo || !ativo.id) return false;
  if(upper_(ativo.status) === ST.INATIVO) return false;
  if(ctx.componente && upper_(ctx.componente.status) === ST.INATIVO) return false;

  var planos = rows_("planos_manutencao").filter(function(pl){
    return String(pl.ativo_id) === String(ativo.id) &&
      isPlanoOperacional_(pl) &&
      (!ctx.componente || String(pl.componente_id) === String(ctx.componente.id));
  });

  if(!planos.length) return false;

  var controles = rows_("plano_controle");
  var componentes = rows_("componentes");

  for(var i=0;i<planos.length;i++){
    var pl = planos[i];
    var tipo = upper_(pl.gatilho_tipo);
    var gat = num_(pl.gatilho_valor,0);
    if(gat <= 0) continue;

    var ctl = controles.find(function(c){ return String(c.plano_id) === String(pl.id); });

    // Sem controle, o motor precisa decidir/criar controle.
    if(!ctl) return true;

    if(tipo === "HORAS"){
      var comp = pl.componente_id ? componentes.find(function(c){ return String(c.id) === String(pl.componente_id); }) : null;
      var current = comp ? num_(comp.horas_acumuladas,0) : num_(ativo.horimetro_atual,0);
      var nextTarget = num_(ctl.proximo_valor_gatilho,0) || gat;

      if(current < nextTarget * FAB.MOTOR_THRESHOLD_RATIO) continue;
      if(num_(ctl.ultimo_valor_processado,0) >= current && clean_(ctl.ultima_acao_id)) continue;

      return true;
    }

    // Para gatilhos não-HORAS, deixa o motor completo decidir. Segurança > velocidade.
    return true;
  }

  return false;
}

function saudeAtivoFast_(ativoId){
  return calcularSaudeAtivoCMMS_(ativoId);
}

function assetLean_(a){
  return {
    id:a.id,
    tag:a.tag,
    qr_payload:a.qr_payload,
    nome:a.nome,
    tipo:a.tipo,
    criticidade:a.criticidade,
    status:a.status,
    saude_pct:num_(a.saude_pct,100),
    horimetro_atual:num_(a.horimetro_atual,0),
    horimetro_modo:a.horimetro_modo || "MANUAL",
    horimetro_atualizado_em:a.horimetro_atualizado_em || "",
    horimetro_base_servico:a.horimetro_base_servico,
    horimetro_base_servico_em:a.horimetro_base_servico_em || "",
    linha_id:a.linha_id
  };
}

function componentLean_(c){
  return {
    id:c.id,
    ativo_id:c.ativo_id,
    tag:c.tag,
    qr_payload:c.qr_payload,
    nome:c.nome,
    tipo:c.tipo,
    criticidade:c.criticidade,
    status:c.status,
    vida_util_horas:num_(c.vida_util_horas,0),
    vida_util_dias:num_(c.vida_util_dias,0),
    horas_acumuladas:num_(c.horas_acumuladas,0)
  };
}

function actionLean_(a){
  var comp = a.componente_id ? find_("componentes","id",a.componente_id) : null;
  var plano = a.plano_id ? find_("planos_manutencao","id",a.plano_id) : null;
  return {
    id:a.id,
    os_id:a.os_id,
    ativo_id:a.ativo_id,
    componente_id:a.componente_id,
    componente_nome:comp ? comp.nome : "",
    plano_id:a.plano_id,
    tipo:a.tipo,
    titulo:a.titulo,
    descricao:a.descricao,
    prioridade:a.prioridade,
    status:a.status,
    max_sessoes:plano ? Math.max(1,num_(plano.max_sessoes,1)) : 1,
    locks_ativos:activeLocks_(a.id).length,
    requer_evidencia:plano ? plano.requer_evidencia : "",
    requer_bloqueio:plano ? plano.requer_bloqueio : "",
    tempo_estimado_min:plano ? num_(plano.tempo_estimado_min,0) : 0
  };
}

function gestorDetalheAcaoFast_(p){
  req_(p,["acao_id"]);
  var a = find_("os_acoes","id",p.acao_id);
  if(!a) err_("ACTION_NOT_FOUND","Ação não encontrada.",404);

  var os = a.os_id ? find_("ordens_servico","id",a.os_id) : null;
  var ativo = find_("ativos","id",a.ativo_id);
  var comp = a.componente_id ? find_("componentes","id",a.componente_id) : null;

  var execs = rows_("execucoes").filter(function(e){ return String(e.acao_id) === String(a.id); }).sort(sortByDateDesc_("criado_em"));
  var chk = rows_("checklist_execucao").filter(function(c){ return String(c.acao_id) === String(a.id); });
  var ev = rows_("evidencias").filter(function(e){ return String(e.acao_id) === String(a.id); });
  var mats = rows_("materiais_uso").filter(function(m){ return String(m.acao_id) === String(a.id); });
  var hist = rows_("historico").filter(function(h){ return String(h.acao_id) === String(a.id) || String(h.os_id) === String(a.os_id); }).sort(sortByDateDesc_("criado_em")).slice(0,8).map(strip_);

  return {
    acao:strip_(a),
    os:os ? strip_(os) : null,
    ativo:ativo ? assetLean_(ativo) : null,
    componente:comp ? componentLean_(comp) : null,
    execucao_atual:execs.length ? strip_(execs[0]) : null,
    counts:{
      execucoes:execs.length,
      checklist:chk.length,
      checklist_pendente:chk.filter(function(i){ return bool_(i.obrigatorio) && !clean_(i.resposta); }).length,
      evidencias:ev.length,
      materiais:mats.length,
      locks:activeLocks_(a.id).length
    },
    checklist:chk.sort(function(a,b){ return num_(a.ordem,0)-num_(b.ordem,0); }).map(function(i){ return enrichChecklistExecItem_(i); }),
    evidencias:ev.map(strip_),
    historico_recente:hist
  };
}

function perfCacheStatus_(p){
  return {
    version:FAB.VERSION,
    cache_service:"ScriptCache",
    auth_cache_ttl_seconds:FAB.AUTH_CACHE_SECONDS || 180,
    table_cache_ttl_seconds:120,
    qr_index_ttl_seconds:FAB.WARMUP_CACHE_SECONDS || 300,
    qr_fast_ttl_seconds:FAB.QR_FAST_CACHE_SECONDS || 30,
    admin_resumo_ttl_seconds:60,
    observacao:"1.0.6 adiciona revisão formal de modelo de checklist validado."
  };
}

function perfCacheClear_(p){
  invalidateRuntimeCache_();
  Object.keys(SH).forEach(function(name){ safeCacheRemove_(tableCacheKey_(name)); });
  safeCacheRemove_(metaCacheKey_("qr_index_v3"));
  safeCacheRemove_(metaCacheKey_("admin_resumo"));
  safeCacheRemove_(metaCacheKey_("warmup_status"));
  if(p && p.token) safeCacheRemove_(authCacheKey_(p.token));
  return {
    cleared:true,
    version:FAB.VERSION,
    observacao:"Cache conhecido removido. Chaves QR fast antigas expiram naturalmente em até 30s."
  };
}
