/**
 * CamBox webui —— Tailwind 主样式层 Design Token 全集（v1.4 Linear-style）
 *
 * Tailwind = 视觉系统（布局/间距/颜色/字级/响应式/动效）；Arco = 交互组件能力。
 * 颜色一律走 CSS 变量（tokens.css），双主题自动切换：dark 默认基准，light 用同名变量覆盖。
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
          bg: 'rgb(var(--cam-bg-rgb) / <alpha-value>)',
          surface: 'var(--cam-surface)',
          elevated: 'var(--cam-elevated)',
          active: 'var(--cam-active)',
          hover: 'var(--cam-hover)',
          selected: 'var(--cam-selected)',
          border: 'var(--cam-border)',
          'border-strong': 'var(--cam-border-strong)',
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
        // Typography 规范（任务书 §17）：小而精确，禁止页面散落任意字号
        'page-title': ['18px', { lineHeight: '26px', fontWeight: '600' }],
        'topbar-title': ['14px', { lineHeight: '20px', fontWeight: '500' }],
        'section-title': ['13px', { lineHeight: '20px', fontWeight: '600' }],
        body: ['13px', { lineHeight: '20px' }],
        'body-secondary': ['12px', { lineHeight: '18px' }],
        caption: ['11px', { lineHeight: '16px' }],
      },
      borderRadius: {
        // 任务书圆角规范：控件/导航 6（rounded-md）· popover 8（rounded-lg）· Panel/Modal 10
        panel: '10px',
      },
      boxShadow: {
        // 深色 UI 克制阴影：仅浮层使用，内容区一律 border + surface 对比
        overlay: '0 16px 48px rgba(0, 0, 0, 0.5)',
        popover: '0 8px 24px rgba(0, 0, 0, 0.35)',
      },
      transitionTimingFunction: {
        // 统一动效曲线（任务书 §60：100~250ms，ease-out，克制）
        cam: 'cubic-bezier(0.32, 0.72, 0, 1)',
      },
      transitionDuration: {
        100: '100ms',
        150: '150ms',
        200: '200ms',
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
          from: { opacity: '0', transform: 'translateY(2px)' },
          to: { opacity: '1', transform: 'none' },
        },
        'hud-in': {
          from: { opacity: '0', transform: 'translateY(4px)' },
          to: { opacity: '1', transform: 'none' },
        },
        'menu-in': {
          from: { opacity: '0', transform: 'translateY(-4px) scale(0.98)' },
          to: { opacity: '1', transform: 'none' },
        },
      },
      animation: {
        breathe: 'breathe 2.4s ease-in-out infinite',
        'rec-pulse': 'rec-pulse 1.6s ease-in-out infinite',
        'page-in': 'page-in 150ms cubic-bezier(0.32, 0.72, 0, 1) both',
        'hud-in': 'hud-in 150ms cubic-bezier(0.32, 0.72, 0, 1) both',
        'menu-in': 'menu-in 120ms cubic-bezier(0.32, 0.72, 0, 1) both',
      },
    },
  },
  plugins: [],
}
