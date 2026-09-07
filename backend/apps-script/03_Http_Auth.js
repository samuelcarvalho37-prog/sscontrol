function doGet(e){ return handle_("GET", e); }
function doPost(e){ return handle_("POST", e); }

function handle_(method, e){
  DB_CACHE = {};
  var started = Date.now();

  try{
    var req = parseReq_(method, e);
    if(!req.action) err_("ACTION_REQUIRED","Parâmetro action é obrigatório.",400);

    var payload = req.payload || {};
    if(PUBLIC_ACTIONS.indexOf(req.action) < 0){
      payload.__auth = authorize_(req.action, payload.token || req.params.token);
    }

    var data = route_(req.action, payload, req);
    return jsonOut_({ok:true, action:req.action, elapsed_ms:Date.now()-started, data:data});
  } catch(e){
    var er = normErr_(e);
    return jsonOut_({ok:false, status:er.status, error:{code:er.code, message:er.message}});
  }
}

function parseReq_(method, e){
  var params = e && e.parameter ? e.parameter : {};
  var body = {};
  if(method === "POST" && e && e.postData && e.postData.contents){
    try{ body = JSON.parse(e.postData.contents); } catch(x){ err_("INVALID_JSON","Body não é JSON válido.",400); }
  }
  var action = body.action || params.action || "";
  var payload = body.payload || {};
  if(method === "GET"){
    payload = Object.assign({}, params);
    delete payload.action;
  }
  return {method:method, action:action, payload:payload, params:params};
}

