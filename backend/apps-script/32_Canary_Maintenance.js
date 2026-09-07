function maintenanceResetCanaryAdminAccess() {
  var allowedEnvironments = ["CANARIO", "CANARY", "HOMOLOG", "HOMOLOGACAO"];
  var environment = motorEnvironment_();
  if (allowedEnvironments.indexOf(environment) < 0) {
    err_(
      "CANARY_MAINTENANCE_ONLY",
      "A recuperação manual de acesso só pode ser executada em homologação.",
      403
    );
  }

  var admin = find_("usuarios", "id", "USR-ADMIN-001");
  if (!admin) {
    err_(
      "CANARY_ADMIN_NOT_FOUND",
      "O administrador padrão de homologação não foi encontrado.",
      404
    );
  }
  if (upper_(admin.perfil) !== ROLE.ADMIN) {
    err_(
      "CANARY_ADMIN_PROFILE_INVALID",
      "A identidade de homologação não possui perfil administrativo.",
      409
    );
  }

  var changedAt = now_();
  update_("usuarios", admin.__rowIndex, {
    status: ST.ATIVO,
    pin_hash: hashPin_("1234"),
    senha_hash: "",
    primeiro_acesso: "SIM",
    tentativas_login: 0,
    bloqueado_ate: "",
    recuperacao_referencia: "",
    recuperacao_solicitada_em: "",
    atualizado_em: changedAt
  });

  rows_("sessoes", true)
    .filter(function (session) {
      return clean_(session.usuario_id) === clean_(admin.id) &&
        upper_(session.status) === ST.ATIVO;
    })
    .forEach(function (session) {
      authRevokeSession_(session, "CANARY_ADMIN_ACCESS_RECOVERY");
    });

  audit_(
    { usuario_id: "SISTEMA-MANUTENCAO", perfil: ROLE.SISTEMA },
    "CANARY_ADMIN_ACCESS_RECOVERED",
    "usuarios",
    admin.id,
    {
      status: admin.status,
      primeiro_acesso: admin.primeiro_acesso,
      tentativas_login: admin.tentativas_login
    },
    {
      status: ST.ATIVO,
      primeiro_acesso: "SIM",
      tentativas_login: 0,
      sessoes_revogadas: true
    },
    "APPS_SCRIPT_EDITOR"
  );

  invalidateRuntimeCache_();
  return {
    recovered: true,
    environment: environment,
    usuario_id: admin.id,
    matricula: clean_(admin.matricula || admin.id),
    primeiro_acesso: true,
    pin_temporario: "1234",
    atualizado_em: changedAt
  };
}

function maintenanceOpenCanaryMotorWindow() {
  var allowedEnvironments = ["CANARIO", "CANARY", "HOMOLOG", "HOMOLOGACAO"];
  var environment = motorEnvironment_();
  if (allowedEnvironments.indexOf(environment) < 0) {
    err_(
      "CANARY_MAINTENANCE_ONLY",
      "A rotina manual so pode ser executada em homologacao.",
      403
    );
  }

  var tenantId = motorConfiguredTenantId_();
  if (!tenantId) {
    err_(
      "CANARY_TENANT_NOT_CONFIGURED",
      "O tenant de homologacao nao esta configurado.",
      409
    );
  }

  var properties = PropertiesService.getScriptProperties();
  var identitySecret = clean_(
    properties.getProperty(MOTOR_INTERNAL_IDENTITY_SECRET_PROPERTY)
  ) || maintenanceRandomSecret_();
  var maintenanceSecret = clean_(
    properties.getProperty(MOTOR_MAINTENANCE_SECRET_PROPERTY)
  ) || maintenanceRandomSecret_();
  var operatorId = "FAB-PLATFORM-CANARY";
  var openedAt = new Date();
  var expiresAt = new Date(
    openedAt.getTime() + MOTOR_INTERNAL_SESSION_MINUTES * 60000
  );
  var windowId = "MW-CANARY-" + Utilities.getUuid();
  var challenge = "FAB-MAINT-" +
    Utilities.getUuid().replace(/-/g, "") +
    Utilities.getUuid().replace(/-/g, "");

  var identity = {
    usuario_id: operatorId,
    nome: "Equipe de Plataforma",
    email: "plataforma-canary@fabcontrol.local",
    tenant_id: tenantId,
    ambientes: [environment],
    status: "ATIVO",
    emitido_em: iso_(openedAt)
  };
  var maintenance = {
    ativa: true,
    motivo: "Validacao controlada do Motor no ambiente canario",
    expira_em: iso_(expiresAt),
    janela_id: windowId,
    operador_id: operatorId,
    ambiente: environment,
    tenant_id: tenantId,
    desafio_hash: motorHmac_(
      "FAB_CONTROL_MAINTENANCE_CHALLENGE_V1:" + challenge,
      maintenanceSecret
    ),
    emitido_em: iso_(openedAt)
  };

  var signedProperties = {};
  signedProperties[MOTOR_INTERNAL_IDENTITY_SECRET_PROPERTY] = identitySecret;
  signedProperties[MOTOR_INTERNAL_IDENTITY_PROPERTY] =
    maintenanceSignedEnvelope_(identity, identitySecret);
  signedProperties[MOTOR_MAINTENANCE_SECRET_PROPERTY] = maintenanceSecret;
  signedProperties[MOTOR_MAINTENANCE_PROPERTY] =
    maintenanceSignedEnvelope_(maintenance, maintenanceSecret);
  properties.setProperties(signedProperties, false);
  properties.deleteProperty(MOTOR_INTERNAL_REDEEMED_PROPERTY);
  properties.deleteProperty(MOTOR_INTERNAL_LOGIN_GUARD_PROPERTY);

  MOTOR_INTERNAL_IDENTITY_CACHE = null;
  MOTOR_INTERNAL_MAINTENANCE_CACHE = null;
  MOTOR_MAINTENANCE_CACHE = null;

  audit_(
    { usuario_id: operatorId, perfil: ROLE.SISTEMA },
    "CANARY_MOTOR_MAINTENANCE_WINDOW_OPENED",
    "motor_manutencao",
    windowId,
    null,
    {
      ambiente: environment,
      tenant_id: tenantId,
      expira_em: iso_(expiresAt),
      uso_unico: true
    },
    "APPS_SCRIPT_EDITOR"
  );

  console.log(JSON.stringify({
    environment: environment,
    janela_id: windowId,
    expira_em: iso_(expiresAt),
    codigo_temporario: challenge,
    uso_unico: true
  }));

  return {
    opened: true,
    environment: environment,
    janela_id: windowId,
    expira_em: iso_(expiresAt),
    codigo_temporario: challenge,
    uso_unico: true
  };
}

function maintenanceRandomSecret_() {
  return Utilities.getUuid().replace(/-/g, "") +
    Utilities.getUuid().replace(/-/g, "");
}

function maintenanceSignedEnvelope_(data, secret) {
  var payload = JSON.stringify(data);
  return JSON.stringify({
    payload: payload,
    signature: motorHmac_(payload, secret)
  });
}
