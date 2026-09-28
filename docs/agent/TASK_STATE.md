# AGENT 共享状态

## ⏸ 进度快照（2026-09-28 08:15，用户指示 9 点停止，存档待续）

**已完成：**
- v1.0 系统全部完成并验证（gofmt/vet/test/build 全绿 + 浏览器实测），主目录 `D:\mv_se` 正在运行 camhub.exe（http://127.0.0.1:8787，模拟源）
- git 仓库建立：main = 1bf7679（v1.0 基线）+ 本提交（v1.1 文档）
- **v1.1 契约已完成并提交：docs/contracts/api-v1.1.md**（配置 schema / 运行时语义 / API 形状 / 页面契约 / 集成步骤，唯一开发依据）
- Task Board：docs/agent/tasks.md（19 项 [Backend]/[Frontend] 任务待做）
- 两个 git worktree 已建好并同步到最新 main：`.wt/backend`(feature/backend-v11)、`.wt/frontend`(feature/frontend-arco)

**未开始：**
- 全部 [Backend] / [Frontend] 实现任务（并行派发的两个 Agent 在启动前被用户取消，**没有任何半成品代码**）

**恢复步骤（下次继续时按此执行）：**
1. 重新并行派发两个 Agent（用 Agent 工具同一条消息发出）：
   - Backend Agent → worktree `D:\mv_se\.wt\backend`，分支 `feature/backend-v11`，按 tasks.md [Backend] 项依契约实现；注意冒烟测试用 8788 端口（主目录 8787 占用中）
   - Frontend Agent → worktree `D:\mv_se\.wt\frontend`，分支 `feature/frontend-arco`，`webui/` 从零搭建 Vite+React+TS+Arco 暗色，mock 模式独立开发
   - 派发前要求先读 multi-agent-parallel-dev 与 go-dev-standard / frontend-dev-standard 的 SKILL.md
2. 两 Agent 完成后 Orchestrator：审查分支 diff 越界情况 → 合并 → `cd webui && npm run build` → dist 复制到 `internal/server/webdist/` → server.go embed 路径 web→webdist → 端到端验收（契约逐项 + 开发文档 §8）
3. 范围提醒：P0 七件套 + C3 画面自检 + C6 Telegram Bot + C9 每日日报（AI 检测等 P1 不在本期）

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
