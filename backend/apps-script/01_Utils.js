function now_(){ return Utilities.formatDate(new Date(), FAB.TZ, "yyyy-MM-dd'T'HH:mm:ss"); }
function iso_(d){ return Utilities.formatDate(d, FAB.TZ, "yyyy-MM-dd'T'HH:mm:ss"); }
function addHours_(d,h){ return new Date(d.getTime()+Number(h||0)*3600000); }
function addSeconds_(d,s){ return new Date(d.getTime()+Number(s||0)*1000); }
function addMinutes_(d,m){ return new Date(d.getTime()+Number(m||0)*60000); }
function clean_(v){ return String(v == null ? "" : v).trim(); }
function upper_(v){ return clean_(v).toUpperCase(); }
function num_(v,f){ var n = Number(v); return isNaN(n) ? Number(f||0) : n; }
function bool_(v){ var s = upper_(v); return v === true || s === "SIM" || s === "TRUE" || s === "1" || s === "YES"; }
function uuid_(p){ return String(p||"ID") + "-" + Utilities.getUuid().replace(/-/g,"").slice(0,10).toUpperCase(); }
function slug_(v){ return clean_(v).normalize("NFD").replace(/[\u0300-\u036f]/g,"").toUpperCase().replace(/[^A-Z0-9]+/g,"-").replace(/^-+|-+$/g,"").slice(0,70); }
function eid_(p,v){ return p + "-" + (slug_(v) || Utilities.getUuid().slice(0,8).toUpperCase()); }
function err_(code,msg,status){ var e = new Error(msg); e.code = code; e.status = status || 400; throw e; }
function req_(o, fields){ fields.forEach(function(f){ if(clean_(o && o[f]) === "") err_("FIELD_REQUIRED","Campo obrigatório: "+f,400); }); }
function strip_(o){ var x = Object.assign({}, o || {}); delete x.__rowIndex; return x; }
function j_(o){ return JSON.stringify(o || {}); }
function hashPin_(pin){ return sha256_("FAB-CONTROL:" + String(pin || "")); }
function sha256_(value){
  var bytes = Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, String(value||""), Utilities.Charset.UTF_8);
  return bytes.map(function(b){ var v=(b<0?b+256:b).toString(16); return v.length===1?"0"+v:v; }).join("");
}
var AUTH_PASSWORD_PEPPER_CACHE = "";

function authPasswordPepper_(){
  if(AUTH_PASSWORD_PEPPER_CACHE) return AUTH_PASSWORD_PEPPER_CACHE;
  var props = PropertiesService.getScriptProperties();
  var key = "FAB_AUTH_PASSWORD_PEPPER";
  var value = clean_(props.getProperty(key));
  if(!value){
    value = Utilities.getUuid().replace(/-/g,"") + Utilities.getUuid().replace(/-/g,"");
    props.setProperty(key, value);
  }
  AUTH_PASSWORD_PEPPER_CACHE = value;
  return value;
}

function authSecureEquals_(a,b){
  a = String(a || "");
  b = String(b || "");
  var diff = a.length ^ b.length;
  var length = Math.max(a.length, b.length);
  for(var i=0;i<length;i++){
    diff |= (a.charCodeAt(i % Math.max(a.length,1)) || 0) ^ (b.charCodeAt(i % Math.max(b.length,1)) || 0);
  }
  return diff === 0;
}

function authPasswordPolicy_(password){
  password = String(password || "");
  if(password.length < 8) return {ok:false, code:"PASSWORD_TOO_SHORT", message:"A senha deve ter ao menos 8 caracteres."};
  if(password.length > 128) return {ok:false, code:"PASSWORD_TOO_LONG", message:"A senha excede o limite permitido."};
  if(!/[a-z]/.test(password)) return {ok:false, code:"PASSWORD_LOWER_REQUIRED", message:"Inclua ao menos uma letra minúscula."};
  if(!/[A-Z]/.test(password)) return {ok:false, code:"PASSWORD_UPPER_REQUIRED", message:"Inclua ao menos uma letra maiúscula."};
  if(!/[0-9]/.test(password)) return {ok:false, code:"PASSWORD_NUMBER_REQUIRED", message:"Inclua ao menos um número."};
  return {ok:true};
}

function authPasswordDigest_(password,salt,iterations){
  var count = Math.max(1, Math.min(num_(iterations, FAB.AUTH_PASSWORD_ITERATIONS || 1200), 10000));
  var value = "FAB-AUTH-V1:" + authPasswordPepper_() + ":" + String(salt || "") + ":" + String(password || "");
  for(var i=0;i<count;i++) value = sha256_(value + ":" + i + ":" + salt);
  return value;
}

function authCreatePasswordHash_(password){
  var policy = authPasswordPolicy_(password);
  if(!policy.ok) err_(policy.code, policy.message, 400);
  var iterations = FAB.AUTH_PASSWORD_ITERATIONS || 1200;
  var salt = Utilities.getUuid().replace(/-/g,"").toLowerCase();
  return ["v1", iterations, salt, authPasswordDigest_(password, salt, iterations)].join("$");
}

function authVerifyPasswordHash_(password,encoded){
  var parts = String(encoded || "").split("$");
  if(parts.length !== 4 || parts[0] !== "v1") return false;
  var iterations = num_(parts[1], 0);
  var salt = parts[2];
  var expected = parts[3];
  if(!iterations || !salt || !expected) return false;
  return authSecureEquals_(expected, authPasswordDigest_(password, salt, iterations));
}

function authRandomToken_(prefix){
  return String(prefix || "FAB") + "-" +
    Utilities.getUuid().replace(/-/g,"").toUpperCase() +
    Utilities.getUuid().replace(/-/g,"").slice(0,12).toUpperCase();
}

function normCell_(v){
  if(v instanceof Date) return iso_(v);
  if(v === null || v === undefined) return "";
  return v;
}
function normErr_(e){ return { code:e.code || "INTERNAL_ERROR", status:e.status || 500, message:e.message || "Erro interno." }; }
function sortByDateDesc_(field){
  return function(a,b){ return String(b[field]||"").localeCompare(String(a[field]||"")); };
}
function priorityScore_(p){
  p = upper_(p);
  if(p === "CRITICA") return 4;
  if(p === "ALTA") return 3;
  if(p === "MEDIA") return 2;
  return 1;
}
function acaoAberta_(a){
  return [ST.CONCLUIDA, ST.CANCELADA].indexOf(upper_(a.status)) < 0;
}
function terminal_(status){
  return [ST.CONCLUIDA, ST.CANCELADA].indexOf(upper_(status)) >= 0;
}
function respostaCritica_(r){
  return ["NOK","NAO_OK","IMPEDIDO"].indexOf(upper_(r)) >= 0;
}
function jsonOut_(obj){
  return ContentService.createTextOutput(JSON.stringify(obj)).setMimeType(ContentService.MimeType.JSON);
}
