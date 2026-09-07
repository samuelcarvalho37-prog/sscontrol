const PRODUCTION_BOOTSTRAP = {
  ENVIRONMENT: "PRODUCAO",
  MARKER_KEY: "production.bootstrap.version",
  STATUS_KEY: "production.bootstrap.status",
  INITIALIZED_AT_KEY: "production.bootstrap.initialized_at",
  ADMIN_CREATED_AT_KEY: "production.admin.created_at",
  ADMIN_PROPERTIES: {
    id: "FAB_PRODUCTION_ADMIN_ID",
    nome: "FAB_PRODUCTION_ADMIN_NAME",
    email: "FAB_PRODUCTION_ADMIN_EMAIL",
    matricula: "FAB_PRODUCTION_ADMIN_REGISTRATION",
    senhaTemporaria: "FAB_PRODUCTION_ADMIN_TEMP_PASSWORD"
  }
};

function getConfiguredSpreadsheetStrict_(){
  var props = PropertiesService.getScriptProperties();
  var id = clean_(props.getProperty(PROP_SPREADSHEET_ID));
  if(!id){
    err_(
      "PRODUCTION_SPREADSHEET_ID_REQUIRED",
      "Defina a Script Property " + PROP_SPREADSHEET_ID + " antes do bootstrap de produção.",
      500
    );
  }

  try {
    return SpreadsheetApp.openById(id);
  } catch(e){
    err_(
      "PRODUCTION_SPREADSHEET_OPEN_FAILED",
      "Não foi possível abrir a planilha configurada para produção.",
      500
    );
  }
}

function productionTrimmedHeader_(sheet){
  if(!sheet || sheet.getLastColumn() < 1) return [];
  var values = sheet.getRange(1, 1, 1, sheet.getLastColumn()).getValues()[0].map(function(value){
    return clean_(value);
  });
  while(values.length && !values[values.length - 1]) values.pop();
  return values;
}

function productionRowsDirect_(sheet){
  if(!sheet) return [];
  var lastRow = sheet.getLastRow();
  var headers = productionTrimmedHeader_(sheet);
  if(lastRow < 2 || !headers.length) return [];

  var values = sheet.getRange(2, 1, lastRow - 1, headers.length).getValues();
  return values.map(function(row){
    var item = {};
    headers.forEach(function(header, index){
      item[header] = normCell_(row[index]);
    });
    return item;
  });
}

function productionConfigValueFromSpreadsheet_(ss, key){
  var sheet = ss.getSheetByName("config");
  var rows = productionRowsDirect_(sheet);
  var found = rows.find(function(row){
    return clean_(row.chave) === clean_(key);
  });
  return found ? clean_(found.valor) : "";
}

function productionSpreadsheetDateMatchesVersion_(value, version){
  var match = /^(\d{1,2})\.(\d{1,2})\.(\d{1,4})$/.exec(clean_(version));
  if(!match) return false;

  var day = Number(match[1]);
  var month = Number(match[2]);
  var yearPart = Number(match[3]);
  if(day < 1 || day > 31 || month < 1 || month > 12 || yearPart < 0 || yearPart > 99){
    return false;
  }

  var expected =
    String(2000 + yearPart) + "-" +
    String(month).padStart(2, "0") + "-" +
    String(day).padStart(2, "0");

  return clean_(value).slice(0, 10) === expected;
}

function productionSheetHasAnyValue_(sheet){
  if(!sheet) return false;
  var values = sheet.getDataRange().getDisplayValues();
  return values.some(function(row){
    return row.some(function(value){ return clean_(value) !== ""; });
  });
}

function productionWithBootstrapLock_(callback){
  var lock = LockService.getScriptLock();
  if(!lock.tryLock(30000)){
    err_(
      "PRODUCTION_BOOTSTRAP_LOCKED",
      "Outro bootstrap de produção está em andamento.",
      409
    );
  }

  try {
    return callback();
  } finally {
    lock.releaseLock();
  }
}

function productionAllowedBootstrapConfigKeys_(){
  return [
    "release.version",
    "app.version",
    "api.version",
    "schema.version",
    "contract.version",
    "frontend.version",
    "app.environment",
    PRODUCTION_BOOTSTRAP.MARKER_KEY,
    PRODUCTION_BOOTSTRAP.STATUS_KEY,
    PRODUCTION_BOOTSTRAP.INITIALIZED_AT_KEY,
    PRODUCTION_BOOTSTRAP.ADMIN_CREATED_AT_KEY
  ];
}