function route_(action, p, req){
  switch(action){
    case "sistema.health": return sistemaHealth_();
    case "sistema.bootstrap": return sistemaBootstrap_();
    case "sistema.warmup": return sistemaWarmup_(p);
    case "cmms.operador_visual_schema_upgrade": return cmmsOperadorTelaRealSchemaUpgrade112_(p, p.__auth);
    case "cmms.tela_operador_schema_upgrade": return cmmsOperadorTelaRealSchemaUpgrade112_(p, p.__auth);
    case "cmms.operador_ui_schema_upgrade": return cmmsOperadorTelaRealSchemaUpgrade112_(p, p.__auth);
    case "cmms.operacional_ui_schema_upgrade": return cmmsOperadorTelaRealSchemaUpgrade112_(p, p.__auth);
    case "cmms.contrato_frontend_schema_upgrade": return cmmsOperadorTelaRealSchemaUpgrade112_(p, p.__auth);
    case "cmms.frontend_contract_schema_upgrade": return cmmsOperadorTelaRealSchemaUpgrade112_(p, p.__auth);
    case "cmms.execucao_checklist_schema_upgrade": return cmmsExecucaoChecklistSchemaUpgrade1083_(p, p.__auth);
    case "cmms.auditoria_operador_schema_upgrade": return cmmsAuditoriaOperadorSchemaUpgrade1081_(p, p.__auth);
    case "cmms.paradas_operacionais_schema_upgrade": return cmmsParadasOperacionaisSchemaUpgrade114_(p, p.__auth);
    case "cmms.horimetro_evidencias_schema_upgrade": return cmmsHorimetroEvidenciasSchemaUpgrade116_(p, p.__auth);
    case "cmms.workflow_tecnico_schema_upgrade": return cmmsWorkflowTecnicoSchemaUpgrade_(p, p.__auth);
    case "cmms.configuracao_schema_upgrade": return cmmsConfiguracaoSchemaUpgrade_(p, p.__auth);
    case "cmms.importacao_admin_schema_upgrade": return cmmsImportacaoAdminSchemaUpgrade_(p, p.__auth);
    case "auth.login": return authLogin_(p, req);
    case "auth.first_access.complete": return authCompleteFirstAccess_(p, req);
    case "auth.recovery.request": return authRecoveryRequest_(p, req);
    case "auth.maintenance.exchange": return motorInternalMaintenanceExchange_(p);
    case "auth.logout": return authLogout_(p, req);

    case "admin.resumo": return adminResumo_();
    case "admin.resumo_cache": return adminResumoCache_(p);
    case "admin.listar": return adminListar_(p);
    case "admin.obter": return adminObter_(p);
    case "admin.salvar": return adminSalvarSeguro_(p, p.__auth);
    case "admin.entidade.acao": return adminEntityAction_(p, p.__auth);
    case "admin.usuarios.listar": return adminUsuariosListar_(p, p.__auth);
    case "admin.usuarios.salvar": return adminUsuariosSalvar_(p, p.__auth);
    case "admin.usuarios.desbloquear": return adminUsuariosDesbloquear_(p, p.__auth);
    case "admin.usuarios.redefinir_senha": return adminUsuariosRedefinirSenha_(p, p.__auth);
    case "admin.usuarios.revogar_sessoes": return adminUsuariosRevogarSessoes_(p, p.__auth);
    case "admin.permissoes.obter": return adminPermissoesObter_(p, p.__auth);
    case "admin.permissoes.salvar": return adminPermissoesSalvar_(p, p.__auth);
    case "admin.empresa.obter": return adminEmpresaObter_(p, p.__auth);
    case "admin.empresa.salvar": return adminEmpresaSalvar_(p, p.__auth);
    case "admin.acesso.estado": return motorCommercialAccessState_(p, p.__auth);
    case "platform.motor.catalogo": return motorPlatformCatalogState_(p, p.__auth);
    case "platform.motor.catalogo.rascunho.salvar": return motorCommercialCatalogDraftSave_(p, p.__auth);
    case "platform.motor.catalogo.validar": return motorCommercialCatalogValidate_(p, p.__auth);
    case "platform.motor.catalogo.publicar": return motorCommercialCatalogPublish_(p, p.__auth);
    case "platform.motor.catalogo.versoes": return motorCommercialCatalogVersions_(p, p.__auth);
    case "platform.motor.catalogo.rollback": return motorCommercialCatalogRollback_(p, p.__auth);
    case "admin.configuracao.estado": return configurationState_(p, p.__auth);
    case "admin.configuracao.rascunho.salvar": return configurationSaveDraft_(p, p.__auth);
    case "admin.configuracao.validar": return configurationValidate_(p, p.__auth);
    case "admin.configuracao.publicar": return configurationPublish_(p, p.__auth);
    case "admin.configuracao.versoes": return configurationVersions_(p, p.__auth);
    case "admin.configuracao.rollback": return configurationRollback_(p, p.__auth);
    case "admin.importacao.modelos": return adminImportacaoModelos_(p, p.__auth);
    case "admin.importacao.validar": return adminImportacaoValidar_(p, p.__auth);
    case "admin.importacao.confirmar": return adminImportacaoConfirmar_(p, p.__auth);
    case "admin.importacao.lotes": return adminImportacaoLotes_(p, p.__auth);
    case "admin.importacao.detalhe": return adminImportacaoDetalhe_(p, p.__auth);
    case "admin.importacao.rollback": return adminImportacaoRollback_(p, p.__auth);
    case "admin.areas_tecnicas.listar": return adminAreasTecnicasListar_(p, p.__auth);
    case "admin.areas_tecnicas.salvar": return adminAreasTecnicasSalvar_(p, p.__auth);
    case "admin.cargos_tecnicos.listar": return adminCargosTecnicosListar_(p, p.__auth);
    case "admin.cargos_tecnicos.salvar": return adminCargosTecnicosSalvar_(p, p.__auth);
    case "admin.demandas_tecnicas.enviar": return adminDemandasTecnicasEnviar_(p, p.__auth);
    case "admin.demandas_tecnicas.listar": return adminDemandasTecnicasListar_(p, p.__auth);
    case "admin.analises_tecnicas.listar": return adminAnalisesTecnicasListar_(p, p.__auth);
    case "admin.analises_tecnicas.converter": return adminAnaliseConverterChecklist_(p, p.__auth);
    case "admin.intervencoes.listar": return adminIntervencoesListar_(p, p.__auth);
    case "admin.intervencoes.salvar": return adminIntervencaoSalvar_(p, p.__auth);
    case "admin.intervencoes.enviar_validacao": return adminIntervencaoEnviarValidacao_(p, p.__auth);
    case "admin.documentos.listar": return adminDocumentosListar_(p, p.__auth);
    case "admin.documentos.detalhe": return adminDocumentoDetalhe_(p, p.__auth);
    case "admin.documentos.upload": return adminDocumentoUpload_(p, p.__auth);
    case "admin.documentos.atualizar": return adminDocumentoAtualizar_(p, p.__auth);
    case "admin.auditoria.listar": return adminAuditoriaListar_(p, p.__auth);
    case "admin.monitoramento.estado": return adminMonitoramentoEstado_(p, p.__auth);
    case "admin.backups.listar": return adminBackupsListar_(p, p.__auth);
    case "admin.backups.criar": return adminBackupCriar_(p, p.__auth);
    case "admin.backups.preparar_restauracao": return adminBackupPrepararRestauracao_(p, p.__auth);
    case "admin.backups.confirmar_restauracao": return adminBackupConfirmarRestauracao_(p, p.__auth);
    case "admin.gerar_qr": return adminGerarQr_(p);
    case "admin.criar_demo": return adminCriarDemo_(p);
    case "admin.recalcular_ativo": return adminRecalcularAtivo_(p);
    case "admin.salvar_modelo_checklist": return adminSalvarModeloChecklist_(p);
    case "admin.enviar_modelo_checklist_validacao": return adminEnviarModeloChecklistValidacao_(p);
    case "admin.detalhe_modelo_checklist": return detalheModeloChecklist_(p);
    case "admin.listar_modelos_checklist": return adminListarModelosChecklist_(p);
    case "admin.modelos_devolvidos": return adminModelosDevolvidos_(p);
    case "admin.corrigir_modelo_checklist": return adminCorrigirModeloChecklist_(p);
    case "admin.criar_revisao_modelo_checklist": return adminCriarRevisaoModeloChecklist_(p);
    case "admin.gerar_acao_teste_checklist": return adminGerarAcaoTesteChecklist108_(p, p.__auth);
    case "admin.corrigir_auditoria_execucao_operador": return adminCorrigirAuditoriaExecucaoOperador1081_(p, p.__auth);
    case "admin.registrar_horimetro_telemetria": return adminRegistrarHorimetroTelemetria116_(p, p.__auth);
    case "admin.reiniciar_contador_servico": return adminReiniciarContadorServico116_(p, p.__auth);

    case "operador.contexto_qr": return operadorContextoQr_(p);
    case "operador.contexto_qr_fast": return operadorContextoQrFast_(p);
    case "operador.historico_qr": return operadorHistoricoQr119_(p);
    case "operador.iniciar_acao": return operadorIniciarAcao_(p);
    case "operador.estado_acao": return operadorEstadoAcao118_(p);
    case "operador.salvar_checklist_item": return operadorSalvarChecklistItem_(p);
    case "operador.finalizar_acao": return operadorFinalizarAcao_(p);
    case "operador.registrar_evidencia": return operadorRegistrarEvidencia_(p);
    case "operador.upload_evidencia_foto": return operadorUploadEvidenciaFoto116_(p, p.__auth);
    case "operador.registrar_material": return operadorRegistrarMaterial_(p);
    case "operador.registrar_parametro": return operadorRegistrarParametro_(p);
    case "operador.parada_ativa": return operadorParadaAtiva114_(p, p.__auth);
    case "operador.iniciar_parada": return operadorIniciarParada114_(p, p.__auth);
    case "operador.finalizar_parada": return operadorFinalizarParada114_(p, p.__auth);
    case "operador.registrar_ocorrencia": return operadorRegistrarOcorrencia114_(p, p.__auth);
    case "operador.listar_checklist_execucao": return operadorListarChecklistExecucao_(p);
    case "operador.home": return operadorHome112_(p, p.__auth);
    case "operador.painel": return operadorHome112_(p, p.__auth);
    case "operador.minhas_acoes": return operadorMinhasAcoes117_(p, p.__auth);
    case "operador.tela_acao": return operadorTelaAcao112_(p, p.__auth);
    case "operador.salvar_checklist_lote": return operadorSalvarChecklistLote112_(p, p.__auth);
    case "operador.detalhar_checklist_execucao": return operadorDetalharChecklistExecucao112_(p, p.__auth);
    case "operador.validar_finalizacao_acao": return operadorValidarFinalizacaoAcao112_(p, p.__auth);

    case "admin.verificar_drive_evidencias": return adminVerificarDriveEvidencias117_(p, p.__auth);

    case "gestor.listar_paradas": return gestorListarParadas114_(p, p.__auth);
    case "gestor.listar_ocorrencias": return gestorListarOcorrencias114_(p, p.__auth);
    case "gestor.listar_acoes": return gestorListarAcoes_(p);
    case "gestor.detalhe_acao": return gestorDetalheAcao_(p);
    case "gestor.detalhe_acao_fast": return gestorDetalheAcaoFast_(p);
    case "gestor.auditoria_execucao_checklist": return gestorAuditoriaExecucaoChecklist112_(p, p.__auth);
    case "gestor.validar_acao": return gestorValidarAcao1083_(p);
    case "gestor.configurar_sessoes": return gestorConfigurarSessoes_(p);
    case "gestor.adicionar_colaborador": return gestorAdicionarColaborador_(p);
    case "gestor.liberar_locks": return gestorLiberarLocks_(p);
    case "gestor.modelos_em_validacao": return gestorModelosEmValidacao_(p);
    case "gestor.listar_modelos_checklist": return gestorListarModelosChecklist_(p);
    case "gestor.detalhe_modelo_checklist": return detalheModeloChecklist_(p);
    case "gestor.validar_modelo_checklist": return gestorValidarModeloChecklist_(p);
    case "gestor.contexto_tecnico": return gestorContextoTecnico_(p, p.__auth);
    case "gestor.demandas.listar": return gestorDemandasListar_(p, p.__auth);
    case "gestor.demandas.detalhe": return gestorDemandaDetalhe_(p, p.__auth);
    case "gestor.demandas.assumir": return gestorDemandaAssumir_(p, p.__auth);
    case "gestor.demandas.encaminhar": return gestorDemandaEncaminhar_(p, p.__auth);
    case "gestor.demandas.assinar": return gestorDemandaAssinar_(p, p.__auth);
    case "gestor.demandas.validar": return gestorDemandaValidar_(p, p.__auth);
    case "gestor.demandas.decidir": return gestorDemandaDecidir_(p, p.__auth);
    case "gestor.paradas.criar_tratamento": return gestorParadaCriarTratamento_(p, p.__auth);
    case "gestor.analises.salvar": return gestorAnaliseSalvar_(p, p.__auth);
    case "gestor.analises.enviar_admin": return gestorAnaliseEnviarAdmin_(p, p.__auth);
    case "gestor.registrar_parametro": return gestorRegistrarParametro_(p, p.__auth);
    case "gestor.dossie_ativo": return gestorDossieAtivo_(p, p.__auth);
    case "gestor.parametros.solicitar_acao": return gestorSolicitarAcaoParametro_(p, p.__auth);
    case "gestor.notificacoes.listar": return gestorNotificacoesListar_(p, p.__auth);
    case "gestor.notificacoes.marcar_lida": return gestorNotificacaoMarcarLida_(p, p.__auth);

    case "lock.status": return lockStatus_(p);
    case "lock.adquirir": return lockAdquirir_(p);
    case "lock.heartbeat": return lockHeartbeat_(p);
    case "lock.liberar": return lockLiberar_(p);

    case "catalogo.checklist_tipos": return adminListarTiposItemChecklist107_(p, p.__auth);
    case "admin.listar_tipos_item_checklist": return adminListarTiposItemChecklist107_(p, p.__auth);
    case "admin.listar_regras_checklist": return adminListarRegrasChecklist107_(p, p.__auth);
    case "admin.validar_catalogo_item_checklist": return adminValidarCatalogoItemChecklist107_(p, p.__auth);
    case "admin.salvar_item_modelo_checklist": return adminSalvarItemModeloChecklist107_(p, p.__auth);
    case "admin.remover_item_modelo_checklist": return adminRemoverItemModeloChecklist107_(p, p.__auth);
    case "admin.reordenar_itens_modelo_checklist": return adminReordenarItensModeloChecklist107_(p, p.__auth);
    case "admin.clonar_item_modelo_checklist": return adminClonarItemModeloChecklist107_(p, p.__auth);
    case "admin.listar_itens_modelo_checklist": return adminListarItensModeloChecklist107_(p, p.__auth);
    case "admin.detalhar_modelo_checklist_catalogo": return adminDetalharModeloChecklistCatalogo107_(p, p.__auth);
    case "operador.validar_resposta_checklist_item": return operadorValidarRespostaChecklistItem107_(p, p.__auth);
    case "cmms.catalogo_checklist_schema_upgrade": return cmmsCatalogoChecklistSchemaUpgrade107_(p, p.__auth);

    case "cmms.schema_upgrade": return cmmsSchemaUpgrade_(p);
    case "cmms.motor_recalcular": return cmmsMotorRecalcular_(p);
    case "cmms.kpis_base": return cmmsKpisBase_(p);
    case "cmms.kpis_tecnicos": return cmmsKpisTecnicos_(p, p.__auth);
    case "perf.cache_status": return perfCacheStatus_(p);
    case "perf.cache_clear": return perfCacheClear_(p);
    case "cmms.diagnostico": return cmmsDiagnostico_(p);
    case "cmms.higiene_diagnosticar": return cmmsHigieneDiagnosticar_(p);
    case "cmms.higienizar_status": return cmmsHigienizarStatus_(p);
    case "cmms.higienizar_duplicidades": return cmmsHigienizarDuplicidades_(p);
    case "cmms.higienizar_base": return cmmsHigienizarBase_(p);

    case "telemetria.iniciar": return telemetriaIniciar_(p);
    case "telemetria.evento": return telemetriaEvento_(p);
    case "telemetria.finalizar": return telemetriaFinalizar_(p);

    default: err_("UNKNOWN_ACTION","Action não reconhecida: "+action,400);
  }
}

