# camhub · 摄像头监控系统

单机监控服务：取流 → 实时预览 + 移动侦测 → 事件记录 → 循环录像 → Web 面板。
Go + FFmpeg 实现，单二进制部署（前端已内嵌），需求与设计见 [docs/开发文档.md](docs/开发文档.md)，
v1.1 的接口契约见 [docs/contracts/api-v1.1.md](docs/contracts/api-v1.1.md)。

## 功能一览（v1.1）

| 能力 | 说明 |
|---|---|
| 实时预览 | MJPEG 推流，断线自动重连，面板显示 fps / 分辨率 / 重连次数 |
| 移动侦测 | 帧差法（阈值 + 最小面积 + 冷却），支持 **ROI 检测区域**（归一化矩形，最多 8 个） |
| 布防 / 撤防 | 运行时开关（重启默认布防）；撤防只停"事件入库 + 推送"，录像由日程单独控制 |
| 布防日程 | 按星期 + 时段规则，分别控制侦测与录像；支持跨零点 |
| 循环录像 | 分段 mp4（rtsp 源走 `-c copy` 零转码，其他源走 libx264），按天数 + 容量自动清理 |
| 多码流 | `camera.sub_rtsp` 子码流做解码/检测/预览，主码流仅用于流复制录像 |
| 画面自检 (C3) | 周期比对帧，识别**画面冻结 / 被遮挡**，入库 + 推送 + 截图，状态暴露在 `/api/status` |
| 事件通知 | 钉钉 / 企业微信 / Telegram / Bark / Webhook 五通道，同通道限流 |
| 每日日报 (C9) | 每天定时推送过去 24h 事件统计（小时分布、总数、最高分事件） |
| Telegram Bot (C6) | `/status` `/arm` `/disarm` `/snap` `/events [n]` `/help`，仅白名单用户可用 |
| Web 面板 | Vite + React + TS + Arco 暗色：概览 / 实时 / 回放 / 事件 / 录像 / 设置 / 日志 |
| 日志 | 内存环形缓冲 500 条 + `GET /api/logs/stream` SSE 实时推送，面板可暂停/清屏 |

## 快速开始

