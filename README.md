# camhub · 摄像头监控系统

单机监控服务：取流 → 实时预览 + 移动侦测 → 事件记录 → 循环录像 → Web 面板。
Go + FFmpeg 实现，单二进制部署（面板已内嵌），需求与设计见 [docs/开发文档.md](docs/开发文档.md)。

## 快速开始

1. 确认本机已安装 [FFmpeg](https://ffmpeg.org)（已确认）和 Go（仅首次编译需要）。
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
     rtsp: rtsp://相机IP:554/...   # 填实测地址
   ```
3. 重启 `camhub.exe`。
4. 面板确认"连接: 在线"，录像模式自动变为**流复制**（`-c copy`，无转码零 CPU 编码）。

**常见 RTSP 地址格式**（白牌机，以卖家文档为准）：

- `rtsp://IP:554/stream0`（主码流）/ `stream1`（子码流）
- `rtsp://IP:554/h264/ch1/main/av_stream`
- `rtsp://IP:554/user=admin&password=&channel=1&stream=0.sdp?`
- 都不行：用 [ONVIF Device Manager](https://sourceforge.net/projects/onvifdm/) 获取 GetStreamUri。

**建议**：高分辨率相机把解码/检测交给子码流，主码流仅用于流复制录像（当前版本解码与录像用同一地址，8MP 相机建议直接填子码流地址，或等升级多码流配置）。

## 配置说明

| 键 | 默认 | 说明 |
|---|---|---|
| camera.type | synthetic | `synthetic` / `rtsp` / `file` / `dshow` |
| camera.rtsp / file / dshow_device | - | 对应来源的地址 |
| record.enabled / segment_seconds | true / 600 | 自动录像与分段时长 |
| record.retention_days / max_disk_gb | 7 / 20 | 循环清理：按天数 + 按容量（快照同受天数管） |
| motion.enabled / threshold / min_area / cooldown_sec | true / 22 / 500 / 8 | 侦测三参数 + 冷却 |
| server.host / port | 127.0.0.1 / 8787 | 局域网访问把 host 改 `0.0.0.0` |

面板"设置"页可热更新 motion/record 并持久化；`camera.*` 修改需重启。

## 安全须知

- 默认只监听 `127.0.0.1`；改 `0.0.0.0` 后**切勿把端口映射到公网**，远程访问用 Tailscale/WireGuard 组网。
- 相机默认密码务必修改；建议相机放独立网段。

## 已知行为

- 进程被**强杀**时正在写入的最后一个分段可能损坏（缺 moov），正常轮转关闭的分段完好。
- 浏览器不能直接播放 H.265——面板预览用 MJPEG 不受影响；录像始终为 H.264（编码模式）或相机原编码（copy 模式）。
- 帧差法在光照突变（开关灯）时可能误报，调大 `threshold` / `min_area` / `cooldown_sec` 可缓解。

## 升级路径（见开发文档 §2.3）

- **AI 人形检测**：实现 `detector.Detector` 接口替换帧差实现
- **通知推送**：pipeline 事件出口加 notifier 模块
- **网页回放**：录像已是标准 mp4 分段，接 video 标签/hls.js 即可
- **多摄像头**：pipeline 多实例 + 配置改列表
- **鉴权**：公网部署前必须加 middleware

## 开发

```bash
go build ./...          # 编译
go test ./... -count=1  # 单元测试
go vet ./...
```

> `go test -race` 在 Windows 需要 cgo（MinGW gcc）；本机暂无 gcc，装好后可补跑。
