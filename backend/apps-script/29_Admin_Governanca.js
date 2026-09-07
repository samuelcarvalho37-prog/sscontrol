/**
 * Documentos, auditoria, monitoramento e backup administrativo.
 * Arquivos permanecem privados no Drive da conta proprietária do Apps Script.
 */

const ADMIN_DOCUMENT_MAX_BYTES = 6 * 1024 * 1024;
const ADMIN_DOCUMENT_TYPES = ["MANUAL","DIAGRAMA","CERTIFICADO","LAUDO","PROCEDIMENTO","FICHA_TECNICA","OUTRO"];
const ADMIN_DOCUMENT_STATUSES = ["RASCUNHO","EM_REVISAO","VIGENTE","OBSOLETO"];
const ADMIN_DOCUMENT_ENTITY_TYPES = ["EMPRESA","PLANTA","SETOR","LINHA","ATIVO","COMPONENTE"];
const ADMIN_DOCUMENT_ALLOWED_MIME = [
  "application/pdf",
  "image/jpeg",
  "image/png",
  "application/msword",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  "application/vnd.ms-excel",
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  "text/csv"
];
const ADMIN_RESTORE_PROTECTED_SHEETS = [
  "config","usuarios","sessoes","audit_log","configuracao_versoes","configuracao_rascunhos","execucao_locks"
];
const ADMIN_RESTORE_REQUIRED_SHEETS = [
  "plantas","setores","linhas","ativos","componentes","planos_manutencao","plano_itens","ordens_servico","os_acoes"
];
const ADMIN_RESTORE_MAX_CELLS = 600000;
const ADMIN_RESTORE_FINAL_CONFIRMATION = "ENTENDO QUE OS DADOS OPERACIONAIS SERAO SUBSTITUIDOS";

function adminGovernanceEnsureSchema_(){
  var ss = getSpreadsheet_();
  ensureSheet_(ss, "documentos_tecnicos", SH.documentos_tecnicos);
  ensureSheet_(ss, "documento_revisoes", SH.documento_revisoes);
}

function adminManagedFolder_(propertyKey, namePrefix){
  var props = PropertiesService.getScriptProperties();
  var existingId = clean_(props.getProperty(propertyKey));
  if(existingId){
    try { return DriveApp.getFolderById(existingId); } catch(error){}
  }
  var folder = DriveApp.createFolder(namePrefix + " - " + getSpreadsheet_().getId());
  props.setProperty(propertyKey, folder.getId());
  return folder;
}

function adminDocumentFolder_(){
  return adminManagedFolder_("FAB_DOCUMENTS_FOLDER_ID", "FAB Control - Documentos");
}

function adminBackupFolder_(){
  return adminManagedFolder_("FAB_BACKUP_FOLDER_ID", "FAB Control - Backups");
}

function adminDocumentValidateLink_(entityType, entityId){
  var type = upper_(entityType || "EMPRESA");
  if(ADMIN_DOCUMENT_ENTITY_TYPES.indexOf(type) < 0) err_("DOCUMENT_ENTITY_TYPE_INVALID", "Tipo de vínculo documental inválido.", 400);
  if(type === "EMPRESA") return {type:type, id:""};
  if(!clean_(entityId)) err_("DOCUMENT_ENTITY_REQUIRED", "Selecione o cadastro vinculado ao documento.", 400);
  var sheets = {PLANTA:"plantas",SETOR:"setores",LINHA:"linhas",ATIVO:"ativos",COMPONENTE:"componentes"};
  if(!find_(sheets[type], "id", entityId)) err_("DOCUMENT_ENTITY_NOT_FOUND", "Cadastro vinculado ao documento não foi encontrado.", 404);
  return {type:type, id:clean_(entityId)};
}