1. 确认本机已安装 [FFmpeg](https://ffmpeg.org) 和 Go（Go 仅首次编译需要）。
2. 双击 `start.bat`（或命令行 `camhub.exe`）。
3. 浏览器打开 **http://127.0.0.1:8787**

首次运行自动生成 `configs/config.yaml`，默认使用内置测试画面（synthetic），无需摄像头即可体验全部功能。

## 接入真实摄像头（相机到货后）

1. 先用 VLC 测试相机取流地址：媒体 → 打开网络串流（常见格式见下）。
2. 编辑 `configs/config.yaml`：
   ```yaml
   camera:
     name: 前门摄像头
     type: rtsp                    # synthetic 改为 rtsp
     rtsp: rtsp://相机IP:554/...   # 主码流：用于流复制录像
     sub_rtsp: rtsp://相机IP:554/... # 子码流：用于解码/检测/预览（高分辨率相机强烈建议填）
   ```
3. 重启 `camhub.exe`。
4. 面板确认"连接: 在线"，录像模式自动变为**流复制**（`-c copy`，无转码零 CPU 编码）。

**常见 RTSP 地址格式**（白牌机，以卖家文档为准）：

- `rtsp://IP:554/stream0`（主码流）/ `stream1`（子码流）
- `rtsp://IP:554/h264/ch1/main/av_stream`
- `rtsp://IP:554/user=admin&password=&channel=1&stream=0.sdp?`
- 都不行：用 [ONVIF Device Manager](https://sourceforge.net/projects/onvifdm/) 获取 GetStreamUri。

**建议**：8MP 等高分辨率相机把 `sub_rtsp` 填子码流地址（解码 ffmpeg 会统一 `-vf scale` 到
`camera.width × camera.height`，所以子码流分辨率与主码流不一致也没关系）。

## 配置说明

完整 schema 与钳制规则见 [契约 §1](docs/contracts/api-v1.1.md)。常用键：

| 键 | 默认 | 说明 |
|---|---|---|
| camera.type | synthetic | `synthetic` / `rtsp` / `file` / `dshow` |
| camera.rtsp / sub_rtsp / file / dshow_device | - | 主码流 / 子码流 / 文件 / DirectShow 设备 |
| motion.enabled / threshold / min_area / cooldown_sec | true / 22 / 500 / 8 | 侦测三参数 + 冷却 |
| motion.rois | `[]` | 检测区域 `[[x,y,w,h],...]`（归一化 0~1，最多 8 个），空 = 全屏 |
| record.enabled / segment_seconds | true / 600 | 自动录像与分段时长 |
| record.retention_days / max_disk_gb | 7 / 20 | 循环清理：按天数 + 按容量（快照同受天数管） |
| notify.* | 全禁用 | 五通道通知，`notify.cooldown_sec` 为同通道限流 |
| schedules.rules | `[]` | 布防日程；空 = 全天按 motion/record 的 enabled |
| selfcheck.enabled / interval_sec | true / 300 | 画面自检开关与周期 |
| digest.enabled / time | true / 22:00 | 每日日报推送时刻 |
| bot.enabled / allowed_users | false / `[]` | Telegram Bot 与用户白名单（空 = 拒绝所有） |
| server.host / port | 127.0.0.1 / 8787 | 局域网访问把 host 改 `0.0.0.0` |

面板「设置」页可热更新 motion / record / notify / schedules / selfcheck / digest / bot 并持久化；
`camera.*` 与 `server.*` 修改需重启（面板会提示）。`bot.bot_token` 变化需重启才会重建轮询。

## 安全须知

- 默认只监听 `127.0.0.1`；改 `0.0.0.0` 后**切勿把端口映射到公网**，远程访问用 Tailscale/WireGuard 组网。
- 本版本**无鉴权**（单机单用户假设）；公网部署前必须加认证中间件。
- 相机默认密码务必修改；建议相机放独立网段。

## 已知行为

- 进程被**强杀**时正在写入的最后一个分段可能损坏（缺 moov），正常轮转关闭的分段完好。
  面板「回放」选中该分段会明确提示"无法播放 xxx.mp4"；「录像」页仍会列出它。
- 浏览器不能直接播放 H.265——面板预览用 MJPEG 不受影响；录像始终为 H.264（编码模式）或相机原编码（copy 模式）。
- 帧差法在光照突变（开关灯）时可能误报，调大 `threshold` / `min_area` / `cooldown_sec` 可缓解。
- 事件列表按时间倒序返回，分页基于该顺序。

## 开发

```bash
go build ./...                       # 编译
go test ./... -count=1               # 单元测试
go vet ./...
gofmt -l .

# 竞态检测（Windows 需要 cgo + gcc）
export PATH="/path/to/mingw64/bin:$PATH"   # 例如 D:/GoTunnel/.tmp/mingw64/bin
CGO_ENABLED=1 go test -race ./...
```

### 前端（webui/）

```bash
cd webui
npm ci
npm run build          # 产物落到 webui/dist
```

**改了前端必须重新内嵌**：把 `webui/dist/*` 复制到 `internal/server/webdist/`，再 `go build`。
`internal/server/server.go` 用 `//go:embed webdist` 把产物打进二进制；只 `npm run build`
而不复制，浏览器里渲染的仍是上一版面板。

前端支持 `VITE_API_MODE=mock`（见 `webui/.env.mock`）在**没有后端**的情况下独立开发与自查，
mock 数据严格按契约构造、覆盖全部 JSON 端点。

## 升级路径（见开发文档 §2.3）

- **AI 人形检测**：实现 `detector.Detector` 接口替换帧差实现
- **事件查询**：按 `detail`（frozen/occlusion）精确筛选、事件存储迁 SQLite
- **多摄像头**：pipeline 多实例 + 配置改列表
- **鉴权**：公网部署前必须加 middleware
- **前端体积**：当前单包 949 kB（gzip 285 kB，Arco 全量）；如需瘦身可按路由 `React.lazy` + Arco 按需引入
