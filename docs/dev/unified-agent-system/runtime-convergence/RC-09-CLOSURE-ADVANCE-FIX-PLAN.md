# RC-09 收口前进修复计划（TF-0041）

> 状态：Phase A 已完成（2026-09-29，Kiro）；Phase B–D 待执行。本计划只包含**一个修复**；实现、测试、跑验收由执行者按 §6 完成。
>
> Phase A 结果：
> - 在 `acceptance` 与 control-pack 两个单测文件的 73 个用例中，新增 3 个 closure-advance 用例（§4 的 10 个场景）全绿；已有用例断言未改、全绿。
> - `eslint`、`typecheck` 均 exit 0。
> - `harness validate --since HEAD` 不拒绝 `closureAdvance` 键。当时唯一的错误是共享树里别的会话未提交的 `tests/integration/channel-startup.integration.test.ts`，与本修复无关。
> - §6 第 5 步冒烟：用旧证据跑，validator 按预期 FAILED（exit 1，22s）。报出 `candidate spec declares no closureAdvance.allowedPaths`、4 个冻结输入被改，以及 `electron/gateway/config-sync.ts`、`supervisor.ts`、`channel-config.ts` 等产品文件被改；validator 自己的 worktree 无残留。另外报 log unavailable，原因是精简归档不含 logs，与 LATEST.md:69 的记录一致。
> - `runAcceptance`、`verifyAcceptance`、`validateAcceptanceManifest`、`createAcceptancePlan` 未改动。
> - 未做：LATEST.md 与 deviation ledger 的条目。这两个文件当时有别的会话未提交的改动，本修复不混提；留给 Phase B 冻结后与其它收口改动一起落库。

## 0. 问题

`scripts/validate-runtime-authority-convergence.mjs` 要求调用方工作区 `HEAD == candidate`：一处在 `:178-182`，另一处在它调用的 `validateAcceptanceManifest(..., { root, requireClean: true })` 里（`scripts/lib/agent-engineering-acceptance.mjs:946-949`）。收口本身必须提交（STATUS、归档、canonical pair、task-forest），所以收口一落库，validator 就无法复现，只能"先验后收、不可复验"（`docs/dev/handoffs/LATEST.md:67-69`）。

**不修**的部分：候选之后出现产品改动时作废证据。这个行为是对的。`93b876df1` / `bd42f81c3` 是真实的 channel 修复（`electron/gateway/config-sync.ts`、`supervisor.ts`、`channel-config.ts`、`openclaw_runtime/.../server-startup-post-attach.ts`），旧候选 `ae489d4a5` 确实不能再用。

## 1. 修复目标

让 validator 接受 `HEAD = candidate + 只触碰收口路径的后继提交`，而且比现在更严：

- 所有候选相关检查都改在 candidate 的 detached worktree 上执行；
- 新增一条 fail-closed 检查：`candidate → 调用方工作树` 的每一条变化路径都必须落在**候选 spec 自身声明**的收口白名单内，且不能是冻结输入，也不能是代码文件。

候选之后任何产品、测试、脚本、spec 或锁定输入的改动，仍然会作废候选。

不在本修复范围内（不要做）：

- 不改 `runAcceptance` / `verifyAcceptance` / `validateAcceptanceManifest` / `createAcceptancePlan`。executor 运行时要求 HEAD==candidate 是正确的。
- 不改 Playwright 重试、`CI` 变量或 E2E 门口径。这些另议，需要所有者决定。
- 不改产品代码、产品锁、归属矩阵生成器。

## 2. 改动 A：validator（`scripts/validate-runtime-authority-convergence.mjs`）

### 2.1 候选视图 `openCandidateView(root, manifest, errors)`

从 `./lib/agent-engineering-acceptance.mjs` 导入已导出的 `createDetachedWorktree`、`repositoryIdentity`。