function adminDocumentNormalizeMetadata_(input, old){
  var data = Object.assign({}, input || {});
  req_(data, ["titulo","tipo"]);
  if(clean_(data.titulo).length < 3) err_("DOCUMENT_TITLE_REQUIRED", "Informe um título documental.", 400);
  var type = upper_(data.tipo);
  if(ADMIN_DOCUMENT_TYPES.indexOf(type) < 0) err_("DOCUMENT_TYPE_INVALID", "Tipo documental inválido.", 400);
  var status = upper_(data.status || (old && old.status) || "RASCUNHO");
  if(ADMIN_DOCUMENT_STATUSES.indexOf(status) < 0) err_("DOCUMENT_STATUS_INVALID", "Status documental inválido.", 400);
  var link = adminDocumentValidateLink_(data.entidade_tipo || (old && old.entidade_tipo), data.entidade_id || (old && old.entidade_id));
  var responsibleId = clean_(data.responsavel_id || (old && old.responsavel_id));
  if(responsibleId && !find_("usuarios", "id", responsibleId)) err_("DOCUMENT_RESPONSIBLE_NOT_FOUND", "Responsável selecionado não foi encontrado.", 404);
  var validity = clean_(data.validade_em);
  if(validity && isNaN(new Date(validity).getTime())) err_("DOCUMENT_VALIDITY_INVALID", "Informe uma data de validade válida.", 400);
  return {
    titulo:clean_(data.titulo), tipo:type, entidade_tipo:link.type, entidade_id:link.id,
    status:status, validade_em:validity, responsavel_id:responsibleId,
    descricao:clean_(data.descricao)
  };
}

function adminDocumentPublic_(row){
  var out = strip_(row);
  var validity = new Date(clean_(row.validade_em)).getTime();
  out.vencido = !!validity && validity < Date.now() && upper_(row.status) === "VIGENTE";
  out.status_exibicao = out.vencido ? "VENCIDO" : upper_(row.status);
  return out;
}

function adminDocumentosListar_(p, auth){
  adminRequireIdentityAdmin_(auth);
  adminGovernanceEnsureSchema_();
  var status = upper_(p.status);
  var type = upper_(p.tipo);
  var search = clean_(p.busca).toLowerCase();
  var items = rows_("documentos_tecnicos", true).filter(function(item){
    if(status && upper_(item.status) !== status) return false;
    if(type && upper_(item.tipo) !== type) return false;
    if(!search) return true;
    return [item.codigo,item.titulo,item.tipo,item.arquivo_nome,item.entidade_tipo,item.entidade_id]
      .some(function(value){ return clean_(value).toLowerCase().indexOf(search) >= 0; });
  }).sort(sortByDateDesc_("atualizado_em")).slice(0, Math.min(num_(p.limite,300),500)).map(adminDocumentPublic_);
  return {total:items.length, documentos:items};
}

function adminDocumentoDetalhe_(p, auth){
  adminRequireIdentityAdmin_(auth);
  adminGovernanceEnsureSchema_();
  req_(p, ["documento_id"]);
  var document = find_("documentos_tecnicos", "id", p.documento_id);
  if(!document) err_("DOCUMENT_NOT_FOUND", "Documento não encontrado.", 404);
  var revisions = rows_("documento_revisoes", true).filter(function(item){
    return String(item.documento_id) === String(document.id);
  }).sort(sortByDateDesc_("criado_em")).map(strip_);
  var url = "";
  try { url = DriveApp.getFileById(document.arquivo_id).getUrl(); } catch(error){}
  return {documento:adminDocumentPublic_(document), revisoes:revisions, arquivo_url:url};
}

function adminDocumentoDecodeFile_(file){
  if(!file || !clean_(file.base64) || !clean_(file.nome) || !clean_(file.mime_type)){
    err_("DOCUMENT_FILE_REQUIRED", "Selecione um arquivo para a revisão.", 400);
  }
  var mime = clean_(file.mime_type).toLowerCase();
  if(ADMIN_DOCUMENT_ALLOWED_MIME.indexOf(mime) < 0) err_("DOCUMENT_FILE_TYPE_INVALID", "Formato de arquivo não permitido.", 400);
  var bytes;
  try { bytes = Utilities.base64Decode(String(file.base64).replace(/^data:[^;]+;base64,/, "")); }
  catch(error){ err_("DOCUMENT_FILE_INVALID", "Conteúdo do arquivo inválido.", 400); }
  if(!bytes || !bytes.length) err_("DOCUMENT_FILE_EMPTY", "O arquivo está vazio.", 400);
  if(bytes.length > ADMIN_DOCUMENT_MAX_BYTES) err_("DOCUMENT_FILE_TOO_LARGE", "O arquivo excede o limite de 6 MB.", 413);
  return {bytes:bytes, nome:clean_(file.nome).slice(0,180), mime_type:mime, tamanho_bytes:bytes.length};
}

