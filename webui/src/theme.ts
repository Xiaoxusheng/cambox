/**
 * CamBox 主题系统 —— light / dark / system 三态（v1.4 Light Mode）。
 *
 * - 持久化：localStorage `cambox-theme`（light | dark | system）；兼容迁移旧键
 *   `camhub-theme`（light/dark），无任何存储时默认 system（跟随浏览器）。
 * - system：跟随 prefers-color-scheme 动态切换，不刷新页面、不覆盖用户选择。
 * - 组件订阅：subscribeTheme + getThemeMode 供 ThemeToggle 等响应式使用。
 * - 切换过渡：150ms 颜色类属性过渡（theme-transition 类短暂挂载），不影响视频画面。
 *
 * 应用机制不变：body[data-theme] 驱动 tokens.css 变量，arco-theme 驱动 Arco 暗色算法。
 */
export type ThemeMode = 'light' | 'dark' | 'system'
export type ResolvedTheme = 'light' | 'dark'

const KEY = 'cambox-theme'
const LEGACY_KEY = 'camhub-theme'

const listeners = new Set<() => void>()
let mql: MediaQueryList | null = null

function media(): MediaQueryList | null {
  if (typeof window === 'undefined') return null
  if (!mql) mql = window.matchMedia('(prefers-color-scheme: dark)')
  return mql
}

export function getThemeMode(): ThemeMode {
  try {
    const v = localStorage.getItem(KEY)
    if (v === 'light' || v === 'dark' || v === 'system') return v
    // 兼容迁移：旧版只存 light（dark 为缺省），尊重已有偏好
    const legacy = localStorage.getItem(LEGACY_KEY)
    if (legacy === 'light') return 'light'
    if (legacy === 'dark') return 'dark'
  } catch {
    /* 隐私模式等场景忽略 */
  }
  return 'system'
}

export function systemTheme(): ResolvedTheme {
  return media()?.matches ? 'dark' : 'light'
}

export function resolvedTheme(mode: ThemeMode): ResolvedTheme {
  return mode === 'system' ? systemTheme() : mode
}

export function applyTheme(mode: ThemeMode) {
  const t = resolvedTheme(mode)
  document.body.setAttribute('data-theme', t)
  if (t === 'dark') document.body.setAttribute('arco-theme', 'dark')
  else document.body.removeAttribute('arco-theme')
  document.documentElement.style.colorScheme = t
  // 与 index.html 早期底色保持一致，避免主题残留错底
  document.documentElement.style.background = t === 'light' ? '#F8F8F7' : '#09090B'
}

/** 主题切换过渡：短暂挂载，只过渡颜色类属性（§35，不影响视频内容） */
function withTransition() {
  const root = document.documentElement
  root.classList.add('theme-transition')
  window.setTimeout(() => root.classList.remove('theme-transition'), 240)
}

function notify() {
  listeners.forEach((l) => l())
}

export function setThemeMode(mode: ThemeMode) {
  try {
    localStorage.setItem(KEY, mode)
  } catch {
    /* 忽略 */
  }
  withTransition()
  applyTheme(mode)
  notify()
}

export function subscribeTheme(cb: () => void): () => void {
  listeners.add(cb)
  return () => {
    listeners.delete(cb)
  }
}

/** 跟随系统：prefers-color-scheme 变化时自动重应用（不改变存储的选择）。返回清理函数。 */
export function watchSystemTheme(): () => void {
  const m = media()
  if (!m) return () => {}
  const onChange = () => {
    if (getThemeMode() === 'system') {
      withTransition()
      applyTheme('system')
      notify()
    }
  }
  m.addEventListener('change', onChange)
  return () => m.removeEventListener('change', onChange)
}

/** 切换到另一个显式主题（命令面板/快捷操作用）：system 下切换到与当前相反的显式值 */
export function toggleTheme(): void {
  setThemeMode(resolvedTheme(getThemeMode()) === 'dark' ? 'light' : 'dark')
}

// ---- 兼容旧调用点（main.tsx / 命令面板等） ----
export function getTheme(): ResolvedTheme {
  return resolvedTheme(getThemeMode())
}
export function setTheme(t: ResolvedTheme) {
  setThemeMode(t)
}
