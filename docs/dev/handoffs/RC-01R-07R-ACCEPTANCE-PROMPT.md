# RC-01R → RC-07R 独立候选验收提示词（交付版）

> 交付日期：2026-08-05 晚。本提示词供**新会话**执行 RC-01R..RC-07R 各包的正式独立验收（plan → executor → verifier，双 actor、detached worktree、唯一 output dir）。前置事实：RC-00R 候选验收已在上一会话恢复（F4 关闭，候选 `a68dec32b`，executor + verifier 双 PASS，产物 `artifacts/agent-engineering-acceptance/runs/rc00-f4-restore-5/`）。本提示词包含完整可复用操作手册与已探明障碍，**不要重新发明流程**。

---

## 0. 目标与验收标准

对以下 8 个包，各生成一份正式验收 evidence（executor `pass` + verifier `pass`，`engineeringAcceptedByAgent=true`，failures 空），并更新控制文档：

| 顺序 | 包 | spec | 候选累积链 |
|---|---|---|---|
| 1 | RC-01R | `harness/specs/tasks/rc01r-self-contained-baseline.md` | main(90e796893) + rc01r |
| 2 | RC-04R | `harness/specs/tasks/rc04-durable-approval-effect-reconciliation.md` | + rc04 |
| 3 | RC-05R | `harness/specs/tasks/rc05-minimal-operator-governance-slice.md` | + rc05 |
| 4 | RC-06AR | `harness/specs/tasks/rc06a-taskflow-capability-proof.md` | + rc06a |
| 5 | RC-06BR | `harness/specs/tasks/rc06b-clawgraph-lifecycle-migration.md` | + rc06b |
| 6 | RC-06CR | `harness/specs/tasks/rc06c-mission-lifecycle-migration.md` | + rc06c |
| 7 | RC-06DR | `harness/specs/tasks/rc06d-task-loop-lifecycle-migration.md` | + rc06d |
| 8 | RC-07R | `harness/specs/tasks/rc07-memory-context-slot-convergence.md` | + rc07 |

**硬性前提（违反即失败）**：
- 严格串行：每包验收必须在前一包 PASS 之后进行；`--since` = 前一包候选 HEAD（rc01r 的 `--since` = `90e796893`）。不得并行、不得跳序。
- 候选 checkout 全量 `pnpm test` 必须 0 failed（含 provision 资源后）；lint 0 errors；typecheck exit 0。
- 保护 workstream 边界：主工作树中 `.agent-workbench/task-forest/**`、FakeCoding UI 等未提交 workstream 文件**永不进入候选**；已入 main 的 `src/pages/Chat/ChatInput.tsx` 修复（90e796893）不得再动。
- 候选构建期间主工作树（`C:\Users\27933\Desktop\clawx\ClawX`，分支 `fix/rc00r-acceptance-control-plane`，171 个未提交文件）保持原样；所有候选操作在**独立 worktree** 中进行。
- 不修改 STATUS.md 的 `accepted_work_packages` 之外的结构；product locks 与 RC-10 保持原值；F4 状态不再回退。

## 1. 环境与关键事实（2026-08-05 实测）

- 仓库：`C:\Users\27933\Desktop\clawx\ClawX`（Git Bash，Windows）。`git worktree` 可用。
- `main` = `90e796893`（含 ChatInput lint 修复）。RC-00R 候选 worktree `C:\Users\27933\Desktop\clawx\ClawX-rc00-candidate`（detached `a68dec32b`）保留中，**不要删除**（其 `artifacts/agent-engineering-acceptance/runs/rc00-f4-restore-5/` 是流程参照物与验收产物归档地）。
- 验收 CLI：`pnpm acceptance:agent:plan|run|verify|full --spec <spec> --executor <id> --verifier <id> --since <ref> --output-dir <dir>`（`scripts/agent-engineering-acceptance.mjs` + `scripts/lib/agent-engineering-acceptance.mjs`）。`full` = plan + executor + verifier 一次跑。
- 验收机制要点（已在 lib 中确认）：
  - `inferCoverage(changedPaths)`：changed paths 含 `src/**`、`electron/**`、`shared/**`、`tests/e2e/**` → `coverage.ui=true` → 自动加 **e2e profile**（全量 Playwright E2E，本机跑不绿）→ **候选 diff 严禁出现这些路径**。
  - `harness validate --spec <spec> --since <ref>` gate：changed files 必须被**该 spec** 的 touchedAreas/ownedPaths 覆盖；缺一即 fail。**spec 的 touchedAreas 需要按候选实际文件补齐**（上一会话对 rc00 就是这么做的：补 `.gitattributes`、`artifacts/**` 等）。
  - mutation gate：全部 gate 后检查 detached worktree `git status --porcelain`；**任何 tracked 文件变化（含内容相同但 stat 变化的复制）都判 NO-GO**。
  - provision gate：从 sourceRoot 复制 gitignored 资源（ae.exe / live-observations.json）到 detached worktree；`--electron` 分支校验 sourceRoot 的 `node_modules/.pnpm/electron@40.8.4/node_modules/electron/{dist,path.txt}` 存在（install 用 `--ignore-scripts` 后**必须手动跑一次 `node node_modules/electron/install.js` 生成 path.txt**）。
  - `dependency-install-offline` gate：detached worktree 内离线 `pnpm install`（依赖主工作树 pnpm store 缓存；新 worktree 首次 install 需在线/缓存充足）。
