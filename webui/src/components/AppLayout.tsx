/**
 * 全局布局（Arco Design 原生）：Layout.Header + Menu 导航。
 * 左：品牌 + 相机状态；右：REC · 布防 · 时钟 · 主题 · Menu。
 * 动画全部来自组件内建（Menu 墨条、Switch、Drawer、Modal、Message）。
 * 移动端导航收进 Drawer。
 */
import { useEffect, useState } from 'react'
import { Avatar, Button, Drawer, Layout, Menu, Message, Modal, Switch, Tag, Tooltip, Typography } from '@arco-design/web-react'
import { IconMenu, IconMoon, IconSun, IconRecord, IconRecordStop } from '@arco-design/web-react/icon'
import { Outlet, useLocation, useNavigate } from 'react-router-dom'
import { IS_MOCK } from '../api/client'
import { fetchConfig, fetchStatus, saveConfig, setArmed } from '../api/endpoints'
import { errorText } from '../api/errors'
import { useAsync } from '../hooks/useAsync'
import { useMediaQuery } from '../hooks/useMediaQuery'
import { getTheme, setTheme, type Theme } from '../theme'
import { formatClock } from '../utils/format'

const { Header, Content } = Layout
const { Text } = Typography

const NAV = [
  { key: '/', label: '监控' },
  { key: '/playback', label: '回看' },
  { key: '/dashboard', label: '概览' },
  { key: '/events', label: '事件' },
  { key: '/recordings', label: '录像' },
  { key: '/settings', label: '设置' },
  { key: '/logs', label: '日志' },
]

/** 「监控」要求精确匹配，其余前缀匹配（避免 startsWith('/') 恒真） */
const isActive = (pathname: string, key: string) =>
  key === '/' ? pathname === '/' : pathname.startsWith(key)

function Clock() {
  const [now, setNow] = useState(() => new Date())
  useEffect(() => {
    const timer = window.setInterval(() => setNow(new Date()), 1000)
    return () => window.clearInterval(timer)
  }, [])
  return (
    <Text className="ch-hide-mobile ch-clock" style={{ fontFamily: 'var(--ch-mono, monospace)' }}>
      {formatClock(now)}
    </Text>
  )
}

