# CamBox UI_REDESIGN_PLAN — Linear 风格全面视觉重构

> 任务书：《CamBox 全面 UI 重构任务》（Linear / Modern Dark Workspace / Professional Camera Console）。
> 本计划是唯一方案文档；执行过程中不换方案，问题走「定位 → 局部修复 → 验证」。

---

## 1. 现状分析（Phase 1 结论）

### 技术栈（保持不变）
React 18 + TypeScript + Vite 5 + Tailwind 3（preflight 关闭）+ Arco Design 2.66 + react-router-dom 6（HashRouter）。
API 层（`src/api/*`）与 mock 模式完整，契约 v1.1/v1.2 已核对：**本次重构零 API 改动**。

### 当前 UI 与目标差距
| 维度 | 现状 | 目标（任务书） |
|---|---|---|
| 布局外壳 | 顶栏胶囊导航（无 Sidebar） | Workspace 左 Sidebar（220–240px）+ 48px TopBar |
| 色彩 | 深青灰底 + 青色 accent 贯穿全局 | 中性 zinc 体系 #09090B 底、低对比边框，色相只留给语义状态 |
| Typography | page-title 20px / body 14px | page-title 18px / body 13px / secondary 12px / caption 11px，小而精确 |
| 圆角 | panel 14 / 控件 8 | panel/modal 10 / popover 8 / 控件 6 |
| 阴影 | 少量 | 仅浮层；内容区全部 border + surface 对比 |
| Monitor | 视口 + Panel 状态条 + 右栏 Panel | CameraViewport 直接作为主 Surface + 单行状态 + 右侧 Recent Events 300–340px |
| Playback | 面板堆叠 | 专业视频工作台：播放器 + 24h 时间轴（中性录像段 + 小事件 marker）+ 控制条 |
| Events | Arco 风格行 + 筛选 | 按日分组的紧凑事件工作区 + 右 Drawer 详情 |
| Recordings | 行列表 | 文件管理器（Asset Workspace）式列表 |
| Dashboard | 4 指标卡 + 状态条 + 图表 | 更名「系统概览」，Compact Metrics + 状态列表 |
| Settings | 左导航（已有）+ 网格卡片 | 左导航 + 行式设置（Title/Desc/Control）+ Save 状态 + Danger Zone |
| Logs | 已终端化 | 保持，配色对齐新 token（INFO 中性色） |
| Mobile | 顶栏 Drawer 导航 | 底部导航（监控/回看/事件/更多）+ 真正重排 |
| 快捷导航 | 无 | Command Menu（⌘K / Ctrl+K） |

### 功能清单（全部保留，不允许丢失）
实时监控 / MJPEG / 自动重连 / 在离线 / FPS / 分辨率 / 录制状态 / 布防撤防 / 抓拍 / ROI / ROI 编辑 / 移动侦测 / 冻结 / 遮挡 / 事件 / 缩略图 / 筛选 / 批量删除 / 回放 / 时间轴 / 录像段 / 存储水位 / 全部配置项 / 布防日程 / 通知五通道+测试 / 自检 / 日报 / Bot / 日志 SSE 暂停清屏 / Mock 模式。

---

## 2. 新信息架构

```text
AppShell
├── Sidebar (224px, <768px 隐藏)
│   ├── CamBox 品牌行
│   ├── CAMERAS：● 相机名 + 分辨率 + 在线点（点击 → /monitor）
│   ├── WORKSPACE：监控 / 回看 / 事件 / 录像
│   ├── SYSTEM：系统概览 / 设置 / 日志
│   └── 底部：v1.3.0 + 主题切换
├── TopBar (48px)
│   ├── 左：当前页面名（14px/medium）
│   └── 右：REC 开关 · 布防开关 · 时钟(mono) · ⌘K · 主题 · (移动端菜单)
├── Main（flex-1，页面级 padding 24px / 移动 16px）
│   ├── /monitor    Camera Workspace：视口(hero) + 单行状态 + 右 Recent Events 栏
│   ├── /playback   Playback Workspace：播放器 + 时间轴 + 控制条
│   ├── /events     Event Workspace：筛选行 + 按日分组列表 + Drawer 详情
│   ├── /recordings Recording Workspace：存储摘要 + 文件列表
│   ├── /dashboard  System Overview：Compact Metrics + 系统状态列表 + 趋势 + 最新事件
│   ├── /settings   Settings Workspace：设置左导航 + 分区行式表单 + Danger Zone
│   └── /logs       Log Console：工具行 + 终端视图
├── Mobile BottomNav（<768px）：监控 / 回看 / 事件 / 更多(Drawer)
└── CommandMenu（⌘K，全局导航 + 主题切换）
```

路由不变（`/`、`/playback`、`/dashboard`、`/events`、`/recordings`、`/settings`、`/logs`）。

---

## 3. Design Token（新）

### 颜色（zinc 中性体系，dark 默认 / light 同名覆盖）
```text
bg #09090B · surface #0D0D0F · elevated #121214 · active(hover) #18181B
border rgba(255,255,255,.06) · border-strong rgba(255,255,255,.10)
text-1 #F4F4F5 · text-2 #A1A1AA · text-3 #71717A · text-4 #52525B
success #34D399 · warning #FBBF24 · danger #F87171 · info #60A5FA · rec #F87171 系
Primary（按钮）#E4E4E7（中性浅按钮，深色文字）—— 全站无品牌色相
```
Arco 对齐：`--primary-6 = #E4E4E7`（Switch/Checkbox/Radio/Slider/分页等选中态为中性别），并加少量
CSS 覆盖让「选中底上的图标/文字」变深色，保证对比度。**不引入蓝色/青色 accent。**

