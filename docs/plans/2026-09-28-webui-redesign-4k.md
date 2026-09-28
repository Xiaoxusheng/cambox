# 计划：webui 按 camhub-ui-4k 设计稿 100% 重做（v1.3 外壳）

日期：2026-09-28 · 状态：进行中

## 目标

把 `webui/` 的视觉层整体重做成 `camhub-ui-4k/` 8 张设计稿的样子：暗色玻璃拟态 + 青色主色 +
等宽数字字体 + 悬浮顶栏（7 个导航 pill）+ 7 个页面 + easeOutExpo 入场动效。
**数据层（api/、hooks/、utils/）保持不动**，只重做布局组件与页面。

## 设计稿要点（提取自 8 张图）

- 外壳：悬浮玻璃顶栏 = 品牌(青点+camhub) | 相机名+在线徽章+FPS+分辨率 | REC 徽章 | 布防开关 | 大时钟 | 导航
  pill×7（监控 回看 概览 事件 录像 设置 日志，全部平铺，不再收「更多▾」）。
- 背景：近黑 #05080e + 顶部青色微光 + 细网格纹理。
- 卡片：1px 白 6~10% 描边、圆角 16~20px、玻璃底；数字/时间全部等宽字体。
- 色板：主色青 #3ec9e7、成功 #35d49a、警告 #efb93f、危险 #f87171、正文 #eef4fa / 次级 #9fb0c0 / 弱化 #5d7185。
- 动效规格（图 08）：cubic-bezier(0.16,1,0.3,1)=easeOutExpo；进入 320ms、退出 180ms、层级错峰 +60ms；
  只动 opacity/transform；位移 ≤24px、缩放 ≥0.98；prefers-reduced-motion 全部直切。
- 页面细节：监控(实时遮罩+ROI 虚线框+底部玻璃状态条+右侧实时事件)、概览(6 状态卡+小时柱图+最新事件)、
  事件中心(筛选 pill+自绘表格+分页 pill)、回看(日期导航+24h 时间轴+自定义播放器控制条 0.5x/1x/2x+全屏)、
  录像管理(存储水位卡+搜索卡+表格)、设置(pill 标签页+行式设置卡+内联 ROI 编辑器+底部保存条)、
  日志(终端风、级别着色、暂停/清屏)。

## 与工作区其他改动的共存（重要）

工作区存在另一会话的未提交改动（v1.2 事件 detail 筛选）：`internal/server/api.go`、
`internal/server/server_v12_test.go`、`internal/store/store.go`、`docs/contracts/api-v1.2.md`、
`README.md`、`webui/src/api/{types,endpoints,mock}.ts`、`webui/src/pages/EventsPage.tsx`。
本任务**不回滚、不覆盖**这些语义：重做 EventsPage 时保留「异常类型(frozen/occlusion)筛选」；
`types.ts`/`endpoints.ts` 原则上不改；提交时只提交本任务文件，绝不混入对方文件。

## 做什么

1. `global.css` 全量重写：设计 token、Arco 暗色变量映射、玻璃顶栏/卡片/pill/按钮/表格/输入框样式、
   动效 keyframes + reduced-motion 降级、响应式断点（1280/1024/768）。
2. `AppLayout.tsx` 重写：悬浮玻璃顶栏（品牌/状态/REC/布防/时钟/7 导航 pill）、View Transition 换页
   （支持时旧页 180ms 退出）、移动端抽屉。
3. 共享组件：`EventList`（新）、`HourlyChart`（重写为设计稿样式，柱色按自检事件着色）、
   `StorageMeter`、`Panel`、`PageHeader`、`StateViews` 重样式。
4. 7 个页面按设计稿重写（保留全部现有功能与状态处理）：
   - 监控：+视频 ROI 虚线覆盖（读 config.motion.rois）、全屏、底部玻璃状态条；检测 bbox 后端无数据，不做。
   - 事件中心：自绘表格 + 分页 pill；「今日 N 条」来自 /api/timeline 今日 hourly 求和。
   - 回看：自定义播放控制条（播放/进度/倍速/全屏）；移除右侧「当日录像段」侧栏（时间轴已承载，设计稿无此栏）。
   - 设置：内联 ROI 编辑器（画/移/删，坐标入 draft，随「保存全部」提交）；保留 RoiEditorModal 供监控页使用。
   - 录像：模式徽章按 camera.type 推断（rtsp/url→流复制，否则编码），Tooltip 注明。
5. `mock.ts` 仅微调取值让观感贴近设计稿（相机名前门摄像头、分数、盘位、uptime）。
6. 验证后内嵌：复制 `webui/dist` → `internal/server/webdist/`，`go build` 重建 camhub.exe（gitignore 内）。

## 不做什么

- 不改任何 API/契约/后端 Go 代码；不碰并行会话正在改的文件语义。
- 不加新依赖（Arco/React 栈原样；图表继续手写 SVG）。
- 不做实时检测 bbox 叠加、事件「已推送/C3 已恢复」等后端不存在的字段（用真实字段近似呈现）。
- 不改 README（有并行未提交改动）。

## 任务拆分

T1 主题+外壳 → T2 共享组件 → T3 监控 → T4 概览 → T5 事件 → T6 回看 → T7 录像 → T8 设置 →
T9 日志 → T10 mock 微调 → T11 验证（tsc+build+mock 浏览器截图+真实后端截图+视觉验收）→
T12 提交（feat(webui) + chore(webdist)）。

## 验收标准

- `npx tsc --noEmit`、`npm run build` 通过。
- mock 模式浏览器逐页截图：布局与设计稿一致、无错位溢出；桌面 1920 与窄屏 390 两档。
- 真实后端（camhub.exe）冒烟：监控流、事件、回放、设置保存、日志 SSE 全通。
- 动效：换页入场 easeOutExpo 320ms 错峰；系统开启「减少动态效果」时直切。
- Git 提交只含本任务文件。

## 风险

- 并行会话同时改 webui：提交前再查 git status，只提交本任务文件；Edit 冲突时重读文件再改。
- go build 可能因并行会话的半成品 Go 代码失败：此时只提交 webdist 产物，二进制重建留给用户/对方会话。
