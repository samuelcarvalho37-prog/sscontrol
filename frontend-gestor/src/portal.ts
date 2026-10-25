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
      intro: 'Entre para gerenciar a estrutura, os acessos e as configurações da empresa.',
      exclusiveProfileLabel: 'Administrador',
    }
  }

  if (PORTAL_PROFILE === 'GESTOR') {
    return {
      profile: 'GESTOR',
      eyebrow: 'VORQIX · GESTÃO',
      title: 'Acesso do Gestor',
      intro: 'Entre para acompanhar a manutenção e as decisões da sua equipe.',
      exclusiveProfileLabel: 'Gestor',
    }
  }

  return {
    profile: 'SHARED',
    eyebrow: 'VORQIX · AMBIENTE DE TRABALHO',
    title: 'Acesso de Gestão',
    intro: 'Use sua matrícula. As ferramentas disponíveis seguem as permissões da sua conta.',
    exclusiveProfileLabel: 'Gestor ou Administrador',
  }
}
