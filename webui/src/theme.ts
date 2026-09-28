/**
 * 明暗主题：localStorage 持久化，驱动 --ch-* token 与 Arco 的 arco-theme。
 * dark = Profound 黑（默认）；light = 同语言浅色。
 */
export type Theme = 'dark' | 'light'
const KEY = 'camhub-theme'

export function getTheme(): Theme {
  return localStorage.getItem(KEY) === 'light' ? 'light' : 'dark'
}

export function applyTheme(t: Theme) {
  document.body.setAttribute('data-theme', t)
  if (t === 'dark') document.body.setAttribute('arco-theme', 'dark')
  else document.body.removeAttribute('arco-theme')
  document.documentElement.style.colorScheme = t
}

export function setTheme(t: Theme) {
  localStorage.setItem(KEY, t)
  applyTheme(t)
}
