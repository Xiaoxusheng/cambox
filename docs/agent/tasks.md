# Tasks — v1.1（范围：P0 七件套 + C3/C6/C9，已确认）

负责人：Backend Agent / Frontend Agent / Orchestrator
Contract：docs/contracts/api-v1.1.md（唯一依据）

## TODO

- [ ] [Frontend] webui 脚手架(Vite+React+TS+Arco暗色+Router) + api client(真实/mock) + 布局
- [ ] [Frontend] Dashboard 页
- [ ] [Frontend] Live 页（含布防开关 + ROI 绘制）
- [ ] [Frontend] Playback 页（时间轴 + 播放器）
- [ ] [Frontend] Events 页（筛选/批量删除）
- [ ] [Frontend] Recordings 页
- [ ] [Frontend] Settings 页（7 个 Tab）
- [ ] [Frontend] Logs 页（SSE）
- [ ] [Frontend] npm run build 通过 + 三态齐全自查
- [ ] [Orchestrator] 分支合并 + dist 内嵌 + 端到端验收 + 文档更新

## DOING

（无）

## DONE

- [x] Contract v1.1（docs/contracts/api-v1.1.md）
- [x] 基线导入与 worktree 建立（main@1bf7679）
- [x] [Backend] 配置 schema v1.1：新结构体/双tag/Sanitize/热更新扩展（§1）→ f5e0998
- [x] [Backend] 多码流：sub_rtsp 解码源 + -vf scale 强制尺寸（§2.1）→ 08f8551
- [x] [Backend] ROI 掩码检测（§2.3）→ 7922f91
- [x] [Backend] 布防日程评估器 + armed 运行时状态（§2.2）→ 6fed84d
- [x] [Backend] 日志环形缓冲 500 条（§2.8）→ 1321819
- [x] [Backend] 通知中心 notify：钉钉/企微/Telegram/Bark/Webhook + 限流（§1 notify）→ 09145c8
- [x] [Backend] C3 画面自检模块 + 状态暴露（§2.4）→ 94c23f0
- [x] [Backend] C9 每日日报（store 按日统计 + 定时推送）（§2.5）→ 26906e4
- [x] [Backend] C6 Telegram Bot 双向控制（§2.6）→ f5050d9
- [x] [Backend] API：arm/timeline/batch-delete/recordings删除/notify test/logs SSE/status扩展/config v1.1（§3）→ 70da7c4
- [x] [Backend] 单元测试 + gofmt/vet/build 全绿 + 8788 端口冒烟（46 项断言全通过）
