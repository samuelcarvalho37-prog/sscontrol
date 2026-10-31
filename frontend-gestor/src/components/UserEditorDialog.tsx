import { useEffect, useMemo, useState, type FormEvent } from 'react'
import {
  listTechnicalAreas,
  getAdminPermissionMatrix,
  listTechnicalRoles,
  saveAdminUser,
  saveTechnicalArea,
} from '../services/api/admin'
import { listAdminEntity } from '../services/api/catalog'
import type {
  AdminUser,
  AdminUserInput,
  AdminUserProfile,
  AdminUserStatus,
  AdminPermissionProfile,
  TechnicalArea,
  TechnicalAreaInput,
  TechnicalRole,
} from '../types/admin'
import type { AdminEntityRecord } from '../types/catalog'

export interface AccountCredentialReceipt {
  name: string
  email: string
  registration: string
  password: string
  profile: string
  area: string
  role: string
  specialties: string[]
  scope: string[]
  passwordReset?: boolean
}

interface UserEditorDialogProps {
  user: AdminUser | null
  currentUserId: string
  onClose: () => void
  onSaved: (message: string) => void
  initialSection?: 'identity' | 'specialties' | 'scope'
  embedded?: boolean
  credentialReceipt?: AccountCredentialReceipt
}

function createTemporaryPassword(): string {
  const bytes = new Uint32Array(3)
  crypto.getRandomValues(bytes)
  return `Fab!${bytes[0].toString(36)}A${bytes[1].toString(36)}7${bytes[2].toString(36)}`.slice(0, 22)
}

function passwordMeetsRules(value: string): boolean {
  return value.length >= 12 && /[a-z]/.test(value) && /[A-Z]/.test(value) && /\d/.test(value)
}

