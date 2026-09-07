const MOTOR_INTERNAL_IDENTITY_PROPERTY = "FAB_CONTROL_PLATFORM_IDENTITY_V1";
const MOTOR_INTERNAL_IDENTITY_SECRET_PROPERTY = "FAB_CONTROL_PLATFORM_IDENTITY_SIGNING_SECRET";
const MOTOR_INTERNAL_LOGIN_GUARD_PROPERTY = "FAB_CONTROL_MOTOR_LOGIN_GUARD_V1";
const MOTOR_INTERNAL_REDEEMED_PROPERTY = "FAB_CONTROL_MOTOR_MAINTENANCE_REDEEMED_V1";
const MOTOR_INTERNAL_SESSION_MINUTES = 30;
const MOTOR_INTERNAL_MAX_ATTEMPTS = 5;
const MOTOR_INTERNAL_LOCK_MINUTES = 15;

var MOTOR_INTERNAL_IDENTITY_CACHE = null;
var MOTOR_INTERNAL_MAINTENANCE_CACHE = null;

function motorInternalIdentityState_(){
  if(MOTOR_INTERNAL_IDENTITY_CACHE) return MOTOR_INTERNAL_IDENTITY_CACHE;
  var signed = motorReadSignedProperty_(MOTOR_INTERNAL_IDENTITY_PROPERTY, MOTOR_INTERNAL_IDENTITY_SECRET_PROPERTY);
  if(signed.estado !== "VALIDO"){
    MOTOR_INTERNAL_IDENTITY_CACHE = {
      ativa:false,
      estado:signed.estado === "AUSENTE" ? "NAO_CONFIGURADA" : "BLOQUEADA",
      motivo:signed.motivo || ""
    };
    return MOTOR_INTERNAL_IDENTITY_CACHE;
  }

  var data = signed.dados || {};
  var environments = Array.isArray(data.ambientes)
    ? data.ambientes.map(function(item){ return upper_(item); }).filter(Boolean)
    : [upper_(data.ambiente)].filter(Boolean);
  var tenantMatches = clean_(data.tenant_id) === motorConfiguredTenantId_();
  var environmentMatches = environments.indexOf(motorEnvironment_()) >= 0;
  var required = clean_(data.usuario_id) && clean_(data.nome) && clean_(data.email);
  var active = upper_(data.status || "ATIVO") === "ATIVO";

  if(!tenantMatches || !environmentMatches || !required || !active){
    MOTOR_INTERNAL_IDENTITY_CACHE = {
      ativa:false,
      estado:"BLOQUEADA",
      motivo:!tenantMatches
        ? "TENANT_DIVERGENTE"
        : !environmentMatches
          ? "AMBIENTE_DIVERGENTE"
          : !required
            ? "IDENTIDADE_INCOMPLETA"
            : "IDENTIDADE_INATIVA"
    };
    return MOTOR_INTERNAL_IDENTITY_CACHE;
  }

  MOTOR_INTERNAL_IDENTITY_CACHE = {
    ativa:true,
    estado:"ATIVA",
    usuario_id:clean_(data.usuario_id),
    nome:clean_(data.nome),
    email:clean_(data.email).toLowerCase(),
    tenant_id:clean_(data.tenant_id),
    ambientes:environments
  };
  return MOTOR_INTERNAL_IDENTITY_CACHE;
}

function motorInternalMaintenanceState_(){
  if(MOTOR_INTERNAL_MAINTENANCE_CACHE) return MOTOR_INTERNAL_MAINTENANCE_CACHE;
  var signed = motorReadSignedProperty_(MOTOR_MAINTENANCE_PROPERTY, MOTOR_MAINTENANCE_SECRET_PROPERTY);
  if(signed.estado !== "VALIDO"){
    MOTOR_INTERNAL_MAINTENANCE_CACHE = {
      aberta:false,
      estado:signed.estado === "AUSENTE" ? "FECHADA" : "BLOQUEADA",
      motivo:"",
      expira_em:"",
      janela_id:"",
      operador_id:"",
      operador_nome:"",
      ambiente:"",
      tenant_id:"",
      desafio_hash:""
    };
    return MOTOR_INTERNAL_MAINTENANCE_CACHE;
  }

  var data = signed.dados || {};
  var identity = motorInternalIdentityState_();
  var expiresAt = clean_(data.expira_em);
  var expiry = expiresAt ? new Date(expiresAt).getTime() : 0;
  var windowId = clean_(data.janela_id);
  var challengeHash = clean_(data.desafio_hash);
  var environment = upper_(data.ambiente);
  var tenantId = clean_(data.tenant_id);
  var operatorId = clean_(data.operador_id);
  var enabled = data.ativa === true;
  var opened = enabled &&
    Number.isFinite(expiry) &&
    expiry > Date.now() &&
    identity.ativa &&
    tenantId === identity.tenant_id &&
    tenantId === motorConfiguredTenantId_() &&
    environment === motorEnvironment_() &&
    operatorId === identity.usuario_id &&
    !!windowId &&
    !!challengeHash;

  MOTOR_INTERNAL_MAINTENANCE_CACHE = {
    aberta:opened,
    estado:opened ? "ABERTA" : enabled ? "BLOQUEADA" : "FECHADA",
    motivo:opened ? clean_(data.motivo) : "",
    expira_em:opened ? expiresAt : "",
    janela_id:opened ? windowId : "",
    operador_id:opened ? identity.usuario_id : "",
    operador_nome:opened ? identity.nome : "",
    ambiente:opened ? environment : "",
    tenant_id:opened ? tenantId : "",
    desafio_hash:opened ? challengeHash : ""
  };
  return MOTOR_INTERNAL_MAINTENANCE_CACHE;
}

