# Inventário do Google Apps Script

Fonte: `backend/apps-script`

Arquivos JavaScript: 34

Funções declaradas: 720
Ações roteadas: 174

Este inventário registra a superfície atual que deverá ser preservada ou substituída por contratos equivalentes no Node.js. Funções terminadas em `_` são internas no Apps Script, mas continuam relevantes porque contêm regras de negócio.

## Funções por arquivo

### 00_Config.js — 0

Arquivo declarativo de constantes, configurações e esquema `SH`.

### 01_Utils.js — 33

`now_`, `iso_`, `addHours_`, `addSeconds_`, `addMinutes_`, `clean_`, `upper_`, `num_`, `bool_`, `uuid_`, `slug_`, `eid_`, `err_`, `req_`, `strip_`, `j_`, `hashPin_`, `sha256_`, `authPasswordPepper_`, `authSecureEquals_`, `authPasswordPolicy_`, `authPasswordDigest_`, `authCreatePasswordHash_`, `authVerifyPasswordHash_`, `authRandomToken_`, `normCell_`, `normErr_`, `sortByDateDesc_`, `priorityScore_`, `acaoAberta_`, `terminal_`, `respostaCritica_`, `jsonOut_`.

### 02_Db.js — 29

`scriptCache_`, `tableCacheKey_`, `metaCacheKey_`, `safeCacheGetJson_`, `safeCachePutJson_`, `safeCacheRemove_`, `invalidateSheetCache_`, `invalidateRuntimeCache_`, `setupInicial`, `setupCMMSCore`, `getSpreadsheet_`, `ensureSheet_`, `sheet_`, `headers_`, `rows_`, `find_`, `filter_`, `append_`, `update_`, `deleteRow_`, `upsertConfigText_`, `upsert_`, `fit_`, `releaseVersionInfo_`, `syncReleaseVersionConfig_`, `seedBase_`, `seedUser_`, `hist_`, `audit_`.

### 03_Http_Auth.js — 24

`doGet`, `doPost`, `handle_`, `parseReq_`, `route_`, `sistemaHealth_`, `sistemaBootstrap_`, `ensureAuthSchema_`, `authFindUser_`, `authPublicUser_`, `authSessionExpiryMs_`, `authLockedUntilMs_`, `authRegisterInvalidAttempt_`, `authResetLoginProtection_`, `authCreateScopedSession_`, `authFindSession_`, `authRevokeSession_`, `authLogin_`, `authCompleteFirstAccess_`, `authRecoveryReference_`, `authRecoveryRequest_`, `authLogout_`, `authorize_`, `sheetExists_`.

### 04_Admin.js — 44

`adminRequireIdentityAdmin_`, `adminCompanyName_`, `adminCompanyLogo_`, `adminEmpresaObter_`, `adminCompanyAuditView_`, `adminEmpresaSalvar_`, `adminSanitizeEntityRow_`, `adminPublicUser_`, `adminActiveSessionCounts_`, `adminRevokeUserSessions_`, `adminAssertUserUniqueness_`, `adminAssertUserPayload_`, `adminAssertAdminContinuity_`, `adminUsuariosListar_`, `adminUsuariosSalvar_`, `adminUsuariosDesbloquear_`, `adminUsuariosRedefinirSenha_`, `adminUsuariosRevogarSessoes_`, `adminPermissionStoredMatrix_`, `adminCapabilityEnabled_`, `adminPermissionDecision_`, `adminPermissionProfile_`, `adminPermissoesObter_`, `adminPermissoesSalvar_`, `adminResumo_`, `adminListar_`, `adminObter_`, `adminSalvar_`, `adminAssertEntityReferences_`, `adminProtectManualPlan_`, `adminSalvarSeguro_`, `adminEntityAllowedStatuses_`, `adminEntityAssertParentAvailable_`, `adminEntityOpenOperations_`, `adminEntityActiveChildren_`, `adminValidateEntityStatusTransition_`, `adminEntityReferenceSummary_`, `adminDeleteEntity_`, `adminEntityAction_`, `normalizeEnt_`, `shForEnt_`, `adminRecalcularAtivo_`, `adminGerarQr_`, `adminCriarDemo_`.

### 05_Motor_Operador.js — 41

`cmmsMotorRecalcular_`, `shouldGenerate_`, `getPlanoControle_`, `updatePlanoControleAfterGenerate_`, `refreshPlanoControleStatus_`, `findOpenActionForPlan_`, `createOs_`, `createAction_`, `ensureDefaultPlanoItem_`, `acaoDisponivelInicioQr119_`, `operadorHistoricoQr119_`, `operadorContextoQr_`, `resolveQr_`, `isValidAtivo_`, `isValidComponent_`, `enrichAction_`, `requireOperadorAuth1081_`, `requireExecucaoDoOperador1081_`, `latestExecucaoAcao1081_`, `patchRowFast118_`, `appendRowsFast118_`, `checklistExecucaoResumo118_`, `validarChecklistParaInicio119_`, `operadorIniciarAcao_`, `operadorEstadoAcao118_`, `keepZero_`, `criarChecklistExec_`, `operadorSalvarChecklistItem_`, `normalizaResultadoOperacional120_`, `resultadoOperacionalDaObservacao120_`, `observacaoComResultadoOperacional120_`, `observacaoFinalInformada120_`, `itemExigeJustificativa120_`, `validarFinalizacaoOperacional120_`, `operadorFinalizarAcao_`, `validateChecklist_`, `operadorRegistrarEvidencia_`, `operadorRegistrarMaterial_`, `operadorRegistrarParametro_`, `calcularSaudeAtivoCMMS_`, `saudeAtivo_`.