function assertSpreadsheetEmptyForProductionBootstrap_(ss){
  var allowedConfigKeys = productionAllowedBootstrapConfigKeys_();
  var violations = [];

  ss.getSheets().forEach(function(sheet){
    var name = sheet.getName();
    var isSchemaSheet = Object.prototype.hasOwnProperty.call(SH, name);

    if(!isSchemaSheet){
      if(productionSheetHasAnyValue_(sheet)){
        violations.push(name + ": aba não prevista preenchida");
      }
      return;
    }

    var actualHeader = productionTrimmedHeader_(sheet);
    var expectedHeader = SH[name];
    if(actualHeader.length && actualHeader.join("|") !== expectedHeader.join("|")){
      violations.push(name + ": cabeçalho divergente");
      return;
    }

    if(sheet.getLastRow() < 2) return;

    if(name !== "config"){
      violations.push(name + ": possui linhas de dados");
      return;
    }

    var seen = {};
    productionRowsDirect_(sheet).forEach(function(row){
      var key = clean_(row.chave);
      if(!key || allowedConfigKeys.indexOf(key) < 0){
        violations.push(name + ": chave não permitida " + (key || "<vazia>"));
        return;
      }
      if(seen[key]){
        violations.push(name + ": chave duplicada " + key);
        return;
      }
      seen[key] = true;
    });
  });

  if(violations.length){
    err_(
      "PRODUCTION_BOOTSTRAP_REQUIRES_EMPTY_SPREADSHEET",
      "Bootstrap bloqueado. A planilha contém dados ou estrutura não segura: " +
        violations.join("; "),
      409
    );
  }
}

function removeEmptyNonSchemaSheets_(ss){
  ss.getSheets().forEach(function(sheet){
    if(!Object.prototype.hasOwnProperty.call(SH, sheet.getName())){
      if(productionSheetHasAnyValue_(sheet)){
        err_(
          "PRODUCTION_UNKNOWN_SHEET_NOT_EMPTY",
          "Aba não prevista contém dados: " + sheet.getName(),
          409
        );
      }
      ss.deleteSheet(sheet);
    }
  });
}

function productionUpsertConfig_(key, value, description){
  upsert_("config", "chave", {
    chave:key,
    valor:value,
    descricao:description,
    atualizado_em:now_()
  });
}

function setupProductionSchema(){
  return productionWithBootstrapLock_(function(){
    invalidateRuntimeCache_();
    var ss = getConfiguredSpreadsheetStrict_();
    var existingMarker = productionConfigValueFromSpreadsheet_(ss, PRODUCTION_BOOTSTRAP.MARKER_KEY);

    if(existingMarker){
      if(existingMarker === FAB_RELEASE_VERSION){
        return Object.assign({already_initialized:true}, diagnoseProductionReadiness());
      }

      if(!productionSpreadsheetDateMatchesVersion_(existingMarker, FAB_RELEASE_VERSION)){
        err_(
          "PRODUCTION_BOOTSTRAP_VERSION_MISMATCH",
          "A planilha já foi inicializada por outra versão: " + existingMarker,
          409
        );
      }
    }

    assertSpreadsheetEmptyForProductionBootstrap_(ss);

    Object.keys(SH).forEach(function(name){
      ensureSheet_(ss, name, SH[name]);
    });
    removeEmptyNonSchemaSheets_(ss);

    syncReleaseVersionConfig_();
    productionUpsertConfig_("app.environment", PRODUCTION_BOOTSTRAP.ENVIRONMENT, "Ambiente operacional");
    productionUpsertConfig_(
      PRODUCTION_BOOTSTRAP.STATUS_KEY,
      "SCHEMA_READY",
      "Estado do bootstrap de produção"
    );
    productionUpsertConfig_(
      PRODUCTION_BOOTSTRAP.INITIALIZED_AT_KEY,
      now_(),
      "Data de inicialização do schema de produção"
    );
    productionUpsertConfig_(
      PRODUCTION_BOOTSTRAP.MARKER_KEY,
      FAB_RELEASE_VERSION,
      "Versão do bootstrap seguro de produção"
    );

    invalidateRuntimeCache_();

    return Object.assign({
      initialized:true,
      spreadsheetId:ss.getId(),
      sheets:Object.keys(SH).length,
      demo_seeded:false
    }, diagnoseProductionReadiness());
  });
}