function adminDocumentoUpload_(p, auth){
  adminRequireIdentityAdmin_(auth);
  adminGovernanceEnsureSchema_();
  var data = Object.assign({}, p.dados || {});
  var old = data.documento_id ? find_("documentos_tecnicos", "id", data.documento_id) : null;
  if(data.documento_id && !old) err_("DOCUMENT_NOT_FOUND", "Documento da nova revisão não foi encontrado.", 404);
  var metadata = adminDocumentNormalizeMetadata_(data, old);
  var file = adminDocumentoDecodeFile_(p.arquivo || data.arquivo);
  var revision = upper_(data.revisao || (old ? "R"+(rows_("documento_revisoes", true).filter(function(item){ return String(item.documento_id) === String(old.id); }).length+1) : "R1"));
  if(!revision) err_("DOCUMENT_REVISION_REQUIRED", "Informe a revisão documental.", 400);
  var documentId = old ? old.id : uuid_("DOC");
  var duplicate = rows_("documento_revisoes", true).find(function(item){
    return String(item.documento_id) === String(documentId) && upper_(item.revisao) === revision;
  });
  if(duplicate) err_("DOCUMENT_REVISION_EXISTS", "Esta revisão já existe para o documento.", 409);
  var lock = LockService.getScriptLock();
  if(!lock.tryLock(15000)) err_("ADMIN_WRITE_BUSY", "Outra alteração administrativa está em andamento.", 409);
  var driveFile = null;
  var revisionRow = null;
  var documentWritten = false;
  var before = old ? adminDocumentPublic_(old) : null;
  try{
    var blob = Utilities.newBlob(file.bytes, file.mime_type, file.nome);
    driveFile = adminDocumentFolder_().createFile(blob);
    driveFile.setDescription("FAB Control "+documentId+" "+revision);
    var now = now_();
    revisionRow = fit_("documento_revisoes", {
      id:uuid_("DREV"), documento_id:documentId, revisao:revision, arquivo_id:driveFile.getId(),
      arquivo_nome:file.nome, mime_type:file.mime_type, tamanho_bytes:file.tamanho_bytes,
      observacao:clean_(data.observacao), criado_por:auth.usuario_id, criado_em:now
    });
    append_("documento_revisoes", revisionRow);
    var document = fit_("documentos_tecnicos", Object.assign({}, old || {}, metadata, {
      id:documentId,
      codigo:old ? old.codigo : upper_(data.codigo || "DOC-"+Utilities.formatDate(new Date(), FAB.TZ, "yyyyMMdd-HHmmss")),
      revisao_atual:revision, arquivo_id:driveFile.getId(), arquivo_nome:file.nome,
      mime_type:file.mime_type, tamanho_bytes:file.tamanho_bytes,
      criado_por:old ? old.criado_por : auth.usuario_id, criado_em:old ? old.criado_em : now, atualizado_em:now
    }));
    if(old) update_("documentos_tecnicos", old.__rowIndex, document); else append_("documentos_tecnicos", document);
    documentWritten = true;
    audit_(auth, old ? "DOCUMENT_REVISION_CREATED" : "DOCUMENT_CREATED", "documentos_tecnicos", document.id, before, adminDocumentPublic_(document), clean_(p.user_agent));
    return {saved:true, mode:old ? "revision" : "insert", documento:adminDocumentPublic_(document), revisao:strip_(revisionRow)};
  } catch(error){
    if(documentWritten){
      var storedDocument = find_("documentos_tecnicos", "id", documentId);
      if(storedDocument){
        if(old) update_("documentos_tecnicos", storedDocument.__rowIndex, fit_("documentos_tecnicos", old));
        else deleteRow_("documentos_tecnicos", storedDocument.__rowIndex);
      }
    }
    if(revisionRow){
      var storedRevision = find_("documento_revisoes", "id", revisionRow.id);
      if(storedRevision) deleteRow_("documento_revisoes", storedRevision.__rowIndex);
    }
    if(driveFile){ try { driveFile.setTrashed(true); } catch(ignore){} }
    throw error;
  } finally {
    lock.releaseLock();
  }
}

