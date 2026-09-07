import fs from 'node:fs'
import path from 'node:path'
import vm from 'node:vm'
import crypto from 'node:crypto'

const root = path.resolve(import.meta.dirname, '..')
const read = (relativePath) => fs.readFileSync(path.join(root, relativePath), 'utf8').replace(/^\uFEFF/, '')
const assert = (condition, message) => {
  if (!condition) throw new Error(`Governança E2E inválida: ${message}`)
}

let uuidSequence = 0
let fileSequence = 0
let folderSequence = 0
const properties = new Map()
const files = new Map()
const folders = new Map()
const caches = new Map()
const spreadsheets = new Map()

class FakeRange {
  constructor(sheet, row, column, rows, columns) {
    this.sheet = sheet
    this.row = row
    this.column = column
    this.rows = rows
    this.columns = columns
  }

  getValues() {
    return Array.from({ length: this.rows }, (_, rowOffset) => (
      Array.from({ length: this.columns }, (_, columnOffset) => (
        this.sheet.values[this.row - 1 + rowOffset]?.[this.column - 1 + columnOffset] ?? ''
      ))
    ))
  }

  setValues(values) {
    if (this.sheet.failNextSet) {
      this.sheet.failNextSet = false
      throw new Error(`Falha simulada em ${this.sheet.name}`)
    }
    values.forEach((row, rowOffset) => {
      const targetRow = this.row - 1 + rowOffset
      this.sheet.values[targetRow] ||= []
      row.forEach((value, columnOffset) => {
        this.sheet.values[targetRow][this.column - 1 + columnOffset] = value
      })
    })
    return this
  }
}

class FakeSheet {
  constructor(name, values = [['id'], [`VALUE-${name}`]]) {
    this.name = name
    this.values = values.map((row) => [...row])
    this.maxRows = Math.max(this.values.length, 10)
    this.maxColumns = Math.max(...this.values.map((row) => row.length), 1)
  }

  clone() { return new FakeSheet(this.name, this.values) }
  getName() { return this.name }
  getLastRow() { return this.values.length }
  getLastColumn() { return Math.max(...this.values.map((row) => row.length), 0) }
  getMaxRows() { return this.maxRows }
  getMaxColumns() { return this.maxColumns }
  insertRowsAfter(_after, count) { this.maxRows += count; return this }
  insertColumnsAfter(_after, count) { this.maxColumns += count; return this }
  getRange(row, column, rows, columns) { return new FakeRange(this, row, column, rows, columns) }
  clearContents() { this.values = []; return this }
}

class FakeSpreadsheet {
  constructor(id, sheets) {
    this.id = id
    this.sheets = sheets
  }

  clone(id) { return new FakeSpreadsheet(id, this.sheets.map((sheet) => sheet.clone())) }
  getId() { return this.id }
  getSheets() { return this.sheets }
  getSheetByName(name) { return this.sheets.find((sheet) => sheet.getName() === name) || null }
  insertSheet(name) { const sheet = new FakeSheet(name, []); this.sheets.push(sheet); return sheet }
  deleteSheet(sheet) { this.sheets = this.sheets.filter((item) => item !== sheet) }
}

class FakeFile {
  constructor(id, name, size, folderId = '') {
    this.id = id
    this.name = name
    this.size = size
    this.folderId = folderId
    this.createdAt = new Date('2026-07-22T18:00:00.000Z')
    this.updatedAt = new Date(this.createdAt)
    this.trashed = false
    this.description = ''
  }

  getId() { return this.id }
  getName() { return this.name }
  getSize() { return this.size }
  getDateCreated() { return this.createdAt }
  getLastUpdated() { return this.updatedAt }
  getUrl() { return `https://drive.google.test/file/${this.id}` }
  setDescription(value) { this.description = String(value); return this }
  setTrashed(value) { this.trashed = Boolean(value); return this }
  makeCopy(name, folder) {
    const copy = folder.createStoredFile(name, this.size)
    const spreadsheet = spreadsheets.get(this.id)
    if (spreadsheet) spreadsheets.set(copy.id, spreadsheet.clone(copy.id))
    return copy
  }
}

