/**
 * StatusActions —— REC / 布防操作（v1.4.4 从 TopBar 抽出，TopBar 与移动端 Drawer 复用）。
 * 视觉 = 状态 metadata（点 + 文字），非按钮；功能保持：REC 二次确认、布防即时切换。
 */
import { useState } from 'react'
import { Message, Modal, Tooltip } from '@arco-design/web-react'
import { fetchConfig, saveConfig, setArmed } from '../../api/endpoints'
import { errorText } from '../../api/errors'
import type { Status } from '../../api/types'
import { cx } from '../../utils/cx'

/** REC：小型 mono metadata（点击切换录像） */
export function RecAction({
  status,
  reload,
  className,
}: {
  status?: Status | null
  reload: () => void
  className?: string
}) {
  const [recPending, setRecPending] = useState(false)
  const recording = status?.recorder.running ?? false

  const toggleRecord = (next: boolean) => {
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

  return (
    <Tooltip
      content={
        recording
          ? '录像进行中，点击结束录像（写入配置，热更新生效）'
          : status
            ? '点击开始录像（写入配置，热更新生效）'
            : '获取状态中…'
      }
    >
      <button
        type="button"
        aria-label={recording ? '结束录像' : '开始录像'}
        disabled={!status || recPending}
        onClick={() => toggleRecord(!recording)}
        className={cx(
          'cam-num inline-flex h-7 items-center gap-1.5 rounded-md px-1 text-[11px] font-medium tracking-[0.06em]',
          'transition-colors duration-150 ease-cam disabled:pointer-events-none disabled:opacity-40',
          recording
            ? 'text-cam-rec hover:bg-cam-hover'
            : 'text-cam-text-tertiary hover:bg-cam-hover hover:text-cam-text-secondary',
          className,
        )}
      >
        <span
          className={cx(
            'h-1.5 w-1.5 rounded-full',
            recording ? 'animate-rec-pulse bg-cam-rec' : 'bg-cam-text-4',
          )}
        />
        REC
      </button>
    </Tooltip>
  )
}

/** Armed：状态文字 + 小圆点（点击布防/撤防） */
export function ArmAction({
  status,
  reload,
  className,
}: {
  status?: Status | null
  reload: () => void
  className?: string
}) {
  const [armPending, setArmPending] = useState(false)
  const armed = status?.armed ?? false

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

  return (
    <Tooltip content={armed ? '布防中：移动侦测事件将入库并推送' : '已撤防：仅停止事件入库与推送'}>
      <button
        type="button"
        aria-label={armed ? '撤防' : '布防'}
        disabled={!status || armPending}
        onClick={() => toggleArm(!armed)}
        className={cx(
          'inline-flex h-7 items-center gap-1.5 rounded-md px-1 text-caption transition-colors duration-150 ease-cam',
          'disabled:pointer-events-none disabled:opacity-40',
          armed ? 'text-cam-text-secondary hover:bg-cam-hover' : 'text-cam-text-tertiary hover:bg-cam-hover',
          className,
        )}
      >
        <span
          className={cx(
            'h-1.5 w-1.5 rounded-full',
            armed ? 'animate-breathe bg-cam-success' : 'bg-cam-text-4',
          )}
        />
        {armed ? '布防中' : '已撤防'}
      </button>
    </Tooltip>
  )
}