- **快路径**：`repositoryIdentity(root)` 的 `commit`、`tree` 都等于 manifest candidate，且 `clean === true` 时，返回 `{ candidateRoot: root, advanced: false, cleanup() {} }`。行为与现状完全一致，现有单测全部走这条路径。
- **前进路径**：`createDetachedWorktree(root, { commit: manifest.candidate.commit })`，调用方必须在 `finally` 里 `cleanup()`，出错路径也要清理。
  - 对 `manifest.source.provisionCopies` 的每一项：若该路径在 candidate 中**未被跟踪**（`git cat-file -e <candidate>:<path>` 失败），就从调用方 `root` 读取，校验 `sha256` 和 `bytes` 与 manifest 一致后再复制进 worktree，复制后再校验一次。任何不一致都 `errors.push('closure advance: provision copy digest mismatch: <path>')` 并返回失败。已跟踪的项不复制，worktree 里本来就有。当前 RC-09 需要复制的两项是 `artifacts/uas-06-single-local-exec-canary/live-observations.json` 和 `artifacts/unified-agent-system/TF-0011/audit-manifest.json`。
  - 复制后 `repositoryIdentity(worktree).clean` 必须为 true。若为 false，说明某个复制项没有被 gitignore，fail-closed：`closure advance: provisioned input is not ignored in the candidate: <path>`。
  - 返回 `{ candidateRoot: worktree.path, advanced: true, cleanup }`。
- 不要在 worktree 里装依赖，也不要 symlink `node_modules`。validator 只需要 git 和文件读取。

### 2.2 根目录分流（`validateRuntimeAuthorityConvergence`，现在在 `:504-551`）

- 证据文件（`manifestPath`、`engineeringReportPath`、`humanVerdictPath`）仍从调用方 `root` 解析。它们是收口产物，完整性由既有的 digest 链保证，路径本身受 §2.3 白名单约束。
- `baselinePath` 改为从 `candidateRoot` 解析（它属于冻结输入）。
- 以下调用中的 `root` 全部改成 `candidateRoot`：`validateAcceptanceManifest`、`validateBaseline`、`validateCandidateTree`、`validateChangedPaths`、`validateOwnershipMatrix`（包括它内部的 `requiredOwnerSet`）、`validateSourceIdentity`。`validateCandidateTree` 不用改，在 `candidateRoot` 上天然成立。
- 在 `validateCandidateTree` 之后插入 `if (view.advanced) validateClosureAdvance(root, candidateRoot, manifest, errors)`。

### 2.3 `validateClosureAdvance(root, candidateRoot, manifest, errors)`

按顺序检查。每一项失败都 push 错误，不提前 return（除非后续无法计算）。错误前缀统一为 `closure advance: `。

1. **祖先关系**：`git merge-base --is-ancestor <candidate> HEAD`（在 `root` 执行）。失败时报 `candidate is not an ancestor of HEAD`。这一条同时覆盖 branch ref 被邻居 agent 回卷的情况（见记忆 `clawx-branch-ref-rewind-hazard`）。
2. **白名单来源**：从 `candidateRoot` 下的 `harness/specs/tasks/runtime-authority-convergence-final-acceptance.md` 读 frontmatter 的 `closureAdvance.allowedPaths`。**必须读候选版本，不能读 HEAD 版本**，否则收口提交可以自己放宽白名单。缺失或为空时报 `candidate spec declares no closureAdvance.allowedPaths`。
3. **白名单语法**：每一项必须是精确的仓库相对路径，或 `<dir>/**`。出现任何其它 `*`、`?`、`[`、`{`、前导 `/`、盘符或 `..`，报 `malformed allowedPaths entry: <entry>`。不引入 glob 依赖，仓库里本来就没有。匹配规则：精确项要求 `p === entry`；`dir/**` 项要求 `p.startsWith(dir + '/')`。
4. **冻结集合 F**（硬编码部分加 manifest 派生部分，允许重复）：
   - `manifest.source.files[].path`（spec、三条 rule、`package.json`、`pnpm-lock.yaml`、`.npmrc`、`harness/src/profiles.mjs`）；
   - `manifest.source.provisionCopies[].path`（包含 `changed-path-ownership.json`）；
   - `artifacts/runtime-authority-convergence/rc-01/baseline.json`；
   - `scripts/validate-runtime-authority-convergence.mjs`、`scripts/lib/agent-engineering-acceptance.mjs`。
   - 自检：白名单任一项覆盖 F 中任一路径，报 `allowedPaths entry covers frozen input: <entry> -> <path>`。
