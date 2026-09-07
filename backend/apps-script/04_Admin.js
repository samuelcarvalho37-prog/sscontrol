const ADMIN_ENT = {
  plantas:"plantas", setores:"setores", linhas:"linhas", ativos:"ativos", componentes:"componentes",
  materiais:"materiais", planos:"planos_manutencao", plano_itens:"plano_itens", usuarios:"usuarios"
};
const ADMIN_ACTIONABLE_ENTITIES = ["plantas","setores","linhas","ativos","componentes","materiais","planos"];
const ADMIN_ENTITY_REFERENCE_FIELDS = {
  plantas:"planta_id",
  setores:"setor_id",
  linhas:"linha_id",
  ativos:"ativo_id",
  componentes:"componente_id",
  materiais:"material_id",
  planos:"plano_id"
};

const ADMIN_PERMISSION_CONFIG_KEY = "permissions.matrix.capabilities.v1";
const ADMIN_PERMISSION_CAPABILITIES = [
  {
    id:"CONSULTAR_OPERACAO",
    nome:"Consultar operação",
    descricao:"Visualiza fila, detalhes e checklist sem autorizar alterações administrativas.",
    perfis:[ROLE.GESTOR, ROLE.OPERADOR],
    padrao:[ROLE.GESTOR, ROLE.OPERADOR],
    acoes:["operador.home","operador.painel","operador.minhas_acoes","operador.tela_acao","operador.estado_acao","operador.listar_checklist_execucao","operador.detalhar_checklist_execucao","operador.validar_finalizacao_acao"]
  },
  {
    id:"EXECUTAR_MANUTENCAO",
    nome:"Executar manutenção",
    descricao:"Inicia e finaliza ações, responde checklist e registra evidências, materiais e parâmetros.",
    perfis:[ROLE.OPERADOR],
    padrao:[ROLE.OPERADOR],
    acoes:["operador.iniciar_acao","operador.salvar_checklist_item","operador.salvar_checklist_lote","operador.finalizar_acao","operador.registrar_evidencia","operador.upload_evidencia_foto","operador.registrar_material","operador.registrar_parametro","lock.status","lock.adquirir","lock.heartbeat","lock.liberar","telemetria.iniciar","telemetria.evento","telemetria.finalizar"]
  },
  {
    id:"REGISTRAR_OCORRENCIAS",
    nome:"Registrar ocorrências",
    descricao:"Registra anormalidades operacionais vinculadas a ativos e componentes.",
    perfis:[ROLE.OPERADOR],
    padrao:[ROLE.OPERADOR],
    acoes:["operador.registrar_ocorrencia"]
  },
  {
    id:"CONTROLAR_PARADAS",
    nome:"Controlar paradas",
    descricao:"Consulta, inicia e encerra paradas de equipamento durante a operação.",
    perfis:[ROLE.OPERADOR],
    padrao:[ROLE.OPERADOR],
    acoes:["operador.parada_ativa","operador.iniciar_parada","operador.finalizar_parada"]
  },
  {
    id:"MONITORAR_OPERACAO",
    nome:"Monitorar operação",
    descricao:"Acompanha ações, paradas e ocorrências consolidadas no painel gerencial.",
    perfis:[ROLE.GESTOR],
    padrao:[ROLE.GESTOR],
    acoes:["gestor.listar_acoes","gestor.listar_paradas","gestor.listar_ocorrencias","gestor.detalhe_acao","gestor.detalhe_acao_fast"]
  },
  {
    id:"VALIDAR_EXECUCOES",
    nome:"Validar execuções",
    descricao:"Audita checklists e aprova ou reprova execuções concluídas.",
    perfis:[ROLE.GESTOR],
    padrao:[ROLE.GESTOR],
    acoes:["gestor.auditoria_execucao_checklist","gestor.validar_acao"]
  },
  {
    id:"VALIDAR_MODELOS",
    nome:"Validar modelos",
    descricao:"Consulta, aprova ou devolve modelos técnicos de checklist.",
    perfis:[ROLE.GESTOR],
    padrao:[ROLE.GESTOR],
    acoes:["gestor.modelos_em_validacao","gestor.listar_modelos_checklist","gestor.detalhe_modelo_checklist","gestor.validar_modelo_checklist"]
  },
  {
    id:"TRATAR_DEMANDAS_TECNICAS",
    nome:"Tratar demandas técnicas",
    descricao:"Assume, encaminha, assina e decide demandas conforme área, cargo e escopo.",
    perfis:[ROLE.GESTOR],
    padrao:[ROLE.GESTOR],
    acoes:["gestor.contexto_tecnico","gestor.demandas.listar","gestor.demandas.detalhe","gestor.demandas.assumir","gestor.demandas.encaminhar","gestor.demandas.assinar","gestor.demandas.validar","gestor.demandas.decidir","gestor.notificacoes.listar","gestor.notificacoes.marcar_lida"]
  },
  {
    id:"EMITIR_ANALISE_TECNICA",
    nome:"Emitir análise técnica",
    descricao:"Analisa ocorrências e envia recomendações de checklist ou ordem de serviço ao administrador.",
    perfis:[ROLE.GESTOR],
    padrao:[ROLE.GESTOR],
    acoes:[
      "gestor.analises.salvar",
      "gestor.analises.enviar_admin",
      "gestor.parametros.solicitar_acao"
    ]
  },
  {
    id:"CONSULTAR_ATIVOS",
    nome:"Consultar ativos",
    descricao:"Permite leitura do catálogo técnico de ativos e componentes.",
    perfis:[ROLE.GESTOR],
    padrao:[ROLE.GESTOR],
    acoes:["admin.listar","admin.obter","gestor.dossie_ativo"]
  },
  {
    id:"REGISTRAR_LEITURAS_TECNICAS",
    nome:"Registrar leituras técnicas",
    descricao:"Registra parâmetros de equipamentos e componentes durante a inspeção em campo.",
    perfis:[ROLE.GESTOR],
    padrao:[ROLE.GESTOR],
    acoes:["gestor.registrar_parametro"]
  },
  {
    id:"VER_INDICADORES",
    nome:"Visualizar indicadores",
    descricao:"Exibe KPIs operacionais disponíveis no contrato atual.",
    perfis:[ROLE.GESTOR],
    padrao:[ROLE.GESTOR],
    acoes:["cmms.kpis_base","cmms.kpis_tecnicos"]
  },
  {
    id:"GERENCIAR_SESSOES_OPERACIONAIS",
    nome:"Gerenciar sessões operacionais",
    descricao:"Configura colaboração e libera bloqueios de execução.",
    perfis:[ROLE.GESTOR],
    padrao:[ROLE.GESTOR],
    acoes:["gestor.configurar_sessoes","gestor.adicionar_colaborador","gestor.liberar_locks"]
  }
];

