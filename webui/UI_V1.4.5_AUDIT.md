# UI_V1.4.5_AUDIT — Final QA（v1.4.4 → v1.4.5）

> 审计方式：指定文件通读 + 全源码 grep（console.log / any / TODO / backdrop-blur /
> 硬编码色 / 任意值 / Modal 宽度 / 竞态路径）。架构、主题系统、API、业务逻辑不动。

## 1. 当前 UI 状态
v1.4.4 已完成：Workspace Shell / Dark+Light+System 三态 / Settings·Events·Playback 工作台化 /
日志终端 / 移动端 BottomNav / ⌘K / 无障碍基线（aria-label、aria-current、focus-visible）。
基线健康：0 console.log、0 any、0 TODO/FIXME、noUnusedLocals 编译期兜底。

## 2. P0 问题（本轮必修）
| # | 问题 | 位置 | 修法 |
|---|---|---|---|
| P0-1 | Events 筛选控件移动端固定宽度（200/168/260px）导致 375~430 挤压/溢出风险 | EventsPage | 改 `w-full sm:w-[…]`，移动端纵向堆叠 |
| P0-2 | 事件翻页不清空 selection：跨页 selection 与「全选本页」替换语义混淆，易误删 | EventsPage | `onChange={(p)=>{setPage(p); setSelected([])}}` |
| P0-3 | Recordings 三个操作（播放 IconButton / 下载裸 `<a>` / 删除 IconButton）Tooltip 与样式不统一 | RecordingsPage | 下载补 Tooltip + aria-label，三者统一 32px ghost（保留 `<a download>` 原生能力） |
| P0-4 | Arco Modal 默认宽 520px，390 屏会横向溢出（抓拍结果/事件预览/布防规则 3 处） | MonitorPage/SettingsPage | `width="min(520px, calc(100vw - 32px))"` |
| P0-5 | 无 prefers-reduced-motion 支持：呼吸点/入场动画在减少动画偏好下仍运行 | global.css | 全局 media query 关闭非必要动画 |
| P0-6 | BottomNav 无 iOS safe-area 适配：全面屏底部被 Home Indicator 遮挡 | AppLayout | padding-bottom: env(safe-area-inset-bottom) |

## 3. P1 问题
| # | 问题 | 修法 |
|---|---|---|
| P1-1 | Settings 左导航组标签 "SETTINGS" 与页面标题「设置」中英混杂 | 移除组标签（导航自明） |
| P1-2 | Settings 左导航移动端滚动提示弱 | 保留 6px 可见滚动条 + 末项可滚动至边缘（已有）；加 `snap` 不做（避免过度工程）→ 记录不改 |
| P1-3 | StorageMeter.tsx 被任务书引用但不存在（过时清单） | 记录，无动作 |
| P1-4 | Timeline hover chip 在 0%/100% 已 clamp（v1.4.4 ✅）；playhead 不会越界（pos ≤ 段长） | 无动作，回归确认 |

## 4. P2 问题
- 任意值字号/宽度均为规格值（30/52/220/1500/64-48 网格等），保留；
- `text-white/85`、`bg-black/40` 仅存在于视频叠层（白名单），页面主体无硬编码色；
- 圆角维持 v1.4.2 规格（面板 10 / 控件 6），不采纳 24px 页标题建议（与更早版任务书冲突，保持 18px）。

## 5. Responsive 问题
- 375/390/430：Events 筛选（P0-1 修后纵向堆叠）；Recordings 行 flex-wrap 已安全；
  Settings 导航横滚（可见滚动条即提示）；Drawer 100%/272px；CommandMenu 100vw-24。
- 终验以 375/390/430 实测 document.scrollWidth == viewport 为准。

## 6. Accessibility
已有：IconButton 强制 aria-label、输入 aria-label、nav aria-current、CommandMenu
listbox/option、focus-visible 全局 2px 中性描边（无 outline:none）、Dialog 走 Arco 语义。
本轮补充：reduced-motion（P0-5）。Tooltip 不承载唯一信息（按钮均有可见文字或自明图标+aria）。

## 7. Interaction
- Logs 自动滚动：stickRef 仅在贴底 40px 内追加滚动 ✓（用户上滑不被打断）。
- Settings 保存：dirty 才可保存；saving 中 loading 防重复；成功清 dirty、失败保留 dirty ✓。
- CommandMenu：Esc/Enter/↑↓/自动聚焦 ✓（v1.4.1 实测）。
- Events 删除：成功→reload+清选；失败→Message+保留状态 ✓。

## 8. Token / CSS
无页面级硬编码色（除视频叠层白名单）；tokens.css 双主题齐备；
`cam-hover/selected/sunken/log-*/tl-*/meter/shadow` 主题感知。本轮零新增 token。

## 9. Performance 风险
- Monitor：LiveClock 自组件秒级重渲染（局部）；status 5s 轮询整页轻更新；视频 src 恒定不重载 ✓。
- Playback：onTimeUpdate 250ms setPos；timelineBlocks/eventTicks/playheadPct 均 useMemo ✓。
- Logs：MAX_LINES 2000 截断；SSE 每条入列触发一次列表 diff，量级可接受（真机突发可再虚拟化，记录不做）。
- Events：useAsync 依赖数组驱动，筛选变化才请求 ✓。

## 10. State / API race
- useAsync：每轮 AbortController，unmount/依赖变化即 abort，过期响应被 `ac.signal.aborted` 拦截 ✓
  （覆盖 Events 筛选/翻页、Playback 换日期、Settings 加载、Monitor 轮询）。
- Logs SSE：cleanup close()；StrictMode 双挂载先清 entries ✓。
- Settings 保存：以本地 draft 全量 POST，返回后同 draft 覆盖，无旧盖新路径 ✓。
- 删除后列表：batch-delete 成功即 reload，selection 清空 ✓。

## 修复清单（已执行 ✅）
P0-1~P0-6 全修；P1-1 修（移除 SETTINGS 组标签），P1-2/P1-3/P1-4 记录不改；P2 记录不改。

## 实测结果
- 390 宽 × 7 路由：document.scrollWidth == 390，main 375，零横向溢出
- 移动端抓拍 Modal：contained，无溢出
- Arco Modal 宽度经 style=min(520px, calc(100vw-32px)) 实现（width prop 类型仅收 number）
