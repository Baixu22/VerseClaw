# Stage 3 独立验收提示词

> 验收对象：Context Control Plane Stage 3（Task Ledger proposal/accept/reject + Working Context 物化投影 + fork/handoff merge）。
> 本提示词供独立 verifier 在**新会话 / 新 actor** 中执行；执行 agent 与开发 agent 不得为同一角色。
> 验收范围只读；发现缺陷时停止并记录，不自行修生产代码，除非 owner 另行授权修复切片。

## 0. 前置事实

- 分支：`codex/context-control-plane-stage0`
- 基线 HEAD：`f55201b22630d5c904f3105b2a9c8876ea5e889b`
- 工作树：`D:\verse_claw_worktree`
- Stage 0 / 1 / 2 已 `accept`；Stage 2 密钥残留已清理。
- Stage 3 `ownerDecisions` 已固定 Q1–Q7，见
  `harness/specs/tasks/context-control-plane-stage3.md` frontmatter。
- Q7 真实证据：`artifacts/context-control-plane/stage3-real-run-evidence.json`。

## 1. 必读材料

1. `AGENTS.md`
2. `docs/dev/context-control-plane/DEVELOPMENT-CONSTRAINTS.zh-CN.md`
3. `docs/dev/context-control-plane/STAGE3-DEV-PROMPT.zh-CN.md`
4. `harness/specs/tasks/context-control-plane-stage3.md`
5. `docs/dev/context-control-plane/DEVLOG.zh-CN.md`
   （重点：Stage 3 spec 创建切片、生产实现切片、Q7 402 尝试与最终 PASS 切片）
6. `docs/dev/context-control-plane/STAGE-ROADMAP.zh-CN.md`
7. Stage 0 D1–D4 与 Stage 1/2 正式 spec
8. `artifacts/context-control-plane/stage3-real-run-evidence.json`

## 2. 只读代码核对

- `shared/types/task-ledger.ts`：只新增 3 个事件类型与 Working Context 契约，不破坏既有 node/edge/session 类型。
- `shared/task-ledger-working-context.ts`：构造器/校验/投影/merge 为纯函数；投影不得调用 `Date.now()`/`new Date()`/`Math.random()`。
- `electron/services/task-ledger-working-context.ts`：只复用 `appendTaskLedgerEvents` / `readTaskLedgerEvents`。
- `openclaw_runtime/src/agents/long-task-control/task-ledger.ts`：仅扩展本地事件 union 与 payload 字段；`appendLongTaskLedgerEvents` 幂等与文件路径未变；`readLongTaskLedgerRevision` 公式未变。
- `openclaw_runtime/src/agents/long-task-control/stage3-working-context.ts`：默认 off，显式 `OPENCLAW_STAGE3_TASK_LEDGER_WC=1` 才写。
- `openclaw_runtime/src/agents/long-task-control/stage3-golden-run.ts`：显式调用，复用 Stage 1/2 真实 DeepSeek write 链。
- 禁止被改：`electron/services/task-ledger-api.ts`、`openclaw_runtime/src/agents/long-task-control/store.ts`、`openclaw_runtime/src/context-engine/stage2-context-refs.ts`。

## 3. 复跑命令（全部原样执行）

```bash
git branch --show-current
git rev-parse HEAD
git status --short

pnpm harness context --spec harness/specs/tasks/context-control-plane-stage3.md
pnpm harness validate --spec harness/specs/tasks/context-control-plane-stage3.md
pnpm harness context --spec harness/specs/tasks/context-control-plane-stage2.md
pnpm harness validate --spec harness/specs/tasks/context-control-plane-stage2.md

pnpm exec vitest run tests/unit/context-control-plane-stage3-contracts.test.ts tests/unit/task-ledger-service.test.ts tests/unit/task-ledger-reference.test.ts --reporter=verbose
pnpm --dir openclaw_runtime exec vitest run --config test/vitest/vitest.agents.config.ts src/agents/long-task-control/stage3-working-context.test.ts --reporter=verbose
pnpm --dir openclaw_runtime exec vitest run --config test/vitest/vitest.agents.config.ts src/agents/long-task-control/stage3-golden-run.test.ts --reporter=verbose
pnpm --dir openclaw_runtime exec vitest run src/context-engine/stage2-dcs.test.ts --reporter=verbose
pnpm contract:check
pnpm run typecheck
pnpm run lint:check
git diff --check
```