function adminRequireIdentityAdmin_(auth){
  if(upper_(auth && auth.perfil) !== ROLE.ADMIN){
    err_("FORBIDDEN_ADMIN_REQUIRED", "Gestão de identidades exige perfil ADMIN.", 403);
  }
}

const ADMIN_COMPANY_NAME_KEY = "empresa.nome_exibicao";
const ADMIN_COMPANY_LOGO_KEY = "empresa.logo_data_url";
const ADMIN_COMPANY_DEFAULT_NAME = "Empresa Demonstração";
const ADMIN_COMPANY_NAME_MAX_LENGTH = 80;
const ADMIN_COMPANY_LOGO_MAX_LENGTH = 40000;
const ADMIN_COMPANY_LOGO_MAX_BYTES = 30000;

function adminCompanyName_(value){
  var name = clean_(value).replace(/[\u0000-\u001F\u007F]/g, " ").replace(/\s+/g, " ");
  if(name.length < 2) err_("COMPANY_NAME_REQUIRED", "Informe um nome de empresa com pelo menos 2 caracteres.", 400);
  if(name.length > ADMIN_COMPANY_NAME_MAX_LENGTH) err_("COMPANY_NAME_TOO_LONG", "O nome da empresa pode ter no máximo 80 caracteres.", 400);
  return name;
}

function adminCompanyLogo_(value){
  var logo = clean_(value);
  if(!logo) return "";
  if(logo.length > ADMIN_COMPANY_LOGO_MAX_LENGTH){
    err_("COMPANY_LOGO_TOO_LARGE", "A imagem ultrapassa o limite seguro para o cabeçalho.", 400);
  }
  var match = logo.match(/^data:image\/(png|jpeg|webp);base64,([A-Za-z0-9+/]+={0,2})$/);
  if(!match) err_("COMPANY_LOGO_INVALID", "Envie uma imagem PNG, JPEG ou WebP válida.", 400);
  var bytes;
  try{
    bytes = Utilities.base64Decode(match[2]);
  } catch(e){
    err_("COMPANY_LOGO_INVALID", "Não foi possível validar o conteúdo da imagem.", 400);
  }
  if(!bytes || !bytes.length || bytes.length > ADMIN_COMPANY_LOGO_MAX_BYTES){
    err_("COMPANY_LOGO_TOO_LARGE", "A imagem ultrapassa o limite seguro para o cabeçalho.", 400);
  }
  var mime = match[1];
  var validSignature = mime === "png"
    ? bytes.length >= 8 && bytes[0] === -119 && bytes[1] === 80 && bytes[2] === 78 && bytes[3] === 71
    : mime === "jpeg"
      ? bytes.length >= 3 && bytes[0] === -1 && bytes[1] === -40 && bytes[2] === -1
      : bytes.length >= 12 && bytes[0] === 82 && bytes[1] === 73 && bytes[2] === 70 && bytes[3] === 70 && bytes[8] === 87 && bytes[9] === 69 && bytes[10] === 66 && bytes[11] === 80;
  if(!validSignature) err_("COMPANY_LOGO_INVALID", "O conteúdo da imagem não corresponde ao formato informado.", 400);
  return logo;
}

function adminEmpresaObter_(p, auth){
  adminRequireIdentityAdmin_(auth);
  var nameRow = find_("config", "chave", ADMIN_COMPANY_NAME_KEY);
  var logoRow = find_("config", "chave", ADMIN_COMPANY_LOGO_KEY);
  return {
    nome:clean_(nameRow && nameRow.valor) || ADMIN_COMPANY_DEFAULT_NAME,
    logo_data_url:clean_(logoRow && logoRow.valor),
    atualizado_em:clean_((logoRow && logoRow.atualizado_em) || (nameRow && nameRow.atualizado_em))
  };
}

function adminCompanyAuditView_(company){
  return {
    nome:company.nome,
    logo_configurada:!!company.logo_data_url,
    logo_tamanho:company.logo_data_url ? company.logo_data_url.length : 0,
    atualizado_em:company.atualizado_em || ""
  };
}

function adminEmpresaSalvar_(p, auth){
  adminRequireIdentityAdmin_(auth);
  var data = p && p.dados && typeof p.dados === "object" ? p.dados : {};
  var name = adminCompanyName_(data.nome);
  var logo = adminCompanyLogo_(data.logo_data_url);
  var lock = LockService.getScriptLock();
  if(!lock.tryLock(10000)) err_("ADMIN_WRITE_BUSY", "Outra alteração administrativa está em andamento.", 409);
  try{
    var before = adminEmpresaObter_({}, auth);
    var updatedAt = now_();
    upsert_("config", "chave", {
      chave:ADMIN_COMPANY_NAME_KEY,
      valor:name,
      descricao:"Nome exibido no Command Workspace",
      atualizado_em:updatedAt
    });
    upsert_("config", "chave", {
      chave:ADMIN_COMPANY_LOGO_KEY,
      valor:logo,
      descricao:"Logomarca compactada exibida no Command Workspace",
      atualizado_em:updatedAt
    });
    var saved = {nome:name, logo_data_url:logo, atualizado_em:updatedAt};
    audit_(auth, "ADMIN_COMPANY_IDENTITY_UPDATED", "config", "empresa.identidade", adminCompanyAuditView_(before), adminCompanyAuditView_(saved), clean_(p.user_agent));
    return {saved:true, empresa:saved};
  } finally {
    lock.releaseLock();
  }
}

function adminSanitizeEntityRow_(sheetName, row){
  var safe = strip_(row);
  if(sheetName === "usuarios"){
    delete safe.pin_hash;
    delete safe.senha_hash;
  }
  return safe;
}

function adminPublicUser_(user, activeSessions){
  var safe = adminSanitizeEntityRow_("usuarios", user);
  safe.sessoes_ativas = num_(activeSessions, 0);
  safe.recuperacao_pendente = !!clean_(safe.recuperacao_referencia);
  return safe;
}

function adminActiveSessionCounts_(){
  var counts = {};
  rows_("sessoes", true).forEach(function(session){
    if(upper_(session.status) !== ST.ATIVO) return;
    if(authSessionExpiryMs_(session) <= Date.now()) return;
    var userId = clean_(session.usuario_id);
    if(!userId) return;
    counts[userId] = num_(counts[userId], 0) + 1;
  });
  return counts;
}

function adminRevokeUserSessions_(userId, reason){
  var revoked = 0;
  rows_("sessoes", true).forEach(function(session){
    if(String(session.usuario_id) !== String(userId)) return;
    if(upper_(session.status) !== ST.ATIVO) return;
    authRevokeSession_(session, reason || "ADMIN_REVOKED");
    revoked++;
  });
  return revoked;
}

