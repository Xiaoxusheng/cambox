# Backend Agent — v1.1 状态报告

分支：`feature/backend-v11`（worktree HEAD 实为扁平分支 `backend-v11`，见「阻塞」节）
契约：`docs/contracts/api-v1.1.md`（唯一依据）
更新：2026-09-28

## 一、进度总览

| # | 任务 | 契约 | 状态 | commit |
|---|---|---|---|---|
| 1 | 配置 schema v1.1 | §1 | DONE | f5e0998 |
| 2 | 多码流 sub_rtsp | §2.1 | DONE | 08f8551 |
| 3 | ROI 掩码检测 | §2.3 | DONE | 7922f91 |
| 4 | 布防日程 + armed 运行时状态 | §2.2 | DONE | 6fed84d |
| 5 | 通知中心 notify 五通道 + 限流 | §1/§2 | DONE | 09145c8 |
| 6 | C3 画面自检 | §2.4 | DONE | 94c23f0 |
| 7 | C9 每日日报 | §2.5 | DONE | 26906e4 |
| 8 | C6 Telegram Bot 双向控制 | §2.6 | DONE | f5050d9 |
| 9 | 新 API + status/config 扩展 | §3 | DONE | 70da7c4 |
| 10 | 日志环形缓冲 500 条 | §2.8 | DONE | 1321819 |

Backend 任务 1~10 全部完成，**无遗留未实现项**。

## 二、验收证据（本地实测）

- `gofmt -l .` → 无输出
- `go vet ./...` → 通过
- `go build ./...` → 通过
- `go test -count=1 -timeout 300s ./...` → **13 个包全绿**（bot/config/detector/digest/logbuf/notify/pipeline/recorder/selfcheck/server/source/store 有测试，cmd/imgconv 无测试文件）
- **8788 端口冒烟（python urllib，绕系统代理）→ 46 项断言全通过**：
  - `GET /api/status`：armed / schedule_active{motion,record} / selfcheck{enabled,last_run,state,last_alert,consecutive_frozen,consecutive_change} ✔
  - `GET /api/config`：全量 8 段（camera/motion/record/notify/schedules/selfcheck/digest/bot）；`server` 按契约不暴露 ✔
  - `POST /api/config`：全量回环，返回结构一致 ✔
  - `POST /api/arm`：`{"armed":false}`→status 生效→恢复 true ✔
  - `GET /api/timeline`：date/segments/events/hourly(24) ✔
  - `GET /api/events`：`?type=`、`?from&to`、`detail` 字段 ✔
  - `GET /api/recordings`：items 含 start/end ✔
  - `POST /api/notify/test`：results[{channel,ok,error}] ✔
  - `POST /api/events/batch-delete`：deleted 计数 ✔
  - `DELETE /api/recordings/{name}`：正常删除；路径穿越（`..%2f..%2fconfig.yaml`）返回 400 ✔
  - `GET /api/logs/stream`：`Content-Type: text/event-stream`，先回放缓冲再实时推送 ✔
- **日程门控实机验证**：写入仅作用于周日、motion/record=false 的规则后，`schedule_active={motion:false,record:false}`，录像在 ~1s 内停止（`recorder.running=false`）；恢复空规则后自动重启。✔

冒烟环境位于 `D:/tmp/camhub-smoke/`（端口 **8788**，未触碰 8787 主目录 v1.0 服务）。

## 三、契约问题

**无静默偏离。** 实现严格对齐 `docs/contracts/api-v1.1.md`。一处需 Orchestrator/前端知悉的**非问题**澄清：

- 契约 §2.7 文字提到「camera/server 需重启」，但 §3.2 给出的 `GET/POST /api/config` data 结构**不含 `server` 段**（第 96–107 行）。实现按 §3.2 的显式 JSON 结构执行：`config.View` 有意排除 `Server`（`ApplyView 用视图覆盖配置(server 除外)`），`server` 仅能经配置文件修改。前端 Settings 页也无「服务器」Tab（§4），与之一致。若后续需要 API 可改 server，请**先修订契约**再加字段。

## 四、阻塞（环境问题，已绕过）

**D 盘 git 无法创建嵌套分支引用**（`.git/refs/heads/feature/backend-v11` 子目录创建失败）：`git commit` 后分支引用被删、`git branch` 返回 0 但 ref 文件不存在；C 盘最小复现正常，判定为本地 NTFS/D 盘环境限制。

- 绕过方案：worktree HEAD 使用扁平分支 `backend-v11`；另维护嵌套别名 ref `feature/backend-v11` 指向同一 SHA；辅助脚本 `/tmp/bcommit.sh` 每次提交后同步别名。
- **影响面**：`feature/frontend-arco` 也可能受影响，已写入 `docs/agent/blocked.md` 提醒 Orchestrator 与 Frontend Agent。
- **建议**：合并时以 SHA 为准（`git merge <sha>`），不要依赖嵌套分支名。

## 五、合并建议

**建议 Orchestrator 合并 `feature/backend-v11`（SHA 70da7c4 及其父链）→ main。**
后端接口与契约逐项一致、全量测试与 8788 冒烟均通过，无未完成项。合并后请按契约 §5 执行 `dist` 内嵌与端到端验收。
