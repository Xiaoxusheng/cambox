# blocked.md — 阻塞与风险记录

> 由各 Agent 追加。只记「当前阻塞点 + 需要什么」，不记流水账。

---

## 2026-09-28 Backend Agent：D 盘 git 无法创建嵌套分支引用（影响两个 worktree，已绕过）

**问题**
`D:\mv_se` 仓库所在的 **D: 盘**（本地 NTFS）上，git 无法在 `.git/refs/heads/` 下创建**子目录**，
导致所有形如 `feature/xxx` 的分支引用**创建/更新时静默失败**（exit code 0，无任何报错）。

**现象（已最小复现）**
```bash
# 在 D: 盘任意全新仓库
cd /d/tmp/x && git init . && git commit --allow-empty -m init
git branch feature/x      # exit=0，但 .git/refs/heads/feature/x 不存在
git branch flat           # exit=0，.git/refs/heads/flat 正常创建
```
对照：同一 git（PortableGit 2.53 与系统 Git 2.53 均复现）在 **C: 盘**全新仓库
`git branch feature/x` 正常。`.git/objects/ab/cdef...` 这种嵌套路径 git 写入正常。
bash 手工 `mkdir -p` + 重定向写文件**可以**创建嵌套 ref，git 也能**读**到它，
但 git 后续对它的 update-ref 会把文件删掉（疑似 git 的 ref 目录清理逻辑）。

**影响（重要）**
- 本仓库 `feature/backend-v11` 与 `feature/frontend-arco` 两个分支引用**已被删除**，
  两个 worktree 的 HEAD 变成 unborn（`git log` 报 "does not have any commits yet"）。
- 若 Agent 此时执行 `git add -A` + `git commit`，会得到 dangling commit 而分支引用不前进，
  **后续提交会互相覆盖，工作有丢失风险**。Frontend Agent 若已提交过，需同样检查。

**已做的绕过（Backend）**
1. 从 dangling commit 恢复：`git update-ref refs/heads/backend-v11 1321819`（扁平分支，可正常提交）。
2. worktree HEAD 改为 `ref: refs/heads/backend-v11`（`.git/worktrees/backend/HEAD`）。
3. 手工维护**嵌套别名 ref**：提交后把同一 SHA 写入
   `.git/refs/heads/feature/backend-v11`，使 Orchestrator 仍可 `git merge feature/backend-v11`。

**需要 Orchestrator 确认 / 处理**
- 合并时请用 `git merge feature/backend-v11`（别名 ref 是手工写入的松散 ref，git 读取正常）。
- 合并后**不要**执行 `git branch -d feature/backend-v11` 之外的 ref 重写（如 `git pack-refs --all`
  或 `git gc` 可能把别名 ref 清掉）；若别名 ref 消失，可用 `git rev-parse backend-v11` 重新指向。
- 建议根治：把仓库迁到 C: 盘，或对 `D:\mv_se` 的 git 操作统一改用扁平分支名。
- Frontend Agent 请确认自己的分支引用是否还在；若已丢，用
  `git fsck --dangling | grep commit` 找回 dangling commit 后按上面方式恢复。

**当前阻塞点**：无（已绕过，可继续开发）；但**环境层面未修复**，属已知风险。

---

## 2026-09-28 Frontend Agent：确认已按同样方式恢复（无遗留阻塞）

**处理结果**
- 前端分支引用确已丢失（worktree HEAD 曾为 unborn）。已按 Backend 方式恢复：
  - 扁平分支 `refs/heads/frontend-arco` = `424c160`（基线 `ed87551`）；
  - `.git/worktrees/frontend/HEAD` 已改写为 `ref: refs/heads/frontend-arco`；
  - 手工写入嵌套别名 `refs/heads/feature/frontend-arco` = `424c160`（`git rev-parse feature/frontend-arco` 读取正常）。
- 本次提交 `424c160` 仅含 `webui/` 下 35 个文件（`git show --name-only` 已核对无越界），
  工作区干净，`webui/dist` 已保留（gitignore 忽略，未入库）。

**需要 Orchestrator 处理**
- 合并前端请用 `git merge feature/frontend-arco`（或等价的 `frontend-arco`）。
- 合并后勿执行 `git pack-refs --all` / `git gc`，以免清除手工别名 ref；
  若别名丢失，用 `git rev-parse frontend-arco` 重新指向即可。
- 前端侧**无阻塞**，无其它待办。