function adminAssertUserUniqueness_(data, currentId){
  var email = clean_(data.email).toLowerCase();
  var registration = upper_(data.matricula);
  var conflict = rows_("usuarios", true).find(function(user){
    if(currentId && String(user.id) === String(currentId)) return false;
    return clean_(user.email).toLowerCase() === email || upper_(user.matricula || user.id) === registration;
  });
  if(!conflict) return;
  if(clean_(conflict.email).toLowerCase() === email){
    err_("USER_EMAIL_EXISTS", "Já existe um usuário com este e-mail.", 409);
  }
  err_("USER_REGISTRATION_EXISTS", "Já existe um usuário com esta matrícula.", 409);
}

function adminAssertUserPayload_(data){
  req_(data, ["nome","email","matricula","perfil"]);
  var email = clean_(data.email).toLowerCase();
  var registration = clean_(data.matricula);
  var profile = upper_(data.perfil);
  var status = upper_(data.status || ST.ATIVO);
  if(clean_(data.nome).length < 3) err_("USER_NAME_INVALID", "Informe o nome completo do usuário.", 400);
  if(!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) err_("USER_EMAIL_INVALID", "Informe um e-mail válido.", 400);
  if(!/^[A-Za-z0-9._-]{3,40}$/.test(registration)) err_("USER_REGISTRATION_INVALID", "A matrícula deve ter de 3 a 40 caracteres alfanuméricos.", 400);
  if([ROLE.ADMIN, ROLE.GESTOR, ROLE.OPERADOR].indexOf(profile) < 0) err_("USER_PROFILE_INVALID", "Perfil de usuário inválido.", 400);
  if([ST.ATIVO, ST.INATIVO].indexOf(status) < 0) err_("USER_STATUS_INVALID", "Status de usuário inválido.", 400);
  var areaId = profile === ROLE.GESTOR ? clean_(data.area_id) : "";
  var roleId = profile === ROLE.GESTOR ? clean_(data.cargo_id) : "";
  if(areaId){
    var area = find_("areas_tecnicas", "id", areaId);
    if(!area || upper_(area.status) !== ST.ATIVO) err_("USER_TECH_AREA_INVALID", "Área técnica inexistente ou inativa.", 400);
  }
  if(roleId){
    var technicalRole = find_("cargos_tecnicos", "id", roleId);
    if(!technicalRole || upper_(technicalRole.status) !== ST.ATIVO) err_("USER_TECH_ROLE_INVALID", "Cargo técnico inexistente ou inativo.", 400);
    if(areaId && String(technicalRole.area_id) !== String(areaId)) err_("USER_TECH_ROLE_AREA_MISMATCH", "O cargo não pertence à área selecionada.", 400);
  }
  return {
    email:email, matricula:registration, perfil:profile, status:status,
    area_id:areaId, cargo_id:roleId,
    especialidades_json:technicalSerializeArray_(data.especialidades_json || data.especialidades),
    escopo_ids_json:technicalSerializeArray_(data.escopo_ids_json || data.escopo_ids)
  };
}

function adminAssertAdminContinuity_(oldUser, nextProfile, nextStatus){
  if(!oldUser || upper_(oldUser.perfil) !== ROLE.ADMIN) return;
  if(nextProfile === ROLE.ADMIN && nextStatus === ST.ATIVO) return;
  var activeAdmins = rows_("usuarios", true).filter(function(user){
    return upper_(user.perfil) === ROLE.ADMIN && upper_(user.status) === ST.ATIVO;
  });
  if(activeAdmins.length <= 1){
    err_("LAST_ADMIN_REQUIRED", "O último administrador ativo não pode ser removido ou inativado.", 409);
  }
}

function adminUsuariosListar_(p, auth){
  adminRequireIdentityAdmin_(auth);
  var search = clean_(p.busca).toLowerCase();
  var profile = upper_(p.perfil);
  var status = upper_(p.status);
  var counts = adminActiveSessionCounts_();
  var users = rows_("usuarios", true).filter(function(user){
    if(profile && upper_(user.perfil) !== profile) return false;
    if(status && upper_(user.status) !== status) return false;
    if(!search) return true;
    return [user.id,user.nome,user.email,user.matricula,user.perfil].some(function(value){
      return clean_(value).toLowerCase().indexOf(search) >= 0;
    });
  }).sort(function(a,b){
    return clean_(a.nome).localeCompare(clean_(b.nome));
  });
  var limit = Math.max(1, Math.min(num_(p.limite, 300), 500));
  return {
    total:users.length,
    usuarios:users.slice(0, limit).map(function(user){
      return adminPublicUser_(user, counts[user.id]);
    })
  };
}

function adminUsuariosSalvar_(p, auth){
  adminRequireIdentityAdmin_(auth);
  req_(p, ["dados"]);
  var data = Object.assign({}, p.dados || {});
  var normalized = adminAssertUserPayload_(data);
  var lock = LockService.getScriptLock();
  if(!lock.tryLock(10000)) err_("ADMIN_WRITE_BUSY", "Outra alteração administrativa está em andamento.", 409);
  try{
    var requestedId = clean_(data.id);
    var old = requestedId ? find_("usuarios", "id", requestedId) : null;
    if(requestedId && !old) err_("NOT_FOUND", "Usuário não encontrado.", 404);
    adminAssertUserUniqueness_(normalized, old && old.id);
    if(old){
      var self = String(old.id) === String(auth.usuario_id);
      if(self && (normalized.perfil !== upper_(old.perfil) || normalized.status !== upper_(old.status))){
        err_("SELF_PROFILE_CHANGE_BLOCKED", "Você não pode alterar o próprio perfil ou status nesta sessão.", 409);
      }
      adminAssertAdminContinuity_(old, normalized.perfil, normalized.status);
      var before = adminPublicUser_(old, 0);
      var patch = {
        nome:clean_(data.nome),
        email:normalized.email,
        matricula:normalized.matricula,
        perfil:normalized.perfil,
        status:normalized.status,
        area_id:normalized.area_id,
        cargo_id:normalized.cargo_id,
        especialidades_json:normalized.especialidades_json,
        escopo_ids_json:normalized.escopo_ids_json,
        atualizado_em:now_()
      };
      update_("usuarios", old.__rowIndex, patch);
      var securityChanged = normalized.perfil !== upper_(old.perfil) || normalized.status !== upper_(old.status);
      var revoked = securityChanged ? adminRevokeUserSessions_(old.id, "IDENTITY_CHANGED") : 0;
      var saved = Object.assign({}, old, patch);
      audit_(auth, "ADMIN_USER_UPDATED", "usuarios", old.id, before, adminPublicUser_(saved, 0), clean_(p.user_agent));
      return {saved:true, mode:"update", usuario:adminPublicUser_(saved, 0), sessoes_revogadas:revoked};
    }

    var temporaryPassword = String(data.senha_temporaria || p.senha_temporaria || "");
    var policy = authPasswordPolicy_(temporaryPassword);
    if(!policy.ok) err_(policy.code, policy.message, 400);
    var userId = clean_(data.id) || eid_("USR", normalized.matricula);
    if(find_("usuarios", "id", userId)) err_("USER_ID_EXISTS", "Já existe um usuário com este identificador.", 409);
    var created = fit_("usuarios", {
      id:userId,
      nome:clean_(data.nome),
      email:normalized.email,
      perfil:normalized.perfil,
      status:normalized.status,
      pin_hash:"",
      matricula:normalized.matricula,
      senha_hash:authCreatePasswordHash_(temporaryPassword),
      primeiro_acesso:"SIM",
      tentativas_login:0,
      bloqueado_ate:"",
      ultimo_login_em:"",
      senha_atualizada_em:now_(),
      recuperacao_referencia:"",
      recuperacao_solicitada_em:"",
      area_id:normalized.area_id,
      cargo_id:normalized.cargo_id,
      especialidades_json:normalized.especialidades_json,
      escopo_ids_json:normalized.escopo_ids_json,
      criado_em:now_(),
      atualizado_em:now_()
    });
    append_("usuarios", created);
    audit_(auth, "ADMIN_USER_CREATED", "usuarios", created.id, null, adminPublicUser_(created, 0), clean_(p.user_agent));
    return {saved:true, mode:"insert", usuario:adminPublicUser_(created, 0), sessoes_revogadas:0};
  } finally {
    lock.releaseLock();
  }
}

