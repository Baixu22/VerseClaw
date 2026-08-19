# Stage 1 开发提示词（Provider Guard + 一个真实工具调用 + EffectReceipt）

> 启用条件：Stage 0 已被 owner 接受；Stage 0 的 baseline 修复切片已确认；本提示词是 Stage 1 唯一任务入口。
> 执行 agent 不得扩大范围、不得翻默认、不得 commit/push/建 PR。

## 0. 工作环境

```text
工作树：D:\verse_claw_worktree
分支：codex/context-control-plane-stage0
基线：f55201b22630d5c904f3105b2a9c8876ea5e889b
包管理：pnpm 11.2.2
```

## 1. 必读材料

1. `AGENTS.md`
2. `docs/dev/context-control-plane/DEVELOPMENT-CONSTRAINTS.zh-CN.md`
3. `docs/dev/context-control-plane/stage0/authority-matrix.md`
4. `docs/dev/context-control-plane/stage0/artifacts-schema.md`
5. `docs/dev/context-control-plane/stage0/authority-adapters.md`
6. `docs/dev/context-control-plane/stage0/golden-path-contract.md`
7. `docs/dev/context-control-plane/stage0/stage1-task-draft.md`
8. `docs/dev/context-capability-blueprint.md`（rev3）
9. `docs/dev/adr/2026-08-16-context-authority-boundaries.md`
10. `docs/dev/context-control-plane/DEVLOG.zh-CN.md`

## 2. 目标

只完成 Stage 1：

1. 黄金 coding turn 的结构化 `RequestEnvelope` 观测；
2. 一个真实工具调用，执行前经过“approval → 临时最小 Grant → Tool Guard”；
3. 真实执行后产生 `EffectReceipt`。

不做：

- 全链 DCS 编译器；
- Task Ledger proposal/accept/reject；
- 完整 `CapabilityGrant`（衰减、跨重启恢复、完整撤销）；
- channel/cron/browser/multi-agent/Memory 收敛。

## 3. 第一步：把 Stage 1 草案转成正式 harness spec

创建：

```text
harness/specs/tasks/context-control-plane-stage1.md
```

要求：

- 引用 Stage 0 五份交付物；
- 定义 touchedAreas，必须精确到 Provider Guard、最小 grant、Tool Guard、EffectReceipt 的真实接线点；
- 把 `stage1-task-draft.md` 的 10 个开放问题中可由约束文档直接裁定的先写死；其余列为 `blockedBy owner`，不得自行决策；
- requiredTests 至少覆盖 T1–T16 中与本阶段允许实现相关的项；
- 运行 `pnpm harness context --spec ...` 与 `pnpm harness validate --spec ...` 通过后，才能写生产代码。

## 4. 允许实现的内容

### 4.1 RequestEnvelope 观测（observational）

- 扩展 `buildGuardedModelFetch` / RC-02 / RC-03，不重写：
  - 生成 `RequestEnvelope/v1`；
  - 覆盖 system、messages、tools、media、所有 registered transforms；
  - 计算 `envelopeDigest`；
  - 关联 `WireReceipt/v1`。
- flag off：发送字节、顺序、tools、retries、审批、delivery 与 legacy 完全一致。
- flag on：发送行为不变，只追加 receipt/diagnostics。
- 黄金路径范围内未登记 egress = 0，并保留五种证明：allowlist、静态约束、运行时 census、负向测试、break-glass 审计。

### 4.2 临时最小 grant + Tool Guard

- Stage 1 不实现完整 `CapabilityGrant` 契约；
- 从现有 approval/effect 链派生临时最小 grant：
  - actor；
  - scope；
  - approval ref；
  - TTL；
  - effect idempotency key；
  - revocation 由拒绝/过期/审批状态表达。
- Tool Guard 在执行点校验上述字段；任一不匹配即拒绝，零副作用。
- 子 agent 权限严格 ≤ 父 agent。

### 4.3 EffectReceipt

- 真实工具调用成功后写 `EffectReceipt/v1`；
- 只存 digest/ref，不存原始 proposal/参数/输出；
- 幂等语义：
  - 同 key 同内容幂等；
  - 异内容 `content-conflict`；
  - `unknown` 进 `needs_reconciliation`，不自动重放；
- approval ledger 状态链完整可查：
  - `approved -> execution_started -> applied|not_applied|unknown -> reconciled|needs_reconciliation`。

## 5. 禁止事项

- 改 `attempt.ts`、`get-reply-run.ts`、`role-spawn.ts`、provider 路径，除非 spec 明确列出最小接线点且 owner 批准；
- 迁移任何现有 prompt 路径；
- 新增 provider/flag/store/daemon；
- 新增权限数据库、第二个 approval ledger、第三个 durable memory writer、第四个能力目录；
- 实现学习型排序、Context diff、policy simulation、replay debugger；
- 用 fixture/synthetic 宣称真实执行；
- 改产品锁或默认值；
- git commit / push / PR。

## 6. 验证命令

```bash
git status --short
git branch --show-current
git rev-parse HEAD
pnpm harness context --spec harness/specs/tasks/context-control-plane-stage1.md
pnpm harness validate --spec harness/specs/tasks/context-control-plane-stage1.md
pnpm exec vitest run tests/unit/context-control-plane-stage1-*.test.ts
pnpm --dir openclaw_runtime exec node scripts/run-vitest.mjs run <Stage 1 runtime tests>
pnpm contract:check
pnpm run typecheck
pnpm run lint:check
git diff --check
```

若触碰通信/发送/重试/fallback 路径，必须加跑：

```bash
pnpm run comms:replay
pnpm run comms:compare
```

## 7. 开发日志

全部结果追加到：

```text
docs/dev/context-control-plane/DEVLOG.zh-CN.md
```

## 8. 停止与升级条件

- 黄金路径无法做到 100% envelope 覆盖；
- 临时最小 grant 无法从现有 approval/effect 链派生；
- Tool Guard 与现有 MCP/tool policy 出现第二权限权威；
- RequestEnvelope canonical serialization 无法确定；
- 观测模式出现非零性能/字节漂移；
- Stage 1 开放问题未被 owner 裁决。

## 9. 完成定义

- 正式 harness spec 存在且 validate 通过；
- RequestEnvelope 观测覆盖黄金路径；
- 一个真实工具调用经 Tool Guard 后成功执行；
- 真实 EffectReceipt 可查询；
- 黄金路径范围内未登记 egress = 0；
- flag off byte-identical parity 通过；
- 全部必需门禁通过；
- 产品锁保持 false；
- DEVLOG 记录完整；
- owner 复核 Stage 1 证据后，才解锁 Stage 2。