5. **变化集合 P**：`git diff --name-only -z <candidate>`（在 `root` 执行，不带第二个 ref，也就是 candidate 对比调用方工作树，已提交和未提交的 tracked 改动都算），并上 `git ls-files --others --exclude-standard -z`。然后用 `normalizedPath` 归一化。**不要求**调用方工作树干净，共享树经常被邻居写脏，但每一条脏路径都要过第 6 步。
6. 对每个 `p ∈ P`：
   - `p ∈ F` → `frozen input changed after candidate: <p>`
   - 扩展名属于 `.mjs .js .cjs .ts .tsx .mts .cts .sh .ps1 .py` → `code file changed after candidate: <p>`。在白名单目录内也一样。例如 `artifacts/runtime-authority-convergence/rc-10/driver.mjs` 是候选产物，不是证据。
   - 不被任何白名单项覆盖 → `non-closure path changed after candidate: <p>`
7. `P` 为空而 HEAD≠candidate（空提交）时允许通过。

为什么比现在严：现在只能在 HEAD 恰好等于候选的那一刻验证。改完后可以在候选之后任意时刻重放，并且逐路径证明候选之后没有任何产品、测试、脚本、spec 或锁定输入变化。validator 自身在 F 里，所以它被篡改会表现为 `git diff <candidate> -- scripts/ harness/` 非空。runbook 要求审计者先看这条（§5）。

## 3. 改动 B：spec（`harness/specs/tasks/runtime-authority-convergence-final-acceptance.md`）

在 frontmatter 的 `cumulativeOwnership` 之后加：

```yaml
closureAdvance:
  # Paths a closure commit may touch after the candidate. Read from the
  # CANDIDATE's copy of this spec, never from HEAD. Exact paths or <dir>/** only.
  allowedPaths:
    - docs/dev/unified-agent-system/runtime-convergence/STATUS.md
    - docs/dev/handoffs/LATEST.md
    - .agent-workbench/task-forest/**
    - artifacts/agent-engineering-acceptance/runtime-authority-convergence-final/manifest.json
    - artifacts/agent-engineering-acceptance/runtime-authority-convergence-final/final-report.json
    - artifacts/runtime-authority-convergence/rc-09/**
    - artifacts/runtime-authority-convergence/rc-10/acceptance/**
```

这些路径来自历史收口提交实际碰过的范围：`100d7bc43` 碰了 STATUS、LATEST、task-forest、`rc-09/acceptance`；`97985461f` 碰了 canonical pair。另外加上 RC-10 的正式证据目录。刻意**不包含**以下几类：

- `changed-path-ownership.json`：矩阵只需覆盖 `base..candidate`，收口后不再重生成。这也消掉了 LATEST.md:68 记录的 `provision copy digest mismatch`。
- `rc-10/` 根目录和其它子目录：driver 脚本放在那里，属于候选产物。
- `WORK-PACKAGES.md` 等 runbook 文档：control pack 会断言它们的内容，改它们必须重新切候选。

同时：

- `acceptance:` 追加一条：`The engineering and human validators pass both at the candidate and at any descendant whose candidate→worktree diff touches only closureAdvance.allowedPaths; a frozen input, a code file, or any other path changed after the candidate fails closed.`
- `forbiddenPatterns:` 追加两条：`regenerating changed-path-ownership.json after the candidate`，`widening closureAdvance.allowedPaths after the candidate`。
- 正文加一个短节 `## Closure advance`，用三五句话说明上面的规则，以及冻结期（§6 Phase B）。
- 运行 `pnpm harness validate --spec harness/specs/tasks/runtime-authority-convergence-final-acceptance.md --since HEAD`（见记忆 `clawx-harness-validate-diff-base`）。如果 harness 因为未知 frontmatter 键报错，就**停下**，在 harness 的 frontmatter schema 里正式登记 `closureAdvance`，不要改名，也不要塞进其它键。

注意：spec 本身属于 F，所以这个改动必须在切新候选**之前**落地。

## 4. 改动 C：单测（`tests/unit/agent-engineering-acceptance.test.ts`）

- `createConvergenceFixture()`（`:185-213`）写 fixture spec 时，加入与 §3 同形的 `closureAdvance.allowedPaths`（最少包含 `docs/dev/unified-agent-system/runtime-convergence/STATUS.md`、`artifacts/runtime-authority-convergence/rc-09/**`、`artifacts/runtime-authority-convergence/rc-10/acceptance/**`）。这是纯增量，现有断言不变。
- 在 `'validates engineering and human convergence evidence…'`（`:1393`）之后新增一个 `it`，复用同样的 fixture 流程跑到 engineering PASS，记下 candidate `C`。每个场景都从 `C` 执行 `git checkout -q --detach C` 后再构造，互不污染。