class FakeFolder {
  constructor(id, name) {
    this.id = id
    this.name = name
  }

  getId() { return this.id }
  createStoredFile(name, size) {
    fileSequence += 1
    const file = new FakeFile(`FILE-${fileSequence}`, name, size, this.id)
    files.set(file.id, file)
    return file
  }
  createFile(blob) { return this.createStoredFile(blob.name, blob.bytes.length) }
  getFiles() {
    const items = [...files.values()].filter((file) => file.folderId === this.id && !file.trashed)
    let index = 0
    return { hasNext() { return index < items.length }, next() { return items[index++] } }
  }
}

files.set('SHEET-CANARY', new FakeFile('SHEET-CANARY', 'FAB Control - CANARIO', 2048))
const requiredSheets = ['plantas', 'setores', 'linhas', 'ativos', 'componentes', 'planos_manutencao', 'plano_itens', 'ordens_servico', 'os_acoes']
const protectedSheets = ['config', 'usuarios', 'sessoes', 'audit_log', 'configuracao_versoes', 'configuracao_rascunhos', 'execucao_locks']
const currentSpreadsheet = new FakeSpreadsheet(
  'SHEET-CANARY',
  [...requiredSheets, ...protectedSheets].map((name) => new FakeSheet(name)),
)
spreadsheets.set(currentSpreadsheet.id, currentSpreadsheet)

const context = vm.createContext({
  console,
  Date,
  JSON,
  Math,
  PropertiesService: {
    getScriptProperties() {
      return {
        getProperty(key) { return properties.get(key) || '' },
        setProperty(key, value) { properties.set(key, String(value)) },
      }
    },
  },
  CacheService: {
    getScriptCache() {
      return {
        put(key, value) { caches.set(String(key), String(value)) },
        get(key) { return caches.get(String(key)) || null },
        remove(key) { caches.delete(String(key)) },
      }
    },
  },
  DriveApp: {
    createFolder(name) {
      folderSequence += 1
      const folder = new FakeFolder(`FOLDER-${folderSequence}`, name)
      folders.set(folder.id, folder)
      return folder
    },
    getFolderById(id) {
      const folder = folders.get(String(id))
      if (!folder) throw new Error('Folder not found')
      return folder
    },
    getFileById(id) {
      const file = files.get(String(id))
      if (!file || file.trashed) throw new Error('File not found')
      return file
    },
  },
  SpreadsheetApp: {
    flush() {},
    openById(id) {
      const spreadsheet = spreadsheets.get(String(id))
      if (!spreadsheet) throw new Error('Spreadsheet not found')
      return spreadsheet
    },
  },
  LockService: {
    getScriptLock() { return { tryLock() { return true }, releaseLock() {} } },
  },
  Utilities: {
    DigestAlgorithm: { SHA_256: 'SHA_256' },
    Charset: { UTF_8: 'UTF_8' },
    computeDigest(_algorithm, value) { return [...crypto.createHash('sha256').update(String(value), 'utf8').digest()] },
    formatDate(date) { return new Date(date).toISOString().slice(0, 19) },
    getUuid() {
      uuidSequence += 1
      return `${String(uuidSequence).padStart(8, '0')}-aaaa-bbbb-cccc-dddddddddddd`
    },
    base64Decode(value) { return [...Buffer.from(String(value), 'base64')] },
    newBlob(bytes, mimeType, name) { return { bytes, mimeType, name } },
  },
  TEST_CURRENT_SPREADSHEET: currentSpreadsheet,
})