function productionAdminConfig_(options){
  var props = PropertiesService.getScriptProperties();
  var input = options || {};
  return {
    id:clean_(input.id || props.getProperty(PRODUCTION_BOOTSTRAP.ADMIN_PROPERTIES.id)),
    nome:clean_(input.nome || props.getProperty(PRODUCTION_BOOTSTRAP.ADMIN_PROPERTIES.nome)),
    email:clean_(input.email || props.getProperty(PRODUCTION_BOOTSTRAP.ADMIN_PROPERTIES.email)).toLowerCase(),
    matricula:clean_(input.matricula || props.getProperty(PRODUCTION_BOOTSTRAP.ADMIN_PROPERTIES.matricula)),
    senhaTemporaria:String(
      input.senhaTemporaria ||
      input.senha_temporaria ||
      props.getProperty(PRODUCTION_BOOTSTRAP.ADMIN_PROPERTIES.senhaTemporaria) ||
      ""
    )
  };
}

function validateProductionAdminConfig_(admin){
  ["id", "nome", "email", "matricula", "senhaTemporaria"].forEach(function(field){
    if(!clean_(admin[field])){
      err_(
        "PRODUCTION_ADMIN_FIELD_REQUIRED",
        "Configuração obrigatória ausente para o administrador: " + field,
        400
      );
    }
  });

  if(admin.email.indexOf("@") < 1){
    err_("PRODUCTION_ADMIN_EMAIL_INVALID", "E-mail do administrador inválido.", 400);
  }

  var policy = authPasswordPolicy_(admin.senhaTemporaria);
  if(!policy.ok) err_(policy.code, policy.message, 400);
}

function assertProductionSchemaReadyForAdmin_(diagnosis){
  if(!diagnosis.schema_valid){
    err_(
      "PRODUCTION_SCHEMA_NOT_READY",
      "O schema de produção não está íntegro. Execute setupProductionSchema() em uma planilha vazia.",
      409
    );
  }
  if(diagnosis.environment !== PRODUCTION_BOOTSTRAP.ENVIRONMENT){
    err_("PRODUCTION_ENVIRONMENT_INVALID", "A planilha não está marcada como PRODUCAO.", 409);
  }
  if(diagnosis.synthetic_rows > 0){
    err_("PRODUCTION_SYNTHETIC_DATA_FOUND", "Dados sintéticos foram detectados.", 409);
  }
  if(diagnosis.active_sessions > 0 || diagnosis.operational_rows > 0){
    err_("PRODUCTION_OPERATIONAL_DATA_FOUND", "A planilha já contém dados operacionais.", 409);
  }
}

function productionAdminRowReady_(admin){
  return !!admin &&
    upper_(admin.perfil) === ROLE.ADMIN &&
    upper_(admin.status) === ST.ATIVO &&
    clean_(admin.senha_hash) !== "";
}

function productionAdminIdentityMatches_(existing, configured){
  return productionAdminRowReady_(existing) &&
    upper_(existing.primeiro_acesso) === "SIM" &&
    clean_(existing.id) === clean_(configured.id) &&
    clean_(existing.email).toLowerCase() === clean_(configured.email).toLowerCase() &&
    clean_(existing.matricula || existing.id) === clean_(configured.matricula);
}

function productionAdminAuditExists_(adminId){
  var ss = getConfiguredSpreadsheetStrict_();
  var rows = productionRowsDirect_(ss.getSheetByName("audit_log"));
  return rows.some(function(row){
    return clean_(row.acao) === "PRODUCTION_ADMIN_BOOTSTRAPPED" &&
      clean_(row.entidade) === "usuarios" &&
      clean_(row.entidade_id) === clean_(adminId);
  });
}