golden-run 真实用例在当前环境无 `DEEPSEEK_API_KEY` 时应显示 skipped；**验收员不得自行检索、读取或持久化任何 key**。若 owner 提供一次性临时 key，只允许以单次命令前缀注入子进程，验收后立即复核销毁状态。

## 4. L1–L12 判定表

| 编号 | 判定标准 | 通过证据 |
|---|---|---|
| L1 | 只有 `working_context_proposed` 可引入 Working Context 值；写入走既有 JSONL appender；无新表/列 | root contracts + runtime adapter 测试 |
| L2 | accept/reject 记录 actor/proposalId/field/version/policyDigest/rejectionReason；重复 accept fail-closed 可查询 | contracts negative tests |
| L3 | 同一事件序列重建投影 deep-equal；投影代码无随机、无 wall-clock | contracts replay + 源码扫描 |
| L4 | `projectTaskLedgerSnapshot` 忽略 Stage 3 事件；`readLongTaskLedgerRevision` 公式不变 | legacy projection 测试 + runtime revision 测试 |
| L5 | 同 actor 后到替代先到；跨 actor 冲突保留 proposalId/source/version | contracts conflict 测试 |
| L6 | 过期 proposal 不可 accept；保留 expired 查询，退出 current/pending | contracts expired 测试 |
| L7 | merge 只复制 `copyFields`；parent/child 冲突双方保留 | contracts merge 测试 |
| L8 | 候选只来自 accepted；无 Memory import/write；marker=`MemPromotionCandidate/v1` | contracts candidate 测试 + 源码扫描 |
| L9 | resolver 默认 false；flag off 零 Stage 3 JSONL I/O | runtime off-parity 测试 |
| L10 | payload 拒绝超长/密钥样值/raw 内容；Evidence 只存 bounded ref | contracts raw-content 测试 |
| L11 | 非法事件/缺 actor/缺 policyDigest/缺 proposal/版本错配/重复 accept/过期 accept 均 fail-closed | contracts malformed 测试 |
| L12 | 全部门禁通过；DEVLOG 完整；无 commit/push/PR | 命令原始输出 + git 状态 |

## 5. Q7 真实证据核对

- 文件存在：`artifacts/context-control-plane/stage3-real-run-evidence.json`。
- `schema=Stage3RealRunEvidence/v1`、`model=deepseek/deepseek-v4-flash`。
- `revisionBefore.eventCount >= 2`，`revisionAfter.eventCount == revisionBefore.eventCount + 2`。
- `stage2.toolCallId / approvalId / effectReceiptId / envelopeDigest / wireDigest` 均非空。
- 证据文件不得包含 `sk-` 密钥、prompt 原文、工具参数、工具输出。
- 对工作树全量精确扫描：任何真实 key 命中都必须判 `blocked`。

## 6. 产品锁与卫生

- `defaultOn=false`、`liveReady=false`、`productApproved=false` 全程不变。
- `DEEPSEEK_API_KEY` 在 Process / User / Machine 均应为 absent。
- 不 commit、不 push、不建 PR。

## 7. 判定与输出

判定词只允许：

```text
accept / accept-with-findings / blocked
```

- `accept`：上述全部通过，剩余问题为空。
- `accept-with-findings`：全部硬门禁通过，仅存在不改变 Stage 3 语义的既有观察项。
- `blocked`：任一 L1–L12 硬门禁失败、真实证据造假/缺失、密钥残留命中、默认值/产品锁被翻、或发现范围外生产改动。

输出必须写入 DEVLOG，并包含：
HEAD SHA、dirty patch 摘要、每类命令 exit code 与关键输出、L1–L12 逐项判定、
Q7 证据逐字段结论、密钥残留复核、产品锁复核、最终 verdict。