vm.runInContext([
  read('backend/apps-script/00_Config.js'),
  read('backend/apps-script/01_Utils.js'),
  `
    var TEST_DB = {
      usuarios:[
        {id:'USR-ADMIN',nome:'Admin Demo',perfil:'ADMIN',status:'ATIVO',__rowIndex:2},
        {id:'USR-GESTOR',nome:'Gestor Demo',perfil:'GESTOR',status:'ATIVO',__rowIndex:3}
      ],
      plantas:[{id:'PLT-01',tag:'P01',nome:'Planta 01',__rowIndex:2}],
      setores:[{id:'SET-01',planta_id:'PLT-01',tag:'S01',nome:'Manutenção',__rowIndex:2}],
      linhas:[{id:'LIN-01',setor_id:'SET-01',tag:'L01',nome:'Linha 01',__rowIndex:2}],
      ativos:[{id:'ATV-01',linha_id:'LIN-01',tag:'EQ-01',nome:'Prensa',__rowIndex:2}],
      componentes:[{id:'CMP-01',ativo_id:'ATV-01',tag:'M01',nome:'Motor',__rowIndex:2}],
      documentos_tecnicos:[], documento_revisoes:[], audit_log:[]
    };
    function getSpreadsheet_(){ return TEST_CURRENT_SPREADSHEET; }
    function ensureSheet_(ss,name){ if(!TEST_DB[name]) TEST_DB[name] = []; }
    function rows_(name){ return TEST_DB[name] || []; }
    function find_(name,key,value){ return rows_(name).find(function(row){ return String(row[key]) === String(value); }) || null; }
    function fit_(name,data){ var out = {}; SH[name].forEach(function(key){ out[key] = data[key] === undefined ? '' : data[key]; }); return out; }
    function append_(name,data){ if(!TEST_DB[name]) TEST_DB[name] = []; data.__rowIndex = TEST_DB[name].length + 2; TEST_DB[name].push(data); return data; }
    function update_(name,rowIndex,patch){ var row = rows_(name).find(function(item){ return item.__rowIndex === rowIndex; }); if(!row) throw new Error('Linha ausente: '+name+'#'+rowIndex); Object.keys(patch).forEach(function(key){ if(key !== '__rowIndex') row[key] = patch[key]; }); }
    function deleteRow_(name,rowIndex){ TEST_DB[name] = rows_(name).filter(function(item){ return item.__rowIndex !== rowIndex; }); TEST_DB[name].forEach(function(item,index){ item.__rowIndex = index + 2; }); }
    function adminRequireIdentityAdmin_(auth){ if(!auth || auth.perfil !== 'ADMIN') err_('ADMIN_ONLY','Acesso exclusivo do administrador.',403); }
    function audit_(auth,action,entity,entityId,before,after,userAgent){ append_('audit_log',{id:'AUD-'+(rows_('audit_log').length+1),usuario_id:auth.usuario_id,perfil:auth.perfil,acao:action,entidade:entity,entidade_id:entityId,antes_json:JSON.stringify(before||{}),depois_json:JSON.stringify(after||{}),user_agent:userAgent||'',criado_em:now_()}); }
    function cmmsHigieneDiagnosticar_(){ return {dry_run:true,total_issues:0,by_code:{},issues:[]}; }
    function perfCacheStatus_(){ return {ok:true,entries:4}; }
    function sistemaHealth_(){ return {ok:true,app:FAB.APP_NAME,version:FAB.VERSION,spreadsheetId:getSpreadsheet_().getId(),serverTime:now_()}; }
  `,
  read('backend/apps-script/29_Admin_Governanca.js'),
].join('\n'), context)

const admin = `{usuario_id:'USR-ADMIN',perfil:'ADMIN'}`
const evaluate = (source) => JSON.parse(vm.runInContext(`JSON.stringify(${source})`, context))

const nonAdminBlocked = vm.runInContext(`try { adminDocumentosListar_({}, {usuario_id:'USR-GESTOR',perfil:'GESTOR'}); false } catch(error) { error.code === 'ADMIN_ONLY' }`, context)
assert(nonAdminBlocked, 'Gestor acessou documentos exclusivos do Admin')

