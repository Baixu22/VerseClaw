# Stage 3 开发提示词（Task Ledger proposal/accept/reject + 物化投影）

> 启用条件：Stage 2 已由独立验收 `accept`。本提示词是 Stage 3 唯一任务入口。
> 执行 agent 不得扩大范围、不得翻默认、不得 commit/push/建 PR。

## 0. 工作环境

```text
工作树：D:\verse_claw_worktree
分支：codex/context-control-plane-stage0
基线：f55201b22630d5c904f3105b2a9c8876ea5e889b
包管理：pnpm 11.2.2
Stage 2 验收证据：artifacts/context-control-plane/stage2-real-run-evidence.json
```

真实 provider / 真实工具运行条件沿用 Stage 1/2：仅 owner 明确授权，且 key 只以
单次命令临时环境变量注入；不得打印 key、不得写入文件、不得持久化到
Process/User/Machine 环境变量。Stage 2 验收修复已清理 User scope 残留。

## 1. 必读材料

1. `AGENTS.md`
2. `docs/dev/context-control-plane/DEVELOPMENT-CONSTRAINTS.zh-CN.md`
3. `docs/dev/context-control-plane/STAGE-ROADMAP.zh-CN.md`
4. `docs/dev/context-control-plane/STAGE2-DEV-PROMPT.zh-CN.md`
5. `docs/dev/context-control-plane/DEVLOG.zh-CN.md`
   （重点：Stage 2 验收结论、密钥残留修复切片、真实 DeepSeek run 证据）
6. `docs/dev/context-control-plane/stage0/authority-matrix.md`
7. `docs/dev/context-control-plane/stage0/artifacts-schema.md`
8. `docs/dev/context-control-plane/stage0/authority-adapters.md`
9. `docs/dev/context-control-plane/stage0/golden-path-contract.md`
10. `harness/specs/tasks/context-control-plane-stage1.md`
11. `harness/specs/tasks/context-control-plane-stage2.md`

实现前只读确认现状：

- `shared/types/task-ledger.ts`（现有 Task Ledger 事件/节点/快照契约）
- `electron/services/task-ledger-service.ts`（workspace Task Ledger JSONL + snapshot 投影）
- `electron/services/task-ledger-api.ts`（对外查询边界，只读确认）
- `openclaw_runtime/src/agents/long-task-control/task-ledger.ts`
  （long-task JSONL append、`readLongTaskLedgerRevision`）
- `openclaw_runtime/src/agents/long-task-control/store.ts`
  （checkpoint/intervention 对 Task Ledger 的只写投影，不得反向改动）
- `openclaw_runtime/src/context-engine/stage2-context-refs.ts`
  （Stage 2 `task_ledger` ContextRef 适配器，Stage 3 必须保持其 revision/digest 语义）
- 既有测试：`tests/unit/task-ledger-service.test.ts`、
  `tests/unit/task-ledger-reference.test.ts`

## 2. 目标

只做 Stage 3：

1. Task Ledger 承载 Working Context 字段；Working Context 字段更新只能是 proposal。
2. proposal 的 accept/reject 必须有独立事件与 actor，拒绝原因可查询。
3. 状态通过可重放的物化投影生成，不把投影当作第二真相源。
4. fork/handoff 有确定合并规则，不自动复制整个 ledger。
5. 只有 accepted 项可被标记为 Mem 晋升候选；Stage 3 不写 Mem。

明确不做：

- Memory / Knowledge / FactStore 迁移或写入；
- 学习型排序、语义压缩、上下文经济系统；
- Context diff / policy simulation / replay debugger；
- 完整 `CapabilityGrant` / 子 agent 授权扩展；
- 改变任何 provider prompt 生产路径；
- 引入第二个 Task Ledger store / 数据库 / daemon。

## 3. 第一步：创建正式 harness spec

创建：

```text
harness/specs/tasks/context-control-plane-stage3.md
```

要求：

