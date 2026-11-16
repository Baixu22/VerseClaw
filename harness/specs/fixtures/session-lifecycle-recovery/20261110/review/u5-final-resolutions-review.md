---
driven_by: agent
actor: u5-final-resolutions-review
review_date: 2026-11-10
base_source_commit: 3774c3bad9531a06c49f0c74e7dd4ed81eb6e7f8
reviewed_merged_head: 3333e5a78dd91293e016bd0182a7cb189b3fc1d6
validation_mode: source_and_existing_artifacts_read_only
new_test_execution: not_run
backend_identity: not_claimed
---

# U5 最终修复窄复审

本轮未发现指定 U5 范围内仍可确定的产品错误。checkpoint workspace/journal、restore generation/fence、反向 admission deadline、compaction pending、四语 checkpoint modal、family counter 和 native Git 独有 commit 保留均与要求一致。

## Git 根与版本边界

Git 读取前确认：

- `show-toplevel`: `D:/ClawX-work/session-task-unified-relay-20261109`
- 当前 HEAD: `3333e5a78dd91293e016bd0182a7cb189b3fc1d6`
- 分支: `codex/session-lifecycle-recovery-20261109`
- `status --porcelain`: 空
- 仓库级 `core.worktree`: 未设置
- `.git` 文件指向 `D:/ClawX/.git/worktrees/session-task-unified-relay-20261109`

用户指定的产品基线为 `3774c3bad9531a06c49f0c74e7dd4ed81eb6e7f8`。合并 `main@5e9e865dc` 后，下列目标文件在 `3774…` 与 `3333e5a78` 的对象哈希完全相同：

| 文件 | 对象哈希 |
| --- | --- |
| `openclaw_runtime/src/gateway/server-methods/sessions.run-control.ts` | `6213d3d27b2caea4ce69513ad299e57735ea7ff4` |
| `openclaw_runtime/src/gateway/server-methods/sessions.run-control.checkpoint-diff.test.ts` | `dcdaab5cabbe94fda7f672b778df4b34d15521e7` |
| `electron/gateway/session-task-scope-bridge.ts` | `af02aff779b95af3fd4a0a4b6c277dfca2397fbe` |
| `electron/services/sessions-api.ts` | `a455443c91cd56d8cf97f0f15e91b0f906cf3e76` |
| `src/pages/Chat/index.tsx` | `1589abf1745c9749568c0b24cbc61bedf1c2e3d2` |
| `src/components/chat/CheckpointsDialog.tsx` | `f6513478b1dbce4f827624976dfb2423f7afe5f0` |
| `electron/services/task-system-service.ts` | `937d1a22fb364e8b14eb851a043d54e1b32434f1` |
| `openclaw_runtime/src/agents/worktree-service.ts` | `a8ebae50fb6ce4b839df42dfd8119e19abde625f` |
| `src/components/layout/SessionFolderTree.tsx` | `50f3dca0c69966164c2f6cf35e2de1235156e524` |
| `src/styles/codex-sidebar.css` | `9a492b19f055ec5d95d35ed4866c6725a6308587` |

`3774…..3333e5a78` 对上述文件及三个 U5 E2E 规格的路径 diff 为空。因此 `3774…` 上的 U5 产品证据继续适用于合并后 HEAD。

## 核对结果

### 1. Checkpoint journal、workspace、generation 与 fence

[`sessions.run-control.ts:642`](D:/ClawX-work/session-task-unified-relay-20261109/openclaw_runtime/src/gateway/server-methods/sessions.run-control.ts:642) 的 restore 路径从 session store 当前 generation 条目按 `workspaceDir -> spawnedWorkspaceDir -> agent default` 选择执行目录；第 644 行使用 checkpoint 自带的 `journalSessionId`，第 645 行要求它精确等于当前 session generation。

[`sessions.run-control.ts:720`](D:/ClawX-work/session-task-unified-relay-20261109/openclaw_runtime/src/gateway/server-methods/sessions.run-control.ts:720) 至第 755 行的 diff 路径使用同一 `workspaceDir -> spawnedWorkspaceDir` 顺序，并以 checkpoint journal identity 调用 `checkpointContentDiff`。

restore generation/fence 保持完整：

- 第 600–609 行先读取当前 `sessionId`，拒绝调用方的 stale `expectedSessionId`，并构造含 `agentId/canonicalSessionKey/expectedSessionId` 的 admission identity。
- 第 610–617 行拒绝 active、fenced、busy 状态并在 rollback 前建立 `session-restore-checkpoint` fence。
- 第 620–626 行在 session-store barrier 内重新读取最新条目并再次比较 generation。
- rollback 的 file lease 在该 barrier 与 fence 内执行；第 693–695 行在 `finally` 释放 fence。

`u5-checkpoint-workspace-green` 在提交 `3f32a2a44326f1766d116cc03bf6b0f1e659899f` 上 `16/16` 通过，`exitCode=0`、`sourceUnchanged=true`。测试覆盖 `workspaceDir` 与 `spawnedWorkspaceDir` 两种字段、stale generation、旧 journal generation、缺 journal identity、run/permit/fence busy 拒绝、store barrier 后 generation 变化、真实文件 lease 期间的 fence、rollback 后 fence 释放。

