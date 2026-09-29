# UI_REFINEMENT_PLAN — v1.4.3 第二轮视觉一致性精修

> 前提：不推翻 v1.4.2 架构（React+TS+Tailwind+Arco+Vite，三态主题，App Shell 不动）。
> 目标：把 Settings / Events / Playback / System Overview 的成熟度拉齐到 Monitor / Logs / Shell 水平；
> 去 Admin 感、去 Arco Demo 感、去 Card 感、去浮层玻璃感；统一 Typography / 间距 / 交互反馈。

## 1. Current Problems（现状分析结论）

| # | 问题 | 位置 |
|---|---|---|
| P1 | Settings 仍是 Card+Form 堆叠（`Card` 组件 = 描边盒 + 表头），控件宽度 22 处 inline `style={{width}}`，保存条 backdrop-blur 玻璃感 | SettingsPage |
| P2 | Settings 分类命名随意（侦测/录像存储/自检与日报/Bot），Danger Zone 混在导航尾部 | SettingsPage |
| P3 | Events 筛选行是 Arco 默认控件宽度/观感；日期分组头带底色偏重；行内「查看/删除」双按钮冗余（Drawer 已有同能力） | EventsPage |
| P4 | Event Drawer 元数据为松散行，页脚 3 按钮 | EventsPage |
| P5 | Playback HUD 与底部信息重复（HUD 显示文件名），日期导航偏重，无时间轴 hover 预览 | PlaybackPage |
| P6 | Overview 指标数值 18px 偏大（规范 15~16px） | DashboardPage |
| P7 | TopBar 搜索按钮带描边偏重；Sidebar 品牌图标带底色方块偏重 | TopBar/AppSidebar |
| P8 | Logs 高度用 `calc(100dvh-330px)` 魔法数 | LogsPage |
| P9 | Monitor HUD 右上「分辨率·FPS」与底部状态行重复；EventList 每项 rounded+缩略图描边偏 Card | MonitorPage/EventList |
| P10 | EmptyState 大圆形图标过重（规范：空态可无图标）；ErrorState 图标可收敛 | StateViews |
| P11 | 死组件：PageHeader / Panel / SectionHeader 已无使用方 | components/ |
| P12 | RoiEditorModal 10 处 inline style、EventsPage 3 处 Arco width inline | components/pages |

Token/字阶/边框体系（v1.4.2 已修 border-style 失效）保持不变；Arco 继续作为交互引擎。

## 2. Target Design

- **Settings Workspace**：左导航（200px，30px 项）分组「SETTINGS」+ 底部独立「DANGER ZONE」；
  分类更名 Camera/Detection/Recording/Notifications/Schedule/Diagnostics/Telegram（自检+日报并入 Diagnostics，仅展示层）。
  内容区 = Section（标题 13/600 + 描述 12 tertiary）+ Row（min-h 52px：左 Title 13/Desc 11，右 Control），
  Row 间 border-b 分隔，Section 间 mb-7；无描边 Card 盒。
  控件统一 32px 高/6px 圆角（Arco 全局高度覆盖），宽度走常量 field-sm/md/lg（160/220/320）。
  Notifications = 一个 Section 内的分通道子组（通道名小标 + Enabled/Webhook/…/Test 行）；
  Schedule = 规则列表行（border-b，无彩色 Tag，无表格 Card）；Save Bar = 无 blur、border-t、实底 52px；
  Danger Zone = danger/3 + danger/15 轻色调，独立导航项。
- **Events Workspace**：工具行控件 32px/6px 低对比（Arco width inline → token 类）；
  日期分组头弱化为 11px uppercase tertiary（去底色）；行 = ☐ + 缩略图 + 标题/meta（点+类型+相机·score·时间），
  去行内「查看/删除」按钮（Drawer 承载）；Drawer = 定义式两列元数据 + 页脚「查看回放(主)/关闭(次)/删除(quiet danger)」。
- **Playback Workspace**：页头（回看 + 相机·日期描述；右侧录制统计为 metadata）；
  日期导航更轻；视频 border+8px；HUD 仅 左=时间 右=相机名；时间轴 hover 预览（时间 chip，
  契约无缩略图数据故只显示时间）；控制条尺寸规范（Play 32px）；空态走新 EmptyState。
- **System Overview**：指标数值 16px（新增 fontSize token `metric`），label/metadata 11px。
- **TopBar**：搜索改无描边 command affordance（⌕ 搜索 ⌘K，hover bg）；分隔线 ≤2。
- **Sidebar**：品牌图标去底色方块（16px 图标 + 文字）；相机行维持圆点。
- **Logs**：Workspace 高度改 `flex-1 min-h-0` 自适应（去 calc 魔法数）。
- **Monitor**：HUD 去右上「分辨率·FPS」重复 chip；EventList 改 border-bottom 行（去每项 rounded/描边）。
- **StateViews**：EmptyState 去大图标（纯标题+描述+动作）；ErrorState 图标缩小。
- **清理**：删除死组件 PageHeader/Panel/SectionHeader；RoiEditorModal/EventsPage inline style 迁 Tailwind；
  global.css 复查无冗余皮肤；preflight:false 策略不动（box-sizing/border/button/list 重置保留）。

## 3. Component Problems
SettingsPage 内部 `Card` → 改名重构为 `Section`（无盒）；`Row` 保留（min-h 52 + 11px desc）；
`ChannelCard` → `ChannelSection`（子组行式）。

## 4. Settings Refinement
见 §2；功能零变化：全部字段、保存流程（POST /api/config 全量）、通知测试、规则增删改、
ROI 编辑、清空事件（batch-delete 分批）原样保留。

## 5. Events Refinement
见 §2；保留：detail 精确筛选、批量删除、删后回退页码、分页、Drawer 查看回放带参跳转。

## 6. Playback Refinement
见 §2；保留：合并/聚合算法、跳转规则、带参跳转、倍速、全屏。

## 7. Dashboard Refinement
仅指标字号与 label 规格，布局不动。

## 8. TopBar Refinement / 9. Logs Refinement / 10. Monitor Refinement
见 §2；业务逻辑（REC 确认弹窗、布防请求、SSE、轮询、黑边检测）零改动。

## 11. Light/Dark Consistency
全部新样式仅用 cam-* token；Arco 高度/圆角覆盖写在 tokens.css（双主题生效）；
验收时明暗双主题逐页走查。

## 12. Inline Style Cleanup
可迁移：Settings 控件宽度→常量类；Events/Settings Arco 宽度→宽度类；RoiEditorModal 间距→类。
保留（真实动态值）：timeline/ROI/进度/图表几何、liveBox objectViewBox、AutoCropImage 定位。

## 13. Validation Plan
每 Phase：`npm run build` + mock 页面截图。
终验：Light/Dark 双主题 × Monitor/Playback/Events/Recordings/Overview/Settings/Logs 全页 +
390/768/1280/1440/1920 分辨率抽查 + Console 无错误 + webdist 内嵌 + go build。