function adminUsuariosDesbloquear_(p, auth){
  adminRequireIdentityAdmin_(auth);
  req_(p, ["usuario_id"]);
  var user = find_("usuarios", "id", p.usuario_id);
  if(!user) err_("NOT_FOUND", "Usuário não encontrado.", 404);
  var before = adminPublicUser_(user, 0);
  var patch = {tentativas_login:0, bloqueado_ate:"", atualizado_em:now_()};
  update_("usuarios", user.__rowIndex, patch);
  audit_(auth, "ADMIN_USER_UNLOCKED", "usuarios", user.id, before, adminPublicUser_(Object.assign({}, user, patch), 0), clean_(p.user_agent));
  return {unlocked:true, usuario_id:user.id};
}

function adminUsuariosRedefinirSenha_(p, auth){
  adminRequireIdentityAdmin_(auth);
  req_(p, ["usuario_id","senha_temporaria"]);
  var user = find_("usuarios", "id", p.usuario_id);
  if(!user) err_("NOT_FOUND", "Usuário não encontrado.", 404);
  if(String(user.id) === String(auth.usuario_id)) err_("SELF_PASSWORD_RESET_BLOCKED", "Use o fluxo de alteração da própria senha.", 409);
  var policy = authPasswordPolicy_(p.senha_temporaria);
  if(!policy.ok) err_(policy.code, policy.message, 400);
  var patch = {
    senha_hash:authCreatePasswordHash_(p.senha_temporaria),
    pin_hash:"",
    primeiro_acesso:"SIM",
    tentativas_login:0,
    bloqueado_ate:"",
    recuperacao_referencia:"",
    recuperacao_solicitada_em:"",
    senha_atualizada_em:now_(),
    atualizado_em:now_()
  };
  update_("usuarios", user.__rowIndex, patch);
  var revoked = adminRevokeUserSessions_(user.id, "PASSWORD_RESET_BY_ADMIN");
  audit_(auth, "ADMIN_USER_PASSWORD_RESET", "usuarios", user.id, {primeiro_acesso:user.primeiro_acesso}, {primeiro_acesso:"SIM", sessoes_revogadas:revoked}, clean_(p.user_agent));
  return {password_reset:true, usuario_id:user.id, primeiro_acesso:true, sessoes_revogadas:revoked};
}

function adminUsuariosRevogarSessoes_(p, auth){
  adminRequireIdentityAdmin_(auth);
  req_(p, ["usuario_id"]);
  var user = find_("usuarios", "id", p.usuario_id);
  if(!user) err_("NOT_FOUND", "Usuário não encontrado.", 404);
  if(String(user.id) === String(auth.usuario_id)) err_("SELF_SESSION_REVOKE_BLOCKED", "Use o botão Sair para encerrar a própria sessão.", 409);
  var revoked = adminRevokeUserSessions_(user.id, "ADMIN_REVOKED");
  audit_(auth, "ADMIN_USER_SESSIONS_REVOKED", "usuarios", user.id, null, {sessoes_revogadas:revoked}, clean_(p.user_agent));
  return {revoked:true, usuario_id:user.id, sessoes_revogadas:revoked};
}

function adminPermissionStoredMatrix_(){
  var row = find_("config", "chave", ADMIN_PERMISSION_CONFIG_KEY);
  if(!row || !clean_(row.valor)) return {};
  try{
    var parsed = JSON.parse(clean_(row.valor));
    return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed : {};
  } catch(e){
    return {};
  }
}

function adminCapabilityEnabled_(capability, profile, matrix){
  profile = upper_(profile);
  var profileMatrix = matrix && matrix[profile];
  if(profileMatrix && Object.prototype.hasOwnProperty.call(profileMatrix, capability.id)){
    return bool_(profileMatrix[capability.id]);
  }
  return capability.padrao.indexOf(profile) >= 0;
}

function adminPermissionDecision_(profile, action){
  profile = upper_(profile);
  if(profile === ROLE.ADMIN) return null;
  var applicable = ADMIN_PERMISSION_CAPABILITIES.filter(function(capability){
    return capability.perfis.indexOf(profile) >= 0 && capability.acoes.indexOf(action) >= 0;
  });
  if(!applicable.length) return null;
  var matrix = adminPermissionStoredMatrix_();
  return applicable.some(function(capability){
    return adminCapabilityEnabled_(capability, profile, matrix);
  });
}

function adminPermissionProfile_(profile, matrix){
  profile = upper_(profile);
  return {
    perfil:profile,
    editavel:profile !== ROLE.ADMIN,
    capacidades:ADMIN_PERMISSION_CAPABILITIES.filter(function(capability){
      return capability.perfis.indexOf(profile) >= 0;
    }).map(function(capability){
      return {
        id:capability.id,
        nome:capability.nome,
        descricao:capability.descricao,
        permitido:adminCapabilityEnabled_(capability, profile, matrix),
        padrao:capability.padrao.indexOf(profile) >= 0,
        acoes:capability.acoes.slice()
      };
    })
  };
}

