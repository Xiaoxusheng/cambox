# camhub API & 配置 Contract v1.2

> 本文件是 Backend 与 Frontend 并行开发的**唯一契约**。实现与本文冲突时：先改本文，再改代码。
> v1.1 契约见 `docs/contracts/api-v1.1.md`；v1.2 在 v1.1 基础上**只做增量**，不删除、不改名任何既有字段。
> 变更流程：修改者写明变更点 → 更新本文 → 通知对方（写入 `docs/agent/*-status.md`）。

---

## 0. v1.2 范围

用户提出的三个问题，对应三项改动：

| # | 需求 | 归属 |
|---|---|---|
| 1 | 支持任意网络流（HTTP-FLV / HLS / RTMP），可接抖音直播 | Backend（新增来源类型） |
| 2 | 清晰度可设置（预览质量 / 预览帧率 / 编码录像 CRF） | Backend（新增配置项） |
| 3 | 页面「后台管理系统感」重——改为**监控优先**外壳 | Frontend（外壳改版） |

**明确不做**（本期）：抖音直播间地址自动抓取与定时刷新（需逆向平台接口、有风控与失效风险，单独评估）。

---

## 1. 配置 Schema v1.2（增量）

v1.1 字段全部保留。**所有字段必须有 yaml+json 双 tag**。

```yaml
camera:
  name: 模拟摄像头
  type: synthetic            # synthetic | rtsp | file | dshow | 【新增】url
  rtsp: ""
  sub_rtsp: ""
  file: ""
  dshow_device: ""
  url: ""                    # 【新增】type=url 时的网络流地址(HTTP-FLV / HLS / RTMP)
  width: 1280
  height: 720
  fps: 25
  reconnect_delay_sec: 3
  preview_quality: 80        # 【新增】MJPEG/抓拍 JPEG 质量, 1~100
  preview_fps: 15            # 【新增】MJPEG 推送帧率上限, 1~30
record:
  enabled: true
  dir: recordings
  segment_seconds: 600
  retention_days: 7
  max_disk_gb: 20
  encode_crf: 26             # 【新增】非 copy 模式录像的 libx264 CRF, 0~51
```

**默认值**：`preview_quality=80`、`preview_fps=15`、`encode_crf=26`（与 v1.1 的硬编码值一致，
升级后行为不变）。`url=""`。

**钳制规则**（Sanitize 扩展）：
- `camera.type` 合法值增加 `url`；非法值仍回退 `synthetic`
- `camera.preview_quality` 裁到 1~100
- `camera.preview_fps` 裁到 1~30
- `record.encode_crf` 裁到 0~51
- `camera.url` 自由文本，不校验（留空时由 source 报错，见 §2.1）

---

## 2. 运行时语义

### 2.1 新增来源类型 `url`（任意网络流）

解码源 URL = `camera.url`。ffmpeg 参数：

- 通用：`-fflags nobuffer -flags low_delay -rw_timeout 8000000`
- **地址以 `http://` / `https://` 开头时额外加**：`-reconnect 1 -reconnect_streamed 1 -reconnect_delay_max 10`
- **不加 `-re`**（直播流加 `-re` 会引入额外延迟且无意义）
- 输出仍是统一链路：`-vf scale=W:H -pix_fmt bgr24 -f rawvideo pipe:1`

`camera.url` 为空时：不构造 ffmpeg 进程，`last_error` 置为「未配置流地址」，
按 `reconnect_delay_sec` 重试（与其它来源的失败路径一致）。

**录像走 copy 模式**：`camera.type` 为 `rtsp` **或** `url` 时使用 `-c copy`（零转码）。
非 copy 模式（synthetic / file / dshow）改用 `record.encode_crf`。

> 抖音直播的拉流地址是**动态下发且带签名**的，几小时后过期。本期只做「填地址就能取流」，
> 地址过期需自行更新；长期自动录制需要额外的地址刷新器（见 §0 明确不做）。

### 2.2 清晰度参数生效时机

| 字段 | 作用 | 生效时机 |
|---|---|---|
| `camera.width` / `height` | 解码目标尺寸（预览与录像共用） | 需重启（改 camera.* 需重启，与 v1.1 一致） |
| `camera.preview_quality` | MJPEG 与抓拍的 JPEG 质量 | **热更新即时生效**（MJPEG 循环与抓拍每次读取） |
| `camera.preview_fps` | MJPEG 推送帧率上限 | **热更新即时生效**（已有连接的流在下一拍即采用新值） |
| `record.encode_crf` | 非 copy 模式录像画质 | 热更新，**下一次录像进程启动时生效** |

**注意**：预览走 MJPEG（有损 JPEG + 帧率上限），观感永远低于录像；录像在 rtsp/url 源下是
原始码流（copy 模式），画质由源决定。面板文案要如实说明这一点，避免用户误以为"录像也糊"。

### 2.3 其余运行时语义

v1.1 §2 的其余部分（armed/日程门控、ROI、自检、日报、Bot、热更新、日志）**全部不变**。

---

## 3. API 变更

统一响应 `{"code":0,"message":"success","data":{...}}` 不变。**v1.1 全部端点与字段不变**。