| # | 构造 | 期望 |
|---|---|---|
| 1 | 不改动（HEAD==C，干净） | `ok: true`（快路径） |
| 2 | 提交改 STATUS.md，并新增 `rc-09/archive/x.json` | engineering 和 human phase 都 `ok: true` |
| 3 | 提交新增 `docs/other.md` | 含 `closure advance: non-closure path changed after candidate: docs/other.md` |
| 4 | 提交新增 `artifacts/runtime-authority-convergence/rc-10/acceptance/x.mjs` | 含 `code file changed after candidate` |
| 5 | 提交改 `changed-path-ownership.json` | 含 `frozen input changed after candidate` |
| 6 | 提交改 spec，把 `docs/**` 加进 allowedPaths，同时新增 `docs/other.md` | 同时含 `frozen input changed…` 和 `non-closure path…`（证明白名单读的是候选版本） |
| 7 | `git checkout --detach <C 的父提交>` 后在上面提交 STATUS 改动 | 含 `candidate is not an ancestor of HEAD` |
| 8 | 不提交，工作区直接新建未跟踪的 `docs/scratch.md` | 含 `non-closure path changed after candidate: docs/scratch.md` |
| 9 | fixture spec 不含 `closureAdvance`，然后做场景 2 的改动 | 含 `candidate spec declares no closureAdvance.allowedPaths` |
| 10 | fixture spec 含 `a/*.json` | 含 `malformed allowedPaths entry: a/*.json` |

每个前进路径场景结束后都断言 `git worktree list --porcelain` 只剩根 worktree，证明成功和失败路径都做了 cleanup。

场景 9 和 10 的 spec 必须在切 `C` 之前定型，所以要给 `createConvergenceFixture` 加一个可选参数 `closureAllowedPaths?: string[] | null`，单独建 fixture。

## 5. 改动 D：文档与账目

- `docs/dev/unified-agent-system/runtime-convergence/ACCEPTANCE.md` 的 validator 段（`:118` 附近）补三点：
  - validator 可以在 candidate 或其"只含收口路径"的后继上运行；
  - 收口后**必须重跑一次**，作为可复验证据；
  - 运行前先确认 `git diff <candidate> -- scripts/ harness/ package.json pnpm-lock.yaml` 为空。
- `docs/dev/handoffs/LATEST.md`：只在最新一节追加一条，说明 `:66-69` 的顺序约束已被本修复解除。不改历史段落。
- deviation ledger 追加一条：验收契约**收紧**（加了 closure-advance 白名单，不放宽任何门），引用本文件。使用 task-forest CLI 并带 UTF-8 环境（见记忆 `clawx-task-forest-conventions`）。
- README 三语不涉及这里的内部机制，不改。

## 6. 执行顺序

**Phase A：落地修复**（本计划唯一的代码改动）

1. 按 §2、§3、§4 实现。
2. 跑 `pnpm vitest run tests/unit/agent-engineering-acceptance.test.ts tests/unit/runtime-authority-convergence-control-pack.test.ts`，要求全绿。
3. 跑根目录 `pnpm run lint:check`（warning 上限 120）和 `pnpm run typecheck`。
4. 跑 `pnpm harness validate --spec harness/specs/tasks/runtime-authority-convergence-final-acceptance.md --since HEAD`。
5. 只读冒烟：拿已归档的旧证据 `artifacts/runtime-authority-convergence/rc-09/acceptance/{manifest.json,finalReport.json}` 跑 `--phase engineering`。期望 **FAILED**，错误里要有 `candidate spec declares no closureAdvance.allowedPaths`（旧候选的 spec 没有这个键），并且列出 `electron/gateway/config-sync.ts` 等产品路径。这证明旧候选不会被新规则意外放行。之后确认 `git worktree list` 没有残留。
6. 分三个提交，用 pathspec 限定范围：`fix(rc09): let the validator replay over closure-only descendants of the candidate`、`test(rc09): …`、`docs(rc09): …`。

**Phase B：冻结并切候选**

