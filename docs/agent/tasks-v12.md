# Tasks — v1.2（任意 URL 流 + 画质可配 + 监控优先外壳）

负责人：Backend Agent / Frontend Agent / Orchestrator
Contract：`docs/contracts/api-v1.2.md`（唯一依据）
基线：main @ `553e5d4`（v1.1 已交付）

## TODO

### Backend（分支 `backend-v12`，worktree `D:\mv_se\.wt\backend`）

- [ ] [Backend] config：`camera.url` / `camera.preview_quality` / `camera.preview_fps` / `record.encode_crf` 四个字段（yaml+json 双 tag、默认值、Sanitize 钳制、`type` 枚举加 `url`）
- [ ] [Backend] source：新增 `type=url` 解码源（不加 `-re`；http(s) 加 reconnect 系列参数；url 为空时报「未配置流地址」并重试）
- [ ] [Backend] recorder：copy 模式判定加入 `url`；非 copy 模式改用 `record.encode_crf`
- [ ] [Backend] imgconv + server + pipeline：JPEG 质量参数化（MJPEG 与抓拍都读 `camera.preview_quality`）；MJPEG 帧率上限读 `camera.preview_fps` 且热更新即时生效
- [ ] [Backend] 单元测试：新字段钳制、decodeArgs 命令形状（url 类型 / http vs rtmp 的 reconnect 分支 / 空 url）、copy 模式判定、crf 传递、JPEG 质量传递
- [ ] [Backend] gofmt/vet/build + `go test -count=1 ./...` + `CGO_ENABLED=1 go test -race ./...` 全绿
- [ ] [Backend] 8788 端口 curl 冒烟：config 全量含新字段、回环、钳制生效

### Frontend（分支 `frontend-v12`，worktree `D:\mv_se\.wt\frontend`）

- [ ] [Frontend] 外壳改版：移除 Sider，改顶部细栏（相机名/状态点/fps/分辨率/布防开关/时钟/导航），二级页面收进「更多▾」抽屉
- [ ] [Frontend] 默认路由 `/` → 监控视图；`/playback` 为回看
- [ ] [Frontend] 监控视图改造：画面占可用高度主体（16:9 contain，无需滚动即可看全画面）+ 一行状态细条 + 最近事件流 + ROI 移入弹层
- [ ] [Frontend] 回看视图适配新外壳，功能不得减少（时间轴/事件刻度 seek/分段列表）
- [ ] [Frontend] 二级页面（概览/事件/录像/设置/日志）去 Sider 依赖，功能不减少
- [ ] [Frontend] 设置页：摄像头 Tab 加「流地址（type=url 时显示）/预览质量/预览帧率」；录像存储 Tab 加「编码 CRF」
- [ ] [Frontend] types/mock 同步 v1.2 新字段；`VITE_API_MODE=mock` 可独立跑通
- [ ] [Frontend] `npx tsc --noEmit` + `npm run build` 通过；三态齐全；移动端无横向溢出

### Orchestrator

- [ ] [Orchestrator] 分支合并 + dist 内嵌 + 端到端验收（含版面断言）+ v1.1 五层验证脚本回归 + 文档更新

## DONE

- [x] Contract v1.2（`docs/contracts/api-v1.2.md`）