function adminDocumentoAtualizar_(p, auth){
  adminRequireIdentityAdmin_(auth);
  adminGovernanceEnsureSchema_();
  var data = Object.assign({}, p.dados || {});
  req_(data, ["id"]);
  var old = find_("documentos_tecnicos", "id", data.id);
  if(!old) err_("DOCUMENT_NOT_FOUND", "Documento não encontrado.", 404);
  var metadata = adminDocumentNormalizeMetadata_(data, old);
  var before = adminDocumentPublic_(old);
  var patch = Object.assign({}, metadata, {atualizado_em:now_()});
  update_("documentos_tecnicos", old.__rowIndex, patch);
  var after = adminDocumentPublic_(Object.assign({}, old, patch));
  audit_(auth, "DOCUMENT_METADATA_UPDATED", "documentos_tecnicos", old.id, before, after, clean_(p.user_agent));
  return {saved:true, documento:after};
}

function adminGovernanceRedact_(value){
  if(value === null || value === undefined) return value;
  if(Array.isArray(value)) return value.map(adminGovernanceRedact_);
  if(typeof value !== "object") return value;
  var out = {};
  Object.keys(value).forEach(function(key){
    if(/senha|pin|token|pepper|segredo|secret|hash/i.test(key)) out[key] = "[PROTEGIDO]";
    else out[key] = adminGovernanceRedact_(value[key]);
  });
  return out;
}

function adminGovernanceSafeJson_(value){
  if(!clean_(value)) return "";
  try { return JSON.stringify(adminGovernanceRedact_(JSON.parse(value))); }
  catch(error){ return "[CONTEUDO_NAO_ESTRUTURADO]"; }
}

function adminAuditoriaListar_(p, auth){
  adminRequireIdentityAdmin_(auth);
  var action = upper_(p.acao);
  var entity = clean_(p.entidade).toLowerCase();
  var userId = clean_(p.usuario_id);
  var search = clean_(p.busca).toLowerCase();
  var items = rows_("audit_log", true).filter(function(item){
    if(action && upper_(item.acao).indexOf(action) < 0) return false;
    if(entity && clean_(item.entidade).toLowerCase() !== entity) return false;
    if(userId && String(item.usuario_id) !== String(userId)) return false;
    if(!search) return true;
    return [item.acao,item.entidade,item.entidade_id,item.usuario_id].some(function(value){
      return clean_(value).toLowerCase().indexOf(search) >= 0;
    });
  }).sort(sortByDateDesc_("criado_em")).slice(0, Math.min(num_(p.limite,200),500)).map(function(item){
    var out = strip_(item);
    out.antes_json = adminGovernanceSafeJson_(item.antes_json);
    out.depois_json = adminGovernanceSafeJson_(item.depois_json);
    return out;
  });
  return {total:items.length, eventos:items};
}

function adminMonitoramentoEstado_(p, auth){
  adminRequireIdentityAdmin_(auth);
  var diagnostics = cmmsHigieneDiagnosticar_(Object.assign({}, p, {dry_run:true}));
  var nowMs = Date.now();
  var last24h = rows_("audit_log", true).filter(function(item){
    var time = new Date(clean_(item.criado_em)).getTime();
    return time && time >= nowMs - 86400000;
  });
  return {
    health:sistemaHealth_(),
    diagnostico:diagnostics,
    cache:perfCacheStatus_(p),
    auditoria:{eventos_24h:last24h.length, ultimo_evento:last24h.sort(sortByDateDesc_("criado_em"))[0] ? strip_(last24h.sort(sortByDateDesc_("criado_em"))[0]) : null},
    tabelas_declaradas:Object.keys(SH).length,
    verificado_em:now_()
  };
}

