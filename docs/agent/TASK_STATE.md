# AGENT 共享状态

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