### 3.1 `GET /api/config` / `POST /api/config` 的 data 增量

`camera` 段新增 3 个字段，`record` 段新增 1 个字段（其余原样）：

```json
{ "camera": { "name":"...", "type":"...", "rtsp":"", "sub_rtsp":"", "file":"", "dshow_device":"",
              "url": "", "width":1280, "height":720, "fps":25, "reconnect_delay_sec":3,
              "preview_quality": 80, "preview_fps": 15 },
  "record": { "enabled":true, "dir":"recordings", "segment_seconds":600,
              "retention_days":7, "max_disk_gb":20, "encode_crf": 26 },
  "...其余段不变..." }
```

`type` 的取值集合变为 `synthetic | rtsp | file | dshow | url`。

### 3.2 其余接口

`GET /api/status`、`/api/events`、`/api/timeline`、`/api/recordings`、`/api/arm`、
`/api/notify/test`、`/api/logs/stream`、媒体端点 **全部不变**。

---

## 4. 前端页面契约（v1.2 外壳改版：监控优先）

**问题**：当前是 `Layout + Sider 菜单 + 7 个平级页面 + 设置页 7 个 Tab` 的后台管理骨架，
而监控产品的心智模型是「看画面」。v1.2 把信息层级反过来：**画面是主体，设置是配角**。

### 4.1 导航结构

| 层级 | 内容 | 进入方式 |
|---|---|---|
| 一级 | **监控**（`/`，默认路由） | 顶部栏常驻 |
| 一级 | **回看**（`/playback`） | 顶部栏常驻 |
| 二级 | 概览、事件中心、录像管理、设置、日志 | 顶部栏「更多 ▾」抽屉 |

- **移除 Sider 侧边菜单**。
- 顶部栏（单行，高度 ≤56px）：相机名 · 连接状态点（在线/离线）· fps · 分辨率 ·
  **布防开关** · 本地时钟 · 右侧导航（监控 / 回看 / 更多▾）。
- 「更多▾」用 Arco `Drawer` 或 `Dropdown`，列出二级页面；当前所在二级页在顶部栏显示页名。
- 移动端（≤768px）：顶部栏保留（隐藏 fps/分辨率等次要信息），导航全部收进抽屉。

### 4.2 监控视图（`/`，改造自原 `/live`）

**画面必须是视觉主体**：

- 画面区域占据可用高度的主体（`flex: 1`，按 16:9 内缩放，`object-fit: contain`，
  不允许出现滚动条才能看到画面）。
- 画面下方一行**状态细条**（不是卡片）：在线状态 · fps · 分辨率 · 录像中/待机 ·
  磁盘水位（细条）· 自检状态 · 事件数。
- 右侧（桌面）或下方（移动）**最近事件流**：最近 5~8 条，缩略图 + 时间 + 类型标签，
  点击在新标签/弹层看大图。
- 操作按钮：抓拍、**检测区域（ROI）**、布防开关（顶部栏已有则可只保留一处，不要重复）。
- **ROI 编辑器移入弹层**（`Modal`/`Drawer`），默认不占监控页版面。
- 移除原 `/live` 页的「状态卡」卡片网格（信息并入状态细条）。

### 4.3 回看视图（`/playback`）

保持 v1.1 的时间轴 + 播放器能力不变，仅适配新外壳（无 Sider）。**功能不得减少**：
日期选择、24h 时间轴（录像段 + 事件刻度）、点击刻度 seek、录像段列表。

### 4.4 二级页面

概览 / 事件中心 / 录像管理 / 设置 / 日志 **功能与 v1.1 一致**，仅去掉 Sider 依赖。
设置页 Tab 保持 7 个，但：
- 「摄像头」Tab 新增：**流地址**（仅 `type=url` 时显示，必填提示）、
  **预览质量**（1~100）、**预览帧率**（1~30）
- 「录像存储」Tab 新增：**编码 CRF**（0~51，附说明"仅对 synthetic/file/dshow 源生效；
  rtsp/url 源为原始码流复制，此值无效"）

### 4.5 通用要求（不放松）

- 中文 UI、Arco 暗色、`base: './'`、HashRouter、无外部 CDN。
- 所有列表页 **Loading / Empty / Error 三态齐全**。
- 数值不得渲染出 `undefined` / `NaN` / `[object Object]`。
- 移动端 390×844 **无横向溢出**。
- `VITE_API_MODE=mock` 仍可独立跑通（mock 数据需同步补上 v1.2 新字段）。

---

## 5. 集成步骤（Orchestrator 执行）

1. 合并 `backend-v12` → main；全量测试（含 `-race`）。
2. 合并 `frontend-v12` → main；`cd webui && npm ci && npm run build`。
3. `webui/dist` → `internal/server/webdist/`，重建二进制。
4. 端到端验收：契约逐项 + 真实浏览器（含"监控视图画面是不是真的占主体"这类**版面断言**）。
5. 回归：v1.1 的四层验证脚本（后端契约 / 浏览器 CDP / 通知+长跑 / 优雅关闭 / 生命周期）
   必须仍全绿，且断言脚本需按新配置字段同步更新。