function adminBackupsListar_(p, auth){
  adminRequireIdentityAdmin_(auth);
  var folder = adminBackupFolder_();
  var iterator = folder.getFiles();
  var items = [];
  while(iterator.hasNext() && items.length < Math.min(num_(p.limite,100),200)){
    var file = iterator.next();
    items.push({
      id:file.getId(), nome:file.getName(), tamanho_bytes:file.getSize(), criado_em:file.getDateCreated().toISOString(),
      atualizado_em:file.getLastUpdated().toISOString(), url:file.getUrl(), pasta_id:folder.getId()
    });
  }
  items.sort(function(a,b){ return clean_(b.criado_em).localeCompare(clean_(a.criado_em)); });
  return {
    total:items.length, backups:items, pasta_id:folder.getId(), restauracao_disponivel:items.length > 0,
    escopo_restauracao:"OPERACIONAL_SEGURO", abas_protegidas:ADMIN_RESTORE_PROTECTED_SHEETS.slice()
  };
}

function adminBackupCreateCopy_(auth, reason, userAgent, auditAction){
  var spreadsheet = getSpreadsheet_();
  SpreadsheetApp.flush();
  var source = DriveApp.getFileById(spreadsheet.getId());
  var prefix = auditAction === "SAFETY_BACKUP_CREATED" ? "FAB-Control-Safety" : "FAB-Control-Backup";
  var name = prefix+"-"+FAB.VERSION+"-"+Utilities.formatDate(new Date(), FAB.TZ, "yyyyMMdd-HHmmss");
  var copy = source.makeCopy(name, adminBackupFolder_());
  copy.setDescription("Backup criado pelo Fab Control. Motivo: "+clean_(reason));
  var result = {id:copy.getId(), nome:copy.getName(), tamanho_bytes:copy.getSize(), criado_em:copy.getDateCreated().toISOString(), url:copy.getUrl()};
  audit_(auth, auditAction || "BACKUP_CREATED", "spreadsheet", spreadsheet.getId(), null, result, clean_(userAgent));
  return result;
}

function adminBackupCriar_(p, auth){
  adminRequireIdentityAdmin_(auth);
  if(upper_(p.confirmacao) !== "CRIAR BACKUP") err_("BACKUP_CONFIRMATION_REQUIRED", "Confirme com a frase CRIAR BACKUP.", 400);
  if(clean_(p.motivo).length < 5) err_("BACKUP_REASON_REQUIRED", "Informe o motivo do backup.", 400);
  var lock = LockService.getScriptLock();
  if(!lock.tryLock(20000)) err_("BACKUP_BUSY", "Outro processo administrativo está em andamento.", 409);
  try{
    return {created:true, backup:adminBackupCreateCopy_(auth, p.motivo, p.user_agent, "BACKUP_CREATED"), restauracao_disponivel:true};
  } finally {
    lock.releaseLock();
  }
}

function adminBackupFindManaged_(backupId){
  var id = clean_(backupId);
  if(!id) err_("BACKUP_REQUIRED", "Selecione um backup para restaurar.", 400);
  var iterator = adminBackupFolder_().getFiles();
  while(iterator.hasNext()){
    var file = iterator.next();
    if(String(file.getId()) === id) return file;
  }
  err_("BACKUP_NOT_MANAGED", "O arquivo selecionado não pertence ao diretório privado de backups.", 404);
}

function adminBackupRestorePreview_(backupId){
  var currentId = getSpreadsheet_().getId();
  if(String(backupId) === String(currentId)) err_("BACKUP_CURRENT_FILE_FORBIDDEN", "A base atual não pode ser usada como origem de restauração.", 409);
  var spreadsheet;
  try { spreadsheet = SpreadsheetApp.openById(backupId); }
  catch(error){ err_("BACKUP_SPREADSHEET_INVALID", "O backup não é uma planilha Google válida ou acessível.", 400); }
  var sourceNames = spreadsheet.getSheets().map(function(sheet){ return sheet.getName(); });
  var restorable = Object.keys(SH).filter(function(name){
    return ADMIN_RESTORE_PROTECTED_SHEETS.indexOf(name) < 0 && sourceNames.indexOf(name) >= 0;
  });
  var requiredMissing = ADMIN_RESTORE_REQUIRED_SHEETS.filter(function(name){ return sourceNames.indexOf(name) < 0; });
  if(requiredMissing.length) err_("BACKUP_REQUIRED_SHEETS_MISSING", "O backup não possui as abas operacionais obrigatórias: "+requiredMissing.join(", ")+".", 409);
  var totalCells = restorable.reduce(function(total, name){
    var sheet = spreadsheet.getSheetByName(name);
    return total + Math.max(sheet.getLastRow(), 1) * Math.max(sheet.getLastColumn(), 1);
  }, 0);
  if(totalCells > ADMIN_RESTORE_MAX_CELLS) err_("BACKUP_RESTORE_TOO_LARGE", "O backup excede o limite seguro de "+ADMIN_RESTORE_MAX_CELLS+" células por restauração.", 413);
  return {
    spreadsheet:spreadsheet, abas_restauradas:restorable,
    abas_ausentes:Object.keys(SH).filter(function(name){ return sourceNames.indexOf(name) < 0; }),
    total_celulas:totalCells
  };
}