[`u5-journal-restore-ui14.result.json`](D:/tmp/unified-management-20261109/lifecycle-validation/u5-journal-restore-ui14.result.json) 在 `3774…`、tree `0e1606b…` 上为 `1 expected / 0 unexpected / 0 skipped`、`exitCode=0`、`sourceUnchanged=true`。其 [`context-commit.json`](D:/tmp/unified-management-20261109/lifecycle-validation/u5-journal-restore-ui14-results/session-context-commit-rec-e72a0-loss-and-retains-generation/context-commit.json) 记录：

- stale restore 被 `Session generation changed before checkpoint restore` 拒绝。
- reply loss 已发生，但 owner restore 已完成并被记录为 dropped；`automaticRedispatches=0`。
- `diffBefore.files=1`，`diffAfter.files=0`。
- 恢复文件 SHA-256 为 v1 的 `2d27fbdf4e8ca207afbfa388ca9172fbcc6c70e534af2476b3b704f87debadcf`。
- restore 前后的 session generation 保持 `b2ee1d8f-1bae-4b01-9cdf-4de66371897c`。

### 2. Reverse admission 独立 20 秒 deadline

[`session-task-scope-bridge.ts:18`](D:/ClawX-work/session-task-unified-relay-20261109/electron/gateway/session-task-scope-bridge.ts:18) 为每个新 `taskScope.admit.request` 创建独立 host deadline，参数为 `stage: 'gateway'`、`timeoutMs: 20_000`、`requestId: request.requestId`。第 20–28 行把 `admit` 与结果 RPC 都放入该 deadline 的 AsyncLocalStorage 上下文；旧 socket 创建请求的 deadline 不再被继承。

`u5-admission-deadline-green` 在提交 `d9b91b1d64973c459c0d0bbd434f96a20c077b1b` 上 `18/18` 通过，`exitCode=0`、`sourceUnchanged=true`。新增断言以一个已过期、`timeoutMs=1` 的 `old-gateway-start` 上下文发起 admission，并确认 admission handler 与 result RPC 观察到同一个新 deadline：requestId 不是旧值、`deadlineAtMs > Date.now()`、`timeoutMs=20_000`。

### 3. Compaction pending 与 Chat 行为

[`sessions-api.ts:885`](D:/ClawX-work/session-task-unified-relay-20261109/electron/services/sessions-api.ts:885) 从 `result.result.details.pending` 提取异步接受状态；第 890 行将其映射为 `status: 'pending'`，并保持 `compacted: false`，不会再误映射成 `skipped` 或 `failed`。

[`Chat/index.tsx:2179`](D:/ClawX-work/session-task-unified-relay-20261109/src/pages/Chat/index.tsx:2179) 的 manual compact 在检查 `compacted` 或失败提示前处理 pending，显示 `toastPending`、刷新状态并保留当前对话。

[`Chat/index.tsx:2358`](D:/ClawX-work/session-task-unified-relay-20261109/src/pages/Chat/index.tsx:2358) 的 range compact 同样把 pending 判断放在 `!result.success || result.compacted !== true` 之前；接受的异步 range 请求不会落入 `compactRange.toastFailed`。

证据状态：

- `u5-native-pending-green` 在提交 `0a6d1730fddc09f8bdd2917b4d92f089471264ef` 上 `123/123` 通过，`exitCode=0`、`sourceUnchanged=true`。其中 `host services preserves an asynchronous compact acceptance as pending` 与 `preserves an asynchronous compactRange acceptance as pending` 均为 passed。
- `u5-native-pending-ui3` 在 `3774…` 上 `1 expected / 0 unexpected`、`exitCode=0`、`sourceUnchanged=true`。其命令明确以 `--grep "manual compact"` 运行 [`session-context-recovery.spec.ts:129`](D:/ClawX-work/session-task-unified-relay-20261109/tests/e2e/session-context-recovery.spec.ts:129)。该 Electron 用例在 accepted-pending 后断言 `chat-compaction-dialog` 仍可见、用户填写的 `U5 preserve this explicit instruction` 仍保留，并验证 generation 与历史不变。

唯一明确的 UI 证据缺口：当前没有一份与 `pending UI3` 同级的、单跑 accepted-pending `compactRange` 的 Electron E2E 通过产物。该分支现有证明是 Chat 源码顺序，以及 `u5-native-pending-green` 内 `compact`/`compactRange` 两个映射断言；上述产品文件在合并后哈希未变。

### 4. CheckpointsDialog 四语与 modal 布局

[`CheckpointsDialog.tsx:140`](D:/ClawX-work/session-task-unified-relay-20261109/src/components/chat/CheckpointsDialog.tsx:140) 使用实体 `bg-surface-modal`、上下/左右边界、`max-w-lg`、`max-h-[70vh]` 和纵向滚动。第 142–147 行将标题与说明放在 `flex-col` 两行，消除旧版横排造成的挤压。