### 06_Gestor_Locks_KPI.js — 23

`gestorListarAcoes_`, `enrichGestorAction_`, `gestorEvidencePublic_`, `gestorDetalheAcao_`, `gestorValidarAcao_`, `syncOsStatus_`, `gestorConfigurarSessoes_`, `gestorAdicionarColaborador_`, `gestorLiberarLocks_`, `lockStatus_`, `lockAdquirir_`, `lockHeartbeat_`, `lockLiberar_`, `activeLocks_`, `expireLocks_`, `releaseLocksForAction_`, `maxSessions_`, `telemetriaIniciar_`, `telemetriaEvento_`, `telemetriaFinalizar_`, `telemetry_`, `cmmsKpisBase_`, `cmmsDiagnostico_`.

### 07_Higiene_Performance.js — 8

`cmmsHigieneDiagnosticar_`, `cmmsHigienizarStatus_`, `cmmsHigienizarDuplicidades_`, `cmmsHigienizarBase_`, `currentValueForPlan_`, `isValidPlan_`, `issue_`, `countBy_`.

### 08_Performance_Fast.js — 14

`adminResumoCache_`, `operadorContextoQrFast_`, `resolveQrFast_`, `getQrIndex_`, `componentesCountByAtivo_`, `openActionsForContextFast_`, `fastNeedsMotorForContext_`, `saudeAtivoFast_`, `assetLean_`, `componentLean_`, `actionLean_`, `gestorDetalheAcaoFast_`, `perfCacheStatus_`, `perfCacheClear_`.

### 09_Warmup_AuthFast.js — 5

`authCacheKey_`, `cacheAuthSession_`, `getCachedAuthSession_`, `ensurePermission_`, `sistemaWarmup_`.

### 10_Checklist_Dinamico_Workflow.js — 20

`cmmsSchemaUpgrade_`, `normalizaTipoChecklist_`, `normalizaOpcoesJson_`, `parseOpcoes_`, `isPlanoOperacional_`, `adminSalvarModeloChecklist_`, `adminEnviarModeloChecklistValidacao_`, `validarModeloChecklistEstrutura_`, `listarModelosChecklistBase_`, `gestorListarModelosChecklist_`, `gestorModelosEmValidacao_`, `adminListarModelosChecklist_`, `adminModelosDevolvidos_`, `adminCorrigirModeloChecklist_`, `detalheModeloChecklist_`, `gestorValidarModeloChecklist_`, `operadorListarChecklistExecucao_`, `enrichChecklistExecItem_`, `validarRespostaChecklistItem_`, `validateGestorAcaoBeforeApproval_`.

### 11_Revisao_Modelo_Checklist.js — 9

`modeloBaseId_`, `revisoesRelacionadasModelo_`, `proximaRevisaoModelo_`, `novoPlanoIdRevisao_`, `revisaoAbertaParaModelo_`, `cloneItensPlanoParaRevisao_`, `adminCriarRevisaoModeloChecklist_`, `migrarPlanoControleParaRevisao_`, `aplicarSubstituicaoRevisaoAprovada_`.

### 12_Checklist_Catalogo_Tecnico.js — 45

`cmms107_dispatch_`, `cmmsCatalogoChecklistSchemaUpgrade107_`, `adminListarTiposItemChecklist107_`, `adminListarRegrasChecklist107_`, `adminValidarCatalogoItemChecklist107_`, `adminSalvarItemModeloChecklist107_`, `adminRemoverItemModeloChecklist107_`, `adminReordenarItensModeloChecklist107_`, `adminClonarItemModeloChecklist107_`, `adminListarItensModeloChecklist107_`, `adminDetalharModeloChecklistCatalogo107_`, `operadorValidarRespostaChecklistItem107_`, `CMMS107_validateRespostaChecklist_`, `CMMS107_validarModeloCompleto_`, `CMMS107_validarItemModelo_`, `CMMS107_normalizarItemInput_`, `CMMS107_enriquecerItem_`, `CMMS107_seedCatalogo_`, `CMMS107_modeloEditavel_`, `CMMS107_assertModeloEditavel_`, `CMMS107_audit_`, `CMMS107_hasEvidenceReference_`, `CMMS107_hasEvidenceInSheet_`, `CMMS107_ss_`, `CMMS107_ensureSheet_`, `CMMS107_headers_`, `CMMS107_readObjects_`, `CMMS107_getById_`, `CMMS107_appendObject_`, `CMMS107_upsertObject_`, `CMMS107_required_`, `CMMS107_requirePerfil_`, `CMMS107_perfil_`, `CMMS107_userId_`, `CMMS107_throw_`, `CMMS107_now_`, `CMMS107_uuid_`, `CMMS107_slug_`, `CMMS107_makeItemId_`, `CMMS107_simNao_`, `CMMS107_boolSim_`, `CMMS107_numOrNull_`, `CMMS107_firstNonEmpty_`, `CMMS107_parseOptions_`, `CMMS107_stringifyOptions_`.

### 13_Execucao_Checklist_Operador.js — 9

`cmmsExecucaoChecklistSchemaUpgrade108_`, `adminGerarAcaoTesteChecklist108_`, `operadorDetalharChecklistExecucao108_`, `operadorValidarFinalizacaoAcao108_`, `CMMS108_resolveExecutionIds_`, `CMMS108_itensExecucaoDetalhados_`, `CMMS108_validateChecklistExecution_`, `CMMS108_itemRespondido_`, `CMMS108_itemResumo_`.

### 14_Auditoria_Operador.js — 2

`cmmsAuditoriaOperadorSchemaUpgrade1081_`, `adminCorrigirAuditoriaExecucaoOperador1081_`.