function adminBackupPrepararRestauracao_(p, auth){
  adminRequireIdentityAdmin_(auth);
  var file = adminBackupFindManaged_(p.backup_id);
  var preview = adminBackupRestorePreview_(file.getId());
  var token = authRandomToken_("RESTORE");
  var tokenHash = sha256_(token);
  var challenge = "RESTAURAR "+tokenHash.slice(0, 6).toUpperCase();
  var expiresAt = addMinutes_(new Date(), 10);
  var pending = {
    backup_id:file.getId(), backup_nome:file.getName(), usuario_id:auth.usuario_id,
    challenge:challenge, abas_restauradas:preview.abas_restauradas,
    abas_ausentes:preview.abas_ausentes, total_celulas:preview.total_celulas,
    expira_em:iso_(expiresAt)
  };
  CacheService.getScriptCache().put("ADMIN_RESTORE_"+tokenHash, JSON.stringify(pending), 600);
  return {
    prepared:true, token:token, desafio:challenge,
    confirmacao_final:ADMIN_RESTORE_FINAL_CONFIRMATION,
    backup:{id:file.getId(), nome:file.getName(), criado_em:file.getDateCreated().toISOString()},
    escopo:"OPERACIONAL_SEGURO", abas_restauradas:preview.abas_restauradas,
    abas_protegidas:ADMIN_RESTORE_PROTECTED_SHEETS.slice(), abas_ausentes:preview.abas_ausentes,
    total_celulas:preview.total_celulas, expira_em:pending.expira_em
  };
}

function adminBackupRestoreSheetValues_(sourceSheet, targetSheet){
  var rowsCount = Math.max(sourceSheet.getLastRow(), 1);
  var columnsCount = Math.max(sourceSheet.getLastColumn(), 1);
  if(targetSheet.getMaxRows() < rowsCount) targetSheet.insertRowsAfter(targetSheet.getMaxRows(), rowsCount - targetSheet.getMaxRows());
  if(targetSheet.getMaxColumns() < columnsCount) targetSheet.insertColumnsAfter(targetSheet.getMaxColumns(), columnsCount - targetSheet.getMaxColumns());
  var values = sourceSheet.getRange(1, 1, rowsCount, columnsCount).getValues();
  targetSheet.clearContents();
  targetSheet.getRange(1, 1, rowsCount, columnsCount).setValues(values);
}

function adminBackupRestoreOperational_(sourceSpreadsheet, targetSpreadsheet, sheetNames, safetySpreadsheet){
  var affected = [];
  var created = [];
  try{
    sheetNames.forEach(function(name){
      var source = sourceSpreadsheet.getSheetByName(name);
      var target = targetSpreadsheet.getSheetByName(name);
      if(!target){
        target = targetSpreadsheet.insertSheet(name);
        target.getRange(1, 1, 1, SH[name].length).setValues([SH[name]]);
        created.push(name);
      }
      affected.push(name);
      adminBackupRestoreSheetValues_(source, target);
    });
    SpreadsheetApp.flush();
    return affected;
  } catch(error){
    var rollbackErrors = [];
    affected.slice().reverse().forEach(function(name){
      try{
        if(created.indexOf(name) >= 0){
          var createdSheet = targetSpreadsheet.getSheetByName(name);
          if(createdSheet) targetSpreadsheet.deleteSheet(createdSheet);
          return;
        }
        var rollbackSource = safetySpreadsheet.getSheetByName(name);
        var rollbackTarget = targetSpreadsheet.getSheetByName(name);
        if(rollbackSource && rollbackTarget) adminBackupRestoreSheetValues_(rollbackSource, rollbackTarget);
      } catch(rollbackError){ rollbackErrors.push(name); }
    });
    SpreadsheetApp.flush();
    if(rollbackErrors.length) err_("BACKUP_RESTORE_ROLLBACK_FAILED", "A restauração falhou e exige recuperação manual das abas: "+rollbackErrors.join(", ")+".", 500);
    err_("BACKUP_RESTORE_FAILED", "A restauração falhou e as abas já alteradas foram revertidas pelo backup de segurança.", 500);
  }
}