function motorInternalMaintenancePublicState_(auth){
  var state = motorInternalMaintenanceState_();
  var internal = upper_(auth && auth.perfil) === ROLE.SISTEMA && state.aberta;
  return {
    aberta:state.aberta,
    estado:state.estado,
    motivo:state.motivo,
    expira_em:state.expira_em,
    janela_id:internal ? state.janela_id : "",
    operador_nome:internal ? state.operador_nome : "",
    ambiente:internal ? state.ambiente : ""
  };
}

function motorInternalChallengeHash_(challenge){
  var secret = clean_(PropertiesService.getScriptProperties().getProperty(MOTOR_MAINTENANCE_SECRET_PROPERTY));
  if(!secret) return "";
  return motorHmac_("FAB_CONTROL_MAINTENANCE_CHALLENGE_V1:" + String(challenge || ""), secret);
}

function motorInternalLoginGuard_(){
  var raw = clean_(PropertiesService.getScriptProperties().getProperty(MOTOR_INTERNAL_LOGIN_GUARD_PROPERTY));
  if(!raw) return {tentativas:0, bloqueado_ate:"", janela_id:""};
  try{
    var parsed = JSON.parse(raw);
    return {
      tentativas:Math.max(0, num_(parsed.tentativas, 0)),
      bloqueado_ate:clean_(parsed.bloqueado_ate),
      janela_id:clean_(parsed.janela_id)
    };
  } catch(e){
    return {tentativas:0, bloqueado_ate:"", janela_id:""};
  }
}

function motorInternalAssertLoginAvailable_(state){
  var guard = motorInternalLoginGuard_();
  if(guard.janela_id && guard.janela_id !== state.janela_id) return;
  var lockedUntil = new Date(guard.bloqueado_ate).getTime();
  if(Number.isFinite(lockedUntil) && lockedUntil > Date.now()){
    err_("MAINTENANCE_ACCESS_INVALID", "Acesso interno indisponível.", 401);
  }
}

function motorInternalRegisterInvalidLogin_(state, userAgent){
  var lock = LockService.getScriptLock();
  if(!lock.tryLock(5000)) err_("MAINTENANCE_ACCESS_INVALID", "Acesso interno indisponível.", 401);
  try{
    var properties = PropertiesService.getScriptProperties();
    var guard = motorInternalLoginGuard_();
    var attempts = guard.janela_id === state.janela_id ? guard.tentativas + 1 : 1;
    var lockedUntil = attempts >= MOTOR_INTERNAL_MAX_ATTEMPTS
      ? iso_(addMinutes_(new Date(), MOTOR_INTERNAL_LOCK_MINUTES))
      : "";
    properties.setProperty(MOTOR_INTERNAL_LOGIN_GUARD_PROPERTY, JSON.stringify({
      tentativas:attempts,
      bloqueado_ate:lockedUntil,
      janela_id:state.janela_id,
      atualizado_em:now_()
    }));
    audit_(
      {usuario_id:state.operador_id, perfil:ROLE.SISTEMA},
      "MOTOR_MAINTENANCE_ACCESS_DENIED",
      "motor_manutencao",
      state.janela_id,
      null,
      {tentativas:attempts, bloqueado:!!lockedUntil, ambiente:state.ambiente},
      clean_(userAgent)
    );
  } finally {
    lock.releaseLock();
  }
}

function motorInternalResetLoginGuard_(){
  PropertiesService.getScriptProperties().deleteProperty(MOTOR_INTERNAL_LOGIN_GUARD_PROPERTY);
}

function motorInternalCreateSession_(identity, state, userAgent){
  var expiresAtMs = Math.min(
    new Date(state.expira_em).getTime(),
    Date.now() + MOTOR_INTERNAL_SESSION_MINUTES * 60000
  );
  if(!Number.isFinite(expiresAtMs) || expiresAtMs <= Date.now()){
    err_("MAINTENANCE_ACCESS_INVALID", "Acesso interno indisponível.", 401);
  }

  var expiresAt = new Date(expiresAtMs);
  var token = authRandomToken_("FAB-MOTOR");
  append_("sessoes", fit_("sessoes", {
    token:token,
    usuario_id:identity.usuario_id,
    perfil:ROLE.SISTEMA,
    status:ST.ATIVO,
    criado_em:now_(),
    expira_em:iso_(expiresAt),
    ultimo_uso_em:now_(),
    user_agent:clean_(userAgent),
    escopo:"PLATFORM_MAINTENANCE",
    expira_ms:expiresAtMs,
    revogado_em:"",
    motivo_revogacao:"",
    janela_id:state.janela_id,
    ambiente:state.ambiente,
    tenant_id:state.tenant_id
  }));

  return {
    token:token,
    expira_em:iso_(expiresAt),
    expira_ms:expiresAtMs
  };
}