context.invalidLink = {
  dados: { titulo: 'Manual inválido', tipo: 'MANUAL', status: 'RASCUNHO', entidade_tipo: 'ATIVO', entidade_id: 'ATV-INEXISTENTE', revisao: 'R1' },
  arquivo: { nome: 'manual.pdf', mime_type: 'application/pdf', base64: Buffer.from('pdf').toString('base64') },
}
const invalidLinkBlocked = vm.runInContext(`try { adminDocumentoUpload_(invalidLink, ${admin}); false } catch(error) { error.code === 'DOCUMENT_ENTITY_NOT_FOUND' }`, context)
assert(invalidLinkBlocked, 'vínculo documental inexistente foi aceito')

context.firstDocument = {
  dados: {
    codigo: 'DOC-001', titulo: 'Manual da prensa', tipo: 'MANUAL', status: 'VIGENTE',
    entidade_tipo: 'ATIVO', entidade_id: 'ATV-01', responsavel_id: 'USR-GESTOR',
    validade_em: '2027-07-22', revisao: 'R1', observacao: 'Emissão inicial'
  },
  arquivo: { nome: 'manual-prensa.pdf', mime_type: 'application/pdf', base64: Buffer.from('conteudo-r1').toString('base64') },
}
const created = evaluate(`adminDocumentoUpload_(firstDocument, ${admin})`)
assert(created.saved && created.mode === 'insert', 'documento inicial não foi salvo')
assert(created.documento.entidade_id === 'ATV-01', 'vínculo assistido não foi persistido')
assert(evaluate(`rows_('documento_revisoes').length`) === 1, 'revisão inicial não foi registrada')
context.documentId = created.documento.id

context.secondRevision = {
  dados: {
    documento_id: created.documento.id, titulo: 'Manual da prensa', tipo: 'MANUAL', status: 'VIGENTE',
    entidade_tipo: 'ATIVO', entidade_id: 'ATV-01', responsavel_id: 'USR-GESTOR',
    validade_em: '2028-07-22', revisao: 'R2', observacao: 'Atualização técnica'
  },
  arquivo: { nome: 'manual-prensa-r2.pdf', mime_type: 'application/pdf', base64: Buffer.from('conteudo-r2').toString('base64') },
}
const revised = evaluate(`adminDocumentoUpload_(secondRevision, ${admin})`)
assert(revised.mode === 'revision' && revised.documento.revisao_atual === 'R2', 'nova revisão não substituiu a revisão atual')
const revisionAudit = evaluate(`rows_('audit_log').filter(function(item){ return item.acao === 'DOCUMENT_REVISION_CREATED'; })[0]`)
assert(JSON.parse(revisionAudit.antes_json).revisao_atual === 'R1', 'auditoria perdeu o estado anterior da revisão')

vm.runInContext(`append_('audit_log',{id:'AUD-SECRET',usuario_id:'USR-ADMIN',perfil:'ADMIN',acao:'USER_SECRET_TEST',entidade:'usuarios',entidade_id:'USR-GESTOR',antes_json:JSON.stringify({senha_hash:'abc',nome:'Gestor'}),depois_json:JSON.stringify({nested:{token:'secreto'},pin_hash:'def'}),criado_em:now_()})`, context)
const audit = evaluate(`adminAuditoriaListar_({acao:'USER_SECRET_TEST'}, ${admin})`)
assert(audit.eventos[0].antes_json.includes('[PROTEGIDO]'), 'hash de senha vazou na auditoria')
assert(audit.eventos[0].depois_json.includes('[PROTEGIDO]'), 'token ou PIN vazou na auditoria')
assert(!audit.eventos[0].depois_json.includes('secreto'), 'valor secreto permaneceu na resposta')

const invalidResponsibleBlocked = vm.runInContext(`try { adminDocumentoAtualizar_({dados:{id:documentId,titulo:'Manual da prensa',tipo:'MANUAL',status:'VIGENTE',entidade_tipo:'ATIVO',entidade_id:'ATV-01',responsavel_id:'USR-INEXISTENTE'}}, ${admin}); false } catch(error) { error.code === 'DOCUMENT_RESPONSIBLE_NOT_FOUND' }`, context)
assert(invalidResponsibleBlocked, 'responsável inexistente foi aceito')

