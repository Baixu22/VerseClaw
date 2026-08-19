# Coding Runtime P5 证据报告（2026-08-17）

> 状态：P5 开发已交付自检完成；TF-0074=review_needed(90%)，等待独立验收。P4 已经用户确认，TF-0073=done(100%)。
> 本报告不是 UFTK GA / canary / 整体成熟度结论。

## 0. 起始信息

- 工作区：`D:\ClawX`（repo root）
- HEAD：`734ec877e75682861103660fbdea2bd55253ece0`
- 工作分支：`main`；未 checkout / reset / clean；工作树仍含大量既有 WIP
- 前置状态：`TF-0070`=done(100%)；`TF-0071`=done(100%)；`TF-0072`=done(100%)；`TF-0073`=done(100%)（用户已确认 P4）
- 待验收节点：`TF-0074`（P5），child_of `TF-0010`，depends_on `TF-0073`
- 验收对象：`docs/dev/coding-runtime-development-spec.md` Phase 5 + 7.2/7.4
- 产品锁：liveReady=false、productApproved=false、defaultOn=false
- 关键 flag：`runtime.coding.uftk.enabled=false`；`runtime.coding.uftk.auditLog.enabled=false`；`runtime.coding.uftk.gitCheckpoint.enabled=false`；`runtime.coding.uftk.execSideEffects.enabled=false`；`runtime.coding.uftk.commandApproval.enabled=false`；`runtime.coding.uftk.baseVersionGuard.enabled=false`；shared 6 个 UFTK flag 全 false

## 1. P5 交付物

| 交付物 | 路径 | 状态 |
|---|---|---|
| Git-backed checkpoint 服务 | `openclaw_runtime/src/agents/coding-runtime/git-checkpoint.ts` | 新增并有测试 |
| 创建/列表/恢复测试 | `openclaw_runtime/src/agents/coding-runtime/git-checkpoint.test.ts` | 新增，6 tests |
| 并发/冲突恢复测试 | `openclaw_runtime/src/agents/coding-runtime/git-checkpoint.restore.test.ts` | 新增，2 tests |
| flag/config 同步 | `types.openclaw.ts` / `zod-schema.ts` / `runtime-feature-leaves.ts` / `coding-runtime-flags.ts` | 新增 `runtime.coding.uftk.gitCheckpoint.enabled`，默认 false |
| shared contract 同步 | `shared/coding-runtime/types.ts` / `schema.ts` / `README.md` / `MIGRATION.md` / `tests/unit/coding-runtime-contract.test.ts` | flag 数 5 -> 6，新增 P5 错误码 |
| dcs 默认门禁 | `openclaw_runtime/src/context-engine/dcs-prod-flags-catalog.test.ts` | gitCheckpoint 默认 false 断言 |

关键实现约束复核：

- 创建采用 `git stash create` 风格：临时 `GIT_INDEX_FILE` -> `git add -A`（排除 `.openclaw`）-> `git write-tree` -> `git commit-tree` -> 私有 ref `refs/openclaw/uftk-checkpoints/<commit>`；真实 index/worktree 不动。
- 创建后返回 checkpoint id；`listCheckpoints()` 用 `git for-each-ref` 列查私有 ref。
- restore 使用临时 index + `git read-tree` + `git checkout-index -a -f`，再把真实 index 读到 checkpoint tree；对恢复前存在但 checkpoint tree 不存在的路径做定向删除（保留 `.git` / `.openclaw` / lock sidecar）。不使用 `git reset --hard`、不使用 `git clean -f`。
- restore 互斥：进程内 per-workspace 队列 + 既有 `acquireSessionWriteLock`（锁文件位于 `<openclaw-state>/locks`，不写工作区），带超时。
- 非 git：`unsupported` 结构化结果；禁用：`disabled` 结构化结果；未知 checkpoint：`not_found` + `E_GIT_CHECKPOINT_NOT_FOUND`。
- 嵌套 `.git`/submodule（含 root `.git` 为文件的情况）：`unsupported` + 显式 warning，禁止静默降级。
- restore 冲突：目标文件路径被目录/符号链接阻挡时返回 `conflict` + `E_GIT_CHECKPOINT_CONFLICT` + `diagnostic`（beforeStatus/beforeTracked/beforeUntracked/targetPaths），不触碰用户内容。
- git checkpoint 未接入任何模型工具 schema；write-journal 回滚路径未改，两者不互相污染。

## 2. 必跑命令与 exit code（自检复跑）

