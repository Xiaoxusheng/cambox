# AGENT 共享状态

## ✅ v1.2 已交付（2026-09-28，Orchestrator 集成验收完成）

**范围**：任意 URL 流来源（HTTP-FLV/HLS/RTMP）+ 画质三项可配（预览质量/预览帧率/编码 CRF）+ 监控优先外壳改版。
**契约**：`docs/contracts/api-v1.2.md`（唯一依据，增量于 v1.1）。
**任务板**：`docs/agent/tasks-v12.md`（全部勾选，含证据）。

### 合并结果（main）

| 提交 | 内容 |
|---|---|
| `79555be` | 后端 v1.2：type=url 解码源 / copy 模式 / 画质三项参数化与热更新（backend-v12 四提交精炼合并） |
| `d549be9` | docs(contract): v1.2 契约与任务板 |
| `208c422` | feat(web): 监控优先外壳——顶部细栏 + 监控默认路由（LivePage→MonitorPage，ROI 收进弹层） |
| 本轮修复 | Sanitize 钳制语义与契约对齐（0/负数钳到下限不回默认值）+ 契约 §1 补充说明 |

### 验收证据（全部实测）

- `gofmt -l` 无输出；`go vet ./...` 通过；**`go test -count=1 ./...` 13 包全绿**
- **后端冒烟三阶段**（`D:/tmp/camhub-v12-smoke/smoke_v12.py`，隔离实例 8788）：
  - 阶段 A 合成源 **28/28**：新字段默认值/回环/纯钳制（0→1、-1→0、101→100）、抓拍质量真实生效
    （q95=41774B vs q5=7565B）、MJPEG fps=30 实测 33ms 帧间隔（热更新 fps=5 → 201ms）、yaml 落盘、encode 模式 + crf 真实录像
  - 阶段 B url 空地址 **6/6**：不起 ffmpeg、last_error=「未配置流地址(camera.url 为空)」、按重连间隔重试
  - 阶段 C url 真实流 **5/5**：ffmpeg `-listen 1` 无限 FLV 源 → connected=true、24.3fps、640×480 解码、抓拍 JPEG、reconnect 参数全部被接受
- **前端 mock 断言 `probe-v12.mjs`：165/165 全绿**（真实 Chrome 153 + CDP，桌面 1440×900 与移动端 390×844；
  监控视区高度精确=100vh−104px、画面高占 84%、整页无滚动条；0 console 错误）
- **真实模式 UI 端到端 `e2e-real-ui.mjs`：18/18 全绿**（内嵌新版产物 + 真后端：真实 MJPEG 解码 640×480、
  布防开关真实生效并 API 回读、设置页改预览质量 90 → `GET /api/config` 真值 90、真实日志 SSE、无 MOCK 徽标、0 console 错误）

### 集成时发现并修复的真实缺陷

1. **Sanitize 钳制违反契约 §1**：`preview_quality=0` 被回退成默认 80（应钳到 1）、`encode_crf=-1` 回退 26（应钳到 0）。
   根因是把「0 当未填」的升级兜底写进了 Sanitize；而文件升级路径本就由 `Load` 的 `Default()` 叠加兜底。
   修复：Sanitize 纯钳制 + 单测修正（`TestV12Clamps`）+ 契约补充「纯钳制」说明。冒烟脚本与实现的不一致（上一会话遗留）由此收敛。
2. **前端**：监控页事件行标题与时间挤同一行（`ch-event-title/sub` 用在 span 上丢了块级）→ CSS 补 `display:block`。
3. 测试基建修正：`smoke_v12.py` 的 last_error 全等断言改为契约短语包含匹配；阶段 C 夹具改为无限 FLV 流
   （静态 mp4 在不加 `-re` 的 url 语义下会被瞬间读完 EOF，属夹具设计错误，非产品缺陷）。

### 遗留（诚实声明）

- v1.1 五层验证中的通知长跑/优雅关闭/生命周期三层本轮未重跑（v1.2 未触碰其代码路径，13 包单测全绿覆盖行为）
- 抖音地址自动抓取与刷新：本期明确不做（契约 §0）
- 相机实机接入未验证（硬件未到货）
- `internal/bot` 单测曾在多任务并行负载下超时抖动一次，单独/空闲复跑均通过

### 环境备注

- 两个 worktree（`.wt/backend`、`.wt/frontend`）本轮未使用（后端已在 main 精炼合并、前端直接在 main 开发），可保留或清理
- 验证产物：截图 `D:/tmp/webui-verify/shots-v12/`（mock）与 `shots-v12-real/`（真实）；
  报告 `D:/tmp/webui-verify/report-v12.txt`、`report-v12-real.txt`、`D:/tmp/camhub-v12-e2e/`

---

## ✅ v1.1 已交付（2026-09-28，Orchestrator 集成验收完成）

**范围**：P0 七件套 + C3 画面自检 + C6 Telegram Bot + C9 日报 + Arco 前端重构。
**契约**：`docs/contracts/api-v1.1.md`（唯一依据）。

### 合并结果（main）

| 顺序 | 提交 | 内容 |
|---|---|---|
| 1 | `acf6661` | 归档两个 Agent 状态报告与任务板勾选 |
| 2 | `c22027f` | merge `feature/backend-v11`（v1.1 后端 10 项） |
| 3 | `97f7ebd` | merge `feature/frontend-arco`（webui Vite+React+TS+Arco） |
| 4 | 见 `git log` | Orchestrator 集成修复：面板资源路由 + ROI 线上形态 + race 修复 + 文档 |