const beforeDocuments = evaluate(`rows_('documentos_tecnicos').length`)
const beforeRevisions = evaluate(`rows_('documento_revisoes').length`)
const beforeActiveFiles = [...files.values()].filter((file) => !file.trashed).length
context.failedDocument = {
  dados: { titulo: 'Documento com falha', tipo: 'LAUDO', status: 'RASCUNHO', entidade_tipo: 'EMPRESA', revisao: 'R1' },
  arquivo: { nome: 'falha.pdf', mime_type: 'application/pdf', base64: Buffer.from('falha').toString('base64') },
}
vm.runInContext(`var originalAuditForTest = audit_; audit_ = function(){ err_('AUDIT_FAILURE','Falha de auditoria simulada.',500); };`, context)
const transactionRolledBack = vm.runInContext(`try { adminDocumentoUpload_(failedDocument, ${admin}); false } catch(error) { error.code === 'AUDIT_FAILURE' }`, context)
vm.runInContext(`audit_ = originalAuditForTest;`, context)
assert(transactionRolledBack, 'falha transacional simulada não ocorreu')
assert(evaluate(`rows_('documentos_tecnicos').length`) === beforeDocuments, 'falha deixou documento órfão')
assert(evaluate(`rows_('documento_revisoes').length`) === beforeRevisions, 'falha deixou revisão órfã')
assert([...files.values()].filter((file) => !file.trashed).length === beforeActiveFiles, 'falha deixou arquivo ativo no Drive')

const backupWithoutConfirmation = vm.runInContext(`try { adminBackupCriar_({motivo:'Antes da release',confirmacao:'NAO'}, ${admin}); false } catch(error) { error.code === 'BACKUP_CONFIRMATION_REQUIRED' }`, context)
assert(backupWithoutConfirmation, 'backup foi criado sem confirmação explícita')
const backup = evaluate(`adminBackupCriar_({motivo:'Antes da release canário',confirmacao:'CRIAR BACKUP'}, ${admin})`)
assert(backup.created && backup.restauracao_disponivel === true, 'backup seguro não foi criado ou restauração protegida permaneceu indisponível')
const backups = evaluate(`adminBackupsListar_({}, ${admin})`)
assert(backups.total === 1 && backups.backups[0].id === backup.backup.id, 'backup criado não apareceu na listagem')