export function UserEditorDialog({
  user,
  currentUserId,
  onClose,
  onSaved,
  initialSection = 'identity',
  embedded = false,
  credentialReceipt,
}: UserEditorDialogProps) {
  const editing = Boolean(user)
  const editingSelf = user?.id === currentUserId
  const [name, setName] = useState(user?.nome ?? '')
  const [email, setEmail] = useState(user?.email ?? '')
  const [registration, setRegistration] = useState(user?.matricula ?? '')
  const [profile, setProfile] = useState<AdminUserProfile>(user?.perfil ?? '')
  const [profiles, setProfiles] = useState<AdminPermissionProfile[]>([])
  const [status, setStatus] = useState<AdminUserStatus>(user?.status ?? 'ATIVO')
  const [areaId, setAreaId] = useState(user?.area_id ?? '')
  const [roleId, setRoleId] = useState(user?.cargo_id ?? '')
  const [specialties, setSpecialties] = useState<string[]>(() => {
    try {
      const parsed = JSON.parse(user?.especialidades_json ?? '[]')
      return Array.isArray(parsed) ? parsed.map(String) : []
    } catch {
      return (user?.especialidades_json ?? '').split(',').map((value) => value.trim()).filter(Boolean)
    }
  })
  const [specialtyDraft, setSpecialtyDraft] = useState('')
  const [scopeIds, setScopeIds] = useState<string[]>(() => {
    try {
      const parsed = JSON.parse(user?.escopo_ids_json ?? '[]')
      return Array.isArray(parsed) ? parsed.map(String) : []
    } catch {
      return (user?.escopo_ids_json ?? '').split(',').map((value) => value.trim()).filter(Boolean)
    }
  })
  const [areas, setAreas] = useState<TechnicalArea[]>([])
  const [roles, setRoles] = useState<TechnicalRole[]>([])
  const [plants, setPlants] = useState<AdminEntityRecord[]>([])
  const [sectors, setSectors] = useState<AdminEntityRecord[]>([])
  const [lines, setLines] = useState<AdminEntityRecord[]>([])
  const [scopeCatalogError, setScopeCatalogError] = useState('')
  const [expandedPlantId, setExpandedPlantId] = useState('')
  const [temporaryPassword] = useState(createTemporaryPassword)
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState('')
  const [activeSection, setActiveSection] = useState(initialSection)
  const [creationStage, setCreationStage] = useState<'access' | 'identity'>('access')
  const [showAreaCreator, setShowAreaCreator] = useState(false)
  const [areaDraftName, setAreaDraftName] = useState('')
  const [areaDraftDescription, setAreaDraftDescription] = useState('')
  const [savingArea, setSavingArea] = useState(false)
  const [creationReceipt, setCreationReceipt] = useState<AccountCredentialReceipt | null>(credentialReceipt ?? null)
  const [receiptCopied, setReceiptCopied] = useState(false)

  const title = useMemo(
    () => (editing ? 'Editar' : 'Novo usuário'),
    [editing],
  )

  useEffect(() => {
    setShowAreaCreator(false)
    setAreaDraftName('')
    setAreaDraftDescription('')
  }, [user?.id])

  useEffect(() => {
    const controller = new AbortController()
    void Promise.all([
      listTechnicalAreas(controller.signal),
      listTechnicalRoles('', controller.signal),
      getAdminPermissionMatrix(controller.signal),
    ]).then(([areaData, roleData, matrix]) => {
      setAreas(areaData)
      setRoles(roleData)
      setProfiles(matrix.perfis)
    }).catch((cause: unknown) => {
      if (!controller.signal.aborted) setError(cause instanceof Error ? cause.message : 'Não foi possível carregar os perfis da empresa.')
    })
    void Promise.all([
      listAdminEntity('plantas', controller.signal),
      listAdminEntity('setores', controller.signal),
      listAdminEntity('linhas', controller.signal),
    ]).then(([plantData, sectorData, lineData]) => {
      if (controller.signal.aborted) return
      setPlants(plantData.rows)
      setSectors(sectorData.rows)
      setLines(lineData.rows)
      const selectedPlant = plantData.rows.find((plant) => sectorData.rows.some((sector) => (
        String(sector.planta_id ?? '') === plant.id && scopeIds.includes(sector.id)
      )) || lineData.rows.some((line) => (
        scopeIds.includes(line.id) && sectorData.rows.some((sector) => (
          sector.id === String(line.setor_id ?? '') && String(sector.planta_id ?? '') === plant.id
        ))
      )))
      if (selectedPlant) setExpandedPlantId(selectedPlant.id)
    }).catch((cause: unknown) => {
      if (!controller.signal.aborted) setScopeCatalogError(cause instanceof Error ? cause.message : 'Estrutura de planta indisponível.')
    })
    return () => controller.abort()
  }, [])

  useEffect(() => {
    setActiveSection(initialSection)
  }, [initialSection])

  const availableRoles = roles.filter((role) => !areaId || role.area_id === areaId)

  function technicalAreaCode(nameValue: string): string {
    return nameValue.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLocaleUpperCase('pt-BR')
      .replace(/[^A-Z0-9]+/g, '_').replace(/^_+|_+$/g, '').slice(0, 40)
  }

  async function createAreaForUser() {
    const nameValue = areaDraftName.trim()
    const code = technicalAreaCode(nameValue)
    if (nameValue.length < 2 || !code) {
      setError('Informe o nome da área técnica para continuar.')
      return
    }
    if (areas.some((area) => area.codigo.toLocaleUpperCase('pt-BR') === code)) {
      setError(`Já existe uma área com o código ${code}. Selecione-a na lista.`)
      return
    }
    const input: TechnicalAreaInput = {
      codigo: code,
      nome: nameValue,
      descricao: areaDraftDescription.trim(),
      status: 'ATIVO',
      exige_assinatura_padrao: 'NAO',
    }
    setSavingArea(true)
    setError('')
    try {
      const saved = await saveTechnicalArea(input)
      setAreas((current) => [...current.filter((area) => area.id !== saved.id), saved].sort((left, right) => left.nome.localeCompare(right.nome)))
      setAreaId(saved.id)
      setRoleId('')
      setAreaDraftName('')
      setAreaDraftDescription('')
      setShowAreaCreator(false)
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Não foi possível criar a área técnica.')
    } finally {
      setSavingArea(false)
    }
  }

  function continueToIdentity() {
    setError('')
    if (!profiles.some((item) => item.perfil === profile)) {
      setError('Selecione um perfil de acesso ativo para o usuário.')
      return
    }
    const selectedProfile = profiles.find((item) => item.perfil === profile)
    const isAdministrativeProfile = selectedProfile?.roleType?.toLocaleUpperCase('pt-BR') === 'ADMIN'
      || profile.toLocaleUpperCase('pt-BR') === 'ADMIN'
    if (!areaId && !isAdministrativeProfile) {
      setError('Selecione uma área técnica ou crie uma nova antes de preencher os dados do usuário.')
      return
    }
    setCreationStage('identity')
  }

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setError('')
    if (!profiles.some((item) => item.perfil === profile)) {
      setError('Selecione um perfil ativo da empresa.')
      return
    }

    if (name.trim().length < 3) {
      setError('Informe o nome completo do usuário.')
      return
    }
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim())) {
      setError('Informe um e-mail válido.')
      return
    }
    if (!/^[A-Za-z0-9._-]{3,40}$/.test(registration.trim())) {
      setError('A matrícula deve ter de 3 a 40 caracteres alfanuméricos.')
      return
    }
    if (!editing && !passwordMeetsRules(temporaryPassword)) {
      setError('A senha temporária precisa ter 12 caracteres, letra maiúscula, minúscula e número.')
      return
    }

    const input: AdminUserInput = {
      id: user?.id,
      nome: name.trim(),
      email: email.trim().toLowerCase(),
      matricula: registration.trim(),
      perfil: profile,
      status,
      senha_temporaria: editing ? undefined : temporaryPassword,
      area_id: areaId,
      cargo_id: roleId,
      especialidades: specialties,
      escopo_ids: scopeIds,
    }

    setSubmitting(true)
    try {
      const result = await saveAdminUser(input)
      const revoked = result.sessoes_revogadas
        ? ` ${result.sessoes_revogadas} sessão(ões) antiga(s) foram encerradas.`
        : ''
      if (result.mode === 'insert') {
        const selectedSectors = new Set(sectors.filter((item) => scopeIds.includes(item.id)).map((item) => item.id))
        const scopeLabels = scopeIds.filter((id) => {
          const line = lines.find((item) => item.id === id)
          return !line || !selectedSectors.has(String(line.setor_id ?? ''))
        }).map((id) => {
          const plant = plants.find((item) => item.id === id)
          if (plant) return rowLabel(plant)
          const sector = sectors.find((item) => item.id === id)
          if (sector) {
            const parentPlant = plants.find((item) => item.id === String(sector.planta_id ?? ''))
            return [parentPlant ? rowLabel(parentPlant) : '', rowLabel(sector)].filter(Boolean).join(' · ')
          }
          const line = lines.find((item) => item.id === id)
          if (!line) return ''
          const parentSector = sectors.find((item) => item.id === String(line.setor_id ?? ''))
          const parentPlant = plants.find((item) => item.id === String(parentSector?.planta_id ?? ''))
          return [parentPlant ? rowLabel(parentPlant) : '', parentSector ? rowLabel(parentSector) : '', rowLabel(line)].filter(Boolean).join(' · ')
        }).filter(Boolean)
        setCreationReceipt({
          name: name.trim(),
          email: email.trim().toLowerCase(),
          registration: registration.trim(),
          password: temporaryPassword,
          profile: profiles.find((item) => item.perfil === profile)?.nome ?? profile,
          area: areas.find((item) => item.id === areaId)?.nome ?? '',
          role: roles.find((item) => item.id === roleId)?.nome ?? '',
          specialties: [...specialties],
          scope: scopeLabels,
        })
      }
      onSaved(
        result.mode === 'insert'
          ? `Usuário criado. A senha temporária deverá ser alterada no primeiro acesso.${revoked}`
          : `Usuário atualizado.${revoked}`,
      )
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Não foi possível salvar o usuário.')
    } finally {
      setSubmitting(false)
    }
  }

  function addSpecialty() {
    const value = specialtyDraft.trim()
    if (!value || specialties.some((specialty) => specialty.toLocaleLowerCase('pt-BR') === value.toLocaleLowerCase('pt-BR'))) return
    setSpecialties((current) => [...current, value])
    setSpecialtyDraft('')
  }

  function toggleScope(id: string, checked: boolean) {
    const parentSectorId = String(lines.find((line) => line.id === id)?.setor_id ?? '')
    const parentSector = sectors.find((sector) => sector.id === parentSectorId)
    const descendants = lines.filter((line) => String(line.setor_id ?? '') === parentSectorId).map((line) => line.id)
    setScopeIds((current) => {
      if (current.includes(parentSectorId) && parentSector) {
        const remaining = current.filter((value) => value !== parentSectorId && !descendants.includes(value))
        if (checked) return [...new Set([...remaining, parentSector.id, ...descendants])]
        return [...new Set([...remaining, ...descendants.filter((lineId) => lineId !== id)])]
      }
      return checked
        ? current.includes(id) ? current : [...current, id]
        : current.filter((value) => value !== id)
    })
  }

  function toggleSectorScope(sector: AdminEntityRecord, checked: boolean) {
    const descendants = lines.filter((line) => String(line.setor_id ?? '') === sector.id).map((line) => line.id)
    setScopeIds((current) => {
      if (checked) return [...new Set([...current, sector.id, ...descendants])]
      return current.filter((value) => value !== sector.id && !descendants.includes(value))
    })
  }

  function rowLabel(record: AdminEntityRecord): string {
    return [record.tag, record.nome].filter(Boolean).join(' · ') || 'Item sem nome'
  }

  async function copyCreationDetails() {
    if (!creationReceipt) return
    const lines = [
      `Nome: ${creationReceipt.name}`,
      `Matrícula: ${creationReceipt.registration}`,
      `Senha temporária: ${creationReceipt.password}`,
      `Perfil: ${creationReceipt.profile}`,
      creationReceipt.area ? `Área: ${creationReceipt.area}` : '',
      creationReceipt.role ? `Cargo: ${creationReceipt.role}` : '',
      creationReceipt.specialties.length ? `Especialidades: ${creationReceipt.specialties.join(', ')}` : '',
      creationReceipt.scope.length ? `Escopo: ${creationReceipt.scope.join('; ')}` : '',
    ].filter(Boolean).join('\n')
    try {
      await navigator.clipboard.writeText(lines)
      setReceiptCopied(true)
    } catch {
      setError('Não foi possível copiar os dados. Selecione e copie as informações exibidas.')
    }
  }

  if (creationReceipt) {
    const subject = `Acesso ao VORQIX · ${creationReceipt.name}`
    const body = [
      `Olá, ${creationReceipt.name.split(/\s+/)[0]}!`,
      '',
      creationReceipt.passwordReset
        ? 'Sua senha foi redefinida. Use a senha temporária abaixo e escolha uma nova senha no próximo acesso.'
        : 'Sua conta VORQIX foi criada. Guarde os dados abaixo e altere a senha no primeiro acesso.',
      '',
      `Matrícula: ${creationReceipt.registration}`,
      `Senha temporária: ${creationReceipt.password}`,
      `Perfil: ${creationReceipt.profile}`,
      creationReceipt.area ? `Área: ${creationReceipt.area}` : '',
      creationReceipt.role ? `Cargo: ${creationReceipt.role}` : '',
      creationReceipt.specialties.length ? `Especialidades: ${creationReceipt.specialties.join(', ')}` : '',
      creationReceipt.scope.length ? `Escopo de atuação: ${creationReceipt.scope.join('; ')}` : '',
      '',
      creationReceipt.passwordReset
        ? 'A senha temporária deve ser alterada no próximo acesso.'
        : 'A senha é temporária e deve ser alterada no primeiro acesso.',
    ].filter(Boolean).join('\n')
    return (
      <div className="identity-editor-pane">
        <section className="identity-dialog identity-dialog--embedded identity-creation-receipt" role="status" aria-live="polite">
          <header className="identity-dialog__header"><div><span className="eyebrow">ACESSO DE USUÁRIO</span><h2>Preparar e-mail</h2></div><button type="button" onClick={onClose} aria-label="Fechar">×</button></header>
          <div className="identity-creation-receipt__content">
            {error ? <div className="feedback feedback--error" role="alert">{error}</div> : null}
            <p>{creationReceipt.passwordReset ? 'A senha temporária foi redefinida.' : 'Confira os dados de acesso.'} Prepare a mensagem para <strong>{creationReceipt.name}</strong> ({creationReceipt.email}). O rascunho abre no aplicativo de e-mail configurado; revise e envie por lá.</p>
            <dl>
              <div><dt>Matrícula</dt><dd>{creationReceipt.registration}</dd></div>
              <div><dt>Senha temporária</dt><dd><code>{creationReceipt.password}</code></dd></div>
              <div><dt>Perfil</dt><dd>{creationReceipt.profile}</dd></div>
              {creationReceipt.area ? <div><dt>Área</dt><dd>{creationReceipt.area}</dd></div> : null}
              {creationReceipt.role ? <div><dt>Cargo</dt><dd>{creationReceipt.role}</dd></div> : null}
              {creationReceipt.specialties.length ? <div><dt>Especialidades</dt><dd>{creationReceipt.specialties.join(', ')}</dd></div> : null}
              {creationReceipt.scope.length ? <div><dt>Escopo</dt><dd>{creationReceipt.scope.join('; ')}</dd></div> : null}
            </dl>
            <footer>
              <button type="button" className="secondary-button" onClick={() => void copyCreationDetails()}>{receiptCopied ? 'Dados copiados' : 'Copiar dados'}</button>
              <a className="primary-button" href={`mailto:${encodeURIComponent(creationReceipt.email)}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`}>Abrir rascunho de e-mail</a>
              <button type="button" className="secondary-button" onClick={onClose}>Concluir</button>
            </footer>
          </div>
        </section>
      </div>
    )
  }

  return (
    <div className={embedded ? 'identity-editor-pane' : 'review-overlay'} role={embedded ? undefined : 'presentation'}>
      <section
        className={`identity-dialog${embedded ? ' identity-dialog--embedded' : ''}`}
        role={embedded ? undefined : 'dialog'}
        aria-modal={embedded ? undefined : 'true'}
        aria-labelledby="user-editor-title"
      >
        <header className="identity-dialog__header">
          <div>
            <span className="eyebrow">IDENTIDADE E ACESSO</span>
            <h2 id="user-editor-title">{title}</h2>
            {editing ? <p className="identity-dialog__subject">{user?.nome}</p> : null}
          </div>
          <button type="button" onClick={onClose} aria-label="Fechar">×</button>
        </header>

        <form className="identity-form" onSubmit={(event) => void submit(event)}>
          {error ? <div className="feedback feedback--error" role="alert">{error}</div> : null}

          <nav className="identity-editor-tabs" role="tablist" aria-label="Seções da conta">
            {(!editing ? [
              ['access', 'Perfil e área'],
              ['identity', 'Dados do usuário'],
            ] as const : [
              ['identity', 'Identidade'],
              ['specialties', 'Especialidades'],
              ['scope', 'Escopo'],
            ] as const).map(([section, label]) => (
              <button
                key={section}
                type="button"
                role="tab"
                aria-selected={!editing ? (section === 'access' ? creationStage === 'access' : creationStage === 'identity') : activeSection === section}
                disabled={!editing && section === 'identity' && creationStage === 'access' || editing && section !== 'identity' && !profile}
                className={(!editing ? (section === 'access' ? creationStage === 'access' : creationStage === 'identity') : activeSection === section) ? 'is-active' : ''}
                onClick={() => editing ? setActiveSection(section as 'identity' | 'specialties' | 'scope') : setCreationStage(section === 'access' ? 'access' : 'identity')}
              >
                {label}
              </button>
            ))}
          </nav>

          {!editing && creationStage === 'access' ? <section className="identity-create-access">
            <label><span>Perfil de acesso *</span><select value={profile} onChange={(event) => setProfile(event.target.value as AdminUserProfile)}><option value="">Selecione um perfil</option>{profiles.filter((item) => item.roleType?.toLocaleUpperCase('pt-BR') !== 'ADMIN' && item.perfil.toLocaleUpperCase('pt-BR') !== 'ADMIN').map((item) => <option key={item.perfil} value={item.perfil}>{item.nome ?? item.perfil}</option>)}</select></label>
            {!profiles.some((item) => item.roleType?.toLocaleUpperCase('pt-BR') !== 'ADMIN' && item.perfil.toLocaleUpperCase('pt-BR') !== 'ADMIN') ? <p className="identity-create-access__empty" role="status">Nenhum perfil operacional. Configure um em Acesso.</p> : null}
            <label><span>Área técnica *</span><select value={areaId} onChange={(event) => { setAreaId(event.target.value); setRoleId('') }}><option value="">Selecione uma área técnica</option>{areas.map((area) => <option key={area.id} value={area.id}>{area.nome}</option>)}</select></label>
            {showAreaCreator ? <div className="identity-create-area">
              <label><span>Nome da nova área</span><input value={areaDraftName} onChange={(event) => setAreaDraftName(event.target.value)} placeholder="PCM" autoFocus /></label>
              <small>Código gerado automaticamente: <strong>{technicalAreaCode(areaDraftName) || '—'}</strong></small>
              <label><span>Descrição (opcional)</span><input value={areaDraftDescription} onChange={(event) => setAreaDraftDescription(event.target.value)} placeholder="Planejamento e Controle da Manutenção" /></label>
              <button type="button" className="secondary-button" disabled={savingArea} onClick={() => void createAreaForUser()}>{savingArea ? 'Criando área…' : 'Salvar área e selecioná-la'}</button>
            </div> : <button type="button" className="identity-create-area__toggle" onClick={() => { setError(''); setShowAreaCreator(true) }}>+ Criar área técnica</button>}
          </section> : null}

          {(!editing && creationStage === 'identity') || (editing && activeSection === 'identity') ? <div className="identity-form__grid">
            <label className="identity-form__wide">
              <span>Nome completo</span>
              <input value={name} onChange={(event) => setName(event.target.value)} autoFocus={initialSection === 'identity'} />
            </label>
            <label>
              <span>Matrícula</span>
              <input value={registration} onChange={(event) => setRegistration(event.target.value)} />
            </label>
            <label>
              <span>E-mail</span>
              <input type="email" value={email} onChange={(event) => setEmail(event.target.value)} />
            </label>
            {editing ? <label>
              <span>Perfil</span>
              <select
                value={profile}
                disabled={editingSelf}
                onChange={(event) => setProfile(event.target.value as AdminUserProfile)}
              >
                <option value="">Selecione um perfil</option>
                {profiles.map((item) => <option key={item.perfil} value={item.perfil}>{item.nome ?? item.perfil} ({item.perfil})</option>)}
              </select>
            </label> : null}
            <label>
              <span>Status</span>
              <select
                value={status}
                disabled={editingSelf}
                onChange={(event) => setStatus(event.target.value as AdminUserStatus)}
              >
                <option value="ATIVO">Ativo</option>
                <option value="INATIVO">Inativo</option>
              </select>
            </label>
            {editing && profile ? (
              <>
                <label>
                  <span>Área técnica</span>
                  <select
                    value={areaId}
                    onChange={(event) => {
                      setAreaId(event.target.value)
                      setRoleId('')
                    }}
                  >
                    <option value="">Sem área definida</option>
                    {areas.map((area) => (
                      <option key={area.id} value={area.id}>{area.nome}</option>
                    ))}
                  </select>
                </label>
                <label>
                  <span>Cargo técnico</span>
                  <select value={roleId} onChange={(event) => setRoleId(event.target.value)}>
                    <option value="">Sem cargo específico</option>
                    {availableRoles.map((role) => (
                      <option key={role.id} value={role.id}>{role.nome}</option>
                    ))}
                  </select>
                </label>
              </>
            ) : null}
          </div> : null}

          {editing && profile && activeSection !== 'identity' ? (
            <div className="identity-assignments">
              {activeSection === 'specialties' ? <section className="identity-assignment" id="identity-specialties" aria-labelledby="identity-specialties-title">
                <header><div><h3 id="identity-specialties-title">Especialidades</h3><p>Adicione as competências associadas a este usuário.</p></div><span>{specialties.length}</span></header>
                <div className="identity-specialty-entry">
                  <input
                    value={specialtyDraft}
                    autoFocus={initialSection === 'specialties'}
                    onChange={(event) => setSpecialtyDraft(event.target.value)}
                    onKeyDown={(event) => { if (event.key === 'Enter') { event.preventDefault(); addSpecialty() } }}
                    placeholder="Digite uma especialidade e pressione Enter"
                  />
                  <button type="button" onClick={addSpecialty}>Adicionar</button>
                </div>
                <div className="identity-specialty-list">
                  {specialties.length ? specialties.map((specialty) => <span key={specialty}>{specialty}<button type="button" aria-label={`Remover especialidade ${specialty}`} onClick={() => setSpecialties((current) => current.filter((value) => value !== specialty))}>×</button></span>) : <small>Nenhuma especialidade configurada.</small>}
                </div>
              </section> : null}

              {activeSection === 'scope' ? <section className="identity-assignment" id="identity-scope" aria-labelledby="identity-scope-title">
                <header><div><h3 id="identity-scope-title">Escopo de atuação</h3><p>Selecione setores ou linhas da estrutura da empresa. Marcar um setor inclui suas linhas.</p></div><span>{scopeIds.length} selecionado(s)</span></header>
                {scopeCatalogError ? <p className="identity-scope-message">Não foi possível carregar plantas e setores. Atualize a janela para tentar novamente.</p> : null}
                {!plants.length && !scopeCatalogError ? <p className="identity-scope-message">Carregando estrutura da empresa…</p> : null}
                <div className="identity-scope-tree">
                  {plants.filter((plant) => String(plant.status ?? '').toUpperCase() !== 'INATIVO' || sectors.some((sector) => String(sector.planta_id ?? '') === plant.id && scopeIds.includes(sector.id))).map((plant) => {
                    const plantSectors = sectors.filter((sector) => String(sector.planta_id ?? '') === plant.id && (String(sector.status ?? '').toUpperCase() !== 'INATIVO' || scopeIds.includes(sector.id)))
                    return <details key={plant.id} open={expandedPlantId === plant.id} onToggle={(event) => { if (event.currentTarget.open) setExpandedPlantId(plant.id); else if (expandedPlantId === plant.id) setExpandedPlantId('') }}>
                      <summary>{rowLabel(plant)}<small>{plantSectors.length} setor(es)</small></summary>
                      {plantSectors.map((sector) => {
                        const sectorLines = lines.filter((line) => String(line.setor_id ?? '') === sector.id && (String(line.status ?? '').toUpperCase() !== 'INATIVO' || scopeIds.includes(line.id)))
                        const selectedLineCount = sectorLines.filter((line) => scopeIds.includes(line.id)).length
                        const sectorChecked = scopeIds.includes(sector.id) || (sectorLines.length > 0 && selectedLineCount === sectorLines.length)
                        return <div className="identity-scope-sector" key={sector.id}>
                          <label><input type="checkbox" autoFocus={initialSection === 'scope' && plant.id === plants[0]?.id && sector.id === plantSectors[0]?.id} checked={sectorChecked} onChange={(event) => toggleSectorScope(sector, event.target.checked)} /><span>{rowLabel(sector)}</span><small>Setor</small></label>
                          {sectorLines.map((line) => <label className="is-line" key={line.id}><input type="checkbox" checked={scopeIds.includes(line.id)} onChange={(event) => toggleScope(line.id, event.target.checked)} /><span>{rowLabel(line)}</span><small>Linha</small></label>)}
                        </div>
                      })}
                      {!plantSectors.length ? <small className="identity-scope-empty">Nenhum setor disponível.</small> : null}
                    </details>
                  })}
                  {!plants.length && !scopeCatalogError ? null : plants.length && !plants.some((plant) => String(plant.status ?? '').toUpperCase() !== 'INATIVO' || scopeIds.some((id) => sectors.some((sector) => sector.id === id && String(sector.planta_id ?? '') === plant.id))) ? <small className="identity-scope-empty">Nenhuma planta ativa disponível.</small> : null}
                </div>
              </section> : null}
            </div>
          ) : null}

          {editingSelf ? (
            <p className="identity-note">Seu próprio perfil e status ficam protegidos durante a sessão atual.</p>
          ) : null}

          <footer className="identity-dialog__footer">
            {!editing && creationStage === 'identity' ? <button className="secondary-button" type="button" disabled={submitting} onClick={() => setCreationStage('access')}>Anterior</button> : null}
            {!editing && creationStage === 'access' ? <button className="primary-button" type="button" disabled={savingArea} onClick={continueToIdentity}>Continuar para os dados</button> : null}
            {!editing && creationStage === 'identity' ? <button className="primary-button" type="submit" disabled={submitting}>{submitting ? 'Criando…' : 'Criar usuário'}</button> : null}
            {editing ? <button className="primary-button" type="submit" disabled={submitting}>{submitting ? 'Salvando…' : 'Salvar alterações'}</button> : null}
          </footer>
        </form>
      </section>
    </div>
  )
}