### 验收证据（全部实测）

- `gofmt -l` 无输出；`go vet ./...` 通过；`go build ./...` 通过
- `go test -count=1 ./...` 13 包全绿
- **`CGO_ENABLED=1 go test -race ./...` 全绿**（v1.0 遗留项，本轮补跑并修掉两处测试自身竞争）
- 真实后端（隔离实例 8789）**84 项断言全通过**
- 真实浏览器（Chrome 153 + 原生 CDP，真实后端）**47 项断言全通过**，0 console 错误
- **长跑 10 分钟（20 采样点）**：内存后半程均值 -14.6%（无增长），21 个录像分段，事件 6→121，
  goroutine 泄漏测试通过（3 轮 Start/Stop 回到基线）
- **通知链路端到端**：dingtalk / wecom / bark / webhook 各收到 11 次真实推送，
  钉钉 sign 与 webhook HMAC 均独立复算验证通过；60s 限流下 11 次推送 vs 115 条事件
- **优雅关闭端到端**：`CTRL_BREAK_EVENT` → 退出码 0 + 完整关闭日志 + 端口释放 + ffmpeg 子进程收尾
- **生命周期路径真实触发**（此前只有单测）：清理器按天数删旧文件 / 按容量删最旧录像（122MB → 100MB）；
  C3 自检用无损静态源真实触发 frozen 告警（事件 + 截图 + 推送 + 告警后清零重计）；
  C9 日报真实推送并覆盖全部 4 个启用通道

### Orchestrator 集成时发现并修复的真实缺陷

1. **面板资源 404（会导致白屏）**：v1.0 只注册了 `GET /{$}`，换成 Vite 产物后 `/assets/*`
   不被任何路由覆盖。改为 `GET /` 兜底（命中文件即服务，否则回 index.html），
   并新增回归测试 `internal/server/webdist_test.go`。**mock/dev-server 下测不出来。**
2. **ROI 线上形态前后端分叉**：契约 §1 写 `[[x,y,w,h],...]`，前端按数组实现，
   后端却用 `{x,y,w,h}` 对象 → 前端保存 ROI 到真实后端直接 400。
   以契约为准改后端（`ROI` 自定义 YAML/JSON 编解码），并在契约里写明形态；
   新增回归测试 `TestROIWireFormatIsFourElementArray` / `TestROIRoundTripYAML`。
3. **Bot `/status` 的"今日事件"用 UTC 边界**：`time.Now().Truncate(24h)` 在东八区会从
   本地 08:00 起算。改用本地零点（与 `api_v11.go` / `digest.go` 一致）。
4. **`go test -race` 暴露两处测试自身的竞争**（非产品代码）：
   SSE 测试用 `httptest.ResponseRecorder` 边写边读；bot 测试的假 Telegram 服务
   未加锁读字段。分别用 `syncRecorder`（新增 `internal/server/recorder_test.go`）
   与加锁访问器修掉。**不修的话 race 检测器会被噪声淹没，等于没跑。**

### 契约澄清（未偏离，已记入契约）

- `GET/POST /api/config` 的 data **不含 `server` 段**（契约 §3.2 显式结构），
  `camera/server` 只能改配置文件后重启。契约 §2.7 的措辞已按此对齐。
- ROI 固定为四元数组，不接受对象形态（契约 §1 已写明）。

### 遗留（诚实声明）

- 相机实机接入未验证（硬件未到货）；多码流 `sub_rtsp` 仅有单测与 ffmpeg 命令形状断言
- telegram 通道未对真实 `api.telegram.org` 投递（需真实 bot token；包内单测已覆盖请求构造与多部分上传）
- 前端无单元测试（以真实浏览器 CDP 端到端断言替代）
- 正在写入的当前分段会出现在「录像」页，选中回放时明确提示"无法播放"（缺 moov，属预期）

### 环境备注

- **D 盘 NTFS 无法创建嵌套分支 ref**（`refs/heads/feature/...` 静默失败）。
  本轮并行开发已改用扁平分支名 `backend-v11` / `frontend-arco`，合并以 SHA 为准。
  下次并行开发请直接使用扁平名，或把仓库迁到 C 盘。详见 `docs/agent/blocked.md`。
- 两个 worktree（`.wt/backend`、`.wt/frontend`）已合并完毕，可保留备用或清理。

---

## 项目

camhub v1.1 已交付并集成到 main。前端在 `webui/`，产物内嵌于 `internal/server/webdist/`。

## v1.0 代码导览

- `cmd/server/main.go`：装配与优雅关闭
- `internal/config`：YAML 配置（所有字段 yaml+json 双 tag；ROI 走自定义四元数组编解码）
- `internal/source`：FFmpeg 子进程解码 → BGR24 裸帧，单写多读帧槽，断线重连，支持 `sub_rtsp`
- `internal/detector`：帧差移动侦测（支持 ROI 掩码与热更）
- `internal/recorder`：ffmpeg 分段录像（copy/encode 双模式）+ 保留清理
- `internal/notify`：五通道通知 + 同通道限流
- `internal/selfcheck`：画面冻结/遮挡自检
- `internal/digest`：每日日报
- `internal/bot`：Telegram long polling 双向控制
- `internal/logbuf`：slog 环形缓冲（供日志 SSE）
- `internal/pipeline`：装配 8 个 goroutine + 布防/日程门控 + 热更新
- `internal/store`：事件 JSONL（append-per-event，月分文件）
- `internal/server`：路由 + MJPEG + SSE + 内嵌 webdist
