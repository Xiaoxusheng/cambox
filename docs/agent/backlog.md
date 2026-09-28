# camhub 待办清单（Backlog）

> 更新：2026-09-28，v1.2 交付后。
> 规则沿用长任务规范：**每项必须带验证方式，过不了验证不得宣布完成**；动手前先改契约（docs/contracts/）。
> 当前基线：v1.2 100%（见 docs/agent/tasks-v12.md 的验收证据）。

---

## A. 现在就能做（无需硬件）

### A1. ✅ 已完成（2026-09-28）：三层回归全绿
v1.1 五层验证中这三层在 v1.2 轮未重跑（代码路径未触碰，单测已绿，但端到端没跑）：
- 通知链路长跑：`python D:/tmp/camhub-soak.py`
- 优雅关闭：`python D:/tmp/camhub-shutdown.py`
- 生命周期清理：`python D:/tmp/camhub-lifecycle.py`

**验证标准**：三个脚本退出码全 0；长跑内存无增长趋势、各通道收到真实推送且 60s 限流生效；
关闭退出码 0 + 端口释放 + ffmpeg 子进程收尾；清理器按天数/容量真实删旧文件。
**注意**：soak 会向你的钉钉/企微/Bark/Webhook 真实推送一批消息，跑之前有心理预期。

### A2. ✅ 已完成（2026-09-28）：README 对齐 v1.2，双配置回读验证通过
「接入真实摄像头」章节补 `type: url`（直播流）接法与预览质量/预览帧率/编码 CRF 三个新配置。
**验证**：照 README 从零填一份 rtsp 与一份 url 的 camera 段均可被服务接受（`-config` 启动 + GET /api/config 回读）。

### A3. ✅ 已完成（2026-09-28）：后端+契约+API 层已交付（main 7b9cbf0）；前端 UI 由 webui-redesign-4k 会话在重做事件页时保留该筛选
`GET /api/events` 目前只能按 type=motion|selfcheck 筛，无法区分「画面冻结/画面异常」。
做什么：契约补 `detail` 查询参数 → 后端实现 → 前端事件中心加筛选项。
**验证**：mock 与真实模式下筛选 `detail=frozen` 只返回冻结事件、分页 total 正确；server 包单测覆盖该参数。

### A4. GitHub 仓库描述/Topics 完善 — P3
**验证**：仓库页简介与 README 首段一致。

### A5. ⏸ 暂缓（前端正被 redesign-4k 会话重做，工具链升级等其落地后再做，避免双会话互相踩踏）
GitHub Dependabot 报 1 high + 5 moderate；`npm audit` 实际为 4 项：
- esbuild/vite ≤6.4.2 dev-server 请求伪造（moderate）——**仅影响 `npm run dev`**，内嵌产物不受影响；修复需升 vite 8（breaking）
- react-router open redirect via backslash（moderate）——面板内全部是固定内部路径，实际风险低；SSR 反序列化（high）——项目未用 SSR，**不适用**；修复需升 react-router-dom 7.18.4（breaking）

**验证**：升级后 `npx tsc --noEmit` + `npm run build` 通过，probe-v12 165 断言全绿，Dependabot 告警清零。
**择机做**：属于工具链升级，别在功能开发中途顺手升。

---

## B. 相机到手后（硬件门控）

### B1. 实机接入实测 — P0
改 `configs/config.yaml` 的 camera 段为 rtsp。逐项验证：
- [ ] 取流 connected，预览 fps 与标称相符
- [ ] sub_rtsp 子码流生效（预览走子码流、录像走主码流）
- [ ] 录像 copy 模式正常分段；**ffprobe 确认 mp4 含音频轨**（`-map 0` 已带，前提相机开拾音）
- [ ] 若相机有私有数据轨导致 mp4 封装报错 → 收窄为 `-map 0:v:0 -map 0:a:0`（改 recorder.go + 单测）
- [ ] 人在画面走动真实触发移动侦测事件 + 截图 + 推送
- [ ] 拔网线/断流 → 按 reconnect_delay_sec 自动重连恢复

### B2. 对讲能力判定（决定 v1.3 对讲 go/no-go）— P0
问卖家 + 实测：是否支持 **ONVIF Profile T**（音频后台声道）？对讲是否只在自家 App 可用？
**验证**：用 ffprobe/ONVIF 探测工具对相机执行 DESCRIBE（带 backchannel 头），能枚举出 recvonly 音频轨即为支持。
输出结论写入本文件并据此定 C2 方案。

---

## C. v1.3 功能候选（动手前先写契约）

### C1. 录像音频保障与音画同步 — P1，小
copy 模式已天然带音轨（`-map 0`）；encode 模式确认音频编码参数与音画同步表现。
**验证**：ffprobe 各来源录像均含 a 轨；抽段人工听查同步偏移 < 200ms。

### C2. 对讲（PTT）— P1，大，**依赖 B2 结论**
方案（Profile T 可用时）：浏览器 getUserMedia（带回声消除）→ WebSocket 推 PCM → 服务端 ffmpeg 转 G.711 alaw → Go 自实现 ONVIF backchannel RTSP 客户端 + RTP 打包（ffmpeg 无此能力，GStreamer 拒绝引入）。
**验证**：面板按住说话，相机喇叭出声且延迟 < 800ms；松开即停；并发抢麦有互斥；断流恢复后可再次对讲。

### C3. 面板实时听音（带音频预览）— P2，大
候选：LL-HLS（ffmpeg/hls.js，延迟 2~5s）或 WebRTC（延迟 <500ms，复杂度高）。
**验证**：面板出声且与画面延迟在所选方案的标称范围内；多客户端并发；不拖垮 CPU。

### C4. 公网部署鉴权 — **P0-if-公网**
不做鉴权就不允许暴露公网（目前仅 127.0.0.1 监听，安全）。
做什么：登录 session/token + middleware 保护 /api 与 /media，登录页；可选 HTTPS 反代说明。
**验证**：未登录访问 /api/* 返回 401；登录后 200；错误口令限速（如 5 次锁定 10 分钟）；静态面板未登录只出登录页。

### C5. 事件存储迁 SQLite — P2（事件量 >10 万再考虑）
**验证**：迁移后事件查询/分页/筛选功能与 JSONL 版一致；旧 JSONL 一次性导入不丢；写入性能不劣化。

### C6. 前端首屏体积优化 — P3
路由级 React.lazy + Arco 按需加载，把 949kB/gzip 285kB 降下来。
**验证**：npm run build 产物显著缩小；全部页面 mock+真实模式回归通过（probe 脚本不改语义仍全绿）。

### C7. 多摄像头 — P3，远期
当前单机单相机，架构已按 source 抽象留了口。
**验证**：≥2 路并发取流/录像/事件互不串扰，面板可切换。

---

## 已完成（索引）

- v1.0：取流/侦测/录像/面板（见 .agent/TASK_STATE.md）
- v1.1：P0 七件套 + 自检 + 日报 + Bot + Arco 前端（docs/contracts/api-v1.1.md）
- v1.2：url 流来源 + 画质三项 + 监控优先外壳（docs/contracts/api-v1.2.md，任务板全勾）