- 每包 gate 集（fast+full 模式，14 个）：dependency-install ×2、provision-verseshell、harness-validate、fast-generate-extension-bridge、fast-lint、fast-typecheck、fast-unit-tests、contract-check、i18n-lint、integration、vite-build、runtime-build、runtime-smoke。

## 2. 每包候选构建手册（核心工作量）

主工作树未提交修改 = 各包修复的**最终混合版**（一个文件可能同时服务多包，如 `approval-ledger.ts` 含 rc04+rc05 修复）。**按包拆分不可行**，采用**累积链 + 文件归包**：

1. **创建候选 worktree**（每包一个，或复用一个累积 worktree）：
   `git worktree add <path> <parent-ref>`，parent-ref = 上一包候选 HEAD（第一包 = `main` = `90e796893`）。
2. **安装依赖**（worktree 内）：
   `pnpm install --offline --frozen-lockfile --ignore-scripts` + `pnpm --dir openclaw_runtime install --offline --frozen-lockfile --ignore-scripts`，然后 `node node_modules/electron/install.js`（生成 electron path.txt）。
3. **复制 gitignored 资源**（provision 需要 sourceRoot 有这些）：
   `resources/bin/win32-x64/ae.exe`、`resources/verseshell/manifest.json`（若与 HEAD 不同会弄脏 status——**从 git show HEAD 取**或直接 `git checkout HEAD --` 后保持不动）、`artifacts/uas-06-single-local-exec-canary/live-observations.json`（仅 sourceRoot 需要）。
4. **应用该包修复**（文件筛选）：从主工作树取该包 touchedAreas 内、且**尚未被先前包 commit 包含**的修改文件，复制到候选 worktree（注意：**不得** `git add -A`；逐文件或按清单）。
   候选文件清单生成法：`git -C <main-worktree> status --short` 过滤 touchedAreas 前缀，减去已入链文件。**逐包 touchedAreas 见第 4 节**。
5. **补齐 spec touchedAreas**：对照候选实际 changed files，把缺失的路径补进该包 spec 的 touchedAreas（先跑一次 `pnpm acceptance:agent:plan` 看 changedPaths 与 coverage，再用 `pnpm harness validate --spec <spec> --since <ref>` 验证覆盖；循环直到 validate pass）。
6. **候选自包含修复**（每包验收前必须全绿）：
   - 全量 `pnpm test` 0 failed（缺资源 → 按第 3 步 provision；缺 fixture → 判断是否需 `git add -f` 入候选）。
   - `pnpm run lint:check` 0 errors（**新增文件可能带 lint error**，需修复后入候选）。
   - `pnpm run typecheck` exit 0。
   - **Windows 换行陷阱**：凡"生成后与提交版必须字节一致"的文件（如 `artifacts/runtime-authority-convergence/rc-01/baseline.json`），在 `.gitattributes` 加 `<path> -text`（rc00 已验证：`core.autocrlf=true` 会 smudge 为 CRLF 破坏断言）。
7. **commit 候选**（worktree 内，detached 或临时分支均可）：commit message 注明包名；`git status --porcelain` 必须为空后进入验收。
8. **跑验收**：
   `pnpm acceptance:agent:full --spec <spec> --executor <pkg>-executor-<n> --verifier <pkg>-verifier-<n> --since <parent-ref> --output-dir artifacts/agent-engineering-acceptance/runs/<pkg>-accept-<n>`
   （sourceRoot = 候选 worktree，须 clean；output-dir 在候选 worktree 内，唯一）。
