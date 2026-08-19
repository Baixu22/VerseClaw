# Stage 4 独立验收提示词

> 验收对象：Context Control Plane Stage 4（统一 CapabilityGrant + Tool Guard + 子 agent 衰减授权）。
> 本提示词供独立 verifier 在**新会话 / 新 actor** 中执行；执行 agent 与开发 agent 不得为同一角色。
> 验收范围只读；发现缺陷时停止并记录，不自行修生产代码，除非 owner 另行授权修复切片。

## 0. 前置事实

- 分支：`codex/context-control-plane-stage0`
- 基线 HEAD：`f55201b22630d5c904f3105b2a9c8876ea5e889b`
- 工作树：`D:\verse_claw_worktree`
- Stage 0 / 1 / 2 已 `accept`；Stage 3 已修复独立验收缺陷并解锁 Stage 4。
- Stage 4 无待裁决 Q 项；`ownerDecisions` D1–D4 已固定于
  `harness/specs/tasks/context-control-plane-stage4.md` frontmatter。
- Stage 4 不重复真实 provider run；真实 provider 证据仍由 Stage 1/2/3 证据链持有。

## 1. 必读材料

1. `AGENTS.md`
2. `docs/dev/context-control-plane/DEVELOPMENT-CONSTRAINTS.zh-CN.md`
3. `docs/dev/context-control-plane/STAGE4-DEV-PROMPT.zh-CN.md`
4. `harness/specs/tasks/context-control-plane-stage4.md`
5. `docs/dev/context-control-plane/DEVLOG.zh-CN.md`
   （重点：Stage 4 开发切片、Stage 3 验收缺陷修复切片）
6. `docs/dev/context-control-plane/STAGE-ROADMAP.zh-CN.md`
7. Stage 0 D2–D4 与 Stage 1/Stage 3 正式 spec
8. `shared/types/context-control-plane/artifacts.ts`（CapabilityGrant/v1 契约 owner）

## 2. 只读代码核对

- `openclaw_runtime/src/agents/stage4-capability-grant.ts`：
  - `deriveStage4CapabilityGrant` 只从 `execution_started` approval row 派生；不写库。
  - `verifyStage4CapabilityGrant` 为纯函数，验证 actor/scope/TTL/approval ref/governance/policy digest/effect idempotency/revocation/parent chain。
  - `revokeStage4CapabilityGrant` / `markStage4GrantExpired` / `recoverStage4GrantAfterRestart` 为纯函数。
  - `Stage4GrantAuditTrail` 为 in-memory append-only；`Stage4GrantAuthority.issue/verify/revoke/deny` 记录 policy digest 与 actor chain。
  - 子 agent 扩权反例必须在 derive/verify 中 fail-closed。
- `openclaw_runtime/src/agents/stage4-tool-guard.ts`：
  - 默认 off；默认只守卫 `write`；非 write 与 disabled 原样透传。
  - 复用现有 `ApprovalLedger` + `EffectReceiptStore` + `buildBlockedToolResult`。
  - 执行顺序：reserve -> resolve approved -> markExecutionStarted -> derive -> verify -> execute -> effect receipt -> recordEffectOutcome -> grant expire。
  - denied/expired/governance mismatch/revoked 必须不调用原 executor。
- `openclaw_runtime/src/agents/agent-tools.ts`：
  - 仅新增 `stage4ToolGuard` 可选接线；位于 policy pipeline 后、`before_tool_call` 前。
  - stage4 与 stage1 同时存在时 stage4 优先；都缺省时工具构造不变。
- 禁止被改：`approval-ledger.ts`、`effect-receipt.ts`、MCP/tool policy、`stage1-minimal-grant.ts`、`stage1-tool-guard.ts`。
- 未新增权限数据库、approval ledger、grant 表、durable grant store。

## 3. 复跑命令（全部原样执行）

