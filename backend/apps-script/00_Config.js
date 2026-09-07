const FAB_RELEASE_VERSION = "1.4.0";

const FAB = {
  APP_NAME: "FAB Control",
  VERSION: FAB_RELEASE_VERSION,
  RELEASE_VERSION: FAB_RELEASE_VERSION,
  API_VERSION: FAB_RELEASE_VERSION,
  SCHEMA_VERSION: FAB_RELEASE_VERSION,
  CONTRACT_VERSION: FAB_RELEASE_VERSION,
  FRONTEND_VERSION: FAB_RELEASE_VERSION,
  AUTH_LOGIN_MAX_ATTEMPTS: 5,
  AUTH_LOCK_MINUTES: 15,
  AUTH_FIRST_ACCESS_MINUTES: 15,
  AUTH_RECOVERY_COOLDOWN_MINUTES: 10,
  AUTH_PASSWORD_ITERATIONS: 1200,
  TZ: "America/Sao_Paulo",
  TOKEN_HOURS: 12,
  LOCK_TTL_SECONDS: 120,
  QR_CACHE_SECONDS: 90,
  AUTH_CACHE_SECONDS: 180,
  WARMUP_CACHE_SECONDS: 300,
  QR_FAST_CACHE_SECONDS: 30,
  QR_HISTORY_PAGE_SIZE: 4,
  QR_HISTORY_SCAN_BLOCK: 120,
  QR_HISTORY_MAX_SCAN_ROWS: 480,
  MOTOR_THRESHOLD_RATIO: 0.98
};

const PROP_SPREADSHEET_ID = "FAB_CONTROL_SPREADSHEET_ID";
const PROP_APP_ENVIRONMENT = "FAB_CONTROL_APP_ENVIRONMENT";

const ROLE = {
  ADMIN: "ADMIN",
  GESTOR: "GESTOR",
  OPERADOR: "OPERADOR",
  SISTEMA: "SISTEMA"
};

const ST = {
  ATIVO: "ATIVO",
  INATIVO: "INATIVO",
  OPERANDO: "OPERANDO",
  PARADO: "PARADO",
  PARADA_ABERTA: "PARADA_ABERTA",
  MANUTENCAO_EM_EXECUCAO: "MANUTENCAO_EM_EXECUCAO",
  AGUARDANDO_RETORNO_OPERACIONAL: "AGUARDANDO_RETORNO_OPERACIONAL",
  AGUARDANDO_ANALISE: "AGUARDANDO_ANALISE",
  ABERTA: "ABERTA",
  PENDENTE: "PENDENTE",
  EM_EXECUCAO: "EM_EXECUCAO",
  AGUARDANDO_VALIDACAO: "AGUARDANDO_VALIDACAO",
  CONCLUIDA: "CONCLUIDA",
  CANCELADA: "CANCELADA",
  BLOQUEADA: "BLOQUEADA",
  RASCUNHO: "RASCUNHO",
  EM_VALIDACAO_GESTAO: "EM_VALIDACAO_GESTAO",
  DEVOLVIDO_CORRECAO: "DEVOLVIDO_CORRECAO",
  VALIDADO: "VALIDADO",
  OBSOLETO: "OBSOLETO",
  RESPONDIDO: "RESPONDIDO",
  FINALIZADA: "FINALIZADA"
};

