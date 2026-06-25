# Phase 1 Handoff: Runtime Surface Inventory

本轮目标：并行调研 ClawX 当前 runtime 表面，确认现有不成熟方案的真实入口、调用链、测试覆盖和迁移风险。此阶段不改业务代码，不引入新设计实现，只收集证据，避免和现有设计直接打架。

## Phase Definition

本轮对应：

- `runtime-research/implementation-roadmap.md` 的 `Phase 0: Runtime Surface Inventory`
- `runtime-research/migration-execution-plan.md` 的 `Stage 0: Inventory and Baseline`

命名上本轮称为 `phase-1-runtime-surface-inventory`，因为它是多窗口协作的第一轮工作。

## Required Reading

每个并行窗口开始前必须阅读：

- `runtime-research/agent-runtime-index.md`
- `runtime-research/migration-execution-plan.md`
- `runtime-research/implementation-roadmap.md`
- `runtime-research/agent-runtime-core-spec.md`

按任务 lane 继续阅读对应项目资料，见 `parallel-lanes.md`。

## Output Location

每个窗口只写一个独立提交文件：

```text
runtime-research/handoffs/phase-1-runtime-surface-inventory/submissions/<lane-id>.md
```

不要多个窗口写同一个文件。综合窗口写：

```text
runtime-research/handoffs/phase-1-runtime-surface-inventory/synthesis.md
```

## Submission Rules

- 必须使用 `submission-template.md` 的标题和字段。
- 每条结论必须有本地文件路径、函数/类/命令输出作为证据。
- 不允许写“凭印象”“可能存在”“应该是”这类无证据结论。
- 找不到入口时，写明搜索命令和无结果证据。
- 不做代码迁移，不改 runtime 逻辑。
- 如果发现当前研究文档与代码矛盾，记录到 `Design Conflicts`，不要直接改架构。

## Invalid Submission

以下情况视为格式不合格，需要退回调整：

- 缺少模板中的任一一级标题。
- 没有 `Evidence Table`。
- 有结论但没有文件路径或命令证据。
- 混入实现方案但没有说明它只是建议。
- 写入了其它窗口负责的 lane 文件。

## Final Integration

所有 lane 完成后，由综合窗口读取 `submissions/*.md`，产出 `synthesis.md`，内容包括：

- current-vs-target gap table
- legacy callsite list
- first migration slices
- required harness/spec updates
- open questions requiring user or maintainer decision

综合后再更新 `runtime-research/agent-runtime-index.md` 的 `Last Known Pointers`。
