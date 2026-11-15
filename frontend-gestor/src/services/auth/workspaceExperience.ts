interface WorkspaceIdentity {
  roleType?: string | null
  primaryRoleCode?: string | null
  perfil?: string
}

export function workspaceExperience(user?: WorkspaceIdentity | null): 'ti' | 'pcm' | 'other' {
  if (!user) return 'other'
  if (user.roleType === 'ADMIN') return 'ti'
  if (user.roleType === 'MANAGER') return 'pcm'
  if (user.roleType) return 'other'
  const code = (user.primaryRoleCode ?? user.perfil ?? '').trim().toUpperCase()
  if (code === 'ADMIN') return 'ti'
  return ['PCM', 'GESTOR', 'GESTOR_TECNICO'].includes(code) ? 'pcm' : 'other'
}