function adminPermissoesObter_(p, auth){
  adminRequireIdentityAdmin_(auth);
  var matrix = adminPermissionStoredMatrix_();
  return {
    chave:ADMIN_PERMISSION_CONFIG_KEY,
    perfis:[
      {perfil:ROLE.ADMIN, editavel:false, capacidades:[], acesso_total:true},
      adminPermissionProfile_(ROLE.GESTOR, matrix),
      adminPermissionProfile_(ROLE.OPERADOR, matrix)
    ]
  };
}

function adminPermissoesSalvar_(p, auth){
  adminRequireIdentityAdmin_(auth);
  req_(p, ["perfil","permissoes"]);
  var profile = upper_(p.perfil);
  if([ROLE.GESTOR, ROLE.OPERADOR].indexOf(profile) < 0){
    err_("PERMISSION_PROFILE_LOCKED", "A matriz do perfil informado não pode ser alterada.", 409);
  }
  if(!p.permissoes || typeof p.permissoes !== "object" || Array.isArray(p.permissoes)){
    err_("PERMISSION_MATRIX_INVALID", "A matriz de permissões é inválida.", 400);
  }
  var matrix = adminPermissionStoredMatrix_();
  var before = Object.assign({}, matrix[profile] || {});
  var allowedIds = ADMIN_PERMISSION_CAPABILITIES.filter(function(capability){
    return capability.perfis.indexOf(profile) >= 0;
  }).map(function(capability){ return capability.id; });
  var next = {};
  allowedIds.forEach(function(id){
    if(Object.prototype.hasOwnProperty.call(p.permissoes, id)) next[id] = bool_(p.permissoes[id]);
  });
  matrix[profile] = next;
  upsertConfigText_("chave", {
    chave:ADMIN_PERMISSION_CONFIG_KEY,
    valor:JSON.stringify(matrix),
    descricao:"Matriz configurável de capacidades por perfil",
    atualizado_em:now_()
  });
  audit_(auth, "ADMIN_PERMISSIONS_UPDATED", "config", ADMIN_PERMISSION_CONFIG_KEY+":"+profile, before, next, clean_(p.user_agent));
  return {saved:true, perfil:profile, matriz:adminPermissionProfile_(profile, matrix)};
}

function adminResumo_(){
  return {
    version:FAB.VERSION,
    totais:{
      plantas:rows_("plantas").length,
      setores:rows_("setores").length,
      linhas:rows_("linhas").length,
      ativos:rows_("ativos").length,
      componentes:rows_("componentes").length,
      planos:rows_("planos_manutencao").length,
      plano_itens:rows_("plano_itens").length,
      usuarios:rows_("usuarios").length,
      acoes_abertas:rows_("os_acoes").filter(acaoAberta_).length,
      os_abertas:rows_("ordens_servico").filter(function(o){ return !terminal_(o.status); }).length
    },
    serverTime:now_()
  };
}

function adminListar_(p){
  var ent = clean_(p.entidade);
  var sh = ADMIN_ENT[ent];
  if(!sh) err_("ENTITY_INVALID","Entidade inválida: "+ent,400);
  var r = rows_(sh).map(function(x){ return adminSanitizeEntityRow_(sh, x); });
  if(p.filtro_campo) r = r.filter(function(x){ return String(x[p.filtro_campo]) === String(p.filtro_valor); });
  return {entidade:ent, total:r.length, rows:r.slice(0, Math.min(num_(p.limite,300),500))};
}

function adminObter_(p){
  req_(p, ["entidade","id"]);
  var sh = ADMIN_ENT[clean_(p.entidade)];
  if(!sh) err_("ENTITY_INVALID","Entidade inválida.",400);
  var r = find_(sh,"id",p.id);
  if(!r) err_("NOT_FOUND","Registro não encontrado.",404);
  r = adminSanitizeEntityRow_(sh, r);
  return {entidade:p.entidade, row:r};
}

function adminSalvar_(p){
  req_(p, ["entidade","dados"]);
  var ent = clean_(p.entidade);
  var sh = ADMIN_ENT[ent];
  if(!sh) err_("ENTITY_INVALID","Entidade inválida: "+ent,400);
  if(ent === "usuarios") return adminUsuariosSalvar_(p, p.__auth || {});
  var row = normalizeEnt_(ent, p.dados || {});
  var old = row.id ? find_(sh,"id",row.id) : null;
  if(old){
    row.criado_em = old.criado_em || row.criado_em || now_();
    row.atualizado_em = now_();
    update_(sh, old.__rowIndex, row);
    return {saved:true, mode:"update", entidade:ent, row:adminSanitizeEntityRow_(sh, Object.assign({}, old, row))};
  }
  row.criado_em = row.criado_em || now_();
  row.atualizado_em = now_();
  append_(sh, row);
  return {saved:true, mode:"insert", entidade:ent, row:adminSanitizeEntityRow_(sh, row)};
}

function adminAssertEntityReferences_(ent, row){
  if(ent === "setores" && !find_("plantas", "id", row.planta_id)){
    err_("ENTITY_REFERENCE_INVALID", "Planta não encontrada: "+row.planta_id, 400);
  }
  if(ent === "linhas" && !find_("setores", "id", row.setor_id)){
    err_("ENTITY_REFERENCE_INVALID", "Setor não encontrado: "+row.setor_id, 400);
  }
  if(ent === "ativos" && !find_("linhas", "id", row.linha_id)){
    err_("ENTITY_REFERENCE_INVALID", "Linha não encontrada: "+row.linha_id, 400);
  }
  if(ent === "componentes" && !find_("ativos", "id", row.ativo_id)){
    err_("ENTITY_REFERENCE_INVALID", "Ativo não encontrado: "+row.ativo_id, 400);
  }
  if(ent === "planos"){
    var planAsset = find_("ativos", "id", row.ativo_id);
    if(!planAsset) err_("ENTITY_REFERENCE_INVALID", "Ativo não encontrado: "+row.ativo_id, 400);
    if(upper_(planAsset.status) === ST.INATIVO) err_("ASSET_INACTIVE", "Reative o equipamento antes de criar um plano.", 409);
    if(row.componente_id){
      var component = find_("componentes", "id", row.componente_id);
      if(!component || String(component.ativo_id) !== String(row.ativo_id)){
        err_("ENTITY_REFERENCE_INVALID", "Componente não pertence ao ativo informado: "+row.componente_id, 400);
      }
      if(upper_(component.status) === ST.INATIVO) err_("COMPONENT_INACTIVE", "Reative o componente antes de criar um plano.", 409);
    }
  }
  if(ent === "plano_itens"){
    var plan = find_("planos_manutencao", "id", row.plano_id);
    if(!plan) err_("ENTITY_REFERENCE_INVALID", "Plano não encontrado: "+row.plano_id, 400);
    if(upper_(plan.status) === ST.ATIVO || upper_(plan.workflow_status) === ST.VALIDADO){
      err_("ENTITY_PROTECTED_PLAN", "O plano validado não pode receber alterações diretas. Crie uma revisão.", 409);
    }
  }
}