7. 在 STATUS `next_action` 和 LATEST.md 里写明：从现在到 RC-10 收口，本分支只接受 §3 白名单内的提交，其它工作走别的分支。
8. 预检：
   - 刷新 Agent Dev 证据：`pnpm agent-dev:workbench`、`pnpm agent-dev:deep-test`、`pnpm agent-dev:audit`，要求 strict exit 0；
   - 跑根目录 `lint:check`；
   - `git status --porcelain` 为空；
   - **验收期间任何 worktree 都不准跑 pnpm**（见记忆 `clawx-acceptance-pnpm-race`）。
9. 在 HEAD 用 `node scripts/generate-rc09-ownership-matrix.mjs --base 1cddcb1ba5e23ebe445afca11174c2575c75f735 --head HEAD --output …/changed-path-ownership.json` 重生成矩阵，并**只提交矩阵**。这个提交就是新候选 `C`。

**Phase C：RC-09 一轮**

10. 按 ACCEPTANCE.md 现有 runbook 执行：`env -u` 剥离凭据，然后 plan → Executor(`rc09-executor`) → 独立 Verifier(`rc09-verifier`) → validator（走快路径），期望 PASS。
    - 若 NO-GO **且仅因** `0xC0000409` 原生崩溃：run 目录是 ignored 的，不需要提交，同一个 `C` 直接重跑，最多 3 轮。
    - 若出现其它失败，或 3 轮仍失败：停下来写 handoff，**不改口径**。
11. 收口提交，只碰白名单：
    - 先把现有 `rc-09/acceptance/` 移到 `rc-09/accepted-20260927-ae489d4a5/`；
    - 再按 LATEST.md:55 的约定归档新一轮（5 个 JSON 加 SHA256SUMS）到 `rc-09/acceptance/`；
    - 把 canonical pair 提升到 final 目录；
    - STATUS 改为 `human_acceptance_pending` / `engineering_verdict: accepted`，`accepted_work_packages` 加入 RC-09，同时更新 LATEST.md 和 task-forest。
12. 在收口后的 HEAD 上**再跑一次** `--phase engineering`（走前进路径），期望 PASS。**这是本修复的真实验收证据**，写进 handoff，并引用 run 目录。

**Phase D：RC-10（同一个 `C`）**

13. 在 HEAD 跑 H-01..H-06 driver。HEAD 与 `C` 的产品树逐路径相同，由第 12 步证明。证据归档到 `rc-10/acceptance/`。`human-verdict.yaml` 写 `driven_by: agent`、`actor: <agent 名>`、`candidate_sha: C`，**永远不写 human**。
14. 跑 `--phase human`，PASS 后做收口提交，然后再跑一次 `--phase human` 确认 PASS。之后按 AGENTS.md §Task Forest closure policy 自动收口 TF-0041，并解除冻结。
15. 若任何 driver 或产品需要改代码：这就是新的候选改动，回到第 9 步。这是设计行为，不是修复失败。

## 7. 本修复的完成标准

- §4 场景表全绿；现有 `validateRuntimeAuthorityConvergence` 用例不改断言且全绿。
- §6 第 5 步冒烟按预期 FAILED，且没有残留 worktree。
- `runAcceptance` / `verifyAcceptance` / `validateAcceptanceManifest` / `createAcceptancePlan` 的 diff 为空。
- 白名单与 F 无交集（由第 4 步自检保证）。
- 最终证明是 §6 第 12 步。在此之前，只能说"已实现、单测通过、尚未在真实候选上验证"。

## 8. 停止条件（遇到就停，写 handoff，不要自行变通）

- 为了通过而需要把代码、spec、测试或 lockfile 加进白名单：说明需要重切候选，不是改白名单。
- harness 拒绝 `closureAdvance` 键：按 §3 在 schema 里登记，不绕过。
- detached worktree 需要 git/fs 以外的依赖才能跑 validator：停下报告，不要 symlink `node_modules`。
- provision copy 在 candidate 里没有被 ignore：停下报告具体路径。
- E2E 重试 / `CI=true` 不属于本修复。若 Phase C 因抖动 3 轮 NO-GO，把"验收 E2E 是否与项目 CI 同姿态（retries 2 + flaky 记账与阈值）"作为**唯一待决事项**交给所有者。
