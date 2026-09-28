# AGENT 共享状态

## ⏸ 进度快照（2026-09-28 08:30，用户指示 9 点停止，存档待续）

**已完成（全部已提交，测试全绿）：**
- v1.0 系统全部完成并验证，主目录 `D:\mv_se` 运行中（http://127.0.0.1:8787，模拟源）
- v1.1 契约 `docs/contracts/api-v1.1.md` + Task Board + 两个 worktree（并行开发基础设施）
- **Backend 分支 feature/backend-v11 实际已完成 3 项**（Agent 中断前）：
  - ✅ 任务1 config v1.1 结构（notify/schedules/selfcheck/digest/bot/sub_rtsp/rois + 日程评估器）→ commit f5e0998
  - ✅ 任务2 多码流（sub_rtsp 解码源 + -vf scale 强制尺寸）→ commit 08f8551
  - ✅ 任务3 ROI 掩码检测 → commit 7922f91（worktree 内 go build / go test -count=1 ./... 6 包全绿，**未经 Orchestrator 代码审查**）
- Frontend：未实际开始（仅建了空 webui/ 目录，已清理）

**未开始：**
- Backend 任务 4~10（armed+日程门控接入 pipeline / notify 五通道 / selfcheck / digest / telegram bot / 新 API / 冒烟）
- Frontend 全部 9 项（webui 脚手架 + 7 页面 + 构建）
- Orchestrator 集成验收

**恢复步骤（下次继续时）：**
1. 重新派发两个 Agent（同一条消息并行）：
   - Backend → worktree `D:\mv_se\.wt\backend`，分支 `feature/backend-v11`，**从任务 4 继续**（1~3 已完成，见上方 commit）；冒烟测试用 8788 端口（8787 被主目录服务占用）；先 `go test -count=1 ./...` 确认起点状态
   - Frontend → worktree `D:\mv_se\.wt\frontend`，分支 `feature/frontend-arco`，webui/ 从零搭建 Vite+React+TS+Arco 暗色，mock 独立开发
   - 派发 prompt 要求先读 multi-agent-parallel-dev 与 go-dev-standard / frontend-dev-standard 的 SKILL.md
2. 完成后 Orchestrator：审查两分支 diff 越界 → 合并 → `cd webui && npm run build` → dist 复制到 `internal/server/webdist/` → server.go embed 改 webdist → 端到端验收（契约逐项 + 开发文档 §8）
3. 范围提醒：P0 七件套 + C3 自检 + C6 Bot + C9 日报（AI 等 P1 不在本期）

---

## 项目
camhub v1.0 基线已可运行（Go 单二进制 + 内嵌面板 + FFmpeg 解码）。
当前开发 v1.1：P0 七件套 + C3 画面自检 + C6 Bot + C9 日报。范围以 docs/agent/tasks.md 为准。

## 两个并行 Agent
- Backend Agent：worktree `D:\mv_se\.wt\backend`，分支 `feature/backend-v11`，状态文件 `docs/agent/backend-status.md`
- Frontend Agent：worktree `D:\mv_se\.wt\frontend`，分支 `feature/frontend-arco`，状态文件 `docs/agent/frontend-status.md`

## 铁律
1. 只在自己 worktree 内、只在自己负责的目录范围内改代码
2. Contract（docs/contracts/api-v1.1.md）冲突时：写入自己 status 文件的"契约问题"节，禁止静默偏离
3. 完成一项勾一项 tasks.md；诚实原则：没做完就写没做完
4. 阻塞时写 docs/agent/blocked.md 并继续其它任务

## v1.0 现有代码导览（Backend 用）
- cmd/server/main.go：装配与优雅关闭
- internal/config：YAML 配置（注意：所有字段 yaml+json 双 tag，历史上吃过亏）
- internal/source：FFmpeg 子进程解码 → BGR24 裸帧，单写多读帧槽，断线重连
- internal/detector：帧差移动侦测（Motion.SetConfig 支持热更）
- internal/recorder：ffmpeg 分段录像(copy/encode 双模式) + CleanOnce 保留清理
- internal/pipeline：装配 4 个 goroutine（source/detect/rec/clean）+ UpdateSettings
- internal/store：事件 JSONL（append-per-event，月分文件）
- internal/server：路由+MJPEG+SSE无；web/ 内嵌单页（v1.1 将被 webui/dist 替换）
- internal/imgconv：BGR→RGBA/JPEG
