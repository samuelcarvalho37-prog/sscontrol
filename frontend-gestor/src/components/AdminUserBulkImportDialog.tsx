import { useMemo, useState } from 'react'
import { createPortal } from 'react-dom'
import { importAdminUsers } from '../services/api/admin'
import { parseAdminWorkbook } from '../services/spreadsheet/adminWorkbook'
import type { AdminPermissionProfile, AdminUser, TechnicalArea, TechnicalRole } from '../types/admin'
import type { AdminImportRow, ParsedAdminWorkbook } from '../types/imports'

interface AdminUserBulkImportDialogProps {
  profiles: AdminPermissionProfile[]
  areas: TechnicalArea[]
  roles: TechnicalRole[]
  existingUsers: AdminUser[]
  onClose: () => void
  onImported: (created: number) => void
  embedded?: boolean
}

interface PreparedUser {
  rowNumber: number
  name: string
  registration: string
  email: string
  profile: AdminPermissionProfile | null
  area: TechnicalArea | null
  areaName: string
  role: TechnicalRole | null
  roleName: string
  status: 'ATIVO' | 'INATIVO'
  temporaryPassword: string
  errors: string[]
  result: 'PENDENTE' | 'CRIADO' | 'FALHOU'
  failure?: string
}

function normalize(value: unknown): string {
  return String(value ?? '').trim()
}

function normalizeKey(value: string): string {
  return value.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLocaleLowerCase('pt-BR').replace(/[^a-z0-9]/g, '')
}

function cell(row: AdminImportRow, aliases: string[]): string {
  const wanted = new Set(aliases.map(normalizeKey))
  const match = Object.entries(row).find(([key]) => key !== '__linha' && wanted.has(normalizeKey(key)))
  return normalize(match?.[1])
}

function newTemporaryPassword(): string {
  const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789!@#$%*+-_'
  const random = new Uint32Array(20)
  crypto.getRandomValues(random)
  const characters = Array.from(random, (value) => alphabet[value % alphabet.length])
  characters[0] = 'A'
  characters[1] = 'm'
  characters[2] = '7'
  characters[3] = '!'
  return characters.join('')
}

function profileMatch(value: string, profiles: AdminPermissionProfile[]): AdminPermissionProfile | null {
  const key = normalizeKey(value)
  return profiles.find((profile) => normalizeKey(profile.perfil) === key || normalizeKey(profile.nome ?? '') === key) ?? null
}

function areaMatch(value: string, areas: TechnicalArea[]): TechnicalArea | null {
  const key = normalizeKey(value)
  return areas.find((area) => area.status === 'ATIVO' && (normalizeKey(area.codigo) === key || normalizeKey(area.nome) === key)) ?? null
}

function temporaryCredentialCsv(rows: PreparedUser[]): string {
  const quote = (value: string) => `"${value.replace(/"/g, '""')}"`
  const header = ['nome', 'matricula', 'email', 'perfil_acesso', 'area_tecnica', 'cargo_tecnico', 'senha_temporaria']
  const created = rows.filter((row) => row.result === 'CRIADO')
  return `\uFEFF${[header, ...created.map((row) => [row.name, row.registration, row.email, row.profile?.nome ?? row.profile?.perfil ?? '', row.area?.nome ?? '', row.role?.nome ?? '', row.temporaryPassword])].map((line) => line.map(quote).join(';')).join('\r\n')}`
}

function downloadCredentials(rows: PreparedUser[]): void {
  const blob = new Blob([temporaryCredentialCsv(rows)], { type: 'text/csv;charset=utf-8' })
  const url = URL.createObjectURL(blob)
  const anchor = document.createElement('a')
  anchor.href = url
  anchor.download = 'credenciais_temporarias_usuarios.csv'
  anchor.click()
  window.setTimeout(() => URL.revokeObjectURL(url), 0)
}

