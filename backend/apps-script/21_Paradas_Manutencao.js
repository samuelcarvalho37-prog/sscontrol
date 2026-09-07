/**
 * FAB Control 1.1.9
 * Política de parada da execução técnica.
 *
 * A parada física do equipamento é sempre registrada em paradas_equipamento.
 * Esta unidade mantém compatibilidade com os modos antigos e com registros
 * legados de paradas_manutencao, mas não cria novas paradas paralelas.
 */

function normalizaModoParadaManutencao115_(value){
  var mode = upper_(value || "DECISAO_EXECUTOR");
  if(mode === "PARAR_EQUIPAMENTO" || mode === "PARADA_OBRIGATORIA") return "OBRIGATORIA";
  if(mode === "ESCOLHA_DO_TECNICO" || mode === "ESCOLHA_TECNICO") return "DECISAO_EXECUTOR";
  if(mode === "EXECUTAR_SEM_PARADA") return "SEM_PARADA";
  if(["OBRIGATORIA","DECISAO_EXECUTOR","SEM_PARADA"].indexOf(mode) < 0){
    return "DECISAO_EXECUTOR";
  }
  return mode;
}

function modoParadaAcao115_(acao){
  if(!acao) return "DECISAO_EXECUTOR";
  var direct = normalizaModoParadaManutencao115_(acao.modo_parada_manutencao);
  if(clean_(acao.modo_parada_manutencao)) return direct;

  var plano = clean_(acao.plano_id) ? find_("planos_manutencao","id",acao.plano_id) : null;
  return normalizaModoParadaManutencao115_(
    plano && clean_(plano.modo_parada_manutencao) ||
    configurationRuntimeValue_("manutencao.modo_parada_padrao", "DECISAO_EXECUTOR")
  );
}

function normalizaDecisaoParada115_(value){
  var decision = upper_(value);
  if(decision === "PARAR" || decision === "COM_PARADA" || decision === "PARAR_EQUIPAMENTO"){
    return "PARAR_EQUIPAMENTO";
  }
  if(decision === "SEM_PARADA" || decision === "EXECUTAR_SEM_PARADA") return "SEM_PARADA";
  return "";
}

function resolverDecisaoInicioManutencao115_(acao, p){
  var configured = modoParadaAcao115_(acao);
  var operationalStop = typeof paradaAtivaPorAtivo114_ === "function"
    ? paradaAtivaPorAtivo114_(acao.ativo_id)
    : null;

  // A condição física prevalece sobre a configuração. Se a produção já
  // registrou uma parada, a manutenção reutiliza esse mesmo evento.
  if(operationalStop){
    return {
      modo_configurado:configured,
      decisao:"PARAR_EQUIPAMENTO",
      parada_operacional:operationalStop
    };
  }

  if(configured === "OBRIGATORIA"){
    return {
      modo_configurado:configured,
      decisao:"PARAR_EQUIPAMENTO",
      parada_operacional:null
    };
  }

  if(configured === "SEM_PARADA"){
    return {
      modo_configurado:configured,
      decisao:"SEM_PARADA",
      parada_operacional:null
    };
  }

  var decision = normalizaDecisaoParada115_(p && p.decisao_parada_manutencao);
  if(!decision){
    err_(
      "MAINTENANCE_STOP_DECISION_REQUIRED",
      "Escolha PARAR_EQUIPAMENTO ou SEM_PARADA antes de iniciar a execução.",
      400
    );
  }

  return {
    modo_configurado:configured,
    decisao:decision,
    parada_operacional:null
  };
}

// Compatibilidade para consulta de registros anteriores à unificação.
function paradaManutencaoAtivaPorAcao115_(acaoId){
  return rows_("paradas_manutencao")
    .filter(function(r){
      return String(r.acao_id) === String(acaoId) &&
        upper_(r.status) === ST.EM_EXECUCAO;
    })
    .sort(sortByDateDesc_("iniciada_em"))[0] || null;
}

function paradaManutencaoAtivaPorAtivo115_(ativoId){
  return rows_("paradas_manutencao")
    .filter(function(r){
      return String(r.ativo_id) === String(ativoId) &&
        upper_(r.status) === ST.EM_EXECUCAO &&
        upper_(r.decisao_execucao) === "COM_PARADA";
    })
    .sort(sortByDateDesc_("iniciada_em"))[0] || null;
}

function paradaManutencaoSerializada115_(row){
  if(!row) return null;
  var out = strip_(row);
  out.duracao_segundos = clean_(row.finalizada_em)
    ? num_(row.duracao_segundos,0)
    : secondsBetween114_(row.iniciada_em, "");
  out.equipamento_ja_parado = bool_(row.equipamento_ja_parado);
  out.alterou_status_ativo = bool_(row.alterou_status_ativo);
  return out;
}

function iniciarCondicaoManutencao115_(acao, ex, auth, policy){
  var executionRow = ex && ex.__rowIndex ? ex : (find_("execucoes","id",ex.id) || ex);

  if(policy.decisao === "SEM_PARADA"){
    if(executionRow && executionRow.__rowIndex){
      patchRowFast118_("execucoes", executionRow, {
        modo_execucao_manutencao:"SEM_PARADA",
        atualizado_em:now_()
      });
    }

    if(typeof histFast119_ === "function"){
      histFast119_({
        ativo_id:acao.ativo_id,
        componente_id:acao.componente_id,
        os_id:acao.os_id,
        acao_id:acao.id,
        execucao_id:ex.id,
        evento:"MANUTENCAO_INICIADA_SEM_PARADA",
        descricao:"Execução técnica iniciada sem parada do equipamento.",
        usuario_id:auth.usuario_id || "",
        perfil:auth.perfil || ROLE.OPERADOR
      });
    } else {
      hist_({
        ativo_id:acao.ativo_id,
        componente_id:acao.componente_id,
        os_id:acao.os_id,
        acao_id:acao.id,
        execucao_id:ex.id,
        evento:"MANUTENCAO_INICIADA_SEM_PARADA",
        descricao:"Execução técnica iniciada sem parada do equipamento.",
        usuario_id:auth.usuario_id || "",
        perfil:auth.perfil || ROLE.OPERADOR
      });
    }
    return null;
  }

  var stop = paradaVincularInicioManutencao114_(acao, ex, auth);

  if(executionRow && executionRow.__rowIndex){
    patchRowFast118_("execucoes", executionRow, {
      modo_execucao_manutencao:"COM_PARADA",
      atualizado_em:now_()
    });
  }

  return stop;
}

function finalizarCondicaoManutencao115_(acao, ex, auth){
  var mode = upper_(ex && ex.modo_execucao_manutencao || "");
  var linkedStop = paradaAtivaPorAcao114_(acao.id);
  var unifiedStop = (mode === "COM_PARADA" || linkedStop)
    ? paradaRegistrarFimManutencao114_(acao, ex, auth)
    : null;

  // Fecha somente o registro legado, quando existir. O status físico do ativo
  // permanece sob controle de paradas_equipamento.
  var legacy = paradaManutencaoAtivaPorAcao115_(acao.id);
  if(legacy){
    var endedAt = now_();
    var duration = secondsBetween114_(legacy.iniciada_em, endedAt);
    patchRowFast118_("paradas_manutencao", legacy, {
      status:ST.FINALIZADA,
      finalizada_em:endedAt,
      duracao_segundos:duration,
      atualizado_em:endedAt
    });
  }

  return unifiedStop || (legacy ? paradaManutencaoSerializada115_(legacy) : null);
}