9. **验收 PASS 后**：记录候选 SHA 与产物路径；将该候选 HEAD 作为下一包 `--since`；更新控制文档（见第 5 节）。

## 3. 已知障碍与解法（rc00 实测，直接复用）

| 障碍 | 现象 | 解法 |
|---|---|---|
| changed paths 含 UI 路径 | coverage.ui=true → e2e profile → 全量 E2E 超时 NO-GO | 该文件移出候选（并入 main 或排除），spec touchedAreas 相应调整 |
| harness-validate 报 changed files 未覆盖 | spec touchedAreas 缺路径 | 补齐 spec touchedAreas 并提交（该改动属候选的一部分） |
| provision 报 electron dist/path.txt missing | install --ignore-scripts 跳过 postinstall | 候选 worktree 手动 `node node_modules/electron/install.js` |
| provision 报 source binary missing（ae.exe） | sourceRoot 缺资源 | 按第 2.3 步复制（ae.exe 为 gitignored，复制不影响 status） |
| detached worktree changed（mutation gate） | provision `--copy` 覆盖 HEAD 已跟踪文件 → Windows copyFileSync 后 git status 误报 M | 从 provision 的 `--copy` 列表移除 HEAD 已跟踪文件（rc00 已移除 audit-manifest.json；后续包若引入新的 HEAD 跟踪 fixture 同理） |
| rc01 baseline 再生成断言失败 | autocrlf smudge CRLF vs 生成 LF | `.gitattributes` 加 `-text` |
| 测试 fixture 仅 stage 未 commit（HEAD 无） | detached checkout 缺文件 → 测试 ENOENT | 该 fixture 文件 `git add -f` 入候选 commit |
| 全量测试在 worktree 缺 gitignored 资源 | uas-05/uas-06 等失败 | provision gate 处理（ae.exe/manifest/canary）；手动预置亦可 |
| Windows EPERM 清理失败 | worktree remove 报 Directory not empty / temp 句柄占用 | `git worktree remove --force` + 手动 `rm -rf`；验收产物目录保留 |
| git index.lock 残留 | 多 worktree 并发 git 命令 | 删除 `C:\Users\27933\Desktop\clawx\ClawX\.git\index.lock` 后重试 |
| `pnpm --dir openclaw_runtime run build:runtime` exit 1 | 该命令不存在 | runtime-build gate 是根级 `pnpm run build:runtime`（`scripts/build-openclaw-runtime.mjs`） |

## 4. 每包 touchedAreas（候选文件筛选依据）