async function downloadTemplate(profiles: AdminPermissionProfile[], areas: TechnicalArea[], roles: TechnicalRole[]): Promise<void> {
  const xlsx = await import('xlsx')
  const profile = profiles.find((item) => item.roleType?.toLocaleUpperCase('pt-BR') !== 'ADMIN' && item.perfil !== 'ADMIN')
  const area = areas.find((item) => item.status === 'ATIVO')
  const role = area ? roles.find((item) => item.area_id === area.id && item.status === 'ATIVO') : undefined
  const worksheet = xlsx.utils.aoa_to_sheet([
    ['nome', 'matricula', 'email', 'perfil_acesso', 'area_tecnica', 'cargo_tecnico'],
    ['Exemplo Funcionário', 'USR-EXEMPLO-001', 'funcionario@exemplo.test', profile?.perfil ?? 'GESTOR', area?.codigo ?? '', role?.codigo ?? ''],
  ])
  worksheet['!cols'] = [{ wch: 30 }, { wch: 20 }, { wch: 34 }, { wch: 20 }, { wch: 22 }, { wch: 22 }]
  const workbook = xlsx.utils.book_new()
  xlsx.utils.book_append_sheet(workbook, worksheet, 'Usuarios')
  xlsx.writeFileXLSX(workbook, 'modelo_cadastro_usuarios_vorqix.xlsx', { compression: true })
}

