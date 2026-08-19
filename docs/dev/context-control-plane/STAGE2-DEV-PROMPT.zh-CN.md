# Stage 2 开发提示词（ContextRef -> CompilationSnapshot -> DCS -> PromptPlan）

> 启用条件：Stage 1 完成且 owner 接受。本提示词是 Stage 2 唯一任务入口。

## 0. 工作环境

```text
工作树：D:\verse_claw_worktree
分支：codex/context-control-plane-stage0
包管理：pnpm 11.2.2
```

## 1. 必读材料

1. `docs/dev/context-control-plane/DEVELOPMENT-CONSTRAINTS.zh-CN.md`
2. `docs/dev/context-control-plane/stage0/authority-matrix.md`
3. `docs/dev/context-control-plane/stage0/artifacts-schema.md`
4. `docs/dev/context-control-plane/stage0/authority-adapters.md`
5. `docs/dev/context-control-plane/stage0/golden-path-contract.md`
6. `docs/dev/context-control-plane/DEVLOG.zh-CN.md`
7. 前一 Stage 的正式 harness spec 与证据。

## 2. 目标

只做三件事：

1. 在黄金 coding turn 上，让三类来源产出 `ContextRef`：用户意图、Task Ledger、工具结果。
2. DCS 从 `ContextRef` 生成 `CompilationSnapshot` 与 `PromptPlan`。
3. Provider Guard 消费 `PromptPlan`，不自行重新编译。

明确不做：

- 不接 Memory/Skill/CVK/FactStore 全量来源；
- 不做学习型排序、语义压缩、上下文经济系统；
- 不改变现有 prompt 路径直到 snapshot/plan 在黄金路径验证。

## 3. 第一步：创建 harness spec

```text
harness/specs/tasks/context-control-plane-stage2.md
```

- 定义 touchedAreas，只覆盖 ContextRef 适配器、DCS snapshot/plan、黄金路径接线；
- 验收必须包含：相同输入得到稳定 `PromptPlan`；未登记 direct system-prompt mutation 在黄金路径为 0；
- `pnpm harness context` 与 `pnpm harness validate` 通过后才写代码。

## 4. 允许实现

- `ContextRef` 只存引用/摘要，不复制 payload；
- `CompilationSnapshot` 冻结并记录：
  - source revisions；
  - task ledger revision；
  - catalog epoch；
  - policy snapshot；
  - model profile；
  - transform graph；
  - PromptPlan digest；
  - RequestEnvelope digest；
- `PromptPlan` 记录 selected/omitted/order/budget/why；
- DCS 服务无状态、可丢弃；snapshot/plan/receipt 可恢复；
- 先 observational：默认 flag off，flag on 时发送行为不变；
- 黄金路径范围内 direct mutation = 0。

## 5. 禁止事项

- DCS 持有原始事实或成为第二数据库；
- producer 自行做预算/选择/排序；
- 把 `PromptPlan` 当作新权限或执行凭证；
- 迁移全部来源；
- 改默认值/产品锁；
- commit/push/PR。

## 6. 验证命令

```bash
pnpm harness context --spec harness/specs/tasks/context-control-plane-stage2.md
pnpm harness validate --spec harness/specs/tasks/context-control-plane-stage2.md
pnpm exec vitest run <Stage 2 contract/unit tests>
pnpm contract:check
pnpm run typecheck
pnpm run lint:check
git diff --check
```

## 7. 完成定义

- 三类来源在黄金路径产生 ContextRef；
- CompilationSnapshot 冻结完整版本输入；
- 相同输入得到稳定 PromptPlan；
- PromptPlan 可解释 selected/omitted/why；
- 黄金路径 direct mutation = 0；
- 默认 flag off，flag on 无发送字节变化；
- 产品锁保持 false；
- DEVLOG 完整；
- owner 接受后解锁 Stage 3。
