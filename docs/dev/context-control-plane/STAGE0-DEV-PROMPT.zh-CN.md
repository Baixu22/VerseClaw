# Stage 0 开发提示词（在 D:\verse_claw_worktree 执行）

> 本提示词是 Stage 0 的唯一任务入口。执行 agent 不得自行扩大范围、不得翻默认、不得提交或 push。

## 0. 工作环境

```text
工作树：D:\verse_claw_worktree
分支：codex/context-control-plane-stage0
基线：f55201b22630d5c904f3105b2a9c8876ea5e889b
包管理：pnpm 11.2.2（使用工作树内 node_modules）
```

## 1. 必读材料（按顺序）

1. `AGENTS.md`
2. `docs/dev/context-control-plane/DEVELOPMENT-CONSTRAINTS.zh-CN.md`
3. `docs/dev/context-capability-blueprint.md`（rev3）
4. `docs/dev/adr/2026-08-16-context-authority-boundaries.md`
5. `docs/dev/context-control-plane/DEVLOG.zh-CN.md`
6. `docs/dev/full-chain-maturity-audit-2026-08-02.md`
7. `docs/dev/dcs-first-context-engineering.md`
8. `docs/dev/capability-registry-v3-development-plan.md`
9. `docs/context-family/axioms.md`、`docs/context-family/glossary.md`
10. 当前工作树中与 `buildGuardedModelFetch`、RC-03、`EffectReceipt`、approval ledger、Task Ledger 相关的源码，只读确认现状。

## 2. 目标

只完成 **Stage 0：冻结五平面、六 artifact、policy/grant/effect 契约**。

不实现 Stage 1 的 Provider Guard 运行时行为，不迁移任何现有 prompt 路径。

## 3. 必须交付

### D1：五平面 authority 矩阵

产出 `docs/dev/context-control-plane/stage0/authority-matrix.md`：

- 数据 / 能力 / 上下文 / 效果 / 出口与证据五个平面；
- 每行给出：owner、唯一问题、核心产物、现有资产映射、缺口；
- 明确“不新增真相源，只新增逻辑契约与适配层”。

### D2：六 artifact 最小 schema

产出 `docs/dev/context-control-plane/stage0/artifacts-schema.md`：

- `ContextRef`
- `CompilationSnapshot`
- `PromptPlan`
- `RequestEnvelope`
- `CapabilityGrant`
- `EffectReceipt`

每个 artifact 的每个字段必须标注：

```text
source / policy / owner / lifecycle / required-or-optional / version
```

约束：

- 首版只保留黄金 coding turn 必需字段；
- `ContextRef` 不复制 payload；
- Receipt 类不保存原始内容；
- `CapabilityGrant` 是派生短生命周期凭证，不是新权限数据库；
- `RequestEnvelope` 必须覆盖 system、messages、tools、media、all transforms。

### D3：逻辑 authority 适配层设计

产出 `docs/dev/context-control-plane/stage0/authority-adapters.md`：

- 现有资产到逻辑 authority 的映射：
  - session/run/attempt + ReceiptStore → Identity；
  - config/policy digest + approval policy → Policy；
  - 现有 approval/effect 链 → 临时最小 Grant；
  - approval ledger + EffectReceipt + operator slice → Effect；
  - `buildGuardedModelFetch` + RC-03 → Egress 基础；
- 每个映射的版本、拒绝原因、缺口；
- 明确哪些现有资产只是工程资产，不是已闭合能力。

### D4：黄金 coding turn 链路契约

产出 `docs/dev/context-control-plane/stage0/golden-path-contract.md`：

```text
普通 coding turn：
用户输入 → session/run/attempt identity
→ ContextRef（用户意图、Task Ledger、工具结果）
→ CompilationSnapshot
→ DCS PromptPlan
→ Provider Guard RequestEnvelope
→ provider fetch
→ 一个真实工具调用
→ CapabilityGrant（临时最小）
→ Tool Guard
→ EffectReceipt
```

必须写明：

- 每个环节的输入、输出、失败语义、回滚语义；
- 哪些字段在 Stage 1 必须可查询；
- Stage 1 的“临时最小 grant”字段：actor、scope、approval ref、TTL、effect idempotency；
- Stage 1 覆盖范围：黄金路径内未登记 egress = 0。

### D5：Stage 1 任务书草案

产出 `docs/dev/context-control-plane/stage0/stage1-task-draft.md`：

- Stage 1 目标：Provider Guard + 一个真实工具调用 + EffectReceipt；
- 验收标准；
- 测试矩阵；
- 不允许提前做的内容；
- 待 owner 决策的开放问题。

### D6：harness task spec

创建：

```text
harness/specs/tasks/context-control-plane-stage0.md
```

要求：

- 引用上述五份 Stage 0 交付物；
- 定义 touchedAreas，只包含 docs 与契约相关路径；
- 定义 required tests / required profiles；
- 不接受任何生产路径变更进入本轮；
- 运行：
  - `pnpm harness context --spec harness/specs/tasks/context-control-plane-stage0.md`
  - `pnpm harness validate --spec harness/specs/tasks/context-control-plane-stage0.md`

## 4. 允许的代码活动

Stage 0 只允许：

- 文档与契约类型草案；
- 纯类型/校验测试，证明 schema 可 validate；
- 不改变任何 prompt、工具注册、provider 路径、默认值；
- 不新增 provider、flag、store、daemon。

如确认需要创建契约类型文件，建议先在 spec 中声明，并限制为：

```text
shared/types/context-control-plane/ 或等价的纯类型目录
```

不得被任何生产模块 import。

## 5. 禁止事项

- 禁止改 `attempt.ts`、`get-reply-run.ts`、`role-spawn.ts`、provider 路径；
- 禁止改 product locks；
- 禁止新增第三个 durable memory writer、第二个权限数据库、第二个 approval ledger、第四个能力目录；
- 禁止写真实密钥、真实渠道凭据、真实用户数据；
- 禁止 git commit / push / 创建 PR；
- 禁止以 fixture 或 synthetic 结果宣称 Stage 1 已可执行。

## 6. 验证命令

在 `D:\verse_claw_worktree` 执行：

```bash
git status --short
git branch --show-current
git rev-parse HEAD
pnpm harness context --spec harness/specs/tasks/context-control-plane-stage0.md
pnpm harness validate --spec harness/specs/tasks/context-control-plane-stage0.md
pnpm contract:check
pnpm exec vitest run <stage0 contract tests>
pnpm run typecheck
pnpm run lint:check
git diff --check
```

如果 Stage 0 创建了类型文件，必须补对应 normalize/validate 单测。

## 7. 开发日志

所有执行结果追加到：

```text
docs/dev/context-control-plane/DEVLOG.zh-CN.md
```

日志格式：

```text
日期时间
切片内容
命令与原始输出摘要
失败原因与修复
未解决问题
```

## 8. 停止与升级条件

遇到以下情况立即停止，不自行决策：

- 六 artifact 与现有资产冲突；
- 黄金路径无法保证 RequestEnvelope 完整覆盖；
- 现有 approval/effect 链无法派生最小 grant；
- harness validate 因范围/归属无法通过；
- 任何修改可能改变默认行为或产品锁；
- owner 未裁决的 authority 歧义。

## 9. 完成定义

Stage 0 完成必须同时满足：

- D1–D6 全部落盘；
- harness context / validate 通过；
- 契约测试与 typecheck 通过；
- 未触碰生产路径；
- 未变更默认值和产品锁；
- DEVLOG 记录完整；
- 独立复核意见已记录为 `accept` 或 `revise` 且剩余问题为空。