export function AppLayout() {
  const isMobile = useMediaQuery('(max-width: 900px)')
  const [drawerOpen, setDrawerOpen] = useState(false)
  const [armPending, setArmPending] = useState(false)
  const [recPending, setRecPending] = useState(false)
  const [theme, setThemeState] = useState<Theme>(() => getTheme())
  const navigate = useNavigate()
  const { pathname } = useLocation()

  // 顶部栏元信息：相机名 / 在线状态 / fps；5s 静默轮询
  const { data: status, reload } = useAsync((signal) => fetchStatus(signal), [], { pollMs: 5000 })

  useEffect(() => {
    if (isMobile) setDrawerOpen(false)
  }, [isMobile, pathname])

  const go = (key: string) => {
    navigate(key)
    setDrawerOpen(false)
  }

  const toggleArm = async (next: boolean) => {
    setArmPending(true)
    try {
      await setArmed(next)
      Message.success(next ? '已布防，移动侦测事件将入库并推送' : '已撤防，仅停止事件入库与推送')
      reload()
    } catch (e) {
      Message.error(errorText(e))
    } finally {
      setArmPending(false)
    }
  }

  const toggleTheme = () => {
    const next: Theme = theme === 'dark' ? 'light' : 'dark'
    setThemeState(next)
    setTheme(next)
  }

  /** 顶栏 REC 开关：切换 record.enabled（热更新生效）。点击时现取配置再全量保存，避免覆盖较新的改动 */
  const toggleRecord = () => {
    const next = !recording
    Modal.confirm({
      title: next ? '开始录像？' : '结束录像？',
      content: next
        ? '将启用自动录像并写入 configs/config.yaml（热更新生效）；是否启动仍受布防日程约束。'
        : '将停止自动录像并写入 configs/config.yaml（热更新生效）；布防与侦测不受影响，可随时再次开启。',
      okText: next ? '开始录像' : '结束录像',
      cancelText: '取消',
      okButtonProps: next ? undefined : { status: 'danger' },
      onOk: async () => {
        setRecPending(true)
        try {
          const cfg = await fetchConfig()
          await saveConfig({ ...cfg, record: { ...cfg.record, enabled: next } })
          Message.success(next ? '已开始录像' : '已结束录像，当前分段会正常收尾')
          reload()
        } catch (e) {
          Message.error(errorText(e))
        } finally {
          setRecPending(false)
        }
      },
    })
  }

  const cam = status?.camera
  const connected = cam?.connected ?? false
  const armed = status?.armed ?? false
  const recording = status?.recorder.running ?? false
  const activeKey = NAV.find((n) => isActive(pathname, n.key))?.key ?? '/'

  return (
    <Layout className="ch-shell" style={{ minHeight: '100vh' }}>
      <Header className="ch-header">
        <div className="ch-header-side">
          {isMobile ? (
            <Button
              shape="circle"
              type="outline"
              size="small"
              icon={<IconMenu />}
              aria-label="打开导航"
              onClick={() => setDrawerOpen(true)}
            />
          ) : (
            <span className="ch-brand" aria-hidden="true">
              <Avatar size={22} shape="square" style={{ backgroundColor: 'rgb(var(--primary-6))' }}>
                C
              </Avatar>
              <Text bold style={{ fontSize: 16 }}>
                camhub
              </Text>
            </span>
          )}
          <span className="ch-topbar-cam" title={cam?.name}>
            <Tag color={connected ? 'green' : 'red'} size="small">
              {connected ? '在线' : '离线'}
            </Tag>
            <Text type="secondary" className="ch-hide-mobile" style={{ maxWidth: 180, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
              {cam?.name || '摄像头'}
            </Text>
            {connected ? (
              <Text type="secondary" className="ch-hide-mobile ch-clock">
                {cam?.fps.toFixed(1)} FPS · {cam?.width}×{cam?.height}
              </Text>
            ) : (
              <Text type="error" className="ch-hide-mobile" disabled={false}>
                等待取流
              </Text>
            )}
          </span>
        </div>

        <div className="ch-header-side">
          <Tooltip
            content={
              recording
                ? '录像进行中，点击结束录像（写入配置，热更新生效）'
                : status
                  ? '点击开始录像（写入配置，热更新生效）'
                  : '获取状态中…'
            }
          >
            <Button
              type={recording ? 'primary' : 'outline'}
              status={recording ? 'danger' : 'default'}
              size="small"
              icon={recording ? <IconRecordStop /> : <IconRecord />}
              loading={recPending}
              disabled={!status}
              onClick={toggleRecord}
              aria-label={recording ? '结束录像' : '开始录像'}
            >
              REC
            </Button>
          </Tooltip>

          <Tooltip content={armed ? '布防中：移动侦测事件将入库并推送' : '已撤防：仅停止事件入库与推送'}>
            <span className="ch-arm">
              <Switch
                size="small"
                checked={armed}
                loading={armPending}
                disabled={!status}
                onChange={toggleArm}
                aria-label="布防开关"
              />
              <Text type="secondary" className="ch-hide-mobile" style={{ fontSize: 12 }}>
                {armed ? '布防中' : '已撤防'}
              </Text>
            </span>
          </Tooltip>

          {IS_MOCK ? (
            <Tooltip content="当前为 mock 数据模式，未连接后端">
              <Tag color="orange" size="small">
                MOCK
              </Tag>
            </Tooltip>
          ) : null}

          <Clock />

          <Tooltip content={theme === 'dark' ? '切换到亮色模式' : '切换到暗色模式'}>
            <Button
              shape="circle"
              type="outline"
              size="small"
              icon={theme === 'dark' ? <IconSun /> : <IconMoon />}
              aria-label={theme === 'dark' ? '切换到亮色模式' : '切换到暗色模式'}
              onClick={toggleTheme}
            />
          </Tooltip>

          {!isMobile ? (
            <Menu
              mode="horizontal"
              ellipsis={false}
              selectedKeys={[activeKey]}
              onClickMenuItem={(key) => go(key)}
              style={{ flexShrink: 0, backgroundColor: 'transparent', borderBottom: 'none' }}
              aria-label="主导航"
            >
              {NAV.map((n) => (
                <Menu.Item key={n.key}>{n.label}</Menu.Item>
              ))}
            </Menu>
          ) : null}
        </div>
      </Header>

      <Content className={`ch-content ${pathname === '/' ? 'ch-content-bleed' : ''}`}>
        <div key={pathname} className="ch-page">
          <Outlet />
        </div>
      </Content>

      <Drawer
        visible={drawerOpen}
        placement="left"
        width={248}
        footer={null}
        title="导航"
        closable
        onCancel={() => setDrawerOpen(false)}
      >
        <Menu
          mode="vertical"
          selectedKeys={[activeKey]}
          onClickMenuItem={(key) => go(key)}
          style={{ border: 'none' }}
        >
          {NAV.map((n) => (
            <Menu.Item key={n.key}>{n.label}</Menu.Item>
          ))}
        </Menu>
      </Drawer>
    </Layout>
  )
}