[`session-context-commit-recovery.spec.ts:317`](D:/ClawX-work/session-task-unified-relay-20261109/tests/e2e/session-context-commit-recovery.spec.ts:317) 对实际 modal 断言：

- 背景不是透明色。
- 宽度不超过 `512px`。
- description 顶边不高于 title 底边。
- `scrollWidth <= clientWidth`，无水平溢出。

`u5-journal-restore-ui12` 在 `5c542533…` 上已通过真实 rollback 与 en/zh/ja/ru 四语恢复。当前 `3774…` 的 `u5-journal-restore-ui14` 进一步覆盖新增 modal 布局，结果 `1/1` 通过。逐张检查当前截图后确认：en、zh、ja、ru 四份均显示实体浅色 modal、独立标题和说明区、无水平溢出；对应截图为：

- `D:/tmp/unified-management-20261109/lifecycle-validation/u5-journal-restore-ui14-results/session-context-commit-rec-e72a0-loss-and-retains-generation/checkpoint-restored-en.png`
- `D:/tmp/unified-management-20261109/lifecycle-validation/u5-journal-restore-ui14-results/session-context-commit-rec-e72a0-loss-and-retains-generation/checkpoint-restored-zh.png`
- `D:/tmp/unified-management-20261109/lifecycle-validation/u5-journal-restore-ui14-results/session-context-commit-rec-e72a0-loss-and-retains-generation/checkpoint-restored-ja.png`
- `D:/tmp/unified-management-20261109/lifecycle-validation/u5-journal-restore-ui14-results/session-context-commit-rec-e72a0-loss-and-retains-generation/checkpoint-restored-ru.png`

首次 `u5-journal-restore-ui13` 在创建测试项目时中止：`electronApplication.evaluate: Target page, context or browser has been closed`，未进入产品断言。随后 `ui14` 在相同 `3774…` 与相同 tree 上完整通过。

### 5. Family counter 窄布局

[`SessionFolderTree.tsx:520`](D:/ClawX-work/session-task-unified-relay-20261109/src/components/layout/SessionFolderTree.tsx:520) 将 family toggle 与标题行放到明确的 sibling 结构中；[`codex-sidebar.css:443`](D:/ClawX-work/session-task-unified-relay-20261109/src/styles/codex-sidebar.css:443) 为 toggle 固定独立区域，并为标题行保留 `padding-left`。

`u5-family-counter-green2` 在 `3774…` 上 `1 expected / 0 unexpected`、`exitCode=0`、`sourceUnchanged=true`，耗时 `201131 ms`。其 [`counter-layout.json`](D:/tmp/unified-management-20261109/lifecycle-validation/u5-family-counter-green2-results/session-family-counter-lay-05afe-le-at-2-20-and-100-children/counter-layout.json) 包含 12 个真实 Electron 布局样本：

- count: `2`、`20`、`100`
- width: `1280`、`960`
- theme: light、dark
- 所有样本 `overflow=false`
- toggle 固定为 `x=17..47`，标题从 `x=50` 开始，和 label 区域分离

### 6. Native Git cleanup 保留独有 commit

[`task-system-service.ts:48`](D:/ClawX-work/session-task-unified-relay-20261109/electron/services/task-system-service.ts:48) 在 UI cleanup 放行前调用 `assertCleanupCommitRetained`。实现位于 [`worktree-service.ts:342`](D:/ClawX-work/session-task-unified-relay-20261109/openclaw_runtime/src/agents/worktree-service.ts:342)：

- `rev-parse --verify HEAD^{commit}` 固定待删 worktree 的 HEAD。
- `for-each-ref --contains=<head> ... refs/` 只接受 shared ref 对 commit 的保留。
- `refs/bisect/`、`refs/rewritten/`、`refs/worktree/` 不作为保留证明。
- 无可保留 ref 时抛出 `worktree_cleanup_unreferenced_commit:<head>`，UI 映射为 `UI_CLEANUP_COMMIT_RETENTION` 并阻止删除。

`u5-native-retention` 在提交 `79fc85d884c13f85021bf342cd8586154630ef6a` 上 `52/52` 通过，`exitCode=0`、`sourceUnchanged=true`。`git` 与 `storage` 两条始发路径的 `preserves a clean detached unique commit until a shared ref retains it` 均为 passed：无 shared ref 时先阻止并保留文件；创建 `u5-native-retained` 分支后清理成功，且该分支仍能读取原 commit 内容。

## 最终状态

在指定 U5 范围内，未发现需要恢复为产品错误的问题。合并后 `3333e5a78` 的 U5 产品对象哈希与 `3774…` 完全一致；现有 `ui14`、`pending UI3`、checkpoint/deadline/unit/native-retention 结果可以绑定到同一产品实现。`compactRange` accepted-pending 缺少独立 Electron E2E 是当前唯一 UI 证据缺口，源码与 host-api 映射已有覆盖。
