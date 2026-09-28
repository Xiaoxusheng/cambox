/** Tailwind：只作为「按钮/徽章等细节」的样式引擎（@apply 进 ch-* 类），preflight 关闭以免重置 Arco */
/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  corePlugins: { preflight: false },
  theme: {
    extend: {
      colors: {
        primary: 'var(--ch-primary)',
        teal: 'var(--ch-teal)',
        ok: 'var(--ch-ok)',
        warn: 'var(--ch-warn)',
        danger: 'var(--ch-danger)',
        'glass-line': 'rgba(255, 255, 255, 0.12)',
      },
      fontFamily: {
        mono: 'var(--ch-mono)',
      },
      transitionTimingFunction: {
        apple: 'cubic-bezier(0.32, 0.72, 0, 1)',
      },
    },
  },
  plugins: [],
}
