# Frontend Agent Status — camhub v1.1

> 角色：Frontend Agent ｜ 分支：`frontend-arco`（基线 `ed87551`）｜ 提交：`424c160` ｜ worktree：`D:\mv_se\.wt\frontend`
> 注：原定分支名 `feature/frontend-arco` 因 worktree 的 `.git/refs/heads/feature/` 子目录被沙箱反复清除而无法建立引用，改用扁平名 `frontend-arco`（后端 Agent 亦改扁平名 `backend-v11`）。
> 改动范围：**仅 `webui/`**（未触碰 `internal/**`、`cmd/**` 及任何 Go 代码）
> 契约：`docs/contracts/api-v1.1.md`（唯一依据，实现与之逐字段对齐）

---

## 1. 完成情况（tasks.md Frontend 9 项：全部完成）

| # | 任务 | 状态 | 交付物 |
|---|---|---|---|
| 1 | 脚手架 + API Client + 布局 | ✅ | `vite.config.ts`、`src/api/{types,client,errors,endpoints,mock,media,logStream}.ts`、`src/components/AppLayout.tsx`、`src/styles/global.css` |
| 2 | /dashboard 概览 | ✅ | `src/pages/DashboardPage.tsx`、`src/components/HourlyChart.tsx`（手写 SVG 24h 柱图）、`StorageMeter.tsx` |
| 3 | /live 实时（布防开关 + ROI 绘制） | ✅ | `src/pages/LivePage.tsx`（Pointer Events 拖拽画框 / 删除 / 保存到 `motion.rois`） |
| 4 | /playback 回放（时间轴 + 播放器） | ✅ | `src/pages/PlaybackPage.tsx`（24h 轴：录像段蓝条 + 事件刻度 + 播放头；点击刻度 `currentTime = 事件时间 − 段start`） |
| 5 | /events 事件中心（筛选 + 批量删除） | ✅ | `src/pages/EventsPage.tsx`（类型/日期区间筛选、分页、Arco Image 预览、多选批量删除 + 二次确认） |
| 6 | /recordings 录像管理 | ✅ | `src/pages/RecordingsPage.tsx`（表格 + 下载 + 删除二次确认 + 存储水位条） |
| 7 | /settings 设置（7 个 Tab） | ✅ | `src/pages/SettingsPage.tsx`（摄像头/侦测/录像存储/通知/布防日程/自检与日报/Bot；全量保存；camera 改动提示需重启） |
| 8 | /logs 日志（SSE） | ✅ | `src/pages/LogsPage.tsx`（EventSource、级别着色、暂停/清屏、级别筛选、贴底自动滚动） |
| 9 | `npm run build` 通过 + 三态齐全自查 | ✅ | 见 §3 验证结果 |

额外交付（契约未要求但支撑并行开发）：
- `src/api/mock.ts`：**覆盖契约全部 JSON 端点**，有状态（arm / config / 事件删除 / 录像删除在会话内真实生效），确定性种子数据，`/media/**` 与快照用内联 SVG 顶替（离线可预览、无裂图）。
- 真实浏览器端到端自查脚本（单进程编排 Vite dev server + Chrome CDP + 断言 + 截图），**143/143 断言通过**。

---

## 2. webui 结构

```
webui/
├── index.html                  # lang=zh-CN, color-scheme: dark
├── vite.config.ts              # base:'./'；去掉 crossorigin（go:embed 同源场景）
├── tsconfig.json               # strict + noUnusedLocals/Parameters
├── .env.mock                   # VITE_API_MODE=mock
└── src/
    ├── main.tsx                # Arco ConfigProvider(zhCN) + HashRouter + 全局暗色
    ├── App.tsx                 # 7 条路由 + 通配重定向到 /dashboard
    ├── api/
    │   ├── types.ts            # 与契约字段一一对应（含 Roi / SelfCheckStatus / TimelineData）
    │   ├── client.ts           # 统一解包 {code,message,data}，code!==0 抛 ApiError；mock 分流
    │   ├── errors.ts           # ApiError / errorText / isAbortError（独立模块，避免循环依赖）
    │   ├── endpoints.ts        # 每个契约端点一个函数，页面禁止自拼 URL
    │   ├── mock.ts             # mock 数据层（有状态、确定性、覆盖全端点）
    │   ├── media.ts            # MJPEG / 快照 / 录像 URL 适配（mock 下返回 SVG 或 null）
    │   └── logStream.ts        # SSE 适配（mock 下等价模拟流）
    ├── hooks/
    │   ├── useAsync.ts         # 统一 Loading/Error/取消/轮询（轮询为静默刷新）
    │   ├── useMediaQuery.ts    # useIsMobile（与 CSS 断点 768px 一致）
    │   └── useStreamFrame.ts   # 实时画面帧源
    ├── components/
    │   ├── AppLayout.tsx       # Arco Layout：Sider 菜单 + Header（相机名/布防/时钟/MOCK 徽标）；≤768px 折叠为抽屉
    │   ├── StateViews.tsx      # 全站唯一的三态组件：InitialLoading / EmptyState / ErrorState
    │   ├── Panel.tsx           # Section 语义面板（比 Card 克制）
    │   ├── PageHeader.tsx      # 页头（标题/说明/操作）
    │   ├── HourlyChart.tsx     # 24h 事件趋势 SVG 柱图
    │   └── StorageMeter.tsx    # 存储水位条（75%/90% 阈值着色）
    ├── pages/                  # 7 个页面
    ├── styles/global.css       # 设计令牌 + 布局/时间轴/ROI/日志样式 + 响应式
    └── utils/format.ts         # 字节/时长/时间/事件类型文案（全站唯一实现）
```

