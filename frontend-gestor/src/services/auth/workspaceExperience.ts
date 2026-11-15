interface WorkspaceIdentity {
  roleType?: string | null
  primaryRoleCode?: string | null
  perfil?: string
}

export function workspaceExperience(user?: WorkspaceIdentity | null): 'ti' | 'pcm' | 'other' {
  if (!user) return 'other'
  if (user.roleType === 'ADMIN') return 'ti'
  // MANAGER is an authorization category shared by PCM and technical validators.
  // The validator's operational identity must keep its own review workspace.
  const code = (user.primaryRoleCode ?? user.perfil ?? '').trim().toUpperCase()
  const profile = (user.perfil ?? '').trim().toUpperCase()
  const validators = ['QUALIDADE', 'SEGURANCA', 'QUALITY', 'SAFETY']
  if (validators.includes(code) || validators.includes(profile)) return 'other'
  if (user.roleType === 'MANAGER') return 'pcm'
  if (user.roleType) return 'other'
  if (code === 'ADMIN') return 'ti'
  return ['PCM', 'GESTOR', 'GESTOR_TECNICO'].includes(code) ? 'pcm' : 'other'
}