### 15_Execucao_Checklist_UI.js — 15

`cmmsExecucaoChecklistSchemaUpgrade1083_`, `operadorDetalharChecklistExecucao1083_`, `operadorValidarFinalizacaoAcao1083_`, `gestorAuditoriaExecucaoChecklist1083_`, `gestorValidarAcao1083_`, `CMMS1083_validateChecklistExecution_`, `CMMS1083_buildChecklistBlockMessage_`, `CMMS1083_resolveExecucaoContext_`, `CMMS1083_requireReadAccess_`, `CMMS1083_itemsByExecucao_`, `CMMS1083_itemRespondido_`, `CMMS1083_itemExigeEvidencia_`, `CMMS1083_pendenciaItem_`, `CMMS1083_buildChecklistPayload_`, `CMMS1083_cleanChecklistItem_`.

### 16_Operador_UI_Batch.js — 17

`cmmsOperadorUiSchemaUpgrade109_`, `operadorMinhasAcoes109_`, `operadorTelaAcao109_`, `operadorSalvarChecklistLote109_`, `CMMS109_buildActionCard_`, `CMMS109_actionContext_`, `CMMS109_uiState_`, `CMMS109_nextActions_`, `CMMS109_prioridadePeso_`, `CMMS109_cleanAcao_`, `CMMS109_cleanOs_`, `CMMS109_cleanAtivo_`, `CMMS109_cleanComponente_`, `CMMS109_cleanPlano_`, `CMMS109_cleanExecucao_`, `CMMS109_cleanPlanoItem_`, `CMMS109_normErr_`.

### 17_Consolidacao_Operacional_UI.js — 23

`cmmsOperacionalUiSchemaUpgrade110_`, `operadorMinhasAcoes110_`, `operadorTelaAcao110_`, `operadorDetalharChecklistExecucao110_`, `operadorValidarFinalizacaoAcao110_`, `operadorSalvarChecklistLote110_`, `gestorAuditoriaExecucaoChecklist110_`, `CMMS110_buildActionCard_`, `CMMS110_technicalBrief_`, `CMMS110_buildActionScreen_`, `CMMS110_buildChecklistExecucao_`, `CMMS110_cleanChecklistItem_`, `CMMS110_cleanModeloItem_`, `CMMS110_inputSchema_`, `CMMS110_resolveBatchContext_`, `CMMS110_buildChecklistMaps_`, `CMMS110_resolveChecklistExecucaoId_`, `CMMS110_checklistIdBelongsToExec_`, `CMMS110_modelItemsForPlan_`, `CMMS110_compactFinalizacao_`, `CMMS110_uiState_`, `CMMS110_nextActions_`, `CMMS110_prioridadePeso_`.

### 18_Contrato_Frontend_UI.js — 23

`cmmsContratoFrontendSchemaUpgrade111_`, `operadorMinhasAcoes111_`, `operadorTelaAcao111_`, `operadorDetalharChecklistExecucao111_`, `operadorSalvarChecklistLote111_`, `operadorValidarFinalizacaoAcao111_`, `gestorAuditoriaExecucaoChecklist111_`, `CMMS111_actionScreen_`, `CMMS111_actionCard_`, `CMMS111_headerFromBase_`, `CMMS111_uiActions_`, `CMMS111_badgeFromState_`, `CMMS111_progressFromFinalizacao_`, `CMMS111_blockersFromFinalizacao_`, `CMMS111_blocker_`, `CMMS111_checklistRows_`, `CMMS111_evidenceRows_`, `CMMS111_historyRows_`, `CMMS111_decisionContract_`, `CMMS111_savedItem_`, `CMMS111_errorItem_`, `CMMS111_nextAfterSave_`, `CMMS111_join_`.

### 19_Tela_Operador_Visual_Final.js — 46

`cmmsOperadorTelaRealSchemaUpgrade112_`, `operadorHome112_`, `operadorMinhasAcoes112_`, `operadorTelaAcao112_`, `operadorDetalharChecklistExecucao112_`, `operadorSalvarChecklistLote112_`, `operadorValidarFinalizacaoAcao112_`, `gestorAuditoriaExecucaoChecklist112_`, `CMMS112_wrapActionScreen_`, `CMMS112B_normalizeLegacyContract_`, `CMMS112B_summaryMessage_`, `CMMS112B_joinClauses_`, `CMMS112_operatorScreen_`, `CMMS112_richChecklistRows_`, `CMMS112_options_`, `CMMS112_issueBuckets_`, `CMMS112_dedupeIssues_`, `CMMS112_visualCard_`, `CMMS112_screenHeader_`, `CMMS112_assetCard_`, `CMMS112_actionBar_`, `CMMS112_stickyFooter_`, `CMMS112_finalizationReason_`, `CMMS112_groupChecklistBlocks_`, `CMMS112_visualChecklistItem_`, `CMMS112_rangeLabel_`, `CMMS112_evidenceGallery_`, `CMMS112_messages_`, `CMMS112_payloadHints_`, `CMMS112_homeResumo_`, `CMMS112_tabs_`, `CMMS112_progress_`, `CMMS112_count_`, `CMMS112_typeMeta_`, `CMMS112_button_`, `CMMS112_firstEnabledButton_`, `CMMS112_primaryCardAction_`, `CMMS112_secondaryCardActions_`, `CMMS112_responseValue_`, `CMMS112_itemTone_`, `CMMS112_itemStateLabel_`, `CMMS112_priorityLabel_`, `CMMS112_priorityTone_`, `CMMS112_hasValue_`, `CMMS112_value_`, `CMMS112_join_`.

### 20_Paradas_Equipamento.js — 22