const SH = {
  config: ["chave", "valor", "descricao", "atualizado_em"],
  usuarios: ["id","nome","email","perfil","status","pin_hash","criado_em","atualizado_em","matricula","senha_hash","primeiro_acesso","tentativas_login","bloqueado_ate","ultimo_login_em","senha_atualizada_em","recuperacao_referencia","recuperacao_solicitada_em","area_id","cargo_id","especialidades_json","escopo_ids_json"],
  sessoes: ["token","usuario_id","perfil","status","criado_em","expira_em","ultimo_uso_em","user_agent","escopo","expira_ms","revogado_em","motivo_revogacao","janela_id","ambiente","tenant_id"],

  plantas: ["id", "tag", "nome", "status", "criado_em", "atualizado_em"],
  setores: ["id", "planta_id", "tag", "nome", "status", "criado_em", "atualizado_em"],
  linhas: ["id", "setor_id", "tag", "nome", "status", "criado_em", "atualizado_em"],

  ativos: ["id", "linha_id", "tag", "qr_payload", "nome", "tipo", "criticidade", "status", "saude_pct", "horimetro_atual", "fabricante", "modelo", "numero_serie", "localizacao_tecnica", "criado_em", "atualizado_em", "horimetro_modo", "horimetro_atualizado_em", "horimetro_base_servico", "horimetro_base_servico_em"],

  componentes: ["id", "ativo_id", "tag", "qr_payload", "nome", "tipo", "criticidade", "status", "vida_util_horas", "vida_util_dias", "horas_acumuladas", "instalado_em", "fabricante", "modelo", "numero_serie", "localizacao_tecnica", "criado_em", "atualizado_em"],

  materiais: ["id", "sku", "nome", "unidade", "estoque_atual", "estoque_minimo", "status", "criado_em", "atualizado_em"],

  planos_manutencao: ["id", "ativo_id", "componente_id", "nome", "tipo", "criticidade", "gatilho_tipo", "gatilho_valor", "unidade", "recorrencia_dias", "tempo_estimado_min", "requer_bloqueio", "requer_evidencia", "max_sessoes", "status", "ultimo_disparo_em", "criado_em", "atualizado_em", "workflow_status", "validado_gestao", "validado_por", "validado_em", "devolvido_por", "devolvido_em", "devolvido_motivo", "enviado_validacao_em", "revisao", "setor_id", "modelo_base_id", "revisao_origem_id", "substitui_plano_id", "substituido_por", "substituido_em", "modo_parada_manutencao", "analise_tecnica_json", "analise_origem_id", "ocorrencia_origem_id"],

  plano_itens: ["id", "plano_id", "ordem", "titulo", "instrucao", "tipo_resposta", "obrigatorio", "evidencia_obrigatoria", "foto_referencia_url", "limite_min", "limite_max", "unidade", "criado_em", "atualizado_em", "parametro_nome", "valor_esperado", "opcoes_json", "bloqueia_finalizacao", "categoria", "peso", "status", "validacao_regra", "evidencia_min_fotos"],

  plano_controle: ["plano_id", "ativo_id", "componente_id", "gatilho_tipo", "gatilho_valor", "ultimo_valor_processado", "proximo_valor_gatilho", "ultima_acao_id", "ultima_acao_status", "atualizado_em"],

  ordens_servico: ["id", "codigo", "ativo_id", "componente_id", "plano_id", "origem", "tipo", "titulo", "descricao", "prioridade", "status", "solicitante_id", "responsavel_id", "aberta_em", "planejada_para", "iniciada_em", "finalizada_em", "criado_em", "atualizado_em", "modo_parada_manutencao", "analise_tecnica_json"],

  os_acoes: ["id", "os_id", "ativo_id", "componente_id", "plano_id", "origem", "tipo", "titulo", "descricao", "prioridade", "status", "responsavel_id", "gerado_em", "iniciado_em", "finalizado_em", "atualizado_em", "modo_parada_manutencao", "analise_tecnica_json"],

  execucoes: ["id", "acao_id", "os_id", "ativo_id", "componente_id", "operador_id", "resultado", "observacao", "duracao_segundos", "abriu_em", "iniciou_em", "finalizou_em", "status", "criado_em", "atualizado_em", "modo_execucao_manutencao"],

  checklist_execucao: ["id", "execucao_id", "acao_id", "plano_item_id", "ordem", "titulo", "instrucao", "tipo_resposta", "obrigatorio", "resposta", "observacao", "evidencia_obrigatoria", "status", "responsavel_id", "data_hora", "criado_em", "atualizado_em", "parametro_nome", "valor_esperado", "opcoes_json", "limite_min", "limite_max", "unidade", "valor_numero", "conforme", "bloqueia_finalizacao", "validacao_msg", "evidencias_count", "categoria", "evidencia_min_fotos"],

  evidencias: ["id", "execucao_id", "acao_id", "checklist_execucao_id", "ativo_id", "componente_id", "tipo", "nome_arquivo", "url", "observacao", "usuario_id", "criado_em", "arquivo_id", "mime_type", "tamanho_bytes", "thumbnail_url"],

  materiais_uso: ["id", "execucao_id", "acao_id", "material_id", "quantidade", "unidade", "observacao", "usuario_id", "criado_em"],
  parametros: ["id", "ativo_id", "componente_id", "parametro", "valor", "unidade", "origem", "registrado_por", "registrado_em", "criado_em"],

  paradas_equipamento: ["id", "ativo_id", "componente_id", "os_id", "acao_id", "execucao_id", "origem", "tipo", "status", "iniciada_em", "iniciada_por", "manutencao_iniciada_em", "manutencao_finalizada_em", "finalizada_em", "finalizada_por", "tempo_parada_segundos", "tempo_espera_manutencao_segundos", "tempo_execucao_segundos", "tempo_retorno_operacional_segundos", "motivo_parada", "categoria_retorno", "justificativa_divergencia", "tolerancia_retorno_min", "criado_em", "atualizado_em"],
  paradas_manutencao: ["id", "ativo_id", "componente_id", "os_id", "acao_id", "execucao_id", "modo_configurado", "decisao_execucao", "status", "equipamento_ja_parado", "alterou_status_ativo", "iniciada_em", "finalizada_em", "duracao_segundos", "usuario_id", "criado_em", "atualizado_em"],
  ocorrencias_operacionais: ["id", "ativo_id", "componente_id", "tipo", "titulo", "descricao", "severidade", "status", "usuario_id", "perfil", "os_id", "acao_id", "parada_id", "demanda_tecnica_id", "analise_tecnica_id", "tratamento_status", "criado_em", "atualizado_em"],

  areas_tecnicas: ["id","codigo","nome","descricao","status","exige_assinatura_padrao","criado_por","criado_em","atualizado_em"],
  cargos_tecnicos: ["id","area_id","codigo","nome","descricao","status","pode_assinar","criado_por","criado_em","atualizado_em"],
  demandas_tecnicas: ["id","tipo","entidade_tipo","entidade_id","origem_tipo","origem_id","titulo","descricao","prioridade","status","area_origem_id","area_atual_id","cargo_atual_id","responsavel_atual_id","criado_por","criado_perfil","exige_assinatura","assinaturas_necessarias","assinaturas_realizadas","exige_segregacao","politica_assinatura","areas_validadoras_json","usuarios_validadores_json","prazo_primeira_resposta_em","prazo_resolucao_em","primeiro_atendimento_em","concluido_em","versao_entidade","payload_hash","criado_em","atualizado_em"],
  demanda_tramitacoes: ["id","demanda_id","sequencia","acao","de_area_id","de_cargo_id","de_usuario_id","para_area_id","para_cargo_id","para_usuario_id","decisao","parecer","motivo","payload_hash","criado_em"],
  assinaturas_tecnicas: ["id","demanda_id","entidade_tipo","entidade_id","versao_entidade","usuario_id","perfil","area_id","cargo_id","significado","declaracao","payload_hash","criado_em","revogado_em","motivo_revogacao"],
  analises_tecnicas: ["id","demanda_id","ocorrencia_id","ativo_id","componente_id","autor_id","area_id","cargo_id","titulo","diagnostico","risco","causa_provavel","recomendacao","recomenda_checklist","recomenda_os","prioridade","status","enviado_admin_em","criado_em","atualizado_em","relatorio_tecnico_json"],
  notificacoes: ["id","usuario_id","perfil","area_id","tipo","titulo","mensagem","entidade_tipo","entidade_id","prioridade","status","lida_em","criado_em"],
  turnos: ["id","planta_id","setor_id","linha_id","nome","inicio_hora","fim_hora","dias_semana_json","timezone","status","criado_em","atualizado_em"],
  apontamentos_producao: ["id","turno_id","ativo_id","inicio_em","fim_em","tempo_planejado_segundos","tempo_operacao_segundos","ciclo_ideal_segundos","quantidade_total","quantidade_boas","quantidade_refugo","fonte","usuario_id","criado_em","atualizado_em"],
  sla_politicas: ["id","tipo_demanda","prioridade","area_id","resposta_minutos","resolucao_minutos","calendario_id","status","criado_em","atualizado_em"],

  historico: ["id", "ativo_id", "componente_id", "os_id", "acao_id", "execucao_id", "evento", "descricao", "usuario_id", "perfil", "criado_em"],
  execucao_locks: ["id", "ativo_id", "acao_id", "usuario_id", "sessao_id", "status", "adquirido_em", "ultimo_ping_em", "expira_em", "liberado_em", "motivo_liberacao", "user_agent"],
  telemetria_sessoes: ["id", "sessao_id", "usuario_id", "ativo_id", "acao_id", "evento", "visibilidade", "delta_segundos", "tempo_total_segundos", "tempo_visivel_segundos", "tempo_oculto_segundos", "user_agent", "criado_em"],
  audit_log: ["id", "usuario_id", "perfil", "acao", "entidade", "entidade_id", "antes_json", "depois_json", "user_agent", "criado_em"],
  checklist_modelo_validacoes: ["id", "plano_id", "revisao", "decisao", "justificativa", "usuario_id", "perfil", "criado_em"],
  checklist_tipos_item: ["id", "tipo", "nome", "descricao", "requer_resposta", "requer_valor", "requer_opcoes", "suporta_limite", "suporta_evidencia", "categoria_padrao", "ativo", "criado_em"],
  checklist_validacao_regras: ["id", "tipo_item", "codigo", "nome", "descricao", "regra_json", "ativo", "criado_em"],
  modelo_checklist_auditoria: ["id", "plano_id", "item_id", "evento", "antes_json", "depois_json", "usuario_id", "perfil", "criado_em"],
  dashboard_cache: ["chave", "valor_json", "gerado_em", "ttl_segundos"],

  configuracao_versoes: ["id","numero","status","origem","base_versao_id","configuracao_json","hash_sha256","validacao_json","criado_por","criado_em"],
  configuracao_rascunhos: ["id","usuario_id","base_versao_id","configuracao_json","hash_sha256","validacao_json","status","criado_em","atualizado_em"],

  importacao_lotes: ["id","tipo","entidade","arquivo_nome","aba_nome","status","total_linhas","linhas_validas","linhas_invalidas","validacao_hash","cabecalhos_json","cabecalhos_ignorados_json","resultado_json","criado_por","criado_em","confirmado_por","confirmado_em","rollback_por","rollback_em","atualizado_em"],
  importacao_registros: ["id","lote_id","linha_numero","entidade","entidade_id","operacao","status","raw_json","normalizado_json","erros_json","antes_json","depois_json","aplicado_em","rollback_em","criado_em","atualizado_em"],

  documentos_tecnicos: ["id","codigo","titulo","tipo","entidade_tipo","entidade_id","status","revisao_atual","validade_em","responsavel_id","descricao","arquivo_id","arquivo_nome","mime_type","tamanho_bytes","criado_por","criado_em","atualizado_em"],
  documento_revisoes: ["id","documento_id","revisao","arquivo_id","arquivo_nome","mime_type","tamanho_bytes","observacao","criado_por","criado_em"],

  legado_quarentena: ["id", "aba_origem", "linha_origem", "motivo", "payload_json", "movido_em"]
};

