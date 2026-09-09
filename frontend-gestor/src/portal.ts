import { allowsPortal } from './services/auth/portalAccess'
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

export function portalAllowsProfile(profile: string, capabilities?: readonly string[]): boolean {
  return allowsPortal(PORTAL_PROFILE, profile, capabilities)
}

export function getPortalPresentation(): PortalPresentation {
  if (PORTAL_PROFILE === 'ADMIN') {
    return {
      profile: 'ADMIN',
      eyebrow: 'VORQIX · ADMINISTRAÇÃO',
      title: 'Acesso do Administrador',
      intro: 'Configuração, governança, cadastros e controle integral do ambiente industrial.',
      exclusiveProfileLabel: 'Administrador',
    }
  }

  if (PORTAL_PROFILE === 'GESTOR') {
    return {
      profile: 'GESTOR',
      eyebrow: 'VORQIX · GESTÃO',
      title: 'Acesso do Gestor',
      intro: 'Supervisão técnica, decisões, indicadores e liberação do trabalho operacional.',
      exclusiveProfileLabel: 'Gestor',
    }
  }

  return {
    profile: 'SHARED',
    eyebrow: 'VORQIX',
    title: 'Acesso de Gestão',
    intro: 'Supervisão técnica e administração do ambiente industrial.',
    exclusiveProfileLabel: 'Gestor ou Administrador',
  }
}