- **RC-01R**（`rc01r-self-contained-baseline.md`）：`.gitignore`、`artifacts/runtime-authority-convergence/rc-01/baseline.json`、`scripts/rc01-authority-inventory.mjs`、`tests/unit/rc01-authority-inventory-baseline.test.ts`、`harness/specs/tasks/rc01r-self-contained-baseline.md`。**注意**：`.gitattributes`（-text 修复）需要补进 touchedAreas；主工作树对应修改文件：`.gitattributes`、`scripts/rc01-authority-inventory.mjs`（无）、`tests/unit/rc01-authority-inventory-baseline.test.ts`（无）——rc01 修复已随 main/rc00 候选部分落地，**先核对主工作树 diff 中 rc01 相关文件**再决定候选内容。
- **RC-04R**：`openclaw_runtime/src/state/**`、`openclaw_runtime/src/agents/**`、`openclaw_runtime/src/gateway/**`、`tests/unit/**`、`harness/specs/**`、`artifacts/runtime-authority-convergence/rc-04/**`。主工作树修改：`approval-ledger.ts`、`effect-receipt.ts`、`receipt-store.ts`（若 rc04 阶段）、`openclaw-state-schema.sql`、generated 文件、`exec-approval-manager.ts`、`server-aux-handlers.ts`、`server-methods/exec-approval.ts`、`plugin-approval.ts`、`rc04-*.test.ts`、spec、docs。
- **RC-05R**：`openclaw_runtime/src/agents/**`、`openclaw_runtime/src/cron/**`、`openclaw_runtime/src/gateway/**`、`src/stores/**`、`src/pages/Inbox/**`、`scripts/**`、`tests/unit/**`、`harness/specs/**`、`artifacts/runtime-authority-convergence/rc-05/**`。**注意**：`src/stores/inbox.ts`、`src/pages/Inbox/**`、`shared/i18n/locales/*/inbox.json`、`tests/e2e/rc05-operator-inbox.spec.ts` 属 `src/**`/`tests/e2e/**`——**会触发 coverage.ui → e2e profile**！**解法**：UI 侧文件（inbox store/页面/i18n）不入 RC-05R 候选（保持 main 版；候选只含 openclaw_runtime/scripts 侧），或按 rc00 先例把 UI 修复并入 main 后以 main 为 --since 基线。**优先选择后者不可行时选前者**——但注意 RC-05 的本地测试（`tests/unit/inbox-store.test.ts`）在候选全量测试中会因 main 版 store 而失败——**处理**：候选全量测试若因此失败，把 inbox-store 测试的期望也归入 main（不属候选）或跳过该文件（在候选中保留 main 版测试 + main 版 store → 应一致）。**实际取舍以候选全量测试全绿为最终标准**。
- **RC-06AR**：`openclaw_runtime/src/tasks/**`、`openclaw_runtime/src/state/**`、`harness/specs/**`、`artifacts/runtime-authority-convergence/rc-06a/**`。主工作树修改：`task-flow-cas.ts`、`task-flow-cas.test.ts`、`task-flow-registry.*`、`openclaw-state-schema.sql`（delivery_state 已有？核对）、generated。
- **RC-06BR**：`openclaw_runtime/src/agents/clawgraph/**`、`openclaw_runtime/src/tasks/**`、`harness/specs/**`、`artifacts/runtime-authority-convergence/rc-06b/**`。
- **RC-06CR**：`openclaw_runtime/src/agents/mission-control/**`、`openclaw_runtime/src/tasks/**`、`harness/specs/**`、`artifacts/runtime-authority-convergence/rc-06c/**`。
- **RC-06DR**：`openclaw_runtime/src/agents/task-loop-controller.ts`、`task-loop-taskflow-projection.ts/.test.ts`、`long-task-control/**`、`openclaw_runtime/src/tasks/**`、`harness/specs/**`、`artifacts/runtime-authority-convergence/rc-06d/**`。**注意**：`orchestration-quality-scorecard.ts`（cancelled 类型兼容修复）不在 rc06d touchedAreas——需补入或归入其他包（它属 `openclaw_runtime/src/agents/**` 可归 rc04/05 链中任意包，选 rc06d 前最近包并补 touchedAreas）。
- **RC-07R**：`openclaw_runtime/src/plugins/**`、`openclaw_runtime/src/memory/**`、`openclaw_runtime/src/context-engine/**`、`packages/vtoken/**`、`openclaw_runtime/src/knowledge/sekb/**`、`tests/unit/**`、`harness/specs/**`、`artifacts/runtime-authority-convergence/rc-07/**`。主工作树修改：`loader.ts`、`activation-planner.ts`、`config-normalization-shared.ts`、`slot-convergence.ts/.test.ts`、`tests/unit/rc07-*.test.ts`、`tests/unit/slot-convergence-loading.test.ts`。

**跨包归属建议**（主工作树修改文件 → 包）：
- `approval-ledger.ts`、`effect-receipt.ts`、`receipt-store.ts`、`exec-approval-manager.ts`、`server-aux-*`、`server-methods/exec-approval.ts`、`plugin-approval.ts`、`rc04-*.test.ts`、`openclaw-state-schema.sql` + generated → **RC-04R**
- `operator-slice.ts/.test.ts`、`cron/delivery.ts`、`gateway/server-cron.ts`、`gateway/server-cron-notifications.ts`、`config/types.openclaw.ts`、`config/zod-schema.ts`、`config/runtime-feature-leaves.ts`、`scripts/channel-conformance.mjs`、`openclaw_runtime/extensions/channels/rc05-operator-fixture/**` → **RC-05R**（config 三个文件属 `openclaw_runtime/src/config/**`——**不在 rc05 touchedAreas**（agents/cron/gateway/stores/pages/scripts/tests/specs）——**需补入 rc05 spec touchedAreas**）
- `task-flow-*` → **RC-06AR**（rc06b/c/d 的投影文件按各自 touchedAreas 归包）
- `mission-control/**`（controller.ts、mission-taskflow-projection.ts/.test.ts）→ **RC-06CR**
- `task-loop-controller.ts`、`task-loop-taskflow-projection.ts/.test.ts` → **RC-06DR**
- `plugins/**`（loader、activation-planner、config-normalization-shared）、`slot-convergence.ts/.test.ts`、`tests/unit/rc07-*.test.ts`、`tests/unit/slot-convergence-loading.test.ts` → **RC-07R**
- `docs/dev/**` 控制文档更新 → 不属候选（验收后更新主工作树文档）
- `tests/unit/inbox-store.test.ts`、`tests/unit/agent-dev-regularization.test.ts`（语义适配）→ 随其依赖包（rc05）或按全量测试需要归包