```bash
git branch --show-current
git rev-parse HEAD
git status --short

pnpm harness context --spec harness/specs/tasks/context-control-plane-stage4.md
pnpm harness validate --spec harness/specs/tasks/context-control-plane-stage4.md
pnpm harness context --spec harness/specs/tasks/context-control-plane-stage3.md
pnpm harness validate --spec harness/specs/tasks/context-control-plane-stage3.md

pnpm exec vitest run tests/unit/context-control-plane-stage4-contracts.test.ts --reporter=verbose
pnpm --dir openclaw_runtime exec vitest run --config test/vitest/vitest.agents.config.ts src/agents/stage4-capability-grant.test.ts --reporter=verbose
pnpm --dir openclaw_runtime exec vitest run --config test/vitest/vitest.agents.config.ts src/agents/stage4-tool-guard.test.ts --reporter=verbose
pnpm exec vitest run tests/unit/context-control-plane-stage1-grant-tool-guard.test.ts tests/unit/context-control-plane-stage3-contracts.test.ts --reporter=verbose
pnpm --dir openclaw_runtime exec vitest run --config test/vitest/vitest.agents.config.ts src/agents/stage1-minimal-grant.test.ts src/agents/stage1-tool-guard.test.ts --reporter=verbose

pnpm contract:check
pnpm run typecheck
pnpm run lint:check
git diff --check
```

Stage 4 不要求真实 provider run；若 verifier 自行运行任何真实 provider 命令，必须遵守 owner 一次性临时 key 规则，且不得把 key 写入任何文件或环境变量持久化。

## 4. L1–L9 判定表

| 编号 | 判定标准 | 通过证据 |
|---|---|---|
| L1 | `deriveStage4CapabilityGrant` 只在 approval row 为 `execution_started` 且 `decision=approved` 时产出 schema-valid `CapabilityGrant/v1`；denied/expired/missing resolved_by/wildcard/invalid identity/scope 全部拒绝且原因可查询 | root Stage4 contracts + runtime grant 测试 |
| L2 | `verifyStage4CapabilityGrant` 精确匹配 actor/scope/approval/governance/policy/idempotency；任一错配在 executor 前 deny | root Stage4 contracts 字段错配测试 |
| L3 | expired/revoked grant 拒绝且零 executor 副作用；拒绝原因可查询 | root Stage4 contracts expired/revoked 测试 + tool guard blocked 测试 |
| L4 | 子 agent 扩权反例全部 fail-closed：missing parent、revoked/expired parent、resource/action/taskBranch/purpose 越界、TTL 越界、depth 不减、actorKind 非 delegate | root Stage4 contracts 子 agent 反例测试 + authority parent revocation 测试 |
| L5 | 重启恢复为显式失效：`recoverStage4GrantAfterRestart` 恒返回 `grant-not-recoverable-after-restart`；不静默复用 | root Stage4 contracts restart 测试 |
| L6 | `Stage4GrantAuditTrail` 对每次 issue/deny/revoke 记录 policy digest 与 actor chain；`listDenials` / `listRevocations` 可查询 | root Stage4 contracts audit 测试 |
| L7 | `wrapToolWithStage4ToolGuard` 默认 off、默认只守卫 write；合法调用经既有 ApprovalLedger + EffectReceiptStore 产出真实 EffectReceipt 并推进 ledger；denied/duplicate/missing path 不执行原 executor 且零文件副作用 | runtime tool-guard 测试 |
| L8 | Stage 1 / Stage 3 回归测试保持绿色；Stage 1/Stage 3 生产路径未被改写 | root + runtime Stage1/Stage3 回归测试 |
| L9 | 全部门禁通过；DEVLOG 完整；无 commit/push/PR；产品锁 false | 命令原始输出 + git 状态 |

## 5. 产品锁与卫生

- `defaultOn=false`、`liveReady=false`、`productApproved=false` 全程不变。
- 对 Stage 4 新增/修改生产文件 grep `defaultOn|liveReady|productApproved`：应无命中。
- 工作树中不得出现真实 key 命中；`DEEPSEEK_API_KEY` 在 Process / User / Machine 均应为 absent。
- 不 commit、不 push、不建 PR；`git log` 不得出现新提交。

## 6. 判定与输出

判定词只允许：

```text
accept / accept-with-findings / blocked
```

- `accept`：上述全部通过，剩余问题为空。
- `accept-with-findings`：全部硬门禁通过，仅存在不改变 Stage 4 语义的既有观察项。
- `blocked`：任一 L1–L9 硬门禁失败、子 agent 扩权反例未 fail-closed、拒绝/撤销不可查询、重启恢复语义不明确、默认值/产品锁被翻、或发现范围外生产改动。

输出必须写入 DEVLOG，并包含：
HEAD SHA、dirty patch 摘要、每类命令 exit code 与关键输出、L1–L9 逐项判定、
产品锁复核、密钥/卫生复核、最终 verdict。
