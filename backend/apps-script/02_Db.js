var DB_CACHE = {};

function scriptCache_(){
  try { return CacheService.getScriptCache(); } catch(e){ return null; }
}

function tableCacheKey_(name){
  return "FAB_TABLE_" + FAB.VERSION + "_" + name;
}

function metaCacheKey_(key){
  return "FAB_META_" + FAB.VERSION + "_" + key;
}

function safeCacheGetJson_(key){
  var c = scriptCache_();
  if(!c) return null;
  var raw = c.get(key);
  if(!raw) return null;
  try { return JSON.parse(raw); } catch(e){ return null; }
}

function safeCachePutJson_(key, obj, seconds){
  var c = scriptCache_();
  if(!c) return false;
  try {
    var raw = JSON.stringify(obj);
    if(raw.length > 90000) return false;
    c.put(key, raw, Math.max(5, Math.min(Number(seconds || 60), 21600)));
    return true;
  } catch(e){
    return false;
  }
}

function safeCacheRemove_(key){
  var c = scriptCache_();
  if(!c) return;
  try { c.remove(key); } catch(e){}
}

function invalidateSheetCache_(name){
  delete DB_CACHE[name];
  safeCacheRemove_(tableCacheKey_(name));
  safeCacheRemove_(metaCacheKey_("admin_resumo"));
  safeCacheRemove_(metaCacheKey_("qr_index"));
  safeCacheRemove_(metaCacheKey_("qr_index_v3"));
  safeCacheRemove_(metaCacheKey_("warmup_status"));
}

function invalidateRuntimeCache_(){
  DB_CACHE = {};
  if(typeof CONFIG_ENGINE_RUNTIME_CACHE !== "undefined") CONFIG_ENGINE_RUNTIME_CACHE = null;
  safeCacheRemove_(metaCacheKey_("admin_resumo"));
  safeCacheRemove_(metaCacheKey_("qr_index"));
  safeCacheRemove_(metaCacheKey_("qr_index_v3"));
  safeCacheRemove_(metaCacheKey_("warmup_status"));
}

function setupInicial(){ return setupProductionSchema(); }

function setupCMMSCore(){
  invalidateRuntimeCache_();
  var ss = getSpreadsheet_();
  Object.keys(SH).forEach(function(name){ ensureSheet_(ss, name, SH[name]); });
  seedBase_();
  return { ok:true, version:FAB.VERSION, spreadsheetId:ss.getId(), sheets:Object.keys(SH).length };
}

function getSpreadsheet_(){
  var props = PropertiesService.getScriptProperties();
  var id = props.getProperty(PROP_SPREADSHEET_ID);
  if(id){
    try { return SpreadsheetApp.openById(id); } catch(e){}
  }
  var ss = SpreadsheetApp.create("FAB Control — CMMS Core");
  props.setProperty(PROP_SPREADSHEET_ID, ss.getId());
  return ss;
}

function ensureSheet_(ss, name, headers){
  var sh = ss.getSheetByName(name);
  if(!sh) sh = ss.insertSheet(name);

  if(sh.getLastColumn() < 1){
    sh.getRange(1,1,1,headers.length).setValues([headers]);
    sh.setFrozenRows(1);
    return;
  }

  var current = sh.getRange(1,1,1,Math.max(sh.getLastColumn(),1)).getValues()[0].map(String);

  if(current.slice(0, headers.length).join("|") !== headers.join("|")){
    // Não destrói dados. Apenas grava o cabeçalho padrão na linha 1.
    sh.getRange(1,1,1,headers.length).setValues([headers]);
  }

  current = sh.getRange(1,1,1,Math.max(sh.getLastColumn(),1)).getValues()[0].map(String);
  headers.forEach(function(h){
    if(current.indexOf(h) < 0){
      sh.getRange(1, sh.getLastColumn()+1).setValue(h);
    }
  });
  sh.setFrozenRows(1);
}

function sheet_(name){
  var sh = getSpreadsheet_().getSheetByName(name);
  if(!sh) err_("SHEET_NOT_FOUND","Aba não encontrada: "+name,500);
  return sh;
}

function headers_(name){
  var sh = sheet_(name);
  return sh.getRange(1,1,1,Math.max(sh.getLastColumn(),1)).getValues()[0].map(String);
}

function rows_(name, force){
  if(!force && DB_CACHE[name]) return DB_CACHE[name];

  if(!force){
    var cached = safeCacheGetJson_(tableCacheKey_(name));
    if(cached && cached.rows){
      DB_CACHE[name] = cached.rows;
      return cached.rows;
    }
  }

  var sh = sheet_(name);
  var lr = sh.getLastRow();
  var lc = sh.getLastColumn();
  if(lr < 2 || lc < 1){
    DB_CACHE[name] = [];
    if(!force) safeCachePutJson_(tableCacheKey_(name), {cached_em:now_(), rows:[]}, 60);
    return [];
  }

  var headers = headers_(name);
  var values = sh.getRange(2,1,lr-1,lc).getValues();

  var out = values.map(function(row,idx){
    var o = {};
    headers.forEach(function(h,i){ o[h] = normCell_(row[i]); });
    o.__rowIndex = idx + 2;
    return o;
  });

  DB_CACHE[name] = out;
  if(!force) safeCachePutJson_(tableCacheKey_(name), {cached_em:now_(), rows:out}, 120);
  return out;
}

function find_(name, key, value){
  return rows_(name).find(function(r){ return String(r[key]) === String(value); }) || null;
}

function filter_(name, key, value){
  return rows_(name).filter(function(r){ return String(r[key]) === String(value); });
}

