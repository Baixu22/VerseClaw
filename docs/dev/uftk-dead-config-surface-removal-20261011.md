# `runtime.coding.uftk` 死配置面移除（issue #95 收口）

Date: 2026-10-11 (agent-driven)
Baseline: private `main` = `727743df2`（本 issue 的父批次 #75/#96/#97 已在其中）
Owner issue: Baixu22/VerseClaw#95（P1）
driven_by: agent — 无真人操作或真人数据；文中所有数字均由本 checkout 实跑得到。

## 1. 决策：删除配置面，而不是接线

issue #95 给出二选一：把实现改为读取 `runtime.coding.uftk`，或把该子树从类型 /
zod-schema / `RUNTIME_FEATURE_EXHAUSTIVE` / UI 标签中移除。**本变更选择移除**，依据如下。

### 1.1 该子树确实没有任何读者（实测，不是引用 issue）

| 事实 | 证据 |
|---|---|
| `uftk` 在全仓库只出现在 4 个文件（3 个声明面 + 1 个测试） | `git grep -i uftk`（改动前） |
| 唯一通用 coding 叶子读取器只有 3 个调用点，且都不传 uftk 键 | `openclaw_runtime/src/context-engine/coding-runtime-flags.ts:71-80`、`:103`、`:115`、`:127` |
| issue 点名的"实现存在但脱钩"三个文件都不读配置 | `infra/exec-approvals-allowlist.ts`（无 `config`/`cfg`/`runtime.` 读取）、`agents/checkpoint-rollback-executor.ts`（靠注入 options，头注自述不是新的 git 事务）、`agents/tools/write-journal.ts`（只读注入的 `options.enabled` 与 env） |
| 两个同名"假消费者"已排除 | `infra/sqlite-wal.ts:23,43-54` 的 `autoCheckpointPages` 是 SQLite pragma；`extensions/codex/src/app-server/approval-bridge.ts:233,669` 的 `commandApprovalDecision()` 是吃 requestParams 的局部函数 |

因此实测是 **12/12 开关（19 个叶子路径）零消费**，而不是 issue 写的 9/12 —— issue 的
数字是低估；连总开关 `uftk.enabled` 自身也没有读者。

### 1.2 为什么不选"接线"

- `uftk.commandApproval` 若要生效，需要在既有 exec 审批管线之外再造一套审批决策来源。
  而 coding-runtime 契约明确禁止这件事：写路径「must never spawn directly or construct a
  second approval, sandbox, or timeout plane」（见 `coding-runtime-flags.ts` 的既有注释）。
  造第二套审批面是**产品安全边界**问题，不是接线工作量问题。
- 其余门面对应的能力**已经**由别的配置入口驱动：`coding.writeJournal`、`coding.parseOnTouch`、
  `coding.staleWriteGuard`，以及 exec 审批管线自身。把它们再挂一份 uftk 开关只会制造
  第二真相来源。

结论：这些叶子属于「声明的承诺没人兑现」，删除是对运维最诚实的处理。

## 2. 删除的兼容性约束（本变更的关键风险点）

严格 zod schema 会拒绝未知键，而**安装态的 workspace 配置里仍然带着整块 uftk**
（`~/.openclaw/openclaw.json` 的 `runtime.coding.uftk`，14 个叶，含
`autoCheckpoint.allowWorkspaceRoots: ["D:\\ClawX-UFTK-Pilot"]`）。因此"直接删除"
会让配置校验失败、gateway 子进程 exit code=1 —— 正是 FP-P0-02 那类
「改了配置面就把 gateway 打死」的缺陷（`runtime-feature-leaves.ts` 头注与
`tests/unit/config-schema-parity.test.ts` 都是为它存在的）。

本变更沿用仓库**已有的**兼容通道，而不是新造机制：

```ts
// openclaw_runtime/src/config/validation.ts
function stripDeprecatedValidationKeys(raw: unknown): unknown { ... }
// 校验前剥离已移除的键；既有先例：commands.modelsWrite
// 新增：runtime.coding.uftk
```

`validateConfigObjectRaw()` 在 `OpenClawSchema.safeParse()` **之前**调用它
（`validation.ts:888-893`），所以：

- 旧配置文件继续可用，死子树被**静默丢弃**（不报错、不影响其它叶子）；
- 未登记的新键仍会被严格 schema 拒绝（不放松 `strict()`）。

这一取舍与既有先例一致：`runtime.coding.factViews` 当年是按"从 schema 移除 + 在生产
catalog 里写明迁移"处理的，`commands.modelsWrite` 也是先例；本变更选择更安全的
"剥离而非仅提示"，因为它不需要运维先手改文件。

## 3. 变更清单