function sistemaHealth_(){
  return Object.assign(
    {ok:true, app:FAB.APP_NAME, version:FAB.VERSION},
    releaseVersionInfo_(),
    {spreadsheetId:getSpreadsheet_().getId(), serverTime:now_()}
  );
}

function sistemaBootstrap_(){
  return Object.assign({
    app:FAB.APP_NAME,
    version:FAB.VERSION,
    spreadsheetId:getSpreadsheet_().getId(),
    serverTime:now_(),
    sheets:Object.keys(SH),
    endpoints:[
      "auth.login","auth.first_access.complete","auth.recovery.request","auth.logout","sistema.warmup","cmms.schema_upgrade","cmms.paradas_operacionais_schema_upgrade","cmms.horimetro_evidencias_schema_upgrade","cmms.catalogo_checklist_schema_upgrade","cmms.workflow_tecnico_schema_upgrade","cmms.configuracao_schema_upgrade","cmms.importacao_admin_schema_upgrade","cmms.operador_visual_schema_upgrade","cmms.tela_operador_schema_upgrade","cmms.operador_ui_schema_upgrade","cmms.operacional_ui_schema_upgrade","cmms.contrato_frontend_schema_upgrade","cmms.frontend_contract_schema_upgrade","cmms.execucao_checklist_schema_upgrade","cmms.auditoria_operador_schema_upgrade","admin.resumo","admin.resumo_cache","admin.listar","admin.salvar","admin.entidade.acao","admin.usuarios.listar","admin.usuarios.salvar","admin.usuarios.desbloquear","admin.usuarios.redefinir_senha","admin.usuarios.revogar_sessoes","admin.permissoes.obter","admin.permissoes.salvar","admin.empresa.obter","admin.empresa.salvar","admin.acesso.estado","admin.configuracao.estado","admin.configuracao.rascunho.salvar","admin.configuracao.validar","admin.configuracao.publicar","admin.configuracao.versoes","admin.configuracao.rollback","admin.importacao.modelos","admin.importacao.validar","admin.importacao.confirmar","admin.importacao.lotes","admin.importacao.detalhe","admin.importacao.rollback","admin.areas_tecnicas.listar","admin.areas_tecnicas.salvar","admin.cargos_tecnicos.listar","admin.cargos_tecnicos.salvar","admin.demandas_tecnicas.enviar","admin.demandas_tecnicas.listar","admin.analises_tecnicas.listar","admin.analises_tecnicas.converter","admin.intervencoes.listar","admin.intervencoes.salvar","admin.intervencoes.enviar_validacao","admin.documentos.listar","admin.documentos.detalhe","admin.documentos.upload","admin.documentos.atualizar","admin.auditoria.listar","admin.monitoramento.estado","admin.backups.listar","admin.backups.criar","admin.backups.preparar_restauracao","admin.backups.confirmar_restauracao","admin.gerar_qr","admin.criar_demo","admin.recalcular_ativo",
      "admin.salvar_modelo_checklist","admin.registrar_horimetro_telemetria","admin.reiniciar_contador_servico","admin.verificar_drive_evidencias","admin.gerar_acao_teste_checklist","admin.corrigir_auditoria_execucao_operador","admin.enviar_modelo_checklist_validacao","admin.detalhe_modelo_checklist","admin.listar_modelos_checklist","admin.modelos_devolvidos","admin.corrigir_modelo_checklist","admin.criar_revisao_modelo_checklist",
      "operador.home","operador.painel","operador.minhas_acoes","operador.tela_acao","operador.estado_acao","operador.salvar_checklist_lote","operador.contexto_qr_fast","operador.contexto_qr","operador.historico_qr","operador.parada_ativa","operador.iniciar_parada","operador.finalizar_parada","operador.registrar_ocorrencia","operador.iniciar_acao","operador.listar_checklist_execucao","operador.detalhar_checklist_execucao","operador.validar_finalizacao_acao","operador.salvar_checklist_item","operador.registrar_evidencia","operador.upload_evidencia_foto","operador.finalizar_acao",
      "gestor.auditoria_execucao_checklist","gestor.listar_paradas","gestor.listar_ocorrencias","gestor.modelos_em_validacao","gestor.listar_modelos_checklist","gestor.detalhe_modelo_checklist","gestor.validar_modelo_checklist","gestor.listar_acoes","gestor.detalhe_acao_fast","gestor.detalhe_acao","gestor.validar_acao","gestor.contexto_tecnico","gestor.demandas.listar","gestor.demandas.detalhe","gestor.demandas.assumir","gestor.demandas.encaminhar","gestor.demandas.assinar","gestor.demandas.validar","gestor.demandas.decidir","gestor.paradas.criar_tratamento","gestor.analises.salvar","gestor.analises.enviar_admin","gestor.registrar_parametro","gestor.dossie_ativo","gestor.parametros.solicitar_acao","gestor.notificacoes.listar","gestor.notificacoes.marcar_lida",
      "cmms.higiene_diagnosticar","cmms.higienizar_status","cmms.higienizar_duplicidades","cmms.higienizar_base","cmms.kpis_base","cmms.kpis_tecnicos","perf.cache_status","perf.cache_clear"
    ]
  }, releaseVersionInfo_());
}