`ensureParadasOperacionaisSchema114_`, `backfillModoParadaManutencao115_`, `cmmsParadasOperacionaisSchemaUpgrade114_`, `paradaToleranciaMin114_`, `paradaStatusAberto114_`, `paradaAtivaPorAtivo114_`, `paradaAtivaPorAcao114_`, `secondsBetween114_`, `paradaMetricas114_`, `paradaSerializada114_`, `histFast119_`, `validarAtivoComponente114_`, `atualizarStatusAtivo114_`, `criarParada114_`, `operadorParadaAtiva114_`, `operadorIniciarParada114_`, `operadorFinalizarParada114_`, `operadorRegistrarOcorrencia114_`, `paradaVincularInicioManutencao114_`, `paradaRegistrarFimManutencao114_`, `gestorListarParadas114_`, `gestorListarOcorrencias114_`.

### 21_Paradas_Manutencao.js — 9

`normalizaModoParadaManutencao115_`, `modoParadaAcao115_`, `normalizaDecisaoParada115_`, `resolverDecisaoInicioManutencao115_`, `paradaManutencaoAtivaPorAcao115_`, `paradaManutencaoAtivaPorAtivo115_`, `paradaManutencaoSerializada115_`, `iniciarCondicaoManutencao115_`, `finalizarCondicaoManutencao115_`.

### 22_Horimetro_Evidencias.js — 21

`ensureHorimetroEvidenciasSchema116_`, `cmmsHorimetroEvidenciasSchemaUpgrade116_`, `normalizaTextoTecnico116_`, `itemEhHorimetro116_`, `horimetroModo116_`, `horimetroResumo116_`, `validarValorHorimetro116_`, `atualizarHorimetroAtivo116_`, `registrarParametroHorimetro116_`, `adminRegistrarHorimetroTelemetria116_`, `adminReiniciarContadorServico116_`, `sincronizarHorimetroChecklist116_`, `evidenciaMinFotos116_`, `evidenciaFotoMaxBytes116_`, `pastaEvidencias116_`, `nomeArquivoSeguro116_`, `autorizarDriveEvidencias117_`, `testarAutorizacaoDrive117`, `adminVerificarDriveEvidencias117_`, `quantidadeEvidenciasRegistradas117_`, `operadorUploadEvidenciaFoto116_`.

### 23_Fila_Operador_Performance.js — 2

`operadorMinhasAcoes117_`, `sincronizarMotorFilaOperador117_`.

### 24_Production_Bootstrap.js — 25

`getConfiguredSpreadsheetStrict_`, `productionTrimmedHeader_`, `productionRowsDirect_`, `productionConfigValueFromSpreadsheet_`, `productionSpreadsheetDateMatchesVersion_`, `productionSheetHasAnyValue_`, `productionWithBootstrapLock_`, `productionAllowedBootstrapConfigKeys_`, `assertSpreadsheetEmptyForProductionBootstrap_`, `removeEmptyNonSchemaSheets_`, `productionUpsertConfig_`, `setupProductionSchema`, `productionAdminConfig_`, `validateProductionAdminConfig_`, `assertProductionSchemaReadyForAdmin_`, `productionAdminRowReady_`, `productionAdminIdentityMatches_`, `productionAdminAuditExists_`, `productionEnsureAdminAudit_`, `productionClearTemporaryAdminPassword_`, `productionFinalizeAdminBootstrap_`, `productionAdminSummary_`, `bootstrapProductionAdmin`, `productionSyntheticRowCount_`, `diagnoseProductionReadiness`.

### 25_Workflow_Tecnico_KPI.js — 72

`technicalEnsureSchema_`, `technicalLooksMojibake_`, `cmmsWorkflowTecnicoSchemaUpgrade_`, `technicalSeedCatalog_`, `technicalRequireAdmin_`, `technicalRequireManager_`, `gestorRegistrarParametro_`, `technicalNullableNumber_`, `technicalParameterStatus_`, `technicalManagerParameterSummaries_`, `technicalManagerAssetHistory_`, `gestorDossieAtivo_`, `gestorSolicitarAcaoParametro_`, `technicalIdentity_`, `technicalJsonArray_`, `technicalSerializeArray_`, `technicalObject_`, `technicalTextList_`, `technicalNormalizeBrief_`, `technicalSerializeBrief_`, `technicalActiveArea_`, `technicalActiveRole_`, `technicalAreaByCode_`, `technicalNormalizeSignaturePolicy_`, `technicalResolveValidationPolicy_`, `technicalDemandValidatorAreaIds_`, `technicalDemandValidatorUserIds_`, `technicalSignaturesForDemand_`, `technicalSignatureProgress_`, `technicalCanValidateDemand_`, `technicalAssertValidationIdentity_`, `technicalMigrateValidationPolicies_`, `adminAreasTecnicasListar_`, `adminAreasTecnicasSalvar_`, `adminCargosTecnicosListar_`, `adminCargosTecnicosSalvar_`, `technicalSlaPolicy_`, `technicalAddMinutesIso_`, `technicalDemandHash_`, `technicalNotify_`, `technicalCloseDemandNotifications_`, `technicalAppendTransition_`, `adminDemandasTecnicasEnviar_`, `technicalDemandAccessible_`, `technicalRequireDemand_`, `technicalAssertDemandOpen_`, `technicalDemandPublic_`, `technicalListDemands_`, `adminDemandasTecnicasListar_`, `gestorDemandasListar_`, `gestorContextoTecnico_`, `gestorDemandaDetalhe_`, `gestorDemandaAssumir_`, `gestorDemandaEncaminhar_`, `gestorDemandaAssinar_`, `gestorDemandaValidar_`, `technicalApplyApprovedEntity_`, `technicalApplyReturnedEntity_`, `technicalAttachBriefToDemandEntity_`, `gestorDemandaDecidir_`, `gestorAnaliseSalvar_`, `gestorParadaCriarTratamento_`, `gestorAnaliseEnviarAdmin_`, `adminAnalisesTecnicasListar_`, `adminAnaliseConverterChecklist_`, `gestorNotificacoesListar_`, `gestorNotificacaoMarcarLida_`, `technicalSecondsBetween_`, `technicalClamp_`, `technicalAverage_`, `technicalAggregateKpis_`, `cmmsKpisTecnicos_`.

