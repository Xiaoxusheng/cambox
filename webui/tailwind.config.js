/**
 * camhub webui —— Tailwind 主样式层 Design Token 全集
 *
 * Tailwind = 视觉系统（布局/间距/颜色/字级/响应式/动效）；Arco = 交互组件能力。
 * 颜色一律走 CSS 变量（cam.*），双主题自动切换：dark 默认基准，light 用同名变量覆盖。
 * preflight 保持关闭：不重置 Arco 组件默认样式。
 *
 * @type {import('tailwindcss').Config}
 */
export default {
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  corePlugins: { preflight: false },
  theme: {
    extend: {
      colors: {
        cam: {
          bg: 'var(--cam-bg)',
          surface: 'var(--cam-surface)',
          elevated: 'var(--cam-elevated)',
          active: 'var(--cam-active)',
          border: 'var(--cam-border)',
          'border-strong': 'var(--cam-border-strong)',
          accent: 'rgb(var(--cam-accent-rgb) / <alpha-value>)',
          'accent-dim': 'var(--cam-accent-dim)',
          success: 'rgb(var(--cam-success-rgb) / <alpha-value>)',
          warning: 'rgb(var(--cam-warning-rgb) / <alpha-value>)',
          danger: 'rgb(var(--cam-danger-rgb) / <alpha-value>)',
          info: 'rgb(var(--cam-info-rgb) / <alpha-value>)',
          rec: 'rgb(var(--cam-rec-rgb) / <alpha-value>)',
          text: {
            primary: 'var(--cam-text-1)',
            secondary: 'var(--cam-text-2)',
            tertiary: 'var(--cam-text-3)',
            disabled: 'var(--cam-text-4)',
          },
        },
      },
      fontFamily: {
        mono: 'var(--cam-mono)',
      },
      fontSize: {
        // Typography 规范（任务书 §13）：禁止页面散落 text-[17px] 等任意值
        'page-title': ['20px', { lineHeight: '28px', fontWeight: '600' }],
        'section-title': ['15px', { lineHeight: '24px', fontWeight: '600' }],
        body: ['14px', { lineHeight: '22px' }],
        'body-secondary': ['13px', { lineHeight: '20px' }],
        caption: ['12px', { lineHeight: '18px' }],
      },
      borderRadius: {
        // 任务书圆角规范：Page container 16 / Panel 14 / Button+Input 8 / chip 6
        panel: '14px',
      },
      boxShadow: {
        // 深色 UI 克制阴影：真正浮层才有大投影，内容区一律 border + surface 对比
        overlay: '0 16px 50px rgba(0, 0, 0, 0.35)',
        popover: '0 8px 24px rgba(0, 0, 0, 0.28)',
      },
      transitionTimingFunction: {
        // 统一动效曲线（任务书：120/150/200/240ms，ease-out，克制）
        cam: 'cubic-bezier(0.32, 0.72, 0, 1)',
      },
      transitionDuration: {
        120: '120ms',
        150: '150ms',
        240: '240ms',
      },
      keyframes: {
        // 状态点呼吸（在线/REC）：极弱透明度呼吸，不闪烁不放大
        breathe: {
          '0%, 100%': { opacity: '1' },
          '50%': { opacity: '0.45' },
        },
        'rec-pulse': {
          '0%, 100%': { opacity: '1' },
          '50%': { opacity: '0.55' },
        },
        'page-in': {
          from: { opacity: '0', transform: 'translateY(4px)' },
          to: { opacity: '1', transform: 'none' },
        },
        'hud-in': {
          from: { opacity: '0', transform: 'translateY(6px)' },
          to: { opacity: '1', transform: 'none' },
        },
      },
      animation: {
        breathe: 'breathe 2.4s ease-in-out infinite',
        'rec-pulse': 'rec-pulse 1.6s ease-in-out infinite',
        'page-in': 'page-in 200ms cubic-bezier(0.32, 0.72, 0, 1) both',
        'hud-in': 'hud-in 150ms cubic-bezier(0.32, 0.72, 0, 1) both',
      },
    },
  },
  plugins: [],
}