function ensureAuthSchema_(){
  var ss = getSpreadsheet_();
  ensureSheet_(ss, "usuarios", SH.usuarios);
  ensureSheet_(ss, "sessoes", SH.sessoes);

  var releaseRow = find_("config", "chave", "release.version");
  if(!releaseRow || clean_(releaseRow.valor) !== FAB.RELEASE_VERSION){
    syncReleaseVersionConfig_();
  }

  var authSchemaRow = find_("config", "chave", "auth.schema.version");
  if(authSchemaRow && clean_(authSchemaRow.valor) === FAB.SCHEMA_VERSION) return;

  rows_("usuarios", true).forEach(function(user){
    var patch = {};
    if(!clean_(user.matricula)) patch.matricula = clean_(user.id);
    if(!clean_(user.primeiro_acesso)){
      patch.primeiro_acesso = clean_(user.senha_hash) ? "NAO" : "SIM";
    }
    if(clean_(user.tentativas_login) === "") patch.tentativas_login = 0;
    if(Object.keys(patch).length){
      patch.atualizado_em = now_();
      update_("usuarios", user.__rowIndex, patch);
    }
  });

  upsert_("config", "chave", {
    chave:"auth.schema.version",
    valor:FAB.SCHEMA_VERSION,
    descricao:"Versao da migracao do schema de autenticacao",
    atualizado_em:now_()
  });
}