function append_(name, obj){
  var sh = sheet_(name);
  var h = headers_(name);
  var row = h.map(function(k){ return obj[k] === undefined ? "" : obj[k]; });
  sh.appendRow(row);
  invalidateSheetCache_(name);
  return obj;
}

function update_(name, rowIndex, patch){
  var sh = sheet_(name);
  var h = headers_(name);
  Object.keys(patch).forEach(function(k){
    var c = h.indexOf(k);
    if(c >= 0) sh.getRange(rowIndex, c+1).setValue(patch[k]);
  });
  invalidateSheetCache_(name);
}

function deleteRow_(name, rowIndex){
  sheet_(name).deleteRow(rowIndex);
  invalidateSheetCache_(name);
}

function upsertConfigText_(key, obj){
  var old = find_("config", key, obj[key]);
  var sh = sheet_("config");
  var headers = headers_("config");
  var rowIndex = old ? old.__rowIndex : sh.getLastRow() + 1;
  var merged = Object.assign({}, old || {}, obj || {});
  var valueIndex = headers.indexOf("valor");

  if(valueIndex >= 0){
    merged.valor = String(merged.valor == null ? "" : merged.valor);
    sh.getRange(rowIndex, valueIndex + 1).setNumberFormat("@");
  }

  sh.getRange(rowIndex, 1, 1, headers.length).setValues([
    headers.map(function(header){
      return merged[header] === undefined ? "" : merged[header];
    })
  ]);

  invalidateSheetCache_("config");
  return old ? Object.assign({}, old, obj) : obj;
}

function upsert_(name, key, obj){
  if(
    name === "config" &&
    Object.prototype.hasOwnProperty.call(obj || {}, "valor")
  ){
    return upsertConfigText_(key, obj);
  }

  var old = find_(name, key, obj[key]);
  if(old){
    update_(name, old.__rowIndex, obj);
    return Object.assign({}, old, obj);
  }
  return append_(name, obj);
}

function fit_(name, obj){
  var out = {};
  SH[name].forEach(function(h){ out[h] = obj[h] === undefined ? "" : obj[h]; });
  return out;
}

function releaseVersionInfo_(){
  return {
    release_version:FAB.RELEASE_VERSION,
    api_version:FAB.API_VERSION,
    schema_version:FAB.SCHEMA_VERSION,
    contract_version:FAB.CONTRACT_VERSION,
    frontend_version:FAB.FRONTEND_VERSION
  };
}

function syncReleaseVersionConfig_(){
  var atualizado = now_();
  [
    {chave:"release.version", valor:FAB.RELEASE_VERSION, descricao:"Versao unica da release"},
    {chave:"app.version", valor:FAB.API_VERSION, descricao:"Versao da API"},
    {chave:"api.version", valor:FAB.API_VERSION, descricao:"Versao da API"},
    {chave:"schema.version", valor:FAB.SCHEMA_VERSION, descricao:"Versao do schema das planilhas"},
    {chave:"contract.version", valor:FAB.CONTRACT_VERSION, descricao:"Versao do contrato frontend/API"},
    {chave:"frontend.version", valor:FAB.FRONTEND_VERSION, descricao:"Versao frontend esperada"}
  ].forEach(function(item){
    upsert_("config", "chave", {
      chave:item.chave,
      valor:item.valor,
      descricao:item.descricao,
      atualizado_em:atualizado
    });
  });
  return releaseVersionInfo_();
}

function seedBase_(){
  syncReleaseVersionConfig_();

  seedUser_("USR-ADMIN-001", "Admin Demo", "admin@fabcontrol.local", ROLE.ADMIN, "1234");
  seedUser_("USR-GESTOR-001", "Gestor Demo", "gestor@fabcontrol.local", ROLE.GESTOR, "1234");
  seedUser_("USR-OPERADOR-001", "Operador Demo", "operador@fabcontrol.local", ROLE.OPERADOR, "1234");
}

function seedUser_(id,nome,email,perfil,pin){
  var old = find_("usuarios","id",id);
  if(old) return;
  append_("usuarios", fit_("usuarios", {
    id:id, nome:nome, email:email, perfil:perfil, status:ST.ATIVO,
    pin_hash:hashPin_(pin), criado_em:now_(), atualizado_em:now_(),
    matricula:id, senha_hash:"", primeiro_acesso:"SIM", tentativas_login:0,
    bloqueado_ate:"", ultimo_login_em:"", senha_atualizada_em:"",
    recuperacao_referencia:"", recuperacao_solicitada_em:""
  }));
}

function hist_(d){
  append_("historico", fit_("historico", {
    id:uuid_("HIS"),
    ativo_id:d.ativo_id||"",
    componente_id:d.componente_id||"",
    os_id:d.os_id||"",
    acao_id:d.acao_id||"",
    execucao_id:d.execucao_id||"",
    evento:d.evento||"",
    descricao:d.descricao||"",
    usuario_id:d.usuario_id||"",
    perfil:d.perfil||"",
    criado_em:now_()
  }));
}

function audit_(auth, action, entity, entityId, beforeObj, afterObj, ua){
  append_("audit_log", fit_("audit_log", {
    id:uuid_("AUD"),
    usuario_id:auth && auth.usuario_id || "",
    perfil:auth && auth.perfil || "",
    acao:action,
    entidade:entity,
    entidade_id:entityId || "",
    antes_json:j_(beforeObj),
    depois_json:j_(afterObj),
    user_agent:ua || "",
    criado_em:now_()
  }));
}