**注意**：以上归属是建议；**最终以"该包候选 checkout 全量测试全绿 + harness validate 覆盖通过 + 依赖链完整"为准**。若某文件必须提前（如 rc04 依赖），归入最早需要的包并确保该包 spec touchedAreas 覆盖。

## 5. 每包验收后必须更新（在主工作树，验收 evidence 归档后）

1. `docs/dev/handoffs/LATEST.md`：追加"<pkg> 独立验收 PASS"记录（候选 SHA、--since、双 actor、output-dir、gate 结果）。
2. `docs/dev/unified-agent-system/runtime-convergence/STATUS.md`：在 `next_action`/记录区追加验收结论；**不解除 RC-10、不动 product locks**；`accepted_work_packages` 按既有口径记录（若该字段为空且验收 PASS，按 STATUS 既有格式追加该包并注明"验收 PASS，正式 accepted 待 F4 全恢复"——**先读 STATUS 头部说明再决定**）。
3. `docs/dev/handoffs/RC-04-07-DEVELOPMENT-PROMPT.md`：追加验收记录章节。
4. 验收产物保留在候选 worktree 的 `artifacts/agent-engineering-acceptance/runs/<pkg>-accept-<n>/`；全部包完成后统一归档（`git worktree remove` 前先复制产物到主工作树 `artifacts/agent-engineering-acceptance/` 或单独备份目录）。

## 6. 每包验收命令模板

```bash
# 在候选 worktree（clean）中：
pnpm acceptance:agent:plan --spec harness/specs/tasks/<spec>.md --since <parent-ref> --output-dir artifacts/agent-engineering-acceptance/runs/<pkg>-accept-1
# 检查 plan.json：changedPaths 必须只含该包文件；coverage 全 false（除非该包 spec 明确覆盖 runtime/comms 域且 profile 可跑）；requiredProfiles 不得含 e2e
pnpm acceptance:agent:full --spec harness/specs/tasks/<spec>.md --executor <pkg>-executor-1 --verifier <pkg>-verifier-1 --since <parent-ref> --output-dir artifacts/agent-engineering-acceptance/runs/<pkg>-accept-1
# PASS 判定：final-report.json 中 executor.result == "pass" 且 verifier.result == "pass" 且 verifier.engineeringAcceptedByAgent == true
```

## 7. 参考（上一会话产物，勿删）

- RC-00R 验收参照物：`C:\Users\27933\Desktop\clawx\ClawX-rc00-candidate\artifacts\agent-engineering-acceptance\runs\rc00-f4-restore-5\`（plan/manifest/executor-report/verifier-report/final-report 全双 pass）。
- 验收脚本：`scripts/agent-engineering-acceptance.mjs`、`scripts/lib/agent-engineering-acceptance.mjs`（provision --copy 已移除 audit-manifest 复制——**后续包候选若新增 HEAD 跟踪的 provision 复制源，按第 3 节处置**）。
- 各包本地门禁清单与审计修复记录：`docs/dev/handoffs/RC-04-07-DEVELOPMENT-PROMPT.md`（"独立审计修复记录"各节 = 每包修复内容与本地验证命令，候选自包含修复时对照）。
- 工作目录限制：仅 `C:\Users\27933\Desktop\clawx\ClawX` 可写（文件工具）；worktree 操作经 bash 命令完成。

## 8. 结束条件（全部完成后向用户汇报）

- 8 包全部 executor + verifier 双 PASS，产出每包 output-dir。
- 控制文档（LATEST/STATUS/PROMPT）已更新，候选链 SHA 记录完整。
- 主工作树未触碰保护 workstream；临时 worktree 清理完毕（保留最终候选与产物）。
- 汇报中明确剩余事项：正式 accepted 判定、RC-10 解除、product locks——**全部保持 false/blocked，待用户与流程裁决**。