function authFindUser_(registration){
  var normalized = clean_(registration);
  var upperRegistration = upper_(normalized);
  var lowerRegistration = normalized.toLowerCase();
  return rows_("usuarios", true).find(function(user){
    return upper_(user.matricula) === upperRegistration ||
      upper_(user.id) === upperRegistration ||
      clean_(user.email).toLowerCase() === lowerRegistration;
  }) || null;
}

function authPublicUser_(user){
  return {
    id:clean_(user.id),
    nome:clean_(user.nome),
    email:clean_(user.email),
    matricula:clean_(user.matricula || user.id),
    perfil:upper_(user.perfil),
    area_id:clean_(user.area_id),
    cargo_id:clean_(user.cargo_id)
  };
}

function authSessionExpiryMs_(session){
  var explicit = num_(session && session.expira_ms, 0);
  if(explicit > 0) return explicit;
  var parsed = new Date(clean_(session && session.expira_em)).getTime();
  return isNaN(parsed) ? 0 : parsed;
}

function authLockedUntilMs_(user){
  var parsed = new Date(clean_(user && user.bloqueado_ate)).getTime();
  return isNaN(parsed) ? 0 : parsed;
}

function authRegisterInvalidAttempt_(user){
  var attempts = num_(user.tentativas_login, 0) + 1;
  var patch = {
    tentativas_login:attempts,
    atualizado_em:now_()
  };

  if(attempts >= (FAB.AUTH_LOGIN_MAX_ATTEMPTS || 5)){
    patch.bloqueado_ate = iso_(addMinutes_(new Date(), FAB.AUTH_LOCK_MINUTES || 15));
    update_("usuarios", user.__rowIndex, patch);
    err_("ACCOUNT_LOCKED", "Conta temporariamente bloqueada após tentativas inválidas.", 423);
  }

  update_("usuarios", user.__rowIndex, patch);
  err_("LOGIN_INVALID", "Matrícula ou senha inválida.", 401);
}

