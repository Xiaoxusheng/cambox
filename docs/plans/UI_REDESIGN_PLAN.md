# UI_REDESIGN_PLAN —— camhub webui 全面 UI 重设计

> 日期：2026-09-29 · 范围：`webui/`（纯前端，零后端改动）· 依据：任务书（CamBox/CamHub 全面 UI 重设计 + Tailwind 规范）+ 仓库设计稿 `camhub-ui-4k/`

## 1. 当前实现与问题

上一轮提交（e76bde3）把 UI 回归为「Arco Design 原生组件 + 默认样式」：

- 观感 = 传统 Arco Admin 后台：灰底 Card 平铺、Arco Menu 顶栏、Arco Table 堆叠。
- 监控页画面被 Card 包裹，状态区是 6~8 个 Tag/按钮堆在一条 Card 工具条里，没有监控台质感。
- 事件中心 = 厚重 Table；设置 = Radio 按钮组 + 双列 Card 网格；日志样式尚可但配色随机。
- Tailwind 已安装但基本闲置（preflight 关闭、仅映射了 5 个 ch-* 变量色）。
- 设计稿（camhub-ui-4k/8k）定义过完整视觉语言，但当前代码完全未采用。

## 2. 目标视觉语言（Professional Dark Monitoring Console）

以仓库设计稿为基准（它就是本产品的既定设计语言）：

- **深色优先**：near-black 背景（#07090c），实体深色 Surface（#0d1015 / #12161c），细白描边 rgba(255,255,255,.07/.12)。
- **Accent = 青/teal**（设计稿语言，覆盖任务书示例里的 #4f8cff——示例标注为「建议」，仓库设计稿为既定规范）：仅用于当前导航、Primary、Focus、选中、少量状态。
- 状态语义固定：success=在线/录像中、warning=注意、danger=离线/错误/危险、info=中性。
- 数字/时间/IP/文件名用 mono + tabular-nums；正文系统字体栈。
- 玻璃拟态只允许出现在：顶栏、视频 HUD、悬浮工具条。内容区一律实体 Surface。
- 动画 120/150/200/240ms，克制；hover 用 bg/border 变化，禁止 scale。
- 亮色主题继续支持（CSS 变量切换，dark 为默认与基准）。

## 3. 技术方案

- **Tailwind = 主 Styling Layer**（布局/间距/颜色/字级/响应式/动效），token 进 `tailwind.config.js`（`cam.*` → CSS 变量，双主题自动切换）。
- **Arco = 交互组件能力**（Modal/Drawer/Select/DatePicker/Message/Tooltip/Input/Switch/Slider/Pagination…），通过全局覆盖少量 Arco CSS 变量（--primary-6 等）对齐 accent。
- preflight 保持关闭（不破坏 Arco 默认样式）。
- 不新增任何 npm 依赖；图标继续用 `@arco-design/web-react/icon`。

## 4. Design Token（dark 默认 / light 覆盖，CSS 变量 + tailwind cam.*）

```text
--cam-bg #07090c      页面底          --cam-surface #0d1015   面板
--cam-elevated #12161c 二级面板/浮层   --cam-active #1a1f27    hover/选中底
--cam-border rgba(255,255,255,.07)   --cam-border-strong .12
--cam-text #eef2f6 / secondary #9aa3ad / tertiary #646b76 / disabled #4a505a
--cam-accent #2fc6cf  + dim rgba(47,198,207,.14)
--cam-success #3ddc97 --cam-warning #f5b942 --cam-danger #ff5d68 --cam-info #55a8ff
--cam-rec #ff4d5e    REC 专用红
字体 --cam-mono：JetBrains Mono/SFMono/Consolas
```

light 主题同名变量覆盖（bg #f4f6f8 / surface #fff / 边框黑系 / accent #0f9aa5）。

## 5. 信息架构与组件规划