const PUBLIC_ACTIONS = ["sistema.health", "sistema.bootstrap", "auth.login", "auth.first_access.complete", "auth.recovery.request", "auth.maintenance.exchange", "auth.logout"];

const PERM = {
  ADMIN: [
    "cmms.horimetro_evidencias_schema_upgrade", "cmms.paradas_operacionais_schema_upgrade", "cmms.operador_visual_schema_upgrade", "cmms.tela_operador_schema_upgrade", "operador.home", "operador.painel", "cmms.operador_ui_schema_upgrade", "cmms.operacional_ui_schema_upgrade", "cmms.contrato_frontend_schema_upgrade", "cmms.frontend_contract_schema_upgrade", "cmms.execucao_checklist_schema_upgrade", "cmms.auditoria_operador_schema_upgrade", "admin.corrigir_auditoria_execucao_operador", "admin.gerar_acao_teste_checklist", "operador.minhas_acoes", "operador.tela_acao", "operador.salvar_checklist_lote", "operador.detalhar_checklist_execucao", "operador.validar_finalizacao_acao",
    "admin.listar_tipos_item_checklist", "admin.listar_regras_checklist", "admin.validar_catalogo_item_checklist", "admin.salvar_item_modelo_checklist", "admin.remover_item_modelo_checklist", "admin.reordenar_itens_modelo_checklist", "admin.clonar_item_modelo_checklist", "admin.listar_itens_modelo_checklist", "admin.detalhar_modelo_checklist_catalogo", "cmms.catalogo_checklist_schema_upgrade",
    "cmms.workflow_tecnico_schema_upgrade", "cmms.configuracao_schema_upgrade", "admin.configuracao.estado", "admin.configuracao.rascunho.salvar", "admin.configuracao.validar", "admin.configuracao.publicar", "admin.configuracao.versoes", "admin.configuracao.rollback", "admin.areas_tecnicas.listar", "admin.areas_tecnicas.salvar", "admin.cargos_tecnicos.listar", "admin.cargos_tecnicos.salvar", "admin.demandas_tecnicas.enviar", "admin.demandas_tecnicas.listar", "admin.analises_tecnicas.listar", "admin.analises_tecnicas.converter",
    "admin.intervencoes.listar", "admin.intervencoes.salvar", "admin.intervencoes.enviar_validacao",
    "admin.documentos.listar", "admin.documentos.detalhe", "admin.documentos.upload", "admin.documentos.atualizar", "admin.auditoria.listar", "admin.monitoramento.estado", "admin.backups.listar", "admin.backups.criar", "admin.backups.preparar_restauracao", "admin.backups.confirmar_restauracao",
    "cmms.importacao_admin_schema_upgrade", "admin.importacao.modelos", "admin.importacao.validar", "admin.importacao.confirmar", "admin.importacao.lotes", "admin.importacao.detalhe", "admin.importacao.rollback",
    "cmms.schema_upgrade", "admin.salvar_modelo_checklist", "admin.enviar_modelo_checklist_validacao", "admin.detalhe_modelo_checklist", "admin.listar_modelos_checklist", "admin.modelos_devolvidos", "admin.corrigir_modelo_checklist", "admin.criar_revisao_modelo_checklist", "gestor.modelos_em_validacao", "gestor.listar_modelos_checklist", "gestor.detalhe_modelo_checklist", "gestor.validar_modelo_checklist", "operador.listar_checklist_execucao",
    "sistema.warmup", "admin.resumo", "perf.cache_clear", "perf.cache_status", "admin.resumo_cache", "admin.listar", "admin.obter", "admin.salvar", "admin.entidade.acao", "admin.usuarios.listar", "admin.usuarios.salvar", "admin.usuarios.desbloquear", "admin.usuarios.redefinir_senha", "admin.usuarios.revogar_sessoes", "admin.permissoes.obter", "admin.permissoes.salvar", "admin.empresa.obter", "admin.empresa.salvar", "admin.acesso.estado", "admin.gerar_qr", "admin.criar_demo", "admin.recalcular_ativo",
    "operador.contexto_qr", "operador.contexto_qr_fast", "operador.historico_qr", "operador.iniciar_acao", "operador.salvar_checklist_item", "operador.finalizar_acao", "operador.registrar_evidencia", "operador.upload_evidencia_foto", "admin.registrar_horimetro_telemetria", "admin.reiniciar_contador_servico", "admin.verificar_drive_evidencias", "operador.registrar_material", "operador.registrar_parametro", "operador.parada_ativa", "operador.iniciar_parada", "operador.finalizar_parada", "operador.registrar_ocorrencia",
    "gestor.listar_paradas", "gestor.listar_ocorrencias", "gestor.listar_acoes", "gestor.detalhe_acao", "gestor.detalhe_acao_fast", "gestor.auditoria_execucao_checklist", "gestor.validar_acao", "gestor.configurar_sessoes", "gestor.adicionar_colaborador", "gestor.liberar_locks",
    "lock.status", "lock.adquirir", "lock.heartbeat", "lock.liberar",
    "gestor.contexto_tecnico", "gestor.demandas.listar", "gestor.demandas.detalhe", "gestor.demandas.assumir", "gestor.demandas.encaminhar", "gestor.demandas.assinar", "gestor.demandas.validar", "gestor.demandas.decidir", "gestor.paradas.criar_tratamento", "gestor.analises.salvar", "gestor.analises.enviar_admin", "gestor.registrar_parametro", "gestor.dossie_ativo", "gestor.parametros.solicitar_acao", "gestor.notificacoes.listar", "gestor.notificacoes.marcar_lida",
    "cmms.kpis_base", "cmms.kpis_tecnicos", "cmms.diagnostico", "perf.cache_status", "perf.cache_clear", "cmms.higiene_diagnosticar", "cmms.higienizar_status", "cmms.higienizar_duplicidades", "cmms.higienizar_base",
    "telemetria.iniciar", "telemetria.evento", "telemetria.finalizar"
  ],
  GESTOR: [
    "operador.home", "operador.painel", "operador.minhas_acoes", "operador.tela_acao", "operador.salvar_checklist_lote", "operador.detalhar_checklist_execucao", "operador.validar_finalizacao_acao",
    "admin.listar_tipos_item_checklist", "admin.listar_regras_checklist", "admin.listar_itens_modelo_checklist", "admin.detalhar_modelo_checklist_catalogo",
    "gestor.modelos_em_validacao", "gestor.listar_modelos_checklist", "gestor.detalhe_modelo_checklist", "gestor.validar_modelo_checklist", "admin.detalhe_modelo_checklist", "operador.listar_checklist_execucao",
    "sistema.warmup",
    "admin.resumo", "perf.cache_clear", "perf.cache_status", "admin.resumo_cache", "admin.listar", "admin.obter", "admin.recalcular_ativo",
    "operador.contexto_qr", "operador.contexto_qr_fast", "operador.historico_qr", "operador.parada_ativa", "operador.iniciar_parada", "operador.finalizar_parada", "operador.registrar_ocorrencia",
    "gestor.listar_paradas", "gestor.listar_ocorrencias",
    "gestor.listar_acoes", "gestor.detalhe_acao", "gestor.detalhe_acao_fast", "gestor.auditoria_execucao_checklist", "gestor.validar_acao", "gestor.configurar_sessoes", "gestor.adicionar_colaborador", "gestor.liberar_locks",
    "gestor.contexto_tecnico", "gestor.demandas.listar", "gestor.demandas.detalhe", "gestor.demandas.assumir", "gestor.demandas.encaminhar", "gestor.demandas.assinar", "gestor.demandas.validar", "gestor.demandas.decidir", "gestor.paradas.criar_tratamento", "gestor.analises.salvar", "gestor.analises.enviar_admin", "gestor.registrar_parametro", "gestor.dossie_ativo", "gestor.parametros.solicitar_acao", "gestor.notificacoes.listar", "gestor.notificacoes.marcar_lida",
    "lock.status", "lock.adquirir", "lock.heartbeat", "lock.liberar",
    "cmms.kpis_base", "cmms.kpis_tecnicos", "cmms.diagnostico", "perf.cache_status", "perf.cache_clear", "cmms.higiene_diagnosticar", "cmms.higienizar_status", "cmms.higienizar_duplicidades",
    "telemetria.iniciar", "telemetria.evento", "telemetria.finalizar"
  ],
  OPERADOR: [
    "operador.home", "operador.painel", "operador.minhas_acoes", "operador.tela_acao", "operador.estado_acao", "operador.salvar_checklist_lote", "operador.detalhar_checklist_execucao", "operador.validar_finalizacao_acao",
    "operador.validar_resposta_checklist_item",
    "operador.listar_checklist_execucao",
    "sistema.warmup",
    "operador.contexto_qr", "operador.contexto_qr_fast", "operador.historico_qr", "operador.iniciar_acao", "operador.salvar_checklist_item", "operador.finalizar_acao", "operador.registrar_evidencia", "operador.upload_evidencia_foto", "operador.registrar_material", "operador.registrar_parametro", "operador.parada_ativa", "operador.iniciar_parada", "operador.finalizar_parada", "operador.registrar_ocorrencia",
    "lock.status", "lock.adquirir", "lock.heartbeat", "lock.liberar",
    "telemetria.iniciar", "telemetria.evento", "telemetria.finalizar"
  ],
  SISTEMA: [
    "admin.acesso.estado",
    "platform.motor.catalogo",
    "platform.motor.catalogo.rascunho.salvar",
    "platform.motor.catalogo.validar",
    "platform.motor.catalogo.publicar",
    "platform.motor.catalogo.versoes",
    "platform.motor.catalogo.rollback"
  ]
};