function authResetLoginProtection_(user){
  update_("usuarios", user.__rowIndex, {
    tentativas_login:0,
    bloqueado_ate:"",
    ultimo_login_em:now_(),
    atualizado_em:now_()
  });
}

function authCreateScopedSession_(user,scope,hours,minutes,userAgent){
  var token = authRandomToken_(scope === "FIRST_ACCESS" ? "FAB-CHANGE" : "FAB");
  var exp = minutes
    ? addMinutes_(new Date(), minutes)
    : addHours_(new Date(), hours || FAB.TOKEN_HOURS);
  var expMs = exp.getTime();

  append_("sessoes", fit_("sessoes", {
    token:token,
    usuario_id:user.id,
    perfil:upper_(user.perfil),
    status:ST.ATIVO,
    criado_em:now_(),
    expira_em:iso_(exp),
    ultimo_uso_em:now_(),
    user_agent:userAgent || "",
    escopo:scope,
    expira_ms:expMs,
    revogado_em:"",
    motivo_revogacao:""
  }));

  return {
    token:token,
    usuario_id:user.id,
    nome:user.nome,
    email:user.email,
    matricula:user.matricula || user.id,
    perfil:upper_(user.perfil),
    escopo:scope,
    expira_em:iso_(exp),
    expira_ms:expMs
  };
}

function authFindSession_(token){
  return rows_("sessoes", true).find(function(session){
    return String(session.token) === String(token);
  }) || null;
}

function authRevokeSession_(session,reason){
  if(!session || !session.__rowIndex) return;
  update_("sessoes", session.__rowIndex, {
    status:ST.INATIVO,
    revogado_em:now_(),
    motivo_revogacao:reason || "REVOGADA"
  });
  if(typeof authCacheKey_ === "function") safeCacheRemove_(authCacheKey_(session.token));
}

