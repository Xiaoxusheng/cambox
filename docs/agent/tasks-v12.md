# Tasks — v1.2（任意 URL 流 + 画质可配 + 监控优先外壳）

负责人：Backend Agent / Frontend Agent / Orchestrator
Contract：`docs/contracts/api-v1.2.md`（唯一依据）
基线：main @ `553e5d4`（v1.1 已交付）

## TODO

### Backend（分支 `backend-v12`，worktree `D:\mv_se\.wt\backend`；已精炼合并至 main `79555be`）

- [x] [Backend] config：`camera.url` / `camera.preview_quality` / `camera.preview_fps` / `record.encode_crf` 四个字段（yaml+json 双 tag、默认值、Sanitize 钳制、`type` 枚举加 `url`）→ `3297ad3`
- [x] [Backend] source：新增 `type=url` 解码源（不加 `-re`；http(s) 加 reconnect 系列参数；url 为空时报「未配置流地址」并重试）→ `b4c3eb7`
- [x] [Backend] recorder：copy 模式判定加入 `url`；非 copy 模式改用 `record.encode_crf` → `b2fe3d0`
- [x] [Backend] imgconv + server + pipeline：JPEG 质量参数化（MJPEG 与抓拍都读 `camera.preview_quality`）；MJPEG 帧率上限读 `camera.preview_fps` 且热更新即时生效 → `babd33f` / main `79555be`
- [x] [Backend] 单元测试：新字段钳制、decodeArgs 命令形状（url 类型 / http vs rtmp 的 reconnect 分支 / 空 url）、copy 模式判定、crf 传递、JPEG 质量传递
- [x] [Backend] gofmt/vet/build + `go test -count=1 ./...` + `CGO_ENABLED=1 go test -race ./...` 全绿
- [x] [Backend] 8788 端口 curl 冒烟：config 全量含新字段、回环、钳制生效 → `D:/tmp/camhub-v12-smoke/smoke_v12.py` 三阶段（A 28/28、B 6/6、C 5/5，见集成验收记录）
- [x] [Backend/Orchestrator] 集成时修正：Sanitize 钳制语义与契约对齐（0/负数按越界钳到下限，不回退默认值；单测同步修正；契约 §1 补充说明）

### Frontend（main `208c422`；worktree `frontend-v12` 未启用，改为 main 直接开发）

- [x] [Frontend] 外壳改版：移除 Sider，改顶部细栏（相机名/状态点/fps/分辨率/布防开关/时钟/导航），二级页面收进「更多▾」Dropdown
- [x] [Frontend] 默认路由 `/` → 监控视图；`/playback` 为回看；`/live` 重定向到 `/`
- [x] [Frontend] 监控视图：画面占可用高度主体（16:9 contain，一屏无滚动条）+ 一行状态细条 + 最近事件流（≤8 条，点击弹层看大图）+ ROI 移入弹层（`RoiEditorModal`）+ 抓拍
- [x] [Frontend] 回看视图适配新外壳，功能不减少（日期/24h 轴/事件刻度 seek/分段列表）
- [x] [Frontend] 二级页面（概览/事件/录像/设置/日志）去 Sider 依赖，功能不减少
- [x] [Frontend] 设置页：摄像头 Tab 加「流地址（type=url 时显示）/预览质量/预览帧率」；录像存储 Tab 加「编码 CRF」（含生效时机与适用范围说明）
- [x] [Frontend] types/mock 同步 v1.2 新字段；`VITE_API_MODE=mock` 可独立跑通
- [x] [Frontend] `npx tsc --noEmit` + `npm run build` 通过；三态齐全；移动端无横向溢出
- [x] [Frontend] 浏览器断言 `probe-v12.mjs`：**165/165 全绿**（桌面 1440×900 版面断言 + 移动端 390×844 + 0 console 错误）

### Orchestrator

- [x] [Orchestrator] 分支合并（backend-v12 精炼为 main `79555be`）+ dist 内嵌（`webui/dist` → `internal/server/webdist`）+ 端到端验收 + 文档更新
- [x] [Orchestrator] 真实浏览器 real 模式 UI 端到端 `e2e-real-ui.mjs`：**18/18 全绿**（内嵌产物路由/真实 MJPEG 640×480 解码/布防开关真实生效并 API 回读/设置页改预览质量 90 → 后端真值 90/真实日志 SSE/无 MOCK 徽标/0 console 错误）
- [x] [Orchestrator] 后端冒烟三阶段回归（修复钳制后）：A 合成源画质接线 28/28、B url 空地址 6/6、C url 真实 http 流（ffmpeg `-listen` 无限 FLV 源）5/5
- [x] [Orchestrator] `go test -count=1 ./...` 13 包全绿（`internal/bot` 曾在与其他构建/浏览器任务并行时超时抖动，单独与空闲复跑均通过）

## DONE

- [x] Contract v1.2（`docs/contracts/api-v1.2.md`）

## 遗留 / 诚实声明

1. v1.1 五层验证中的「通知链路长跑 / 优雅关闭 / 生命周期清理」三层未在本轮重跑——v1.2 未触碰
   notify/digest/lifecycle 代码路径，且 13 包单测全绿覆盖其行为；如需可再跑 `camhub-soak.py` / `camhub-shutdown.py` / `camhub-lifecycle.py`。
2. 抖音等平台直播地址自动抓取与刷新：本期明确不做（契约 §0）。
3. 相机实机接入仍未验证（硬件未到货）。