### 26_Motor_Configuracao.js — 21

`configurationRequireAdmin_`, `configurationEnsureSchema_`, `configurationCatalogMap_`, `configurationDefaults_`, `configurationLegacySnapshot_`, `configurationParseJson_`, `configurationNormalizeValue_`, `configurationValidateSnapshot_`, `configurationRuntimeEnvelope_`, `configurationRuntimeValue_`, `configurationDraftForUser_`, `configurationPublicVersion_`, `configurationState_`, `configurationSaveDraft_`, `configurationValidate_`, `configurationNextVersionNumber_`, `configurationPublishSnapshot_`, `configurationPublish_`, `configurationVersions_`, `configurationRollback_`, `cmmsConfiguracaoSchemaUpgrade_`.

### 27_Admin_Importacao.js — 27

`adminImportRequireAdmin_`, `adminImportEnsureSchema_`, `cmmsImportacaoAdminSchemaUpgrade_`, `adminImportHeader_`, `adminImportFieldMap_`, `adminImportPublicModel_`, `adminImportacaoModelos_`, `adminImportPrimitive_`, `adminImportIsBlankRow_`, `adminImportMapRow_`, `adminImportResolveId_`, `adminImportResolveReferences_`, `adminImportAssertReference_`, `adminImportProtectWorkflow_`, `adminImportError_`, `adminImportComparable_`, `adminImportRowHash_`, `adminImportacaoValidar_`, `adminImportPublicRecord_`, `adminImportPublicBatch_`, `adminImportBatchRecords_`, `adminImportacaoDetalhe_`, `adminImportacaoLotes_`, `adminImportRollbackApplied_`, `adminImportacaoConfirmar_`, `adminImportAssertDeleteSafe_`, `adminImportacaoRollback_`.

### 28_Admin_Intervencoes.js — 11

`adminIntervencaoEnsureSchema_`, `adminIntervencaoRequireExecutablePlan_`, `adminIntervencaoAssertEditable_`, `adminIntervencaoNormalize_`, `adminIntervencoesListar_`, `adminIntervencaoSalvar_`, `adminIntervencaoEnviarValidacao_`, `adminIntervencaoCriarDaOcorrenciaAprovada_`, `adminIntervencaoLiberarOperacao_`, `adminIntervencaoQuarentenarAcoesInvalidas_`, `adminIntervencaoDevolver_`.

### 29_Admin_Governanca.js — 25

`adminGovernanceEnsureSchema_`, `adminManagedFolder_`, `adminDocumentFolder_`, `adminBackupFolder_`, `adminDocumentValidateLink_`, `adminDocumentNormalizeMetadata_`, `adminDocumentPublic_`, `adminDocumentosListar_`, `adminDocumentoDetalhe_`, `adminDocumentoDecodeFile_`, `adminDocumentoUpload_`, `adminDocumentoAtualizar_`, `adminGovernanceRedact_`, `adminGovernanceSafeJson_`, `adminAuditoriaListar_`, `adminMonitoramentoEstado_`, `adminBackupsListar_`, `adminBackupCreateCopy_`, `adminBackupCriar_`, `adminBackupFindManaged_`, `adminBackupRestorePreview_`, `adminBackupPrepararRestauracao_`, `adminBackupRestoreSheetValues_`, `adminBackupRestoreOperational_`, `adminBackupConfirmarRestauracao_`.

### 30_Motor_Acesso_Comercial.js — 16

`motorEffectivePlanCatalogState_`, `motorUniqueKnownFeatures_`, `motorHmac_`, `motorReadSignedProperty_`, `motorConfiguredTenantId_`, `motorLegacySubscription_`, `motorBlockedSubscription_`, `motorSubscriptionState_`, `motorFeatureForAction_`, `motorAuthorizeAction_`, `motorEnvironment_`, `motorMaintenanceState_`, `motorCommercialAccessContext_`, `motorCommercialAccessState_`, `motorPlatformCatalogState_`, `motorRequireMaintenanceAccess_`.

### 31_Motor_Acesso_Interno.js — 11

`motorInternalIdentityState_`, `motorInternalMaintenanceState_`, `motorInternalMaintenancePublicState_`, `motorInternalChallengeHash_`, `motorInternalLoginGuard_`, `motorInternalAssertLoginAvailable_`, `motorInternalRegisterInvalidLogin_`, `motorInternalResetLoginGuard_`, `motorInternalCreateSession_`, `motorInternalMaintenanceExchange_`, `motorInternalAuthorizeSession_`.

### 32_Canary_Maintenance.js — 4

`maintenanceResetCanaryAdminAccess`, `maintenanceOpenCanaryMotorWindow`, `maintenanceRandomSecret_`, `maintenanceSignedEnvelope_`.

### 32_Motor_Catalogo_Comercial.js — 24