function authLogin_(p, req){
  ensureAuthSchema_();

  var registration = clean_(p.matricula || p.registration || p.email);
  var password = String(p.senha || p.password || p.pin || "");
  if(!registration) err_("FIELD_REQUIRED", "Campo obrigatório: matricula", 400);
  if(!password) err_("FIELD_REQUIRED", "Campo obrigatório: senha", 400);

  var user = authFindUser_(registration);
  if(!user){
    Utilities.sleep(120);
    err_("LOGIN_INVALID", "Matrícula ou senha inválida.", 401);
  }

  if(upper_(user.status) !== ST.ATIVO){
    err_("USER_INACTIVE", "Usuário inativo.", 403);
  }

  var lockedUntil = authLockedUntilMs_(user);
  if(lockedUntil > Date.now()){
    err_("ACCOUNT_LOCKED", "Conta temporariamente bloqueada após tentativas inválidas.", 423);
  }

  if(lockedUntil && lockedUntil <= Date.now()){
    update_("usuarios", user.__rowIndex, {
      tentativas_login:0,
      bloqueado_ate:"",
      atualizado_em:now_()
    });
    user = authFindUser_(registration);
  }

  var passwordHash = clean_(user.senha_hash);
  var valid = passwordHash
    ? authVerifyPasswordHash_(password, passwordHash)
    : authSecureEquals_(clean_(user.pin_hash), hashPin_(password));

  if(!valid) authRegisterInvalidAttempt_(user);

  authResetLoginProtection_(user);
  user = authFindUser_(registration);

  var firstAccess = bool_(user.primeiro_acesso) || !clean_(user.senha_hash);
  if(firstAccess){
    var changeSession = authCreateScopedSession_(
      user,
      "FIRST_ACCESS",
      0,
      FAB.AUTH_FIRST_ACCESS_MINUTES || 15,
      p.user_agent || ""
    );

    return Object.assign({
      requires_password_change:true,
      first_access:true,
      change_token:changeSession.token,
      expira_em:changeSession.expira_em,
      expira_ms:changeSession.expira_ms,
      usuario:authPublicUser_(user)
    }, releaseVersionInfo_());
  }

  var appSession = authCreateScopedSession_(
    user,
    "APP",
    FAB.TOKEN_HOURS,
    0,
    p.user_agent || ""
  );

  cacheAuthSession_(appSession);

  return Object.assign({
    requires_password_change:false,
    token:appSession.token,
    expira_em:appSession.expira_em,
    expira_ms:appSession.expira_ms,
    usuario:authPublicUser_(user),
    warmup_required:true,
    warmup_action:"sistema.warmup"
  }, releaseVersionInfo_());
}

function authCompleteFirstAccess_(p, req){
  ensureAuthSchema_();
  req_(p, ["change_token", "nova_senha"]);

  var policy = authPasswordPolicy_(p.nova_senha);
  if(!policy.ok) err_(policy.code, policy.message, 400);

  var session = authFindSession_(p.change_token);
  if(!session) err_("CHANGE_TOKEN_INVALID", "Solicitação de primeiro acesso inválida.", 401);
  if(upper_(session.status) !== ST.ATIVO) err_("CHANGE_TOKEN_INACTIVE", "Solicitação de primeiro acesso inativa.", 401);
  if(upper_(session.escopo) !== "FIRST_ACCESS") err_("CHANGE_TOKEN_SCOPE_INVALID", "Escopo de primeiro acesso inválido.", 401);
  if(authSessionExpiryMs_(session) <= Date.now()) err_("CHANGE_TOKEN_EXPIRED", "Solicitação de primeiro acesso expirada.", 401);

  var user = find_("usuarios", "id", session.usuario_id);
  if(!user || upper_(user.status) !== ST.ATIVO) err_("USER_INACTIVE", "Usuário inativo.", 403);

  var newHash = authCreatePasswordHash_(p.nova_senha);
  update_("usuarios", user.__rowIndex, {
    senha_hash:newHash,
    pin_hash:"",
    primeiro_acesso:"NAO",
    tentativas_login:0,
    bloqueado_ate:"",
    senha_atualizada_em:now_(),
    atualizado_em:now_()
  });

  rows_("sessoes", true)
    .filter(function(item){
      return String(item.usuario_id) === String(user.id) && upper_(item.status) === ST.ATIVO;
    })
    .forEach(function(item){ authRevokeSession_(item, "PASSWORD_CHANGED"); });

  audit_(
    {usuario_id:user.id, perfil:upper_(user.perfil)},
    "AUTH_FIRST_ACCESS_COMPLETED",
    "usuarios",
    user.id,
    null,
    {matricula:user.matricula || user.id},
    p.user_agent || ""
  );

  return Object.assign({
    password_changed:true,
    usuario:authPublicUser_(user)
  }, releaseVersionInfo_());
}

function authRecoveryReference_(registration){
  return "REC-" + sha256_(
    "FAB-RECOVERY-V1:" + authPasswordPepper_() + ":" + upper_(registration)
  ).slice(0,12).toUpperCase();
}

