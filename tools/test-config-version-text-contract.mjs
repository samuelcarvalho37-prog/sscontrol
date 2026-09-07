import fs from "node:fs";
import path from "node:path";

const root = process.cwd();
const db = fs.readFileSync(
  path.join(root, "backend/apps-script/02_Db.js"),
  "utf8"
);
const bootstrap = fs.readFileSync(
  path.join(root, "backend/apps-script/24_Production_Bootstrap.js"),
  "utf8"
);

function assert(condition, message){
  if(!condition){
    console.error("FALHA:", message);
    process.exit(1);
  }
}

assert(
  db.includes("function upsertConfigText_"),
  "helper de configuração textual ausente"
);
assert(
  db.includes('setNumberFormat("@")'),
  "coluna valor da configuração deve ser formatada como texto"
);
assert(
  db.includes('name === "config"') &&
  db.includes('hasOwnProperty.call(obj || {}, "valor")'),
  "upsert de config deve usar a escrita textual"
);
assert(
  bootstrap.includes("function productionSpreadsheetDateMatchesVersion_"),
  "recuperação de versão convertida em data ausente"
);
assert(
  bootstrap.includes(
    "!productionSpreadsheetDateMatchesVersion_(existingMarker, FAB_RELEASE_VERSION)"
  ),
  "setup deve aceitar somente a coerção de data correspondente à release"
);
assert(
  bootstrap.indexOf('existingMarker === FAB_RELEASE_VERSION') <
    bootstrap.lastIndexOf('productionSpreadsheetDateMatchesVersion_('),
  "marcador textual válido deve continuar idempotente"
);

console.log("TESTE DE VERSAO TEXTUAL DA CONFIGURACAO APROVADO");
console.log("Versoes semanticas não serão convertidas em datas pelo Google Sheets");
console.log("Marcadores já convertidos podem ser reparados com segurança");
