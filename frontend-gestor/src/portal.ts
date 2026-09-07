export type PortalProfile = 'GESTOR' | 'ADMIN' | 'SHARED'

export interface PortalPresentation {
  profile: PortalProfile
  eyebrow: string
  title: string
  intro: string
  exclusiveProfileLabel: string
}

function readPortalProfile(): PortalProfile {
  const configured = String(import.meta.env.VITE_PORTAL_PROFILE ?? '')
    .trim()
    .toUpperCase()

  if (configured === 'ADMIN') return 'ADMIN'
  if (configured === 'GESTOR') return 'GESTOR'
  return 'SHARED'
}

export const PORTAL_PROFILE = readPortalProfile()

export function portalAllowsProfile(profile: string): boolean {
  const normalized = profile.trim().toUpperCase()
  if (PORTAL_PROFILE === 'SHARED') return ['GESTOR', 'ADMIN'].includes(normalized)
  return normalized === PORTAL_PROFILE
}

export function getPortalPresentation(): PortalPresentation {
  if (PORTAL_PROFILE === 'ADMIN') {
    return {
      profile: 'ADMIN',
      eyebrow: 'FAB CONTROL · ADMINISTRAÇÃO',
      title: 'Acesso do Administrador',
      intro: 'Configuração, governança, cadastros e controle integral do ambiente industrial.',
      exclusiveProfileLabel: 'Administrador',
    }
  }

  if (PORTAL_PROFILE === 'GESTOR') {
    return {
      profile: 'GESTOR',
      eyebrow: 'FAB CONTROL · GESTÃO',
      title: 'Acesso do Gestor',
      intro: 'Supervisão técnica, decisões, indicadores e liberação do trabalho operacional.',
      exclusiveProfileLabel: 'Gestor',
    }
  }

  return {
    profile: 'SHARED',
    eyebrow: 'FAB CONTROL',
    title: 'Acesso de Gestão',
    intro: 'Supervisão técnica e administração do ambiente industrial.',
    exclusiveProfileLabel: 'Gestor ou Administrador',
  }
}