currentSpreadsheet.getSheetByName('ativos').getRange(2, 1, 1, 1).setValues([['CURRENT-AFTER-BACKUP']])
currentSpreadsheet.getSheetByName('usuarios').getRange(2, 1, 1, 1).setValues([['SECURITY-CURRENT']])
context.restoreBackupId = backup.backup.id
const preparation = evaluate(`adminBackupPrepararRestauracao_({backup_id:restoreBackupId}, ${admin})`)
assert(preparation.prepared && preparation.abas_restauradas.includes('ativos'), 'restauração não analisou as abas operacionais')
assert(preparation.abas_protegidas.includes('usuarios') && preparation.abas_protegidas.includes('sessoes'), 'núcleo de identidade não foi protegido')
context.restorePreparation = preparation
const missingSafetyBlocked = vm.runInContext(`try { adminBackupConfirmarRestauracao_({token:restorePreparation.token,backup_id:restoreBackupId,confirmacao:restorePreparation.desafio,confirmacao_final:restorePreparation.confirmacao_final,motivo:'Retorno operacional validado',criar_backup_seguranca:false}, ${admin}); false } catch(error) { error.code === 'BACKUP_SAFETY_COPY_REQUIRED' }`, context)
assert(missingSafetyBlocked, 'restauração foi aceita sem backup automático de segurança')
const wrongChallengeBlocked = vm.runInContext(`try { adminBackupConfirmarRestauracao_({token:restorePreparation.token,backup_id:restoreBackupId,confirmacao:'RESTAURAR ERRADO',confirmacao_final:restorePreparation.confirmacao_final,motivo:'Retorno operacional validado',criar_backup_seguranca:true}, ${admin}); false } catch(error) { error.code === 'BACKUP_RESTORE_CHALLENGE_REQUIRED' }`, context)
assert(wrongChallengeBlocked, 'primeira confirmação incorreta foi aceita')
assert(currentSpreadsheet.getSheetByName('ativos').values[1][0] === 'CURRENT-AFTER-BACKUP', 'pré-validação alterou a base')
const restored = evaluate(`adminBackupConfirmarRestauracao_({token:restorePreparation.token,backup_id:restoreBackupId,confirmacao:restorePreparation.desafio,confirmacao_final:restorePreparation.confirmacao_final,motivo:'Retorno operacional validado',criar_backup_seguranca:true}, ${admin})`)
assert(restored.restored && restored.abas_restauradas.includes('ativos'), 'restauração operacional não foi concluída')
assert(currentSpreadsheet.getSheetByName('ativos').values[1][0] === 'VALUE-ativos', 'dados operacionais não voltaram ao backup selecionado')
assert(currentSpreadsheet.getSheetByName('usuarios').values[1][0] === 'SECURITY-CURRENT', 'restauração substituiu usuários protegidos')
assert(evaluate(`rows_('audit_log').some(function(item){ return item.acao === 'SAFETY_BACKUP_CREATED'; })`) === true, 'backup automático de segurança não foi auditado')
assert(evaluate(`rows_('audit_log').some(function(item){ return item.acao === 'BACKUP_OPERATIONAL_RESTORED'; })`) === true, 'restauração concluída não foi auditada')
const reusedTokenBlocked = vm.runInContext(`try { adminBackupConfirmarRestauracao_({token:restorePreparation.token,backup_id:restoreBackupId,confirmacao:restorePreparation.desafio,confirmacao_final:restorePreparation.confirmacao_final,motivo:'Tentativa de repetição',criar_backup_seguranca:true}, ${admin}); false } catch(error) { error.code === 'BACKUP_RESTORE_TOKEN_EXPIRED' }`, context)
assert(reusedTokenBlocked, 'token de restauração pôde ser reutilizado')

currentSpreadsheet.getSheetByName('ativos').getRange(2, 1, 1, 1).setValues([['CURRENT-BEFORE-FAILURE']])
currentSpreadsheet.getSheetByName('os_acoes').getRange(2, 1, 1, 1).setValues([['CURRENT-OS-BEFORE-FAILURE']])
const failurePreparation = evaluate(`adminBackupPrepararRestauracao_({backup_id:restoreBackupId}, ${admin})`)
context.failurePreparation = failurePreparation
currentSpreadsheet.getSheetByName('os_acoes').failNextSet = true
const restoreFailureRolledBack = vm.runInContext(`try { adminBackupConfirmarRestauracao_({token:failurePreparation.token,backup_id:restoreBackupId,confirmacao:failurePreparation.desafio,confirmacao_final:failurePreparation.confirmacao_final,motivo:'Teste de rollback da restauração',criar_backup_seguranca:true}, ${admin}); false } catch(error) { error.code === 'BACKUP_RESTORE_FAILED' }`, context)
assert(restoreFailureRolledBack, 'falha de restauração não acionou rollback automático')
assert(currentSpreadsheet.getSheetByName('ativos').values[1][0] === 'CURRENT-BEFORE-FAILURE', 'rollback não recuperou aba já restaurada')
assert(currentSpreadsheet.getSheetByName('os_acoes').values[1][0] === 'CURRENT-OS-BEFORE-FAILURE', 'rollback não recuperou a aba que falhou durante a escrita')

const monitoring = evaluate(`adminMonitoramentoEstado_({}, ${admin})`)
assert(monitoring.health.ok && monitoring.diagnostico.dry_run, 'monitoramento alterou a base ou não retornou saúde')

console.log('GOVERNANÇA ADMINISTRATIVA E2E EM MEMÓRIA APROVADA')
console.log('Documentos, revisões, vínculos, redação de segredos e rollback transacional conferidos')
console.log('Restauração exige duas confirmações, cria safety backup e preserva identidade, sessões e configuração')