- `touchedAreas` 只覆盖 Stage 3 真实接线点；在写 spec 前先只读确认第 1 节列出的源码，
  并把实际需要修改的文件逐路径列入 spec。
- 引用 Stage 0 契约、Stage 1/2 正式 spec 与 Stage 2 真实证据。
- 明确 Stage 2 回归约束：`readLongTaskLedgerRevision` 的
  `eventCount/revision/contentDigest` 语义不得改变；新增事件后 revision/digest
  仍可由同一只读函数计算。
- 定义 proposal / accept / reject 事件的最小契约：proposal id、目标字段、
  提议值、版本、actor、证据 ref、TTL、sensitivity/trust、拒绝原因。
- 定义 Working Context 字段的最小集合（现有提示词草案字段只能作为候选，
  不得在 spec 中承诺超范围能力）：
  `Objective / Constraints / ConfirmedFacts / Decisions / OpenRisks /
  ActiveFiles / Evidence / NextAction`。
- 定义物化投影规则：事件顺序确定、同字段最新 accepted 值确定、冲突保留
  proposal 来源与版本、未知/非法事件产生可查询 warning。
- 定义 fork/handoff 规则：只复制显式 task-scoped 字段；合并冲突必须保留双方
  source/version，禁止静默 last-write-wins。
- 以下开放项若无法由约束文档直接裁定，必须写入 spec 的 `blockedBy`，
  停在 spec 阶段等待 owner，不得自行决定：
  - Q1 accept/reject 的合法 actor 集合；
  - Q2 每个 Working Context 字段的默认 sensitivity/trust 与长度上限；
  - Q3 proposal TTL 默认值、过期判定与过期后物化投影状态；
  - Q4 同字段并发 proposal 的确定冲突/合并规则；
  - Q5 fork/handoff 的 task-scoped 字段精确复制清单；
  - Q6 Mem 晋升候选标记的最小形状；
  - Q7 真实证据是否必须包含真实 provider coding turn，或仅需真实 long-task
    ledger 事件重放。
- 验收测试映射至少覆盖 L1–L12。
- 先运行 `pnpm harness context --spec ...` 与
  `pnpm harness validate --spec ...`，两者通过后才允许写生产代码。

### L1–L12 验收映射（供正式 spec 使用）

| 编号 | 验收点 |
|---|---|
| L1 | Working Context proposal 事件通过既有 append-only JSONL 写入，不新增表/列；未经 proposal 的 Working Context 字段更新被拒绝。 |
| L2 | accept/reject 必须记录 actor、proposal id、policy/rule digest、拒绝原因；同一 proposal 不可重复 accept。 |
| L3 | 相同事件日志重建物化投影得到相同结果；投影函数无随机数、无 wall-clock 决策。 |
| L4 | 既有 `projectTaskLedgerSnapshot` / Stage 2 `readLongTaskLedgerRevision` 与 Stage 3 事件共存且可重放。 |
| L5 | 同字段冲突保留多个 proposal 来源与版本，确定胜出/合并规则，无静默覆盖。 |
| L6 | TTL 过期后 proposal 不可 accept，投影只显示 expired/omitted，不自动晋升。 |
| L7 | fork/handoff 只复制显式 task-scoped 字段，父/子 ledger 关联可查询。 |
| L8 | accepted 项只产生 Mem 晋升候选标记；Stage 3 不发起任何 Memory 写入。 |
| L9 | Stage 3 flag 默认关闭；关闭时现有 Task Ledger / Working Context 行为不变。 |
| L10 | 事件 payload 只含 bounded 字段、证据 ref、sensitivity/trust 元数据；不含完整 transcript、文件正文、工具输出、密钥。 |
| L11 | 非法事件、缺 actor、缺 policy digest、重复 accept 均 fail-closed 且原因可查询。 |
| L12 | 全部必需门禁通过；DEVLOG 记录完整；无 commit/push/PR。 |

## 4. 允许实现

