import { useRef, useState, type ChangeEvent, type FormEvent } from 'react'
import type { AdminCompanyProfile } from '../types/admin'
import { FactoryIcon, UploadIcon } from './Icons'

interface AdminCompanyDialogProps {
  company: AdminCompanyProfile
  initialError?: string
  onClose: () => void
  onSave: (company: Pick<AdminCompanyProfile, 'nome' | 'logo_data_url'>) => Promise<void>
}

const COMPANY_NAME_MAX_LENGTH = 80
const COMPANY_LOGO_MAX_SOURCE_BYTES = 5 * 1024 * 1024
const COMPANY_LOGO_MAX_DATA_URL_LENGTH = 39000
const COMPANY_LOGO_MAX_WIDTH = 360
const COMPANY_LOGO_MAX_HEIGHT = 120
const ALLOWED_LOGO_TYPES = new Set(['image/png', 'image/jpeg', 'image/webp'])

function loadImage(file: File): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const source = URL.createObjectURL(file)
    const image = new Image()
    image.onload = () => {
      URL.revokeObjectURL(source)
      resolve(image)
    }
    image.onerror = () => {
      URL.revokeObjectURL(source)
      reject(new Error('Não foi possível ler a imagem selecionada.'))
    }
    image.src = source
  })
}

function renderLogo(image: HTMLImageElement, width: number, height: number, quality: number): string {
  const canvas = document.createElement('canvas')
  canvas.width = Math.max(1, Math.round(width))
  canvas.height = Math.max(1, Math.round(height))
  const context = canvas.getContext('2d')
  if (!context) throw new Error('O navegador não conseguiu preparar a imagem.')
  context.imageSmoothingEnabled = true
  context.imageSmoothingQuality = 'high'
  context.drawImage(image, 0, 0, canvas.width, canvas.height)
  return canvas.toDataURL('image/webp', quality)
}

async function prepareCompanyLogo(file: File): Promise<string> {
  if (!ALLOWED_LOGO_TYPES.has(file.type)) {
    throw new Error('Selecione uma imagem PNG, JPEG ou WebP.')
  }
  if (file.size > COMPANY_LOGO_MAX_SOURCE_BYTES) {
    throw new Error('A imagem original deve ter no máximo 5 MB.')
  }
  const image = await loadImage(file)
  if (!image.naturalWidth || !image.naturalHeight) {
    throw new Error('A imagem selecionada não possui dimensões válidas.')
  }
  const initialScale = Math.min(
    1,
    COMPANY_LOGO_MAX_WIDTH / image.naturalWidth,
    COMPANY_LOGO_MAX_HEIGHT / image.naturalHeight,
  )
  let width = image.naturalWidth * initialScale
  let height = image.naturalHeight * initialScale
  const qualities = [0.9, 0.82, 0.74, 0.64, 0.54, 0.44]
  for (const quality of qualities) {
    const dataUrl = renderLogo(image, width, height, quality)
    if (dataUrl.startsWith('data:image/webp;base64,') && dataUrl.length <= COMPANY_LOGO_MAX_DATA_URL_LENGTH) {
      return dataUrl
    }
    width *= 0.86
    height *= 0.86
  }
  throw new Error('Não foi possível compactar a imagem para o limite seguro. Escolha uma imagem mais simples.')
}

export function AdminCompanyDialog({ company, initialError = '', onClose, onSave }: AdminCompanyDialogProps) {
  const fileInputRef = useRef<HTMLInputElement | null>(null)
  const [name, setName] = useState(company.nome)
  const [logoDataUrl, setLogoDataUrl] = useState(company.logo_data_url)
  const [error, setError] = useState(initialError)
  const [processingImage, setProcessingImage] = useState(false)
  const [saving, setSaving] = useState(false)

  async function handleFileChange(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0]
    event.target.value = ''
    if (!file) return
    setError('')
    setProcessingImage(true)
    try {
      setLogoDataUrl(await prepareCompanyLogo(file))
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Não foi possível preparar a imagem.')
    } finally {
      setProcessingImage(false)
    }
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const normalizedName = name.trim().replace(/\s+/g, ' ')
    if (normalizedName.length < 2) {
      setError('Informe um nome de empresa com pelo menos 2 caracteres.')
      return
    }
    setError('')
    setSaving(true)
    try {
      await onSave({ nome: normalizedName, logo_data_url: logoDataUrl })
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Não foi possível salvar a identidade da empresa.')
    } finally {
      setSaving(false)
    }
  }

  const busy = processingImage || saving

  return (
    <div className="admin-desktop-overlay" role="presentation" onMouseDown={(event) => {
      if (!busy && event.currentTarget === event.target) onClose()
    }}>
      <form className="admin-company-dialog" role="dialog" aria-modal="true" aria-labelledby="admin-company-title" onSubmit={handleSubmit}>
        <header>
          <div><span aria-hidden="true"><FactoryIcon /></span><div><small>IDENTIDADE DA EMPRESA</small><strong id="admin-company-title">Configurar empresa</strong></div></div>
          <button type="button" aria-label="Fechar" disabled={busy} onClick={onClose}>×</button>
        </header>
        <div className="admin-company-dialog__content">
          <section className="admin-company-logo-panel">
            <span>Prévia no cabeçalho</span>
            <div className="admin-company-logo-preview">
              {logoDataUrl ? <img src={logoDataUrl} alt="Logomarca da empresa" /> : <b aria-hidden="true">TOZ</b>}
              <strong>{name.trim() || 'Nome da empresa'}</strong>
            </div>
            <p>A imagem é ajustada automaticamente para manter o cabeçalho leve e nítido.</p>
          </section>
          <section className="admin-company-fields">
            <label>
              <span>Nome da empresa *</span>
              <input
                autoFocus
                type="text"
                maxLength={COMPANY_NAME_MAX_LENGTH}
                value={name}
                disabled={busy}
                onChange={(event) => setName(event.target.value)}
                placeholder="Ex.: Tozzi Industrial"
                required
              />
              <small>{name.length}/{COMPANY_NAME_MAX_LENGTH} caracteres</small>
            </label>
            <div className="admin-company-upload-field">
              <span>Logomarca</span>
              <input ref={fileInputRef} type="file" accept="image/png,image/jpeg,image/webp" hidden onChange={handleFileChange} />
              <div>
                <button type="button" disabled={busy} onClick={() => fileInputRef.current?.click()}><UploadIcon />{processingImage ? 'Preparando…' : 'Selecionar imagem'}</button>
                {logoDataUrl ? <button type="button" disabled={busy} onClick={() => setLogoDataUrl('')}>Remover</button> : null}
              </div>
              <small>PNG, JPEG ou WebP. Arquivo original de até 5 MB.</small>
            </div>
            {error ? <p className="admin-company-error" role="alert">{error}</p> : null}
          </section>
        </div>
        <footer>
          <span>A alteração será aplicada imediatamente e registrada na auditoria.</span>
          <div><button type="button" disabled={busy} onClick={onClose}>Cancelar</button><button type="submit" disabled={busy}>{saving ? 'Salvando…' : 'Salvar empresa'}</button></div>
        </footer>
      </form>
    </div>
  )
}
