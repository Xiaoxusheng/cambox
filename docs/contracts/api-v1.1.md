# camhub API & 配置 Contract v1.1

> 本文件是 Backend 与 Frontend 并行开发的**唯一契约**。实现与本文冲突时：先改本文，再改代码。
> 变更流程：修改者写明变更点 → 更新本文 → 通知对方（写入 docs/agent/*-status.md）。

---

## 1. 配置 Schema v1.1（configs/config.yaml）

v1.0 字段全部保留（见 docs/开发文档.md §4.1），新增/变化如下。**所有字段必须有 yaml+json 双 tag**。

```yaml
camera:
  name: 模拟摄像头
  type: synthetic            # synthetic | rtsp | file | dshow
  rtsp: ""                   # 主码流地址(录像用)
  sub_rtsp: ""               # 【新增】子码流地址(预览+检测解码用); 空=用主码流
  file: ""
  dshow_device: ""
  width: 1280                # 解码目标尺寸(ffmpeg -vf scale 强制缩放到该尺寸)
  height: 720
  fps: 25
  reconnect_delay_sec: 3
motion:
  enabled: true
  threshold: 22
  min_area: 500
  cooldown_sec: 8
  downscale_width: 320
  rois: []                   # 【新增】检测区域, 归一化矩形 [[x,y,w,h],...] 值域0~1; 空=全屏
record:                      # 与 v1.0 完全一致
  enabled: true
  dir: recordings
  segment_seconds: 600
  retention_days: 7
  max_disk_gb: 20
notify:                      # 【新增】事件通知
  cooldown_sec: 60           # 同一通道最小推送间隔(限流)
  dingtalk: { enabled: false, webhook: "", secret: "" }
  wecom:    { enabled: false, webhook: "" }
  telegram: { enabled: false, bot_token: "", chat_id: "" }
  bark:     { enabled: false, server: "https://api.day.app", device_key: "" }
  webhook:  { enabled: false, url: "", secret: "" }
schedules:                   # 【新增】布防日程
  rules:                     # 空=全天按 motion.enabled/record.enabled
    - days: [1,2,3,4,5]      # 1=周一 ... 7=周日
      start: "08:00"         # 当地时间, 闭区间
      end: "22:00"           # start==end 视为全天; end<start 跨零点
      motion: true           # 该时段允许移动侦测事件
      record: true           # 该时段允许录像
selfcheck:                   # 【新增】C3 画面自检
  enabled: true
  interval_sec: 300          # 自检周期(60~3600)
  frozen_checks: 3           # 连续 N 次画面完全静止判定"冻结"
  change_threshold: 25       # 降采样灰度平均差>该值判定"画面突变"
  change_checks: 3           # 连续 N 次突变判定"被遮挡/移动"
digest:                      # 【新增】C9 每日日报
  enabled: true
  time: "22:00"              # 每天该时刻推送(当地时间)
bot:                         # 【新增】C6 Telegram 双向 Bot
  enabled: false
  bot_token: ""              # 可与 notify.telegram.bot_token 相同
  allowed_users: []          # Telegram 数字用户ID白名单, 空=拒绝所有
```

**钳制规则**（Sanitize 扩展）：`sub_rtsp` 自由文本；`rois` 值域裁到 [0,1] 且 w,h>0（最多 8 个）；`notify.cooldown_sec` 10~3600；`schedules.rules` 最多 16 条、start/end 校验 HH:MM；`selfcheck.interval_sec` 60~3600、`frozen_checks`/`change_checks` 1~60、`change_threshold` 1~255；`digest.time` 校验 HH:MM；`bot.allowed_users` 每项为非空数字字符串。

---

## 2. 运行时语义（Backend 实现依据）

1. **多码流**：解码源 URL = `sub_rtsp`（非空且 type=rtsp 时），否则 `rtsp`。解码 ffmpeg 统一加 `-vf scale=W:H` 强制输出 cfg.Width×cfg.Height（解决子码流分辨率不一致）。**录像(copy 模式)始终用主码流 `rtsp`**。
2. **生效标志**（每个处理 tick 计算）：
   - `motion.effective = motion.enabled && armed && scheduleActive.motion`
   - `record.effective = record.enabled && scheduleActive.record`
   - `armed` 为**运行时状态**（不持久化，重启默认 true）；由 POST /api/arm 与 Bot /arm /disarm 切换。撤防只关"事件入库+推送"，录像由 schedule.record 单独控制。
3. **ROI**：变化像素只统计落在 rois 内的部分（降采样掩码）；外接框仍按实际变化像素计算。rois 空=全屏。
4. **自检**：每 interval_sec 取两帧（间隔 2s）：bitwise 完全相同 → frozen 计数；降采样平均灰度差 > change_threshold → change 计数；连续达标 → 事件 `type=selfcheck, detail=frozen|occlusion` 入库+推送+截图，告警后本项清零重新计数；状态暴露在 /api/status。
5. **日报**：每天到点统计过去 24h 事件（按小时分布、总数、最高分事件），无事件发"今日无事发生"。走 notify 全部启用通道。
6. **Bot**（Telegram long polling）：命令 `/status` `/arm` `/disarm` `/snap` `/events [n]` `/help`；仅 allowed_users；/snap 回当前帧照片；每次命令回复纯文本。getUpdates 30s 超时轮询，ctx 取消退出。
7. **热更新**：POST /api/config 后立即生效：motion(含 rois)/record/notify/schedules/selfcheck/digest/bot（bot token 变化需重启 Bot 轮询）。camera/server 需重启（UI 提示）。
8. **日志**：slog 输出同时进内存环形缓冲（500 条），供 SSE 消费。

---

## 3. API 全集

统一响应：`{"code":0,"message":"success","data":{...}}`，错误 `code` = HTTP 状态码。

### 3.1 保留不变的 v1.0 接口
`GET /`（改为新面板）、`GET /api/stream.mjpeg`、`GET /api/snapshot`、`POST /api/snapshots`、`GET /api/events`、`GET /api/recordings`、`GET /media/*`。

### 3.2 变更接口

**GET /api/config** → data（**全量**）：
```json
{ "camera": {...含 sub_rtsp...}, "motion": {...含 rois...}, "record": {...},
  "notify": { "cooldown_sec":60, "dingtalk":{"enabled":false,"webhook":"","secret":""},
              "wecom":{"enabled":false,"webhook":""},
              "telegram":{"enabled":false,"bot_token":"","chat_id":""},
              "bark":{"enabled":false,"server":"","device_key":""},
              "webhook":{"enabled":false,"url":"","secret":""} },
  "schedules": { "rules": [ { "days":[1], "start":"08:00", "end":"22:00", "motion":true, "record":true } ] },
  "selfcheck": { "enabled":true, "interval_sec":300, "frozen_checks":3, "change_threshold":25, "change_checks":3 },
  "digest": { "enabled":true, "time":"22:00" },
  "bot": { "enabled":false, "bot_token":"", "allowed_users":[] } }
```
**POST /api/config**：请求体=上述 data 全量；返回更新后的同结构。敏感字段(各 token/webhook/secret)返回时**原样返回**（本机单用户系统，不做脱敏）。

**GET /api/events**：新增查询参数 `type`（motion|selfcheck，空=全部）、`from`/`to`（RFC3339，可只给一个）。返回结构不变；Event 新增可选字段 `"detail":""`（selfcheck 事件的 frozen|occlusion）。

**GET /api/recordings**：items 增加 `start`/`end`（RFC3339，由文件名解析；解析失败置 null）。

**GET /api/status**：data 新增：
```json
{ "armed": true,
  "schedule_active": { "motion": true, "record": true },
  "selfcheck": { "enabled": true, "last_run": "RFC3339或null", "state": "ok", "last_alert": "", "consecutive_frozen": 0, "consecutive_change": 0 } }
```
`selfcheck.state`: `ok | frozen | occlusion`。

### 3.3 新增接口

| 方法 | 路径 | 请求 | 响应 data |
|---|---|---|---|
| POST | /api/arm | `{"armed":false}` | `{"armed":false}` |
| GET | /api/timeline?date=YYYY-MM-DD（默认今天） | - | 见下 |
| POST | /api/events/batch-delete | `{"ids":[1,2]}` | `{"deleted":2}`（同时删除关联快照文件，忽略不存在） |
| DELETE | /api/recordings/{name} | - | `{}`；name 必须匹配 `^[A-Za-z0-9_-]+\.(mp4)$`，否则 400 |
| POST | /api/notify/test | `{"channel":""}` 空=全部启用通道 | `{"results":[{"channel":"telegram","ok":false,"error":"..."}]}` |
| GET | /api/logs/stream | - | SSE，每条：`data: {"time":"RFC3339","level":"INFO","msg":"..."}`；连接后先回放缓冲区再实时推送 |

**GET /api/timeline** data：
```json
{ "date": "2026-09-28",
  "segments": [ { "name": "2026-09-28_08-00-00.mp4", "start": "RFC3339", "end": "RFC3339", "size_bytes": 123 } ],
  "events":   [ { "id": 7, "time": "RFC3339", "type": "motion", "score": 900, "image": "...", "detail": "" } ],
  "hourly":   [0,0,...24个整数,当日每小时事件数] }
```
segments 按 start 升序；events 按 time 升序；hourly 长度恒 24。

### 3.4 事件类型枚举
`motion`（移动侦测）、`selfcheck`（detail=frozen|occlusion）。前端按此渲染标签：移动侦测 / 画面冻结 / 画面异常。

---

## 4. 前端页面契约（webui/，Vite + React + TS + @arco-design/web-react）

- **目录**：`webui/`（新目录，不碰 Go 代码）。构建：`npm run build` → `webui/dist`（tsc + vite build 必须通过）。
- **主题**：Arco 暗色算法全局暗色；主色保持默认电蓝或 `#5b9dd9`；中文 UI；`base: './'`。
- **API Client**：`src/api/client.ts` 封装统一响应解包（code!==0 抛错）；`VITE_API_MODE=mock` 时走 `src/api/mock.ts`（数据严格按本契约，覆盖每个端点），默认 `real`。
- **类型**：`src/api/types.ts` 与契约字段一一对应。

| 路由 | 页面 | 关键内容与所用 API |
|---|---|---|
| /dashboard | 概览 | 状态卡(连接/录像/布防开关/磁盘水位/运行时长/自检状态)、今日趋势(SVG 轻量柱图, /api/timeline?date=今天.hourly)、最新 5 事件 |
| /live | 实时 | MJPEG 画面、fps、抓拍、**布防/撤防 Switch(POST /api/arm)**、ROI 编辑器（截图上拖拽画矩形，保存到 config.motion.rois，支持删除已画框） |
| /playback | 回放 | 日期选择(默认今天)、24h 时间轴(录像段蓝条+事件刻度点, /api/timeline)、`<video controls>` 播放 `/media/recordings/{name}`，点击事件刻度跳转该时刻（video.currentTime = 事件时间-段start） |
| /events | 事件中心 | 类型/日期区间筛选、分页、Arco Image 预览、多选批量删除(POST /api/events/batch-delete，二次确认) |
| /recordings | 录像管理 | 表格(名称/大小/起止/操作)、下载、删除(二次确认)、存储水位条 |
| /settings | 设置 | Tabs：摄像头 / 侦测 / 录像存储 / 通知(每通道表单+发送测试) / 布防日程(rules 增删编辑) / 自检与日报 / Bot；保存=POST /api/config 全量；摄像头/server 修改后提示"需重启生效" |
| /logs | 日志 | EventSource 消费 /api/logs/stream，级别着色，暂停/清屏 |

布局：Arco `Layout`（Sider 菜单 + Header 显示相机名/布防状态/时钟）。所有列表页必须有 Loading/Empty/Error 三态。移动端：Sider 折叠为抽屉。

---

## 5. 集成步骤（Orchestrator 执行）

1. 合并 `feature/backend-v11` → main；全量测试。
2. 合并 `feature/frontend-arco` → main；`cd webui && npm ci && npm run build`。
3. `dist` 产物复制到 `internal/server/webdist/`，server.go embed 从 `web` 改 `webdist`（index 保留 no-cache），删除旧 `web/index.html`。
4. 重建二进制，端到端验收（开发文档 §8 + 契约逐项 curl/UI 核对）。