function adminBackupConfirmarRestauracao_(p, auth){
  adminRequireIdentityAdmin_(auth);
  req_(p, ["token","backup_id","confirmacao","confirmacao_final","motivo"]);
  if(p.criar_backup_seguranca !== true) err_("BACKUP_SAFETY_COPY_REQUIRED", "A cópia automática de segurança é obrigatória.", 400);
  if(clean_(p.motivo).length < 8) err_("BACKUP_RESTORE_REASON_REQUIRED", "Informe o motivo detalhado da restauração.", 400);
  var tokenHash = sha256_(clean_(p.token));
  var cache = CacheService.getScriptCache();
  var cached = cache.get("ADMIN_RESTORE_"+tokenHash);
  if(!cached) err_("BACKUP_RESTORE_TOKEN_EXPIRED", "A preparação expirou. Analise o backup novamente.", 409);
  var pending;
  try { pending = JSON.parse(cached); } catch(error){ err_("BACKUP_RESTORE_TOKEN_INVALID", "Preparação de restauração inválida.", 409); }
  if(String(pending.usuario_id) !== String(auth.usuario_id) || String(pending.backup_id) !== String(p.backup_id)) err_("BACKUP_RESTORE_CONTEXT_MISMATCH", "O backup ou administrador não corresponde à preparação.", 403);
  if(upper_(p.confirmacao) !== upper_(pending.challenge)) err_("BACKUP_RESTORE_CHALLENGE_REQUIRED", "Digite exatamente o desafio de restauração apresentado.", 400);
  if(upper_(p.confirmacao_final) !== ADMIN_RESTORE_FINAL_CONFIRMATION) err_("BACKUP_RESTORE_FINAL_CONFIRMATION_REQUIRED", "A segunda confirmação obrigatória não foi aceita.", 400);
  var lock = LockService.getScriptLock();
  if(!lock.tryLock(30000)) err_("BACKUP_RESTORE_BUSY", "Outra operação administrativa está em andamento.", 409);
  try{
    var file = adminBackupFindManaged_(pending.backup_id);
    var preview = adminBackupRestorePreview_(file.getId());
    var target = getSpreadsheet_();
    var safety = adminBackupCreateCopy_(auth, "Cópia automática antes da restauração: "+clean_(p.motivo), p.user_agent, "SAFETY_BACKUP_CREATED");
    var safetySpreadsheet;
    try { safetySpreadsheet = SpreadsheetApp.openById(safety.id); }
    catch(error){ err_("BACKUP_SAFETY_COPY_UNAVAILABLE", "A cópia de segurança foi criada, mas ainda não está disponível. Nenhum dado foi alterado.", 503); }
    cache.remove("ADMIN_RESTORE_"+tokenHash);
    var restored = adminBackupRestoreOperational_(preview.spreadsheet, target, preview.abas_restauradas, safetySpreadsheet);
    DB_CACHE = {};
    var result = {
      restored:true, backup_id:file.getId(), backup_nome:file.getName(), escopo:"OPERACIONAL_SEGURO",
      abas_restauradas:restored, abas_protegidas:ADMIN_RESTORE_PROTECTED_SHEETS.slice(),
      backup_seguranca:safety, motivo:clean_(p.motivo), restaurado_em:now_()
    };
    audit_(auth, "BACKUP_OPERATIONAL_RESTORED", "spreadsheet", target.getId(), null, result, clean_(p.user_agent));
    return result;
  } finally {
    lock.releaseLock();
  }
}