function adminProtectManualPlan_(ent, row){
  if(ent !== "planos") return row;
  var old = row.id ? find_("planos_manutencao", "id", row.id) : null;
  if(old && (upper_(old.status) === ST.ATIVO || upper_(old.workflow_status) === ST.VALIDADO || upper_(old.workflow_status) === ST.EM_VALIDACAO_GESTAO)){
    err_("ENTITY_PROTECTED_PLAN", "O plano em validação ou validado não pode ser alterado diretamente. Crie uma revisão.", 409);
  }
  row.status = ST.INATIVO;
  row.workflow_status = ST.RASCUNHO;
  row.validado_gestao = "NAO";
  row.validado_por = "";
  row.validado_em = "";
  return row;
}

function adminSalvarSeguro_(p, auth){
  adminRequireIdentityAdmin_(auth);
  req_(p, ["entidade","dados"]);
  var ent = clean_(p.entidade);
  if(ent === "usuarios") return adminUsuariosSalvar_(p, auth);
  var sheetName = ADMIN_ENT[ent];
  if(!sheetName) err_("ENTITY_INVALID", "Entidade inválida: "+ent, 400);
  var normalized = adminProtectManualPlan_(ent, normalizeEnt_(ent, p.dados || {}));
  adminAssertEntityReferences_(ent, normalized);
  var lock = LockService.getScriptLock();
  if(!lock.tryLock(10000)) err_("ADMIN_WRITE_BUSY", "Outra alteração administrativa está em andamento.", 409);
  try{
    var old = normalized.id ? find_(sheetName, "id", normalized.id) : null;
    adminValidateEntityStatusTransition_(ent, old, normalized);
    var before = old ? adminSanitizeEntityRow_(sheetName, old) : null;
    var result = adminSalvar_({entidade:ent, dados:normalized, __auth:auth});
    audit_(auth, old ? "ADMIN_ENTITY_UPDATED" : "ADMIN_ENTITY_CREATED", sheetName, result.row.id, before, result.row, clean_(p.user_agent));
    return result;
  } finally {
    lock.releaseLock();
  }
}

function adminEntityAllowedStatuses_(ent){
  if(ent === "ativos") return [ST.OPERANDO, ST.PARADO, ST.INATIVO];
  if(["plantas","setores","linhas","componentes","materiais"].indexOf(ent) >= 0) return [ST.ATIVO, ST.INATIVO];
  return [];
}

function adminEntityAssertParentAvailable_(ent, row){
  var parent = null;
  if(ent === "setores") parent = find_("plantas", "id", row.planta_id);
  if(ent === "linhas") parent = find_("setores", "id", row.setor_id);
  if(ent === "ativos") parent = find_("linhas", "id", row.linha_id);
  if(ent === "componentes") parent = find_("ativos", "id", row.ativo_id);
  if(parent && upper_(parent.status) === ST.INATIVO){
    err_("ENTITY_PARENT_INACTIVE", "Reative o cadastro superior antes de ativar este registro.", 409);
  }
}

function adminEntityOpenOperations_(ent, entityId){
  if(["ativos","componentes"].indexOf(ent) < 0) return [];
  var field = ent === "ativos" ? "ativo_id" : "componente_id";
  var isOpen = function(row){
    return [ST.CONCLUIDA, ST.CANCELADA, ST.FINALIZADA].indexOf(upper_(row.status)) < 0;
  };
  var checks = [
    {sheet:"ordens_servico", open:isOpen},
    {sheet:"os_acoes", open:isOpen},
    {sheet:"execucoes", open:isOpen}
  ];
  var found = [];
  checks.forEach(function(check){
    if(typeof sheetExists_ === "function" && !sheetExists_(check.sheet)) return;
    var count = rows_(check.sheet, true).filter(function(row){
      return String(row[field]) === String(entityId) && check.open(row);
    }).length;
    if(count) found.push({entidade:check.sheet, total:count});
  });
  return found;
}

function adminEntityActiveChildren_(ent, entityId){
  var relation = {
    plantas:{sheet:"setores", field:"planta_id"},
    setores:{sheet:"linhas", field:"setor_id"},
    linhas:{sheet:"ativos", field:"linha_id"}
  }[ent];
  if(!relation) return 0;
  return rows_(relation.sheet, true).filter(function(row){
    return String(row[relation.field]) === String(entityId) && upper_(row.status) !== ST.INATIVO;
  }).length;
}

function adminValidateEntityStatusTransition_(ent, old, next){
  var allowed = adminEntityAllowedStatuses_(ent);
  if(!allowed.length) return;
  var target = upper_(next.status);
  if(allowed.indexOf(target) < 0){
    err_("ENTITY_STATUS_INVALID", "Status inválido para "+ent+": "+target, 400);
  }
  if(target !== ST.INATIVO) adminEntityAssertParentAvailable_(ent, next);
  if(old && upper_(old.status) !== ST.INATIVO && target === ST.INATIVO){
    var activeChildren = adminEntityActiveChildren_(ent, old.id);
    if(activeChildren){
      err_("ENTITY_HAS_ACTIVE_CHILDREN", "Desative primeiro os cadastros vinculados a este nível da estrutura.", 409);
    }
    var openOperations = adminEntityOpenOperations_(ent, old.id);
    if(openOperations.length){
      err_("ENTITY_HAS_OPEN_OPERATIONS", "Conclua ou cancele as ordens e execuções abertas antes de desativar este registro.", 409);
    }
  }
}

function adminEntityReferenceSummary_(ent, entityId){
  var field = ADMIN_ENTITY_REFERENCE_FIELDS[ent];
  var ownSheet = ADMIN_ENT[ent];
  if(!field) return [];
  return Object.keys(SH).filter(function(sheetName){
    if(sheetName === ownSheet || sheetName === "audit_log" || sheetName === "modelo_checklist_auditoria") return false;
    if(ent === "planos" && sheetName === "plano_itens") return false;
    if(SH[sheetName].indexOf(field) < 0) return false;
    return typeof sheetExists_ !== "function" || sheetExists_(sheetName);
  }).map(function(sheetName){
    return {
      entidade:sheetName,
      total:rows_(sheetName, true).filter(function(row){ return String(row[field]) === String(entityId); }).length
    };
  }).filter(function(reference){ return reference.total > 0; });
}