function productionEnsureAdminAudit_(admin){
  if(productionAdminAuditExists_(admin.id)) return false;

  audit_(
    {usuario_id:clean_(admin.id), perfil:ROLE.ADMIN},
    "PRODUCTION_ADMIN_BOOTSTRAPPED",
    "usuarios",
    clean_(admin.id),
    null,
    {
      matricula:clean_(admin.matricula || admin.id),
      primeiro_acesso:"SIM"
    },
    "APPS_SCRIPT_BOOTSTRAP"
  );
  return true;
}

function productionClearTemporaryAdminPassword_(){
  PropertiesService.getScriptProperties().deleteProperty(
    PRODUCTION_BOOTSTRAP.ADMIN_PROPERTIES.senhaTemporaria
  );
}

function productionFinalizeAdminBootstrap_(admin, createdAt){
  productionUpsertConfig_(
    PRODUCTION_BOOTSTRAP.STATUS_KEY,
    "ADMIN_READY",
    "Estado do bootstrap de produção"
  );
  productionUpsertConfig_(
    PRODUCTION_BOOTSTRAP.ADMIN_CREATED_AT_KEY,
    createdAt,
    "Data de criação do administrador inicial"
  );

  productionClearTemporaryAdminPassword_();
  productionEnsureAdminAudit_(admin);
  invalidateRuntimeCache_();
}

function productionAdminSummary_(admin){
  return {
    id:clean_(admin.id),
    nome:clean_(admin.nome),
    email:clean_(admin.email),
    matricula:clean_(admin.matricula || admin.id),
    perfil:ROLE.ADMIN,
    primeiro_acesso:clean_(admin.primeiro_acesso || "SIM")
  };
}

function bootstrapProductionAdmin(options){
  return productionWithBootstrapLock_(function(){
    invalidateRuntimeCache_();
    var ss = getConfiguredSpreadsheetStrict_();

    var diagnosis = diagnoseProductionReadiness();
    assertProductionSchemaReadyForAdmin_(diagnosis);

    var users = rows_("usuarios", true);
    if(users.length){
      var existing = users.length === 1 ? users[0] : null;
      var bootstrapStatus = productionConfigValueFromSpreadsheet_(
        ss,
        PRODUCTION_BOOTSTRAP.STATUS_KEY
      );
      var adminCreatedAt = productionConfigValueFromSpreadsheet_(
        ss,
        PRODUCTION_BOOTSTRAP.ADMIN_CREATED_AT_KEY
      );

      if(
        bootstrapStatus === "ADMIN_READY" &&
        adminCreatedAt &&
        productionAdminRowReady_(existing)
      ){
        productionClearTemporaryAdminPassword_();
        productionEnsureAdminAudit_(existing);
        invalidateRuntimeCache_();

        return Object.assign({
          already_created:true,
          temporary_password_cleared:true,
          admin:productionAdminSummary_(existing)
        }, diagnoseProductionReadiness());
      }

      var recoveryAdmin = productionAdminConfig_(options);
      if(existing && productionAdminIdentityMatches_(existing, recoveryAdmin)){
        productionFinalizeAdminBootstrap_(
          existing,
          clean_(existing.criado_em) || now_()
        );

        return Object.assign({
          recovered:true,
          temporary_password_cleared:true,
          admin:productionAdminSummary_(existing)
        }, diagnoseProductionReadiness());
      }

      err_(
        "PRODUCTION_ADMIN_BOOTSTRAP_BLOCKED",
        "Bootstrap bloqueado porque a aba usuarios já contém registros não recuperáveis.",
        409
      );
    }

    var admin = productionAdminConfig_(options);
    validateProductionAdminConfig_(admin);

    var createdAt = now_();
    append_("usuarios", fit_("usuarios", {
      id:admin.id,
      nome:admin.nome,
      email:admin.email,
      perfil:ROLE.ADMIN,
      status:ST.ATIVO,
      pin_hash:"",
      criado_em:createdAt,
      atualizado_em:createdAt,
      matricula:admin.matricula,
      senha_hash:authCreatePasswordHash_(admin.senhaTemporaria),
      primeiro_acesso:"SIM",
      tentativas_login:0,
      bloqueado_ate:"",
      ultimo_login_em:"",
      senha_atualizada_em:"",
      recuperacao_referencia:"",
      recuperacao_solicitada_em:""
    }));

    productionFinalizeAdminBootstrap_(admin, createdAt);

    return Object.assign({
      created:true,
      temporary_password_cleared:true,
      admin:productionAdminSummary_(admin)
    }, diagnoseProductionReadiness());
  });
}