`motorCatalogRequireInternal_`, `motorCatalogSecret_`, `motorCatalogRequireSecret_`, `motorCatalogPropertyBytes_`, `motorCatalogSignedEnvelope_`, `motorCatalogWriteSignedProperty_`, `motorCatalogRestoreProperty_`, `motorCatalogPlanCodes_`, `motorCatalogDefaultPlans_`, `motorCatalogMapFromPlans_`, `motorCatalogValidateSnapshot_`, `motorCatalogInvalidRuntime_`, `motorCommercialCatalogRuntime_`, `motorCatalogReadDraft_`, `motorCatalogReadIndex_`, `motorCatalogReadVersion_`, `motorCommercialCatalogControlState_`, `motorCommercialCatalogValidate_`, `motorCommercialCatalogDraftSave_`, `motorCatalogNextVersionNumber_`, `motorCatalogPublishUnderLock_`, `motorCommercialCatalogPublish_`, `motorCommercialCatalogVersions_`, `motorCommercialCatalogRollback_`.

## Rotas atuais

O protocolo atual usa uma ação textual dentro de uma única entrada HTTP. Na migração, cada ação deve ganhar um endpoint REST ou comando de aplicação equivalente, mantendo autorização e semântica.

### Sistema, schema e autenticação

| Ação | Handler |
|---|---|
| `sistema.health` | `sistemaHealth_` |
| `sistema.bootstrap` | `sistemaBootstrap_` |
| `sistema.warmup` | `sistemaWarmup_` |
| `cmms.operador_visual_schema_upgrade` | `cmmsOperadorTelaRealSchemaUpgrade112_` |
| `cmms.tela_operador_schema_upgrade` | `cmmsOperadorTelaRealSchemaUpgrade112_` |
| `cmms.operador_ui_schema_upgrade` | `cmmsOperadorTelaRealSchemaUpgrade112_` |
| `cmms.operacional_ui_schema_upgrade` | `cmmsOperadorTelaRealSchemaUpgrade112_` |
| `cmms.contrato_frontend_schema_upgrade` | `cmmsOperadorTelaRealSchemaUpgrade112_` |
| `cmms.frontend_contract_schema_upgrade` | `cmmsOperadorTelaRealSchemaUpgrade112_` |
| `cmms.execucao_checklist_schema_upgrade` | `cmmsExecucaoChecklistSchemaUpgrade1083_` |
| `cmms.auditoria_operador_schema_upgrade` | `cmmsAuditoriaOperadorSchemaUpgrade1081_` |
| `cmms.paradas_operacionais_schema_upgrade` | `cmmsParadasOperacionaisSchemaUpgrade114_` |
| `cmms.horimetro_evidencias_schema_upgrade` | `cmmsHorimetroEvidenciasSchemaUpgrade116_` |
| `cmms.workflow_tecnico_schema_upgrade` | `cmmsWorkflowTecnicoSchemaUpgrade_` |
| `cmms.configuracao_schema_upgrade` | `cmmsConfiguracaoSchemaUpgrade_` |
| `cmms.importacao_admin_schema_upgrade` | `cmmsImportacaoAdminSchemaUpgrade_` |
| `auth.login` | `authLogin_` |
| `auth.first_access.complete` | `authCompleteFirstAccess_` |
| `auth.recovery.request` | `authRecoveryRequest_` |
| `auth.maintenance.exchange` | `motorInternalMaintenanceExchange_` |
| `auth.logout` | `authLogout_` |

### Administração, motor e governança

