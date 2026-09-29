# WebUI 全面回归 Arco Design 组件重构

日期：2026-09-29 · 状态：执行中

## 目标

用户裁定当前 Profound 自绘皮肤"太丑"，要求：**能用 Arco 组件的地方全部用 Arco 组件实现，动画用组件自带动画**。
即：拆除 2633 行自绘 CSS 皮肤（玻璃拟态/液态玻璃/自绘按钮/表格/分页/徽章/进度条），
回归 Arco Design 默认视觉语言；交互改用 Arco 组件内建行为与动画。

## 组件映射表（自绘 → Arco）

| 现状（自绘） | 改为（Arco） |
|---|---|
| `ch-topbar` 悬浮玻璃顶栏 + `ch-navpill` 自绘导航 | `Layout.Header` + `Menu`(horizontal) + `Button`/`Switch`/`Tag`/`Typography` |
| View Transitions 换页动画 | 删除（保留 React 重挂载默认，不加自定义动画） |
| `ch-panel` 自绘面板（Panel.tsx） | `Card`（title/extra/hoverable）——Panel.tsx 保留 API 内部转发 Card |
| `ch-statcard` ×6 | `Card` + `Statistic` + `Tag` + `Progress` |
| `ch-meter` 自绘进度条 | `Progress`（line，自带动画） |
| `ch-event-list` 自绘事件列表 | `List` + `List.Item` + `Avatar`/img + `Typography` |
| HourlyChart 自绘 SVG 柱图 | `@arco-design/charts` Column（自带 tooltip/动画） |
| `ch-table` 自绘表格 + `ch-pager` 自绘分页 | `Table`（rowSelection/pagination/loading 自带） |
| `ch-badge` | `Tag` |
| `ch-btn` / `ch-linkbtn` | `Button`（type=text/primary, status=danger） |
| `ch-btn icon` | `Button shape=circle/iconOnly`（保留方形 `shape=square`） |
| 监控页实时事件侧栏 + 收起/呼出 | `Drawer`（mask=false，自带滑入动画）+ `Card` |
| `ch-ovl` LIVE/分辨率浮层 | `Tag`（浮层定位保留少量 CSS） |
| `ch-filterbar` | `Space` + 既有 Select/DatePicker |
| Playback 播放控制条 | `Slider`（进度/倍速容器）+ `Button` + `Select` |
| 24h 录像时间轴 | 无对应组件 → 保留自绘，但重写为贴合 Arco token 的极简样式 |

## 做什么

1. AppLayout：Layout.Header + Menu 导航（选中态动画组件自带）、保留布防/REC/时钟/主题切换/mock 徽标、移动端 Drawer。
2. Panel.tsx 内部转发 Card；PageHeader 用 Typography 重写。
3. Dashboard：Card+Statistic+Progress+Tag；图表换 @arco-design/charts（新增依赖）；EventList 换 List。
4. Monitor：事件侧栏改 Drawer(mask=false)+Card+List；livebar 改 Space+Button 工具条；浮层改 Tag；保留 MJPEG/自动裁黑边/ROI 覆盖逻辑。
5. Events/Recordings：自绘表格换 Table（rowSelection、pagination、Tooltip、下载/删除操作列）。
6. Playback：控制条换 Slider/Button/Select；24h 时间轴保留自绘但重写样式（Arco token）；聚合事件刻度逻辑保留。
7. Settings/Logs/RoiEditor：ch-btn/ch-panel/ch-badge 全部换对应 Arco 组件。
8. global.css：2633 行 → 精简为布局骨架 + 少量定位样式 + Arco token 适配；删除玻璃/液态玻璃/网格背景/自绘按钮表格分页皮肤/自定义 keyframes。
9. 主题：保留 data-theme + arco-theme 原生明暗切换。

## 不做什么

- 不改 API、mock、路由、数据结构、后端。
- 不删功能：抓拍、ROI、布防、REC、主题切换、自动裁黑边、事件聚合刻度全保留。
- 不引入第二套组件库 / Tailwind UI；Tailwind 依赖保留但基本不再使用其类。
- 不追求 1:1 复刻旧布局细节（用户已否决旧视觉）。

## 修改文件

AppLayout.tsx、Panel.tsx、PageHeader.tsx、EventList.tsx、HourlyChart.tsx(删/换)、StateViews.tsx、StorageMeter.tsx、
DashboardPage、MonitorPage、EventsPage、RecordingsPage、PlaybackPage、SettingsPage、LogsPage、
RoiEditorModal/RoiEditorCard、global.css、package.json(+@arco-design/charts)

## 测试方案

`npm run build`（tsc+vite）→ 同步 webdist → go build → 重启 → 无头 Edge 逐页截图（监控/回看/概览/事件/录像/设置/日志 × 明暗主题）目检验收。

## 风险

- @arco-design/charts 包体较大（G2Plot），本地 NVR 可接受；若与 React 18 构建冲突则回退自绘 SVG 图。
- Table rowSelection 分页全选语义与旧自绘一致（仅本页全选）。
- Drawer 事件面板与旧"推挤布局"交互不同（用户本次指令以组件自带动画优先）。

## 验收标准

全部 7 页在明暗两主题下正常渲染、无样式错位；所有按钮/表格/分页/开关为 Arco 默认样式；
自绘 CSS 显著减少；构建通过。