function productionSyntheticRowCount_(ss){
  var markers = ["DEMO", "HOMOLOG", "POSTMAN", "FABCONTROL.LOCAL", "HML"];
  var count = 0;

  ss.getSheets().forEach(function(sheet){
    if(sheet.getLastRow() < 2 || sheet.getLastColumn() < 1) return;
    var values = sheet.getRange(2, 1, sheet.getLastRow() - 1, sheet.getLastColumn()).getDisplayValues();

    values.forEach(function(row){
      var text = row.join(" | ").toUpperCase();
      if(markers.some(function(marker){ return text.indexOf(marker) >= 0; })) count++;
    });
  });

  return count;
}

function diagnoseProductionReadiness(){
  var ss = getConfiguredSpreadsheetStrict_();
  var expectedNames = Object.keys(SH);
  var actualNames = ss.getSheets().map(function(sheet){ return sheet.getName(); });
  var missingSheets = expectedNames.filter(function(name){ return actualNames.indexOf(name) < 0; });
  var unknownSheets = actualNames.filter(function(name){ return expectedNames.indexOf(name) < 0; });
  var headerMismatches = [];
  var rowCounts = {};

  expectedNames.forEach(function(name){
    var sheet = ss.getSheetByName(name);
    if(!sheet){
      rowCounts[name] = 0;
      return;
    }

    var actualHeader = productionTrimmedHeader_(sheet);
    var expectedHeader = SH[name];
    rowCounts[name] = Math.max(0, sheet.getLastRow() - 1);

    if(actualHeader.join("|") !== expectedHeader.join("|")){
      headerMismatches.push({
        sheet:name,
        expected_columns:expectedHeader.length,
        actual_columns:actualHeader.length
      });
    }
  });

  var users = productionRowsDirect_(ss.getSheetByName("usuarios"));
  var sessions = productionRowsDirect_(ss.getSheetByName("sessoes"));
  var activeSessions = sessions.filter(function(session){
    return upper_(session.status) === ST.ATIVO &&
      authSessionExpiryMs_(session) > Date.now();
  }).length;
  var activeAdmins = users.filter(function(user){
    return upper_(user.perfil) === ROLE.ADMIN && upper_(user.status) === ST.ATIVO;
  }).length;

  var operationalRows = expectedNames.reduce(function(total, name){
    if(["config", "usuarios", "sessoes", "audit_log"].indexOf(name) >= 0) return total;
    return total + (rowCounts[name] || 0);
  }, 0);

  var environment = productionConfigValueFromSpreadsheet_(ss, "app.environment");
  var markerVersion = productionConfigValueFromSpreadsheet_(ss, PRODUCTION_BOOTSTRAP.MARKER_KEY);
  var syntheticRows = productionSyntheticRowCount_(ss);
  var schemaValid =
    missingSheets.length === 0 &&
    unknownSheets.length === 0 &&
    headerMismatches.length === 0 &&
    markerVersion === FAB_RELEASE_VERSION;

  var stage = "BLOCKED_SCHEMA";
  if(schemaValid){
    if(syntheticRows > 0 || activeSessions > 0 || operationalRows > 0){
      stage = "BLOCKED_DATA";
    } else if(users.length === 0){
      stage = "SCHEMA_READY";
    } else if(users.length === 1 && activeAdmins === 1){
      stage = "READY_FOR_CANARY";
    } else {
      stage = "BLOCKED_USERS";
    }
  }

  return {
    dry_run:true,
    spreadsheetId:ss.getId(),
    release_version:FAB_RELEASE_VERSION,
    environment:environment,
    bootstrap_marker:markerVersion,
    stage:stage,
    ready:stage === "READY_FOR_CANARY",
    schema_valid:schemaValid,
    missing_sheets:missingSheets,
    unknown_sheets:unknownSheets,
    header_mismatches:headerMismatches,
    sheet_count:actualNames.length,
    row_counts:rowCounts,
    users:users.length,
    active_admins:activeAdmins,
    sessions:sessions.length,
    active_sessions:activeSessions,
    operational_rows:operationalRows,
    synthetic_rows:syntheticRows
  };
}