- 扩展既有 Task Ledger 事件契约（`shared/types/task-ledger.ts`）与 JSONL 追加器，
  不重写 store、不加表。
- 增加只读物化投影（可复用并扩展现有 `projectTaskLedgerSnapshot`），投影结果
  只是可丢弃缓存，重建始终以 JSONL 事件为输入。
- 增加 proposal / accept / reject 构造与校验适配器，所有写入都带 actor、
  证据 ref、版本、TTL、sensitivity/trust。
- fork/handoff 合并作为纯函数实现，输入为父/子任务事件投影，输出确定合并结果。
- 默认关闭或 shadow：未开启时发送字节、既有 Task Ledger 写入、查询与 UI 投影
  保持不变。
- 真实证据：若 owner 裁决 Q7 需要真实 provider，必须复用 Stage 1/2 的真实
  DeepSeek run 与工具链；禁止用 fixture/mock/cache 冒充。

## 5. 禁止事项

- 把 Task Ledger 当成 transcript 或 Memory；
- 自动接受 proposal；
- 未确认项自动晋升 Mem；
- 引入第二任务状态权威、第二 ledger、第二物化数据库；
- 直接修改既有 checkpoint/intervention 的 Task Ledger 投影语义，除非 spec
  明确列出最小兼容改动；
- 改变 Stage 2 `task_ledger` ContextRef 的 revision/digest 语义；
- 迁移 provider prompt 路径；
- 改产品锁或默认值；
- commit / push / 建 PR。

## 6. 验证命令

```bash
pnpm harness context --spec harness/specs/tasks/context-control-plane-stage3.md
pnpm harness validate --spec harness/specs/tasks/context-control-plane-stage3.md
pnpm exec vitest run <Stage 3 root tests>
pnpm --dir openclaw_runtime exec vitest run <Stage 3 runtime tests>
pnpm exec vitest run tests/unit/task-ledger-service.test.ts tests/unit/task-ledger-reference.test.ts
pnpm --dir openclaw_runtime exec vitest run src/context-engine/stage2-dcs.test.ts
pnpm contract:check
pnpm run typecheck
pnpm run lint:check
git diff --check
```

若实现触碰通信 / provider / 重试 / fallback 路径，必须加跑：

```bash
pnpm run comms:replay
pnpm run comms:compare
```

## 7. 开发日志

全部结果追加到：

```text
docs/dev/context-control-plane/DEVLOG.zh-CN.md
```

必须记录：HEAD SHA、dirty patch 摘要、harness context/validate 原始输出摘要、
L1–L12 逐项结果、真实证据或 Q7 未裁决状态、密钥处理复核。

## 8. 停止与升级条件

发现以下任一情况必须停止并记录，不得自行扩大范围：

- 既有两个 Task Ledger 写入/投影路径无法在单一 JSONL authority 下共存；
- proposal/accept/reject 无法保持 append-only 或向后兼容；
- 物化投影无法从事件确定重放；
- Stage 2 `readLongTaskLedgerRevision` 回归失败；
- flag off 时任何现有 Task Ledger / Working Context 行为发生变化；
- 需要新增表、数据库、daemon 或第二任务状态权威；
- Q1–Q7 任一开放项未被约束文档裁定或 owner 裁决。

## 9. 完成定义

- `harness/specs/tasks/context-control-plane-stage3.md` 存在且
  context / validate 在代码前、代码后均通过。
- proposal/accept/reject 事件可重放，actor 与拒绝原因可查询。
- 物化投影可从事件重建，结果确定。
- fork/handoff 合并行为确定，不自动复制整个 ledger。
- 无自动 accept、无自动 Mem 晋升。
- Stage 2 `readLongTaskLedgerRevision` 回归通过，task-ledger ContextRef 语义不变。
- 默认关闭 / shadow，现有行为不变。
- 全部门禁通过；产品锁保持 false。
- DEVLOG 完整；未 commit、未 push、未建 PR。
- owner 接受后解锁 Stage 4。