设计基线：延续 v1.0 深色监控主题（背景 `#0f1417`、面板 `#171e24`、描边 `#232c34`、主色钢蓝 `#5b9dd9`、正常 `#46b26b`、告警 `#e2b93b`、错误 `#e25c5c`）；Arco 暗色算法全局生效；数字统一 `tabular-nums`；间距 8 的倍数；无渐变、无装饰动画。

---

## 3. 验证结果（全部实测，非推断）

### 3.1 构建
```
$ npx tsc --noEmit      → 通过（0 error）
$ npm run build         → 通过（tsc + vite build）
  dist/index.html                0.45 kB │ gzip   0.31 kB
  dist/assets/index-*.css      580.89 kB │ gzip  66.21 kB
  dist/assets/index-*.js       949.15 kB │ gzip 284.64 kB
  grep -c crossorigin dist/index.html → 0
```

### 3.2 mock 模式端到端自查（真实 Chrome 153 + 原生 CDP，无第三方库）
`VITE_API_MODE=mock` 起 dev server（`http://127.0.0.1:5199`），逐页断言 + 截图：

```
结果：PASS 143 / FAIL 0
```

覆盖内容（摘要）：
- **三态齐全**：7 个页面全部断言「出现过 Loading 态」（骨架屏 / Spin）；`/recordings` 关键词无匹配 → Empty 组件渲染；`/events` 筛选无结果 → Empty + 清除筛选入口；**Error 态**在 Phase B 用 real 模式 + 无后端实测（见下）。
- **契约字段逐项核对**：fps `25.1 fps`、磁盘 `49.0%`、运行时长 `2d 7h`、事件分页 `共 102 条`、时间轴录像段/事件刻度数量、`selfcheck.state`、`schedule_active`。
- **真实交互**（非合成断言）：
  - 布防开关真实点击 → Header 标签 `布防中 → 已撤防`；
  - ROI 用 CDP `Input.dispatchMouseEvent` 真实拖拽 → 生成矩形 → 保存按钮由禁用变可用 → 保存成功 → ROI 列表同步；
  - 事件多选 → 批量删除 → 二次确认文案出现 → 确认 → 删除成功提示；
  - 设置页 7 个 Tab 逐个点开断言内容；改摄像头名称 → 出现「需重启服务生效」+ 保存按钮可用 → 保存成功；
  - 日志流收到 62 行、级别着色（INFO 与 ERROR 的 `getComputedStyle().color` 实测不同）、暂停后 2.2s 行数不再增长、清屏归零。
- **质量门**：无 `undefined`/`NaN`/`[object Object]` 漏出；**无裂图**（`img.complete && naturalWidth===0` 计数为 0，含 20 张事件缩略图）；无横向溢出；全流程 **0 条 console 错误/异常**。
- **移动端（390×844）**：Sider 折叠、抽屉可开（7 个菜单项）、抽屉导航跳转、状态格 2 列、**无横向溢出（390/390）**。

截图：`D:/tmp/webui-verify/shots/`（A1–A11、B1–B2，共 19 张）。

### 3.3 real 模式错误态与产物自包含（Phase B）
用静态服务器托管 `dist`（real 模式），`/api/*` 返回 `{code:404,...}`：
- 触发 **Error 态**：`加载失败 / 后端服务未就绪 / 重新加载` 按钮 ✅
- real 模式不显示 MOCK 徽标 ✅
- `/logs` 无后端时给出可读的连接状态提示 ✅
- `dist/index.html` 全部相对路径、无外部 CDN 引用 ✅

> 说明：后端分支尚未合并到 main，**real 模式只验证了 client 的错误路径与产物加载，未做真实数据联调**。

---

## 4. 契约问题（重要，请 Orchestrator / Backend 确认）