| 文件 | 变更 |
|---|---|
| `openclaw_runtime/src/config/types.openclaw.ts` | 删除 `coding.uftk?` 类型块，留注释说明移除原因与兼容通道 |
| `openclaw_runtime/src/config/zod-schema.ts` | 删除 `coding.uftk` 严格 schema 块 |
| `openclaw_runtime/src/config/runtime-feature-leaves.ts` | 删除 `uftk` 取样块（连带移除样例里的本机路径 `D:/ClawX`，见 §6） |
| `openclaw_runtime/src/config/validation.ts` | `stripDeprecatedValidationKeys` 增加 `runtime.coding.uftk` 剥离 + 说明注释 |
| `openclaw_runtime/src/config/runtime-coding-uftk.test.ts` | 从"接受 uftk 块"改写为「移除 + 兼容」覆盖（5 例） |
| `scripts/check-feature-leaf-consumers.mjs` | baseline 从 19 条降到 2 条（不再固定任何 uftk 叶子），头注更新 |
| `tests/unit/feature-leaf-consumers.test.ts` | 新增回归断言：`coding.uftk.*` 不得重新出现在叶子树中；baseline 断言改为"不得再出现 uftk" |
| `harness/specs/rules/runtime-feature-leaf-consumers.md` | 把 uftk 记为"历史样例、已由 #95 移除"，`pathPatterns` 增加 `validation.ts` |
| `harness/specs/tasks/p1-uftk-dead-config-surface-removal-20261011.md` | 本变更的任务 spec |

**未改**：`schema.labels.ts` / `schema.help.ts`（两者本来就没有 uftk 条目 —— issue 所说
"UI 标签一应俱全"不成立），因此没有 UI / i18n / E2E 面变化；产品默认值、功能开关、
权限默认、冻结锁、发布状态均未触碰。

## 4. 验证（agent 驱动，全部在候选 worktree 内实跑）

| 门禁 | 结果 |
|---|---|
| `node scripts/run-vitest.mjs run --config test/vitest/vitest.runtime-config.config.ts`（openclaw_runtime） | 9 文件 / 30 用例通过，含改写后的 uftk 用例 |
| `tests/unit/config-schema-parity.test.ts`（三个方向 + 严格性硬锁） | 120 passed（叶子数随 19 条移除而下降，断言仍全绿） |
| `tests/unit/feature-leaf-consumers.test.ts` | 10 passed |
| `node scripts/check-feature-leaf-consumers.mjs` | 110 叶子（原 129，−19）/ 2 pinned，OK |
| `node scripts/check-feature-leaf-consumers.mjs --self-test` | PASS 3/3 |
| 兼容性用例（改写后的 uftk 测试） | 旧配置（完整 uftk 块 + 块内未知键）仍 `ok: true`，返回配置中无 `uftk`；`commands.modelsWrite` 剥离保持；真正未知的 coding 叶子仍被拒 |

## 4.5 顺带修复：生成态基线未被忽略 + 配置面哈希基线更新

- 删除配置面后，仓库自身的 `config:docs:check`
  （`openclaw_runtime/scripts/generate-config-doc-baseline.ts --check`）必然报
  `Config baseline drift detected`，并提示运行 `config:docs:gen` 后提交更新后的哈希文件。
  已按该流程重建：`openclaw_runtime/docs/.generated/config-baseline.sha256` 中
  `config-baseline.json` / `.core.json` / `.plugin.json` 三行哈希更新，`.channel.json` 未变
  （配置面变更本就只影响 runtime/core/plugin 范围）。
- 同一脚本把 4 个 per-scope JSON 基线写成「gitignored, local only」，但实际上仓库里
  **只有 `.sha256` 被跟踪**，而 JSON 既未跟踪、**也未被忽略**（`git check-ignore` 无命中）——
  生成器自己的提示与实际不符，`git add -A` 会误把它们提交进仓库。
  本变更把 `/openclaw_runtime/docs/.generated/*.json` 加入 `.gitignore` 并注明原因，
  让生成器的声明成立，也避免下一位接力者重犯。

## 5. 残留与边界

1. **不修改所有者的线上配置文件**。`~/.openclaw/openclaw.json` 里的 uftk 块现在被
   校验前剥离，因此**不影响启动**；是否物理清理该文件属于所有者机器状态，agent 未代改。
   若要清理，可手工删除 `runtime.coding.uftk` 一节（删除后行为完全不变，因为它本来无效）。
2. **没有 doctor 迁移条目**。当前实现是"静默剥离"：没有 doctor 规则把它报告为可清理项，
   也没有在日志里提示。若后续希望显式提示，可在 doctor 的 legacy 规则里加一条 —— 属于
   独立的小任务，不在本变更内。
3. **历史证据不动**。`artifacts/system-maturity/P6-005/release-source-manifest.json` 里仍记录
   被改文件的旧 sha256/行号；该 manifest 由发布基线在打 tag 时重新采集，且没有任何 PR
   门禁校验它（只有机制单测），故按既有先例（"配置项只声明不重写"）保持原样并在此披露。
4. **未跑**：全量单测、`pnpm run harness:ci` 整体、Electron E2E、打包、跨平台；未实跑
   gateway 启动端到端（兼容性由 `validateConfigObjectRaw` 的返回值与单测证明，不是进程级实测）。
5. `runtime-coding-uftk.test.ts` 文件名保留（虽然现在测的是移除），以保持
   release-source-manifest 等历史清单里的路径引用不失效；改名为独立小任务。
