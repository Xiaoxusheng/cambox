import React from 'react'
import ReactDOM from 'react-dom/client'
import { ConfigProvider } from '@arco-design/web-react'
import zhCN from '@arco-design/web-react/es/locale/zh-CN'
import { HashRouter } from 'react-router-dom'
import '@arco-design/web-react/dist/css/arco.css'
import './styles/tokens.css'
import './styles/global.css'
import App from './App'
import { applyTheme, getTheme } from './theme'

// 启动时恢复上次选择的主题（默认 Profound 黑）
applyTheme(getTheme())

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <ConfigProvider locale={zhCN}>
      {/* v7 future flags：提前对齐 React Router 7 行为，同时消除控制台告警 */}
      <HashRouter future={{ v7_startTransition: true, v7_relativeSplatPath: true }}>
        <App />
      </HashRouter>
    </ConfigProvider>
  </React.StrictMode>,
)
