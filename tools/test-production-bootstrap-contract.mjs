import fs from "node:fs";
import path from "node:path";

const root = path.resolve(import.meta.dirname, "..");
const config = fs.readFileSync(path.join(root, "backend/apps-script/00_Config.js"), "utf8");
const db = fs.readFileSync(path.join(root, "backend/apps-script/02_Db.js"), "utf8");
const source = fs.readFileSync(
  path.join(root, "backend/apps-script/24_Production_Bootstrap.js"),
  "utf8"
);

function assert(condition, message){
  if(!condition){
    console.error("FALHA:", message);
    process.exit(1);
  }
}

function functionBody(text, functionName){
  const marker = "function " + functionName + "(";
  const start = text.indexOf(marker);
  assert(start >= 0, "função ausente: " + functionName);

  const open = text.indexOf("{", start);
  let depth = 0;
  for(let index = open; index < text.length; index += 1){
    if(text[index] === "{") depth += 1;
    if(text[index] === "}") depth -= 1;
    if(depth === 0) return text.slice(open + 1, index);
  }
  assert(false, "corpo incompleto: " + functionName);
}

assert(config.includes('const FAB_RELEASE_VERSION = "1.4.0";'), "backend deve declarar a versão 1.4.0");

assert(
  db.includes("function setupInicial(){ return setupProductionSchema(); }"),
  "setupInicial deve usar o bootstrap seguro"
);

[
  "setupProductionSchema",
  "bootstrapProductionAdmin",
  "diagnoseProductionReadiness",
  "getConfiguredSpreadsheetStrict_",
  "assertSpreadsheetEmptyForProductionBootstrap_"
].forEach((name) => functionBody(source, name));

const setupBody = functionBody(source, "setupProductionSchema");
assert(!setupBody.includes("seedBase_"), "setupProductionSchema não pode semear dados Demo");
assert(!setupBody.includes("setupCMMSCore"), "setupProductionSchema não pode chamar setupCMMSCore");
assert(!setupBody.includes("adminCriarDemo_"), "setupProductionSchema não pode criar demo");
assert(setupBody.includes("assertSpreadsheetEmptyForProductionBootstrap_"), "proteção de planilha vazia ausente");
assert(setupBody.includes("demo_seeded:false"), "resultado deve declarar ausência de seed");

const adminBody = functionBody(source, "bootstrapProductionAdmin");
assert(adminBody.includes('perfil:ROLE.ADMIN'), "administrador inicial deve ter perfil ADMIN");
assert(adminBody.includes('primeiro_acesso:"SIM"'), "primeiro acesso obrigatório ausente");
assert(adminBody.includes("authCreatePasswordHash_"), "senha temporária deve ser armazenada com hash seguro");
const clearPasswordBody = functionBody(
  source,
  "productionClearTemporaryAdminPassword_"
);
assert(
  clearPasswordBody.includes("deleteProperty"),
  "senha temporária deve ser removida das Script Properties"
);
assert(!adminBody.includes("pin_hash:hashPin_"), "bootstrap não deve criar PIN legado");
const existingUsersCheck = adminBody.indexOf('var users = rows_("usuarios", true);');
const credentialLoad = adminBody.indexOf("productionAdminConfig_(options)");
assert(existingUsersCheck >= 0, "bootstrap deve verificar usuários existentes");
assert(credentialLoad > existingUsersCheck, "credenciais temporárias só podem ser exigidas na primeira criação");
assert(adminBody.includes('bootstrapStatus === "ADMIN_READY"'), "idempotência deve exigir o marcador ADMIN_READY");
assert(adminBody.includes("adminCreatedAt"), "idempotência deve exigir a data de criação do administrador");


const diagnosisBody = functionBody(source, "diagnoseProductionReadiness");
assert(
  diagnosisBody.includes('["config", "usuarios", "sessoes", "audit_log"]'),
  "sessões históricas revogadas não podem contar como dados operacionais"
);
assert(
  diagnosisBody.includes("activeSessions > 0"),
  "sessões ativas devem continuar bloqueando a prontidão"
);
[
  "append_(",
  "update_(",
  "upsert_(",
  ".setValue(",
  ".setValues(",
  ".appendRow("
].forEach((mutation) => {
  assert(!diagnosisBody.includes(mutation), "diagnóstico deve ser somente leitura: " + mutation);
});

assert(source.includes("PRODUCTION_BOOTSTRAP_REQUIRES_EMPTY_SPREADSHEET"), "gate de planilha vazia ausente");
assert(source.includes("PRODUCTION_OPERATIONAL_DATA_FOUND"), "gate de dados operacionais ausente");
assert(source.includes("PRODUCTION_SYNTHETIC_DATA_FOUND"), "gate de dados sintéticos ausente");
assert(!source.includes('"1234"'), "senha de demonstração não pode existir no bootstrap");
assert(!source.includes("admin@fabcontrol.local"), "usuário Demo não pode existir no bootstrap");
assert(!source.includes("gestor@fabcontrol.local"), "usuário Demo não pode existir no bootstrap");
assert(!source.includes("operador@fabcontrol.local"), "usuário Demo não pode existir no bootstrap");

const safeGateBody = functionBody(source, "assertSpreadsheetEmptyForProductionBootstrap_");
assert(
  safeGateBody.includes("productionAllowedBootstrapConfigKeys_"),
  "recuperação de schema parcial seguro ausente"
);
assert(
  safeGateBody.includes('name !== "config"'),
  "somente config pode conter linhas parciais controladas"
);
assert(
  source.includes("PRODUCTION_BOOTSTRAP_LOCKED"),
  "lock concorrente do bootstrap ausente"
);
assert(
  setupBody.includes("productionWithBootstrapLock_"),
  "setupProductionSchema deve usar lock"
);
assert(
  setupBody.lastIndexOf("PRODUCTION_BOOTSTRAP.MARKER_KEY") >
    setupBody.lastIndexOf("PRODUCTION_BOOTSTRAP.INITIALIZED_AT_KEY"),
  "marcador final deve ser gravado somente após a configuração"
);
assert(
  adminBody.includes("productionWithBootstrapLock_"),
  "bootstrapProductionAdmin deve usar lock"
);
assert(
  adminBody.includes("productionAdminIdentityMatches_"),
  "recuperação de administrador parcial ausente"
);
assert(
  adminBody.includes("productionClearTemporaryAdminPassword_"),
  "caminho idempotente deve remover a senha temporária"
);
assert(
  adminBody.includes("productionEnsureAdminAudit_"),
  "caminho idempotente deve reparar a auditoria"
);

const finalizerBody = functionBody(source, "productionFinalizeAdminBootstrap_");
assert(
  finalizerBody.indexOf("productionClearTemporaryAdminPassword_") <
    finalizerBody.indexOf("productionEnsureAdminAudit_"),
  "senha temporária deve ser removida antes da auditoria final"
);

console.log("TESTE DO BOOTSTRAP SEGURO DE PRODUÇÃO APROVADO");