function adminDeleteEntity_(ent, row, auth, userAgent){
  if(ent === "planos"){
    if(upper_(row.workflow_status || ST.RASCUNHO) !== ST.RASCUNHO || upper_(row.status || ST.INATIVO) !== ST.INATIVO){
      err_("ENTITY_PROTECTED_PLAN", "Somente um plano em rascunho inativo pode ser excluído.", 409);
    }
    if(clean_(row.revisao_origem_id) || clean_(row.substitui_plano_id)){
      err_("ENTITY_PROTECTED_REVISION", "Uma revisão formal deve permanecer rastreável e não pode ser excluída.", 409);
    }
  }

  var references = adminEntityReferenceSummary_(ent, row.id);
  if(references.length){
    var summary = references.map(function(reference){ return reference.entidade+" ("+reference.total+")"; }).join(", ");
    err_("ENTITY_IN_USE", "Este registro possui vínculos e não pode ser excluído: "+summary+". Desative-o para preservar o histórico.", 409);
  }

  var removedItems = [];
  if(ent === "planos"){
    removedItems = rows_("plano_itens", true)
      .filter(function(item){ return String(item.plano_id) === String(row.id); })
      .sort(function(left, right){ return right.__rowIndex - left.__rowIndex; });
    removedItems.forEach(function(item){ deleteRow_("plano_itens", item.__rowIndex); });
  }

  deleteRow_(ADMIN_ENT[ent], row.__rowIndex);
  var before = adminSanitizeEntityRow_(ADMIN_ENT[ent], row);
  audit_(auth, "ADMIN_ENTITY_DELETED", ADMIN_ENT[ent], row.id, before, {
    excluido:true,
    itens_rascunho_excluidos:removedItems.length
  }, userAgent);
  return {
    acted:true,
    acao:"EXCLUIR",
    entidade:ent,
    id:row.id,
    deleted:true,
    itens_rascunho_excluidos:removedItems.length
  };
}

function adminEntityAction_(p, auth){
  adminRequireIdentityAdmin_(auth);
  req_(p, ["entidade","id","acao"]);
  var ent = clean_(p.entidade);
  var action = upper_(p.acao);
  if(ADMIN_ACTIONABLE_ENTITIES.indexOf(ent) < 0) err_("ENTITY_ACTION_INVALID", "Entidade não aceita ações administrativas: "+ent, 400);
  if(["ALTERAR_STATUS","EXCLUIR"].indexOf(action) < 0) err_("ENTITY_ACTION_INVALID", "Ação administrativa inválida: "+action, 400);

  var sheetName = ADMIN_ENT[ent];
  var lock = LockService.getScriptLock();
  if(!lock.tryLock(10000)) err_("ADMIN_WRITE_BUSY", "Outra alteração administrativa está em andamento.", 409);
  try{
    var row = find_(sheetName, "id", p.id);
    if(!row) err_("NOT_FOUND", "Registro não encontrado.", 404);
    if(action === "EXCLUIR") return adminDeleteEntity_(ent, row, auth, clean_(p.user_agent));
    if(ent === "planos") err_("ENTITY_PROTECTED_PLAN", "O estado do plano é controlado pelo fluxo de validação e revisão.", 409);

    var nextStatus = upper_(p.status);
    var next = Object.assign({}, row, {status:nextStatus, atualizado_em:now_()});
    adminValidateEntityStatusTransition_(ent, row, next);
    var before = adminSanitizeEntityRow_(sheetName, row);
    update_(sheetName, row.__rowIndex, {status:nextStatus, atualizado_em:next.atualizado_em});
    var saved = adminSanitizeEntityRow_(sheetName, Object.assign({}, row, next));
    audit_(auth, "ADMIN_ENTITY_STATUS_CHANGED", sheetName, row.id, before, saved, clean_(p.user_agent));
    return {acted:true, acao:action, entidade:ent, id:row.id, deleted:false, row:saved};
  } finally {
    lock.releaseLock();
  }
}

function normalizeEnt_(ent,d){
  var o = Object.assign({}, d);

  if(ent === "plantas"){
    req_(d,["tag","nome"]); o.tag=upper_(d.tag); o.id=clean_(d.id)||eid_("PLT",o.tag); o.status=upper_(d.status||ST.ATIVO);
  }
  if(ent === "setores"){
    req_(d,["planta_id","tag","nome"]); o.tag=upper_(d.tag); o.id=clean_(d.id)||eid_("SET",d.planta_id+"-"+o.tag); o.status=upper_(d.status||ST.ATIVO);
  }
  if(ent === "linhas"){
    req_(d,["setor_id","tag","nome"]); o.tag=upper_(d.tag); o.id=clean_(d.id)||eid_("LIN",d.setor_id+"-"+o.tag); o.status=upper_(d.status||ST.ATIVO);
  }
  if(ent === "ativos"){
    req_(d,["linha_id","tag","nome"]); o.tag=upper_(d.tag); o.id=clean_(d.id)||eid_("ATV",o.tag); o.qr_payload=clean_(d.qr_payload)||o.tag; o.criticidade=upper_(d.criticidade||"MEDIA"); o.status=upper_(d.status||ST.OPERANDO); o.saude_pct=num_(d.saude_pct,100); o.horimetro_atual=num_(d.horimetro_atual,0);
  }
  if(ent === "componentes"){
    req_(d,["ativo_id","tag","nome"]); o.tag=upper_(d.tag); o.id=clean_(d.id)||eid_("CMP",d.ativo_id+"-"+o.tag); o.qr_payload=clean_(d.qr_payload)||o.id; o.criticidade=upper_(d.criticidade||"MEDIA"); o.status=upper_(d.status||ST.ATIVO); o.vida_util_horas=num_(d.vida_util_horas,0); o.vida_util_dias=num_(d.vida_util_dias,0); o.horas_acumuladas=num_(d.horas_acumuladas,0);
  }
  if(ent === "materiais"){
    req_(d,["sku","nome"]); o.sku=upper_(d.sku); o.id=clean_(d.id)||eid_("MAT",o.sku); o.unidade=clean_(d.unidade||"un"); o.estoque_atual=num_(d.estoque_atual,0); o.estoque_minimo=num_(d.estoque_minimo,0); o.status=upper_(d.status||ST.ATIVO);
  }
  if(ent === "planos"){
    req_(d,["ativo_id","nome","gatilho_tipo","gatilho_valor"]); o.id=clean_(d.id)||eid_("PLN",d.ativo_id+"-"+(d.componente_id||"ATIVO")+"-"+d.nome); o.tipo=upper_(d.tipo||"PREVENTIVA"); o.criticidade=upper_(d.criticidade||"MEDIA"); o.gatilho_tipo=upper_(d.gatilho_tipo||"HORAS"); o.gatilho_valor=num_(d.gatilho_valor,0); o.unidade=clean_(d.unidade||""); o.recorrencia_dias=num_(d.recorrencia_dias,0); o.tempo_estimado_min=num_(d.tempo_estimado_min,0); o.requer_bloqueio=bool_(d.requer_bloqueio===undefined?"SIM":d.requer_bloqueio)?"SIM":"NAO"; o.requer_evidencia=bool_(d.requer_evidencia===undefined?"NAO":d.requer_evidencia)?"SIM":"NAO"; o.max_sessoes=Math.max(1,num_(d.max_sessoes,1)); o.status=upper_(d.status||ST.INATIVO); o.workflow_status=upper_(d.workflow_status||ST.RASCUNHO); o.validado_gestao=bool_(d.validado_gestao)?"SIM":"NAO"; o.revisao=Math.max(1,num_(d.revisao,1)); o.setor_id=clean_(d.setor_id); o.modelo_base_id=clean_(d.modelo_base_id); o.revisao_origem_id=clean_(d.revisao_origem_id); o.substitui_plano_id=clean_(d.substitui_plano_id); o.substituido_por=clean_(d.substituido_por); o.substituido_em=clean_(d.substituido_em);
  }
  if(ent === "plano_itens"){
    req_(d,["plano_id","titulo"]); o.id=clean_(d.id)||eid_("PIT",d.plano_id+"-"+(d.ordem||1)+"-"+d.titulo); o.ordem=num_(d.ordem,1); o.tipo_resposta=normalizaTipoChecklist_(d.tipo_resposta||"OK_NOK"); o.obrigatorio=bool_(d.obrigatorio===undefined?"SIM":d.obrigatorio)?"SIM":"NAO"; o.evidencia_obrigatoria=bool_(d.evidencia_obrigatoria===undefined?"NAO":d.evidencia_obrigatoria)?"SIM":"NAO"; o.parametro_nome=clean_(d.parametro_nome); o.valor_esperado=clean_(d.valor_esperado); o.opcoes_json=normalizaOpcoesJson_(d.opcoes||d.opcoes_json); o.bloqueia_finalizacao=bool_(d.bloqueia_finalizacao)?"SIM":"NAO"; o.categoria=upper_(d.categoria||"OPERACIONAL"); o.peso=num_(d.peso,1); o.status=upper_(d.status||ST.ATIVO); o.validacao_regra=clean_(d.validacao_regra);
  }
  if(ent === "usuarios"){
    err_("USER_ENDPOINT_REQUIRED", "Use o endpoint administrativo dedicado para usuários.", 400);
  }

  return fit_(shForEnt_(ent), o);
}