export function AdminUserBulkImportDialog({ profiles, areas, roles, existingUsers, onClose, onImported, embedded = false }: AdminUserBulkImportDialogProps) {
  const [file, setFile] = useState<File | null>(null)
  const [parsed, setParsed] = useState<ParsedAdminWorkbook | null>(null)
  const [prepared, setPrepared] = useState<PreparedUser[]>([])
  const [error, setError] = useState('')
  const [busy, setBusy] = useState<'template' | 'reading' | 'importing' | ''>('')
  const [templateError, setTemplateError] = useState('')
  const [importFinished, setImportFinished] = useState(false)

  const validCount = useMemo(() => prepared.filter((row) => row.errors.length === 0).length, [prepared])
  const invalidCount = prepared.length - validCount
  const createdCount = prepared.filter((row) => row.result === 'CRIADO').length

  function validateRows(rows: AdminImportRow[]): PreparedUser[] {
    const existingEmails = new Set(existingUsers.map((user) => normalizeKey(user.email)))
    const existingRegistrations = new Set(existingUsers.map((user) => normalizeKey(user.matricula)))
    const seenEmails = new Set<string>()
    const seenRegistrations = new Set<string>()
    return rows.map((row) => {
      const rowNumber = Number(row.__linha) || 0
      const name = cell(row, ['nome', 'nome completo', 'funcionario', 'employee', 'name'])
      const registration = cell(row, ['matricula', 'registro', 'registration', 'codigo usuario'])
      const email = cell(row, ['email', 'e-mail', 'correio eletronico'])
      const profileValue = cell(row, ['perfil', 'perfil de acesso', 'perfil acesso', 'perfil sistema', 'profile', 'role'])
      const areaValue = cell(row, ['area', 'area tecnica', 'departamento'])
      const roleValue = cell(row, ['cargo', 'cargo tecnico', 'funcao tecnica', 'funcao', 'especialidade'])
      const statusValue = cell(row, ['status', 'situacao']).toLocaleUpperCase('pt-BR')
      const profile = profileMatch(profileValue, profiles)
      const area = areaMatch(areaValue, areas)
      const role = area ? roles.find((item) => item.status === 'ATIVO' && item.area_id === area.id && (normalizeKey(item.codigo) === normalizeKey(roleValue) || normalizeKey(item.nome) === normalizeKey(roleValue))) ?? null : null
      const errors: string[] = []
      if (name.length < 3) errors.push('Informe o nome completo.')
      if (!/^[A-Za-z0-9._-]{3,40}$/.test(registration)) errors.push('Matrícula deve ter 3 a 40 caracteres (letras, números, ponto, hífen ou sublinhado).')
      if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) errors.push('Informe um e-mail válido.')
      if (!profile) errors.push(`Perfil “${profileValue || 'vazio'}” não encontrado nas configurações de acesso.`)
      if (profile && (profile.roleType?.toLocaleUpperCase('pt-BR') === 'ADMIN' || profile.perfil === 'ADMIN')) errors.push('O perfil TI deve ser atribuído individualmente, não pela importação em massa.')
      if (!areaValue) errors.push('Informe a área técnica do usuário.')
      if (!roleValue) errors.push('Informe o cargo técnico do usuário.')
      if (statusValue && !['ATIVO', 'INATIVO'].includes(statusValue)) errors.push('Status deve ser ATIVO ou INATIVO.')

      const emailKey = normalizeKey(email)
      const registrationKey = normalizeKey(registration)
      if (emailKey && existingEmails.has(emailKey)) errors.push('Este e-mail já pertence a um usuário cadastrado.')
      if (registrationKey && existingRegistrations.has(registrationKey)) errors.push('Esta matrícula já pertence a um usuário cadastrado.')
      if (emailKey && seenEmails.has(emailKey)) errors.push('O e-mail aparece mais de uma vez nesta planilha.')
      if (registrationKey && seenRegistrations.has(registrationKey)) errors.push('A matrícula aparece mais de uma vez nesta planilha.')
      if (emailKey) seenEmails.add(emailKey)
      if (registrationKey) seenRegistrations.add(registrationKey)

      return {
        rowNumber,
        name,
        registration,
        email,
        profile,
        area,
        areaName: areaValue,
        role,
        roleName: roleValue,
        status: statusValue === 'INATIVO' ? 'INATIVO' : 'ATIVO',
        temporaryPassword: newTemporaryPassword(),
        errors,
        result: 'PENDENTE',
      }
    })
  }

  async function analyzeFile(): Promise<void> {
    if (!file) {
      setError('Selecione a planilha de funcionários.')
      return
    }
    setBusy('reading')
    setError('')
    setImportFinished(false)
    try {
      const workbook = await parseAdminWorkbook(file)
      if (workbook.rows.length > 500) throw new Error('A importação em massa aceita até 500 usuários por arquivo.')
      const nextRows = validateRows(workbook.rows)
      setParsed(workbook)
      setPrepared(nextRows)
      if (nextRows.some((row) => row.errors.length)) setError('Revise os erros apontados por linha. Nenhuma conta foi criada.')
    } catch (cause) {
      setParsed(null)
      setPrepared([])
      setError(cause instanceof Error ? cause.message : 'Não foi possível ler a planilha de funcionários.')
    } finally {
      setBusy('')
    }
  }

  async function importUsers(): Promise<void> {
    if (!prepared.length || invalidCount || busy) return
    setBusy('importing')
    setError('')
    const results = [...prepared]
    const generatedCode = (value: string) => normalizeKey(value).toLocaleUpperCase('pt-BR').slice(0, 40) || 'SEM_CODIGO'
    try {
      const imported = await importAdminUsers({
        fileName: parsed?.fileName ?? file?.name ?? 'equipe.xlsx',
        sheetName: parsed?.selectedSheet ?? 'Usuários',
        headers: parsed?.headers ?? [],
        rows: results.map((row) => ({
          rowNumber: row.rowNumber,
          name: row.name,
          email: row.email.toLowerCase(),
          registration: row.registration,
          profile: row.profile?.perfil ?? '',
          status: row.status,
          temporaryPassword: row.temporaryPassword,
          areaCode: row.area?.codigo ?? generatedCode(row.areaName),
          areaName: row.area?.nome ?? row.areaName,
          roleCode: row.role?.codigo ?? generatedCode(row.roleName),
          roleName: row.role?.nome ?? row.roleName,
        })),
      })
      const completed = results.map((row) => ({ ...row, result: 'CRIADO' as const, failure: undefined }))
      setPrepared(completed)
      setImportFinished(true)
      setError(`Importação registrada no lote ${imported.lote_id}. ${imported.areas_criadas} área(s) e ${imported.cargos_criados} cargo(s) criados; ${imported.total} usuário(s) importados.`)
      onImported(imported.total)
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'A API não concluiu a importação da equipe. Nenhuma conta foi gravada.')
    } finally {
      setBusy('')
    }
  }

  const content = <div className={`admin-user-import-backdrop${embedded ? ' is-embedded' : ''}`} role="presentation" onMouseDown={(event) => { if (!embedded && event.target === event.currentTarget && !busy) onClose() }}>
    <section className={`admin-user-import-dialog${embedded ? ' is-embedded' : ''}`} role={embedded ? 'region' : 'dialog'} aria-modal={embedded ? undefined : 'true'} aria-labelledby="admin-user-import-title">
      <header><div><h2 id="admin-user-import-title">Importar equipe</h2><p>Cadastre várias pessoas de uma vez.</p></div>{!embedded ? <button type="button" disabled={Boolean(busy)} onClick={onClose} aria-label="Fechar">×</button> : null}</header>
      <div className="admin-user-import-body">
        {error ? <div className={importFinished ? 'dashboard-notice' : 'dashboard-error'} role={importFinished ? 'status' : 'alert'}>{error}</div> : null}
        {!importFinished ? <>
          <div className="admin-user-import-actions">
            <button type="button" disabled={Boolean(busy)} onClick={() => {
              setBusy('template')
              setTemplateError('')
              void downloadTemplate(profiles, areas, roles).catch((cause: unknown) => setTemplateError(cause instanceof Error ? cause.message : 'Não foi possível gerar o modelo.')).finally(() => setBusy(''))
            }}>{busy === 'template' ? 'Gerando…' : 'Baixar modelo'}</button>
            <label className="admin-user-import-file">{file ? file.name : 'Escolher arquivo'}<input type="file" accept=".xlsx,.xls,.csv,.json,application/json" disabled={Boolean(busy)} onChange={(event) => { setFile(event.target.files?.[0] ?? null); setPrepared([]); setParsed(null); setError('') }} /></label>
            <button className="primary-button" type="button" disabled={!file || Boolean(busy)} onClick={() => void analyzeFile()}>{busy === 'reading' ? 'Analisando…' : 'Analisar planilha'}</button>
          </div>
          {templateError ? <p className="admin-user-import-error" role="alert">{templateError}</p> : null}
          <details className="admin-user-import-rules">
            <summary>Campos e formatos aceitos</summary>
            <p>Excel, CSV ou JSON · até 500 pessoas. Informe nome, matrícula, e-mail, perfil, área e cargo. O perfil precisa existir; áreas e cargos ausentes serão criados.</p>
          </details>
          {parsed ? <>
            <div className="admin-user-import-summary"><span>{parsed.fileName} · {prepared.length} usuário(s)</span><strong>{validCount} válidos</strong><strong className={invalidCount ? 'has-error' : ''}>{invalidCount} com erro</strong></div>
            <div className="admin-user-import-table-wrap"><table><thead><tr><th>Linha</th><th>Nome</th><th>Perfil</th><th>Área</th><th>Cargo</th><th>Validação</th></tr></thead><tbody>{prepared.slice(0, 100).map((row) => <tr key={row.rowNumber} className={row.errors.length ? 'has-error' : ''}><td>{row.rowNumber}</td><td>{row.name || '—'}</td><td>{row.profile?.nome ?? row.profile?.perfil ?? '—'}</td><td>{row.area?.nome ?? `${row.areaName || '—'} (será criada)`}</td><td>{row.role?.nome ?? `${row.roleName || '—'} (será criado)`}</td><td>{row.errors.length ? row.errors.join(' ') : 'Pronto para criar'}</td></tr>)}</tbody></table></div>
            {prepared.length > 100 ? <p className="admin-user-import-help">Prévia das primeiras 100 linhas; todas as {prepared.length} linhas foram validadas.</p> : null}
          </> : null}
        </> : <>
          <div className="admin-user-import-summary"><strong>{createdCount} conta(s) criada(s)</strong><strong className={prepared.length - createdCount ? 'has-error' : ''}>{prepared.length - createdCount} com falha</strong></div>
          {createdCount ? <><p className="admin-user-import-help">Baixe e guarde as senhas temporárias agora. Elas não serão exibidas novamente; cada usuário deverá trocá-las no primeiro acesso.</p><button type="button" onClick={() => downloadCredentials(prepared)}>Baixar credenciais temporárias</button></> : null}
          <div className="admin-user-import-table-wrap"><table><thead><tr><th>Usuário</th><th>Matrícula</th><th>Perfil</th><th>Área</th><th>Cargo</th><th>Resultado</th></tr></thead><tbody>{prepared.map((row) => <tr key={row.rowNumber} className={row.result === 'FALHOU' ? 'has-error' : ''}><td>{row.name}</td><td>{row.registration}</td><td>{row.profile?.nome ?? row.profile?.perfil}</td><td>{row.area?.nome}</td><td>{row.role?.nome}</td><td>{row.result === 'CRIADO' ? 'Criado' : row.failure ?? 'Falha'}</td></tr>)}</tbody></table></div>
        </>}
      </div>
      {(importFinished || parsed) ? <footer><div><button type="button" disabled={Boolean(busy)} onClick={onClose}>{importFinished ? 'Concluir' : 'Cancelar'}</button>{!importFinished && parsed ? <button className="primary-button" type="button" disabled={Boolean(busy) || invalidCount > 0 || !prepared.length} onClick={() => void importUsers()}>{busy === 'importing' ? 'Importando…' : `Criar ${validCount} conta(s)`}</button> : null}</div></footer> : null}
    </section>
  </div>
  return embedded ? content : createPortal(content, document.body)
}