| 命令 | Exit | 结果 |
|---|---:|---|
| `pnpm exec vitest run tests/unit/coding-runtime-contract.test.ts --maxWorkers=1` | 0 | 1 file / 8 tests PASS |
| runtime 定向 20 文件（P5 列表，显式列出）`--maxWorkers=1` | 0 | 20 files / 170 tests PASS |
| `pnpm --dir openclaw_runtime exec vitest run src/context-engine/dcs-prod-flags-catalog.test.ts --config test/vitest/vitest.config.ts --maxWorkers=1` | 0 | 1 file / 4 tests PASS |
| `pnpm run typecheck:node` | 0 | PASS |
| `pnpm run typecheck:web` | 0 | PASS |
| `pnpm contract:check` | 0 | Contract check passed |
| `pnpm run lint:bom` | 0 | check-no-bom: ok |
| `git diff --check -- <P5 tracked 变更文件列表>` | 0 | clean；新文件无行尾空白 |
| `pnpm verseshell:test` | 0 | bundle 13/13 + runtime-bundle 11/11 + runtime 15 files/141 tests + MCP 11/11 |
| `pnpm --dir openclaw_runtime tsgo:core` | 0 | PASS |
| `pnpm --dir openclaw_runtime tsgo:core:test` | 2 | **residual**：仅既有 RLG WIP 测试文件（session-drain-service.test.ts / session-reset-service.stop.test.ts / session-reset-service.subagent-stop.test.ts）；无 P5 文件 |

预存失败复核：`tests/unit/config-schema-parity.test.ts` 复跑 exit 1，失败原因仍为 `runtime.memory.candidateGeneration`（zod 有、type/leaves 无）；新增 `runtime.coding.uftk.gitCheckpoint.enabled` 未出现在 unknown 列表，非 P5 引入，未修。

runtime 定向 20 文件实际为 P4 的 18 文件 +：

```text
src/agents/coding-runtime/git-checkpoint.test.ts
src/agents/coding-runtime/git-checkpoint.restore.test.ts
```

## 3. P5 矩阵结果（逐项实测，不靠嘴说）

- git 项目 checkpoint 创建：`git stash create` 风格私有 ref；创建后 `git status --porcelain` 前后一致（index/worktree 零变化）；返回 checkpoint id；`listCheckpoints()` 可列查（测试覆盖）。
- git 项目 restore：修改文件、删除文件、新增文件、嵌套路径均恢复到 checkpoint 一致；`git status`/`git diff --name-only` 确认工作区与恢复索引一致（测试覆盖）。
- 非 git 项目：create/list/restore 均返回结构化 `unsupported`，不抛异常破坏既有行为（测试覆盖）。
- 并发 restore：两个并发 restore 串行执行；两者均成功且最终工作区是某一个 checkpoint 的完整状态，不出现混合态（`git-checkpoint.restore.test.ts` 覆盖）。
- restore 冲突/失败：目标文件路径被目录阻挡时返回 `conflict` + `E_GIT_CHECKPOINT_CONFLICT` + `diagnostic`；阻挡内容原样保留，不静默丢失任何一侧（测试覆盖）。
- 嵌套 .git / submodule：显式 warning + `unsupported` 结构化结果（测试覆盖 nested `.git` dir；root `.git` 文件同样返回 unsupported）。
- flag off：`isCodingGitCheckpointEnabled()`=false；`GitCheckpointService` 默认 disabled，不创建 ref；未接入任何模型工具路径；write/edit/apply_patch/exec 对外 TypeBox schema 未变。
- 与 journal 回滚区分：git-checkpoint 模块不导入/调用 write-journal 或 FTS rollback；write-journal 与 FTS rollback 文件未改，两条路径不互相污染。
- P1/P2/P3/P4 回归矩阵：包含在 20 文件定向测试中，170 tests PASS。

## 4. 性能与复杂度复核

- checkpoint 创建基于 temp index + `git write-tree`/`commit-tree`，不做全树复制。
- 10,000+ 文件真实 git 仓库实测：create=571.2ms，restore=4186.6ms（restore 包含 checkout-index 全树写出 + 定向删除校验）。
- restore 互斥使用既有 `session-write-lock` + 进程内队列，默认超时 60s，不无限阻塞。
- 非 git 场景在第一个 `git rev-parse` 后即返回 unsupported，无扫描开销。
- git 命令失败 fail-closed：返回结构化 `failed`/`conflict`，不 fallback 到 `git reset --hard` 或 `git clean -f`。

## 5. Task Forest 与收尾

- `TF-0073`=done(100%)（用户已确认 P4）。
- `TF-0074`=review_needed(90%)，child_of `TF-0010`，depends_on `TF-0073`，未置 done。
- `TFP-coding-runtime-p4-confirmed-p5-start-20260817` 与 `TFP-coding-runtime-p5-review-needed-20260817` 已 save → validate → apply → export。
- `docs/dev/handoffs/LATEST.md` 顶部已写入 P5 交接段。
- 独立验收通过且用户明确确认前，不置 `TF-0074` done。