function shForEnt_(ent){ return ADMIN_ENT[ent]; }

function adminRecalcularAtivo_(p){
  req_(p,["ativo_id"]);
  var auth = p.__auth || {};
  var ativoId = clean_(p.ativo_id);
  var ativoAntes = find_("ativos","id",ativoId);
  if(!ativoAntes) err_("NOT_FOUND","Ativo não encontrado: "+ativoId,404);

  var saudeAnterior = num_(ativoAntes.saude_pct,100);
  var motor = cmmsMotorRecalcular_({ativo_id:ativoId, __auth:auth});

  var metricas = calcularSaudeAtivoCMMS_(ativoId);
  var ativoAtual = find_("ativos","id",ativoId);
  if(ativoAtual){
    update_("ativos", ativoAtual.__rowIndex, {saude_pct:metricas.pct, atualizado_em:now_()});
  }

  hist_({
    ativo_id:ativoId,
    componente_id:"",
    os_id:"",
    acao_id:"",
    execucao_id:"",
    evento:"ATIVO_RECALCULADO_ADMIN",
    descricao:"Ativo recalculado por "+(auth.perfil||"")+". Saúde: "+saudeAnterior+"% -> "+metricas.pct+"%.",
    usuario_id:auth.usuario_id||"",
    perfil:auth.perfil||""
  });

  return {
    recalculado:true,
    ativo_id:ativoId,
    saude_anterior:saudeAnterior,
    saude_atual:metricas.pct,
    saude_status:metricas.status,
    acoes_abertas:metricas.acoes_abertas,
    os_abertas:metricas.os_abertas,
    motor:motor
  };
}

function adminGerarQr_(p){
  req_(p,["tipo","id"]);
  var tipo = upper_(p.tipo);
  var row = tipo === "ATIVO" ? find_("ativos","id",p.id) : tipo === "COMPONENTE" ? find_("componentes","id",p.id) : null;
  if(!row) err_("NOT_FOUND","Registro não encontrado para QR.",404);
  var payload = clean_(row.qr_payload || row.tag || row.id);
  return {tipo:tipo, id:row.id, tag:row.tag, nome:row.nome, qr_payload:payload, qr_url:"https://api.qrserver.com/v1/create-qr-code/?size=420x420&data="+encodeURIComponent(payload)};
}

function adminCriarDemo_(p){
  adminSalvar_({entidade:"plantas", dados:{id:"PLT-PLT-01", tag:"PLT-01", nome:"Planta 01"}});
  adminSalvar_({entidade:"setores", dados:{id:"SET-PLT-PLT-01-ENV", planta_id:"PLT-PLT-01", tag:"ENV", nome:"Envase"}});
  adminSalvar_({entidade:"linhas", dados:{id:"LIN-SET-PLT-PLT-01-ENV-L01", setor_id:"SET-PLT-PLT-01-ENV", tag:"L01", nome:"Linha 01"}});
  var atv = adminSalvar_({entidade:"ativos", dados:{id:"ATV-ENV-001", linha_id:"LIN-SET-PLT-PLT-01-ENV-L01", tag:"ENV-001", nome:"Envasadora 01", tipo:"Envasadora", criticidade:"CRITICA", status:"OPERANDO", saude_pct:100, horimetro_atual:3990}}).row;
  var comp = adminSalvar_({entidade:"componentes", dados:{id:"CMP-ATV-ENV-001-ROL-001", ativo_id:atv.id, tag:"ROL-001", qr_payload:"CMP-ATV-ENV-001-ROL-001", nome:"Rolamento principal", tipo:"Rolamento", criticidade:"ALTA", status:"ATIVO", vida_util_horas:4000, horas_acumuladas:3990}}).row;
  var plano = adminSalvar_({entidade:"planos", dados:{id:"PLN-ATV-ENV-001-CMP-ATV-ENV-001-ROL-001-INSPECIONAR-ROLAMENTO-PR", ativo_id:atv.id, componente_id:comp.id, nome:"Inspecionar rolamento principal", tipo:"INSPECAO", criticidade:"ALTA", gatilho_tipo:"HORAS", gatilho_valor:4000, unidade:"h", tempo_estimado_min:15, requer_bloqueio:"SIM", requer_evidencia:"NAO", max_sessoes:1, status:"ATIVO"}}).row;
  ensureDefaultPlanoItem_(plano);
  return {created:true, ativo:atv, componente:comp, plano:plano};
}