function authRecoveryRequest_(p, req){
  ensureAuthSchema_();
  var started = Date.now();
  var registration = clean_(p.matricula || p.registration || p.email);
  if(!registration) err_("FIELD_REQUIRED", "Campo obrigatório: matricula", 400);

  // A referência depende somente da matrícula normalizada e de um segredo do projeto.
  // Assim, a resposta pública é idêntica para contas existentes e inexistentes.
  var reference = authRecoveryReference_(registration);
  var user = authFindUser_(registration);

  if(user){
    var lastRequestMs = new Date(clean_(user.recuperacao_solicitada_em)).getTime();
    var cooldownMs = (FAB.AUTH_RECOVERY_COOLDOWN_MINUTES || 10) * 60000;
    var cooldownActive =
      !isNaN(lastRequestMs) &&
      lastRequestMs > 0 &&
      Date.now() - lastRequestMs < cooldownMs;

    if(!cooldownActive){
      update_("usuarios", user.__rowIndex, {
        recuperacao_referencia:reference,
        recuperacao_solicitada_em:now_(),
        atualizado_em:now_()
      });
      audit_(
        {usuario_id:user.id, perfil:upper_(user.perfil)},
        "AUTH_RECOVERY_REQUESTED",
        "usuarios",
        user.id,
        null,
        {referencia:reference},
        p.user_agent || ""
      );
    }
  }

  // Reduz diferenças triviais de tempo entre matrícula existente e inexistente.
  var remainingDelay = 200 - (Date.now() - started);
  if(remainingDelay > 0) Utilities.sleep(remainingDelay);

  return Object.assign({
    accepted:true,
    request_id:reference,
    message:"Solicitação registrada. O administrador fará a validação do acesso."
  }, releaseVersionInfo_());
}

function authLogout_(p, req){
  ensureAuthSchema_();
  var token = clean_(p.token || (req && req.params && req.params.token));
  if(!token) return Object.assign({logged_out:true}, releaseVersionInfo_());

  var session = authFindSession_(token);
  if(session) authRevokeSession_(session, "LOGOUT");

  return Object.assign({logged_out:true}, releaseVersionInfo_());
}

function authorize_(action, token){
  if(!token) err_("TOKEN_REQUIRED","Token obrigatório para ação: "+action,401);

  var cached = getCachedAuthSession_(token);
  if(cached){
    ensurePermission_(cached.perfil, action);
    var cachedAuth = {
      token:token,
      usuario_id:cached.usuario_id,
      nome:cached.nome,
      email:cached.email,
      perfil:cached.perfil
    };
    if(typeof motorAuthorizeAction_ === "function") motorAuthorizeAction_(action, cachedAuth);
    return cachedAuth;
  }

  var sess = find_("sessoes","token",token);

  // Compatibilidade com banco antigo.
  if(!sess && sheetExists_("tokens_sessao")){
    sess = rows_("tokens_sessao").find(function(s){ return String(s.token) === String(token); }) || null;
  }

  if(!sess) err_("TOKEN_INVALID","Sessão inválida. Faça login novamente.",401);
  if(upper_(sess.status) !== ST.ATIVO) err_("TOKEN_INACTIVE","Sessão inativa.",401);
  if(authSessionExpiryMs_(sess) < Date.now()) err_("TOKEN_EXPIRED","Sessão expirada. Faça login novamente.",401);

  if(upper_(sess.perfil) === ROLE.SISTEMA){
    if(upper_(sess.escopo) !== "PLATFORM_MAINTENANCE"){
      err_("TOKEN_SCOPE_INVALID","Sessão interna sem escopo de manutenção.",401);
    }
    var systemAuth = motorInternalAuthorizeSession_(sess);
    ensurePermission_(ROLE.SISTEMA, action);
    if(typeof motorAuthorizeAction_ === "function") motorAuthorizeAction_(action, systemAuth);
    return systemAuth;
  }

  if(clean_(sess.escopo) && upper_(sess.escopo) !== "APP") err_("TOKEN_SCOPE_INVALID","Sessão sem escopo operacional.",401);

  var user = find_("usuarios","id",sess.usuario_id);
  if(!user || upper_(user.status) !== ST.ATIVO) err_("USER_INACTIVE","Usuário inativo.",403);

  var perfil = upper_(user.perfil || sess.perfil);
  ensurePermission_(perfil, action);

  var auth = {token:token, usuario_id:user.id, nome:user.nome, email:user.email, perfil:perfil, expira_em:sess.expira_em};
  if(typeof motorAuthorizeAction_ === "function") motorAuthorizeAction_(action, auth);
  cacheAuthSession_(auth);

  // Não atualiza ultimo_uso_em a cada requisição. Isso gerava escrita, invalidava cache e pesava o Apps Script.
  // O toque é feito só quando o token cai fora do cache.
  if(sess.__rowIndex && sheetExists_("sessoes")) update_("sessoes", sess.__rowIndex, {ultimo_uso_em:now_()});

  return {token:token, usuario_id:user.id, nome:user.nome, email:user.email, perfil:perfil};
}

function sheetExists_(name){
  return !!getSpreadsheet_().getSheetByName(name);
}
