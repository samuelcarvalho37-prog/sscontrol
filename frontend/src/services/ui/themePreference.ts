export type VorqixTheme = 'light' | 'dark'

const STORAGE_KEY = 'vorqix.ui.theme'

export function readVorqixTheme(): VorqixTheme {
  try {
    const stored = window.localStorage.getItem(STORAGE_KEY)
    if (stored === 'light' || stored === 'dark') return stored
  } catch {
    // A preferência visual continua funcional apenas durante esta sessão.
  }
  return window.matchMedia?.('(prefers-color-scheme: dark)').matches ? 'dark' : 'light'
}

export function applyVorqixTheme(theme: VorqixTheme): void {
  document.documentElement.dataset.vorqixTheme = theme
  document.documentElement.style.colorScheme = theme
  try { window.localStorage.setItem(STORAGE_KEY, theme) } catch { /* storage indisponível */ }
}

export function nextVorqixTheme(theme: VorqixTheme): VorqixTheme {
  return theme === 'dark' ? 'light' : 'dark'
}
