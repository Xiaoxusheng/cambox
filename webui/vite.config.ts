import { defineConfig } from 'vite'
import type { Plugin } from 'vite'
import react from '@vitejs/plugin-react'

/**
 * 去掉 Vite 默认给 <script>/<link> 加的 crossorigin 属性。
 *
 * dist 会被复制到 internal/server/webdist 并用 go:embed 由 Go 服务同源提供；
 * 带 crossorigin 会让浏览器以 CORS 模式请求这些同源资源，在缺少 CORS 响应头的
 * 内嵌静态服务上存在整页白屏的风险。同源场景不需要该属性。
 */
function removeCrossorigin(): Plugin {
  return {
    name: 'camhub-remove-crossorigin',
    transformIndexHtml(html) {
      return html.replace(/\s+crossorigin(?:="[^"]*")?/g, '')
    },
  }
}

// 面板最终内嵌进 Go 单二进制，故 base 用 './'（相对路径）
export default defineConfig({
  base: './',
  plugins: [react(), removeCrossorigin()],
  server: {
    port: 5173,
    // 真实模式下联调：本地起 camhub(8787) 时走代理
    proxy: {
      '/api': 'http://127.0.0.1:8787',
      '/media': 'http://127.0.0.1:8787',
    },
  },
})