```text
components/
  common/    Panel SectionHeader StatusBadge EmptyState ErrorState LoadingSkeleton
  camera/    CameraViewport(画面+HUD+悬浮工具条) CameraStatusBar(状态条)
  events/    EventList(实时事件/最新事件共用) EventRow EventDrawer
  playback/  Timeline(24h) Player
```

页面：

| 页面 | 新结构 |
|---|---|
| AppLayout | 56px 胶囊顶栏：品牌+相机状态｜REC/布防/时钟/主题｜导航 pill 组；移动端汉堡 Drawer；监控页无 max-width |
| MonitorPage `/` | 桌面 `grid lg:grid-cols-[minmax(0,1fr)_320px]`：左=视口(视频 contain+HUD+悬浮工具条)+状态条；右=实时事件 Panel；<lg 事件转下方 Section；移动端工具条常驻 |
| PlaybackPage | 页头 + 日期胶囊导航 + 时间轴 Panel（保留合并/聚合算法）+ 播放器 Panel（自绘控制条：播放/时间/进度/倍速/全屏） |
| EventsPage | 筛选行（Select+RangePicker+重置）+ 轻量事件列表（复选框/缩略图/类型徽章/时间/详情/操作）+ 批量删除条 + Pagination + 详情 Drawer |
| RecordingsPage | 存储摘要头 + 搜索 + 轻量列表（文件名/起止/大小/模式/下载/删除）+ 分页 |
| DashboardPage | 4 个核心指标卡（连接/录像/存储/运行）+ 今日事件趋势 + 最新事件 + 布防快捷开关 |
| SettingsPage | 左侧 SettingsNav(220px，移动端顶部横滚) + Section 卡（每行 标题+描述+控件）+ 吸底保存条 |
| LogsPage | 终端面板：工具行（级别/计数/连接态/暂停/清屏）+ mono 日志视图 |

## 6. 必须保留的功能清单（回归验收）

实时 MJPEG/自动重连/在线离线/FPS/分辨率/布防撤防/抓拍/ROI(弹层编辑+设置页内联)/移动侦测/冻结/遮挡/事件记录+缩略图/事件筛选(类型/detail/日期)/批量删除/回看时间轴(合并+聚合+播放头)/录像播放(分段/倍速/全屏)/录像列表(搜索/下载/删除)/存储水位/全部设置项(7 组+日程+日报+Bot)/SSE 日志(暂停/清屏/级别)/Mock 与 Real 双模式/全部现有 API 调用路径。

## 7. 明确不做

- ❌ 不修改后端 Go 代码与 API 契约；不做无 API 支撑的新功能（如「清空录像」按钮）
- ❌ 不新增 npm 依赖、不引入图表库/动画库/图标库
- ❌ 不做登录/权限/国际化；不做玻璃拟态铺满、渐变、发光
- ❌ 不改路由结构；mock.ts 数据形状不动

## 8. 阶段划分（每阶段独立可验证 + 独立 commit）

1. Phase 1 Design System：tokens → tailwind.config → global.css 重写 → common 组件 → index.html 防白屏
2. Phase 2 AppLayout 顶栏
3. Phase 3 MonitorPage + camera/* + EventList（视觉基准页）
4. Phase 4 PlaybackPage + playback/*
5. Phase 5 EventsPage + RecordingsPage
6. Phase 6 DashboardPage
7. Phase 7 SettingsPage + LogsPage + ROI 皮肤
8. Phase 8 验收：`npm run build` + `npm run dev:mock` 浏览器截图（1440×900 / 390×844，各状态 Loading/Empty/Error）+ 最终报告

## 9. 风险

- Arco 组件在深色 pill 语境下的默认样式冲突 → 用少量全局变量覆盖 + 局部 className，不全局 reset。
- object-fit 由 cover 改 contain（任务书要求不裁切主画面）→ ROI 覆盖矩形计算同步改 contain 公式。
- 双主题回归 → 所有 token 走 CSS 变量，禁止硬编码页面色。