| Ação | Handler |
|---|---|
| `admin.resumo` | `adminResumo_` |
| `admin.resumo_cache` | `adminResumoCache_` |
| `admin.listar` | `adminListar_` |
| `admin.obter` | `adminObter_` |
| `admin.salvar` | `adminSalvarSeguro_` |
| `admin.entidade.acao` | `adminEntityAction_` |
| `admin.usuarios.listar` | `adminUsuariosListar_` |
| `admin.usuarios.salvar` | `adminUsuariosSalvar_` |
| `admin.usuarios.desbloquear` | `adminUsuariosDesbloquear_` |
| `admin.usuarios.redefinir_senha` | `adminUsuariosRedefinirSenha_` |
| `admin.usuarios.revogar_sessoes` | `adminUsuariosRevogarSessoes_` |
| `admin.permissoes.obter` | `adminPermissoesObter_` |
| `admin.permissoes.salvar` | `adminPermissoesSalvar_` |
| `admin.empresa.obter` | `adminEmpresaObter_` |
| `admin.empresa.salvar` | `adminEmpresaSalvar_` |
| `admin.acesso.estado` | `motorCommercialAccessState_` |
| `platform.motor.catalogo` | `motorPlatformCatalogState_` |
| `platform.motor.catalogo.rascunho.salvar` | `motorCommercialCatalogDraftSave_` |
| `platform.motor.catalogo.validar` | `motorCommercialCatalogValidate_` |
| `platform.motor.catalogo.publicar` | `motorCommercialCatalogPublish_` |
| `platform.motor.catalogo.versoes` | `motorCommercialCatalogVersions_` |
| `platform.motor.catalogo.rollback` | `motorCommercialCatalogRollback_` |
| `admin.configuracao.estado` | `configurationState_` |
| `admin.configuracao.rascunho.salvar` | `configurationSaveDraft_` |
| `admin.configuracao.validar` | `configurationValidate_` |
| `admin.configuracao.publicar` | `configurationPublish_` |
| `admin.configuracao.versoes` | `configurationVersions_` |
| `admin.configuracao.rollback` | `configurationRollback_` |
| `admin.importacao.modelos` | `adminImportacaoModelos_` |
| `admin.importacao.validar` | `adminImportacaoValidar_` |
| `admin.importacao.confirmar` | `adminImportacaoConfirmar_` |
| `admin.importacao.lotes` | `adminImportacaoLotes_` |
| `admin.importacao.detalhe` | `adminImportacaoDetalhe_` |
| `admin.importacao.rollback` | `adminImportacaoRollback_` |
| `admin.areas_tecnicas.listar` | `adminAreasTecnicasListar_` |
| `admin.areas_tecnicas.salvar` | `adminAreasTecnicasSalvar_` |
| `admin.cargos_tecnicos.listar` | `adminCargosTecnicosListar_` |
| `admin.cargos_tecnicos.salvar` | `adminCargosTecnicosSalvar_` |
| `admin.demandas_tecnicas.enviar` | `adminDemandasTecnicasEnviar_` |
| `admin.demandas_tecnicas.listar` | `adminDemandasTecnicasListar_` |
| `admin.analises_tecnicas.listar` | `adminAnalisesTecnicasListar_` |
| `admin.analises_tecnicas.converter` | `adminAnaliseConverterChecklist_` |
| `admin.intervencoes.listar` | `adminIntervencoesListar_` |
| `admin.intervencoes.salvar` | `adminIntervencaoSalvar_` |
| `admin.intervencoes.enviar_validacao` | `adminIntervencaoEnviarValidacao_` |
| `admin.documentos.listar` | `adminDocumentosListar_` |
| `admin.documentos.detalhe` | `adminDocumentoDetalhe_` |
| `admin.documentos.upload` | `adminDocumentoUpload_` |
| `admin.documentos.atualizar` | `adminDocumentoAtualizar_` |
| `admin.auditoria.listar` | `adminAuditoriaListar_` |
| `admin.monitoramento.estado` | `adminMonitoramentoEstado_` |
| `admin.backups.listar` | `adminBackupsListar_` |
| `admin.backups.criar` | `adminBackupCriar_` |
| `admin.backups.preparar_restauracao` | `adminBackupPrepararRestauracao_` |
| `admin.backups.confirmar_restauracao` | `adminBackupConfirmarRestauracao_` |
| `admin.gerar_qr` | `adminGerarQr_` |
| `admin.criar_demo` | `adminCriarDemo_` |
| `admin.recalcular_ativo` | `adminRecalcularAtivo_` |
| `admin.salvar_modelo_checklist` | `adminSalvarModeloChecklist_` |
| `admin.enviar_modelo_checklist_validacao` | `adminEnviarModeloChecklistValidacao_` |
| `admin.detalhe_modelo_checklist` | `detalheModeloChecklist_` |
| `admin.listar_modelos_checklist` | `adminListarModelosChecklist_` |
| `admin.modelos_devolvidos` | `adminModelosDevolvidos_` |
| `admin.corrigir_modelo_checklist` | `adminCorrigirModeloChecklist_` |
| `admin.criar_revisao_modelo_checklist` | `adminCriarRevisaoModeloChecklist_` |
| `admin.gerar_acao_teste_checklist` | `adminGerarAcaoTesteChecklist108_` |
| `admin.corrigir_auditoria_execucao_operador` | `adminCorrigirAuditoriaExecucaoOperador1081_` |
| `admin.registrar_horimetro_telemetria` | `adminRegistrarHorimetroTelemetria116_` |
| `admin.reiniciar_contador_servico` | `adminReiniciarContadorServico116_` |
| `admin.verificar_drive_evidencias` | `adminVerificarDriveEvidencias117_` |

### Operador

| Ação | Handler |
|---|---|
| `operador.contexto_qr` | `operadorContextoQr_` |
| `operador.contexto_qr_fast` | `operadorContextoQrFast_` |
| `operador.historico_qr` | `operadorHistoricoQr119_` |
| `operador.iniciar_acao` | `operadorIniciarAcao_` |
| `operador.estado_acao` | `operadorEstadoAcao118_` |
| `operador.salvar_checklist_item` | `operadorSalvarChecklistItem_` |
| `operador.finalizar_acao` | `operadorFinalizarAcao_` |
| `operador.registrar_evidencia` | `operadorRegistrarEvidencia_` |
| `operador.upload_evidencia_foto` | `operadorUploadEvidenciaFoto116_` |
| `operador.registrar_material` | `operadorRegistrarMaterial_` |
| `operador.registrar_parametro` | `operadorRegistrarParametro_` |
| `operador.parada_ativa` | `operadorParadaAtiva114_` |
| `operador.iniciar_parada` | `operadorIniciarParada114_` |
| `operador.finalizar_parada` | `operadorFinalizarParada114_` |
| `operador.registrar_ocorrencia` | `operadorRegistrarOcorrencia114_` |
| `operador.listar_checklist_execucao` | `operadorListarChecklistExecucao_` |
| `operador.home` | `operadorHome112_` |
| `operador.painel` | `operadorHome112_` |
| `operador.minhas_acoes` | `operadorMinhasAcoes117_` |
| `operador.tela_acao` | `operadorTelaAcao112_` |
| `operador.salvar_checklist_lote` | `operadorSalvarChecklistLote112_` |
| `operador.detalhar_checklist_execucao` | `operadorDetalharChecklistExecucao112_` |
| `operador.validar_finalizacao_acao` | `operadorValidarFinalizacaoAcao112_` |
| `operador.validar_resposta_checklist_item` | `operadorValidarRespostaChecklistItem107_` |

### Gestor