1. **`GET /api/events` 的 `type` 只区分 `motion|selfcheck`，无法按 `detail`(frozen/occlusion) 过滤。**
   因此事件中心的类型筛选只有「全部类型 / 移动侦测 / 画面自检（冻结·异常）」三项；行内用 Tag 如实区分「画面冻结 / 画面异常」。
   **不是契约冲突，是能力边界**——已在 UI 上如实呈现，未做客户端假过滤（避免分页 total 失真）。
   若需要按 detail 精确筛选，需后端扩展查询参数（如 `detail=frozen`）。

2. **`GET /api/recordings` 不返回 `max_gb`**，而 `/recordings` 页需要「存储水位条」。
   现实现额外调用 `GET /api/status` 取 `disk.max_gb`（页面首屏 2 个请求）。
   可选优化：在 recordings 响应里补 `max_gb`，前端即可省一次调用。**不阻塞。**

3. **契约未定义 `GET /api/events` 的排序**，前端**假定按时间倒序**（最新在前）以配合分页。
   若后端返回升序，翻页顺序会与预期不符。**建议后端明确为 time 倒序**（或确认该假设成立）。

4. **契约未定义 `GET /api/recordings` 的排序**，前端按**文件名倒序**展示（最新在前），排序由前端承担，不依赖后端。

5. **`GET /api/snapshot`、`GET /api/stream.mjpeg`、`GET /media/*` 不是 JSON 端点**，无法走 `client.ts` 的 mock 分流。
   mock 模式下由 `src/api/media.ts` 用确定性内联 SVG 顶替（画面/快照/事件缩略图都能离线渲染，无裂图）；**录像 mp4 无法伪造**，mock 下播放器显示明确说明「mock 模式没有真实 mp4 视频源」。真实模式一律走原 URL。

6. **`GET /api/logs/stream` 是 SSE**，同样不走 JSON 分流；`src/api/logStream.ts` 在 mock 下用等价模拟流（先回放 60 条再实时推送），页面代码两种模式完全一致。

7. `POST /api/config` 敏感字段原样返回 —— 已按契约实现，前端不做脱敏、不做任何本地缓存。

8. 前端假定 `GET /api/config` **恒为全量**（契约 §3.2 已声明）。若后端漏字段，页面会渲染空值而非崩溃（已用默认值兜底 `defaultConfig()`）。

---

## 5. 遗留 / 未完成（诚实声明）

| 项 | 说明 |
|---|---|
| **无前端单元测试** | 项目未引入测试框架，未新增（避免为通过"测试"引入与契约无关的依赖）。改用真实浏览器 CDP 端到端自查（143 项断言）作为替代，**这不是单元测试**。 |
| **未做真实数据联调** | 后端未合并到 main，real 模式仅验证错误路径。合并后需跑一次真机联调（`VITE_API_MODE=real` + `npm run dev`，vite proxy 已指向 `127.0.0.1:8787`）。 |
| **未做代码分割** | 单包 949 kB / gzip 285 kB（Arco 全量 + 全量 CSS 580 kB）。对单机内嵌面板可接受，未引入 manualChunks 复杂度。若在意首屏体积，可按路由 `React.lazy` + 按需引 Arco 样式。 |
| **未做 i18n** | 契约要求中文 UI，已全部中文硬编码，未抽 i18n 层。 |
| **`/live` ROI 未做框内拖动/缩放** | 当前支持「拖拽新建 + 单框删除 + 清空 + 撤销改动」。拖动已有框、缩放、多选框合并未实现（契约只要求"拖拽画矩形 + 删除已画框"，均已满足）。 |
| **未实现键盘绘制 ROI** | 键盘可聚焦并 Enter/空格跳转时间轴事件刻度；但 ROI 画框依赖指针设备（触屏可用）。 |
| **`/playback` 未做片段间自动续播** | 点击刻度会切到所在段并 seek；播放到段尾不会自动切下一段。契约未要求。 |

---

## 6. 给 Orchestrator 的合并建议

**建议合并。** 依据：
- 工作范围严格限于 `webui/`，未越界修改任何 Go 代码或 main 分支文件；
- `npx tsc --noEmit` 与 `npm run build` 均通过，`dist` 已按 real 模式构建并保留在 `webui/dist`（未被 `.gitignore` 提交，但文件在磁盘上，供你按契约 §5.3 复制到 `internal/server/webdist/`）；
- mock 模式 143/143 断言通过，7 页三态齐全、交互闭环可用；
- 契约问题（§4）均为**能力边界或未定义项**，无一处需要前端静默偏离契约。

合并后请务必执行（契约 §5.2/5.3）：
1. `cd webui && npm ci && npm run build`（复现构建，确认无 TS 报错）；
2. `dist` → `internal/server/webdist/`，`server.go` embed 从 `web` 改为 `webdist`（index 保留 no-cache）；
3. 端到端验收时，`/playback` 的播放、`/live` 的 MJPEG 与 `/logs` 的 SSE 必须在真实后端下各跑一次——这三处是 mock 覆盖不到的（§4.5、§4.6）。