### Typography（Inter 优先栈）
page-title 18/600 · section-title 13/600 · body 13/400 · body-secondary 12 · caption/metadata 11（数字时间 mono + tabular-nums）。

### 圆角 / 动效
控件与导航 6px（rounded-md）· popover 8px（rounded-lg）· panel/modal 10px（rounded-panel=10px）。
动效 100–200ms ease-out，只用 opacity/color/translateY(2px)；呼吸点保留（在线/REC）。

### CSS 架构
`styles/tokens.css`（token + Arco 变量对齐 + 控件覆盖）+ `styles/global.css`（基础层 + 专用皮肤）。
遗留 `ch-*` 类全部清除。

---

## 4. 组件体系（新增/保留）

```text
components/app/    AppSidebar · TopBar · CommandMenu        （新增）
components/common/ Panel · StatusBadge · IconButton · SectionHeader · StateViews（保留，视觉重绘）
components/        EventList · RoiEditorCard/Modal · HourlyChart · AutoCropImage（保留，皮肤重绘）
```
不为了结构而拆散业务逻辑：页面内部结构保持，只重排布局与视觉；`useAsync` / `useStreamFrame` /
`useMediaQuery` / format 工具全部复用。

---

## 5. 页面要点

- **Monitor**：视口 `flex-1` 黑底 contain 主角；HUD = LIVE+时钟(左上) / 分辨率·FPS(右上) / REC(左下，
  克制红点)；悬浮工具条 hover 浮现（抓拍/检测区域/全屏）；ROI 默认隐藏、工具条可开关显示；
  底部单行状态（在线·FPS·分辨率·录像·存储）；右栏 320px 最近事件（紧凑行：缩略图+类型+时间+score 弱化）。
- **Playback**：播放器在上（黑底 contain），下方 24h 时间轴：录像段=中性灰带、事件=小 marker
  （motion 中性 / 冻结 amber / 遮挡 red）、播放头白色；hover 时间刻度提示；控制条 Play/时间/进度/倍速/全屏。
- **Events**：筛选行（类型/日期/异常/重置/刷新）；列表按「今天 / 昨天 / 日期」分组；行=时间(mono)+类型+相机
  +右缩略图；Drawer 详情（大图+元数据+查看回放→带参跳转回放页）。
- **Recordings**：存储摘要条 + 搜索；行=文件名(mono)+起止+时长+大小+播放/下载/删除；mock 下载禁用提示保留。
- **System Overview**：Compact Metrics 一行四项（相机/录像/存储/运行）+ 系统状态列表（相机健康/存储/录像/
  侦测/通知/自检）+ 紧凑趋势图 + 最新事件。
- **Settings**：左导航（复用现有交互，视觉对齐）；行=Title+Desc+Control；保存条=「Saved / 未保存 N 处」
  内联状态；新增「危险操作」分区（清空事件记录，走现有 batch-delete API，二次确认）。
- **Logs**：终端不变；INFO 改中性色；新增缓冲内搜索；级别筛选/暂停/清屏保留。

## 6. 响应式

`<768px`：BottomNav + 内容单列 + 视口工具条常驻 + Monitor 事件区在视口下方；`768–1279px`：Sidebar + 单列；
`≥1280px`：Monitor 右栏 / Overview 双栏。验收覆盖 375/390/430/768/1024/1280/1440/1920/2560。

## 7. 做什么 / 不做什么

**做**：以上全部视觉/布局/交互重构；Command Menu；移动 BottomNav；tokens 拆分；清理遗留 ch-* CSS；
package.json version → 1.3.0（与仓库 v1.3 版本语言一致）；品牌展示名 → CamBox。

**不做**：不改任何 API/契约/后端/mock 数据结构；不加多摄像头（API 为单相机，「+ 添加摄像头」不做）；
不做 Workspace 切换器（单工作区）；不做事件全文搜索（API 无该参数，避免假搜索）；播放器不加音量
（监控录像无声轨，任务书允许只保留核心控件）；不加新依赖/不换 UI 框架；不做重置配置（无对应 API）。

## 8. Phase 拆分与完成标准

| Phase | 内容 | 完成标准 |
|---|---|---|
| 2 | tokens.css + tailwind.config + 基础组件重绘 + Arco 覆盖 | build 通过；token 全站生效 |
| 3 | AppShell：Sidebar/TopBar/CommandMenu/BottomNav | 全路由可用；无样式断裂 |
| 4 | Monitor | 视口主角；HUD/工具条/状态行/事件栏；ROI 开关 |
| 5 | Playback | 时间轴中性化；控制条；跳转逻辑保留 |
| 6 | Events | 分组列表 + Drawer + 批删；详情带「查看回放」 |
| 7 | Recordings | 文件列表式；播放/下载/删除保留 |
| 8 | System Overview | Compact Metrics + 状态列表 |
| 9 | Settings | 行式 + 保存状态 + Danger Zone |
| 10 | Logs | 终端对齐新 token + 搜索 |
| 验收 | `npm run build` + mock 模式多分辨率截图走查 | 9 档分辨率无错位；无 console 错误 |

每 Phase 结束：`tsc && vite build` 通过 → 独立 commit。