function motorInternalMaintenanceExchange_(p){
  ensureAuthSchema_();
  var challenge = String(p && (p.codigo || p.code) || "");
  if(challenge.length < 16 || challenge.length > 160){
    Utilities.sleep(150);
    err_("MAINTENANCE_ACCESS_INVALID", "Acesso interno indisponível.", 401);
  }

  var state = motorInternalMaintenanceState_();
  var identity = motorInternalIdentityState_();
  if(!state.aberta || !identity.ativa){
    Utilities.sleep(150);
    err_("MAINTENANCE_ACCESS_INVALID", "Acesso interno indisponível.", 401);
  }

  motorInternalAssertLoginAvailable_(state);
  if(!authSecureEquals_(motorInternalChallengeHash_(challenge), state.desafio_hash)){
    motorInternalRegisterInvalidLogin_(state, p && p.user_agent);
    Utilities.sleep(150);
    err_("MAINTENANCE_ACCESS_INVALID", "Acesso interno indisponível.", 401);
  }

  var lock = LockService.getScriptLock();
  if(!lock.tryLock(10000)) err_("MAINTENANCE_ACCESS_BUSY", "Outra validação interna está em andamento.", 409);
  try{
    MOTOR_INTERNAL_IDENTITY_CACHE = null;
    MOTOR_INTERNAL_MAINTENANCE_CACHE = null;
    state = motorInternalMaintenanceState_();
    identity = motorInternalIdentityState_();
    if(!state.aberta || !identity.ativa || state.operador_id !== identity.usuario_id){
      err_("MAINTENANCE_ACCESS_INVALID", "Acesso interno indisponível.", 401);
    }
    if(!authSecureEquals_(motorInternalChallengeHash_(challenge), state.desafio_hash)){
      err_("MAINTENANCE_ACCESS_INVALID", "Acesso interno indisponível.", 401);
    }

    var properties = PropertiesService.getScriptProperties();
    var redeemedWindow = clean_(properties.getProperty(MOTOR_INTERNAL_REDEEMED_PROPERTY));
    if(redeemedWindow === state.janela_id){
      err_("MAINTENANCE_ACCESS_INVALID", "Acesso interno indisponível.", 401);
    }

    var session = motorInternalCreateSession_(identity, state, p && p.user_agent);
    properties.setProperty(MOTOR_INTERNAL_REDEEMED_PROPERTY, state.janela_id);
    motorInternalResetLoginGuard_();
    audit_(
      {usuario_id:identity.usuario_id, perfil:ROLE.SISTEMA},
      "MOTOR_MAINTENANCE_SESSION_STARTED",
      "motor_manutencao",
      state.janela_id,
      null,
      {ambiente:state.ambiente, expira_em:session.expira_em, motivo:state.motivo},
      clean_(p && p.user_agent)
    );

    return Object.assign({
      requires_password_change:false,
      token:session.token,
      expira_em:session.expira_em,
      expira_ms:session.expira_ms,
      usuario:{
        id:identity.usuario_id,
        nome:identity.nome,
        email:identity.email,
        matricula:identity.usuario_id,
        perfil:ROLE.SISTEMA
      },
      manutencao:motorInternalMaintenancePublicState_({
        perfil:ROLE.SISTEMA,
        janela_id:state.janela_id
      }),
      acesso_integral:true,
      warmup_required:false
    }, releaseVersionInfo_());
  } finally {
    lock.releaseLock();
  }
}

function motorInternalAuthorizeSession_(session){
  var identity = motorInternalIdentityState_();
  var state = motorInternalMaintenanceState_();
  var valid = identity.ativa &&
    state.aberta &&
    upper_(session && session.perfil) === ROLE.SISTEMA &&
    upper_(session && session.escopo) === "PLATFORM_MAINTENANCE" &&
    clean_(session && session.usuario_id) === identity.usuario_id &&
    clean_(session && session.janela_id) === state.janela_id &&
    clean_(session && session.ambiente) === state.ambiente &&
    clean_(session && session.tenant_id) === state.tenant_id;

  if(!valid){
    err_("MOTOR_MAINTENANCE_REQUIRED", "A janela interna de manutenção foi encerrada ou alterada.", 403);
  }

  return {
    token:clean_(session.token),
    usuario_id:identity.usuario_id,
    nome:identity.nome,
    email:identity.email,
    perfil:ROLE.SISTEMA,
    expira_em:clean_(session.expira_em),
    janela_id:state.janela_id,
    ambiente:state.ambiente,
    tenant_id:state.tenant_id
  };
}