| Ação | Handler |
|---|---|
| `gestor.listar_paradas` | `gestorListarParadas114_` |
| `gestor.listar_ocorrencias` | `gestorListarOcorrencias114_` |
| `gestor.listar_acoes` | `gestorListarAcoes_` |
| `gestor.detalhe_acao` | `gestorDetalheAcao_` |
| `gestor.detalhe_acao_fast` | `gestorDetalheAcaoFast_` |
| `gestor.auditoria_execucao_checklist` | `gestorAuditoriaExecucaoChecklist112_` |
| `gestor.validar_acao` | `gestorValidarAcao1083_` |
| `gestor.configurar_sessoes` | `gestorConfigurarSessoes_` |
| `gestor.adicionar_colaborador` | `gestorAdicionarColaborador_` |
| `gestor.liberar_locks` | `gestorLiberarLocks_` |
| `gestor.modelos_em_validacao` | `gestorModelosEmValidacao_` |
| `gestor.listar_modelos_checklist` | `gestorListarModelosChecklist_` |
| `gestor.detalhe_modelo_checklist` | `detalheModeloChecklist_` |
| `gestor.validar_modelo_checklist` | `gestorValidarModeloChecklist_` |
| `gestor.contexto_tecnico` | `gestorContextoTecnico_` |
| `gestor.demandas.listar` | `gestorDemandasListar_` |
| `gestor.demandas.detalhe` | `gestorDemandaDetalhe_` |
| `gestor.demandas.assumir` | `gestorDemandaAssumir_` |
| `gestor.demandas.encaminhar` | `gestorDemandaEncaminhar_` |
| `gestor.demandas.assinar` | `gestorDemandaAssinar_` |
| `gestor.demandas.validar` | `gestorDemandaValidar_` |
| `gestor.demandas.decidir` | `gestorDemandaDecidir_` |
| `gestor.paradas.criar_tratamento` | `gestorParadaCriarTratamento_` |
| `gestor.analises.salvar` | `gestorAnaliseSalvar_` |
| `gestor.analises.enviar_admin` | `gestorAnaliseEnviarAdmin_` |
| `gestor.registrar_parametro` | `gestorRegistrarParametro_` |
| `gestor.dossie_ativo` | `gestorDossieAtivo_` |
| `gestor.parametros.solicitar_acao` | `gestorSolicitarAcaoParametro_` |
| `gestor.notificacoes.listar` | `gestorNotificacoesListar_` |
| `gestor.notificacoes.marcar_lida` | `gestorNotificacaoMarcarLida_` |

### Catálogo, locks, métricas e telemetria

| Ação | Handler |
|---|---|
| `lock.status` | `lockStatus_` |
| `lock.adquirir` | `lockAdquirir_` |
| `lock.heartbeat` | `lockHeartbeat_` |
| `lock.liberar` | `lockLiberar_` |
| `catalogo.checklist_tipos` | `adminListarTiposItemChecklist107_` |
| `admin.listar_tipos_item_checklist` | `adminListarTiposItemChecklist107_` |
| `admin.listar_regras_checklist` | `adminListarRegrasChecklist107_` |
| `admin.validar_catalogo_item_checklist` | `adminValidarCatalogoItemChecklist107_` |
| `admin.salvar_item_modelo_checklist` | `adminSalvarItemModeloChecklist107_` |
| `admin.remover_item_modelo_checklist` | `adminRemoverItemModeloChecklist107_` |
| `admin.reordenar_itens_modelo_checklist` | `adminReordenarItensModeloChecklist107_` |
| `admin.clonar_item_modelo_checklist` | `adminClonarItemModeloChecklist107_` |
| `admin.listar_itens_modelo_checklist` | `adminListarItensModeloChecklist107_` |
| `admin.detalhar_modelo_checklist_catalogo` | `adminDetalharModeloChecklistCatalogo107_` |
| `cmms.catalogo_checklist_schema_upgrade` | `cmmsCatalogoChecklistSchemaUpgrade107_` |
| `cmms.schema_upgrade` | `cmmsSchemaUpgrade_` |
| `cmms.motor_recalcular` | `cmmsMotorRecalcular_` |
| `cmms.kpis_base` | `cmmsKpisBase_` |
| `cmms.kpis_tecnicos` | `cmmsKpisTecnicos_` |
| `perf.cache_status` | `perfCacheStatus_` |
| `perf.cache_clear` | `perfCacheClear_` |
| `cmms.diagnostico` | `cmmsDiagnostico_` |
| `cmms.higiene_diagnosticar` | `cmmsHigieneDiagnosticar_` |
| `cmms.higienizar_status` | `cmmsHigienizarStatus_` |
| `cmms.higienizar_duplicidades` | `cmmsHigienizarDuplicidades_` |
| `cmms.higienizar_base` | `cmmsHigienizarBase_` |
| `telemetria.iniciar` | `telemetriaIniciar_` |
| `telemetria.evento` | `telemetriaEvento_` |
| `telemetria.finalizar` | `telemetriaFinalizar_` |

## Rotas públicas sem sessão

O roteador trata como públicas:

- `sistema.health`;
- `sistema.bootstrap`;
- `auth.login`;
- `auth.first_access.complete`;
- `auth.recovery.request`;
- `auth.maintenance.exchange`;
- `auth.logout`.

As demais ações passam por autenticação, autorização de capacidades e, quando aplicável, plano comercial e janela interna de manutenção.

## Conversão sugerida para Node.js

As ações não devem ser copiadas como um `switch` único. O contrato equivalente deve ser separado por módulos:

- `/health` e `/bootstrap`;
- `/auth`;
- `/admin`;
- `/manager`;
- `/operator`;
- `/assets`;
- `/maintenance-plans`;
- `/work-orders`;
- `/executions`;
- `/checklists`;
- `/technical-workflow`;
- `/notifications`;
- `/documents`;
- `/imports`;
- `/configuration`;
- `/platform`;
- `/telemetry`.

Esta sugestão é apenas de organização. Os endpoints finais pertencem à Fase 3 e dependem do esquema aprovado na Fase 2.
