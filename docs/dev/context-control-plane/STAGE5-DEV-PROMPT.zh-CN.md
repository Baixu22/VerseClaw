# Stage 5 开发提示词（Memory 收敛 + unit-aware packing + 真实任务对照）

> 启用条件：Stage 4 完成且 owner 接受。本提示词是 Stage 5 唯一任务入口。

## 0. 工作环境

```text
工作树：D:\verse_claw_worktree
分支：codex/context-control-plane-stage0
包管理：pnpm 11.2.2
```

## 1. 必读材料

1. `docs/dev/context-control-plane/DEVELOPMENT-CONSTRAINTS.zh-CN.md`
2. Stage 0 的 authority-matrix / artifacts-schema / authority-adapters；
3. `docs/dev/context-control-plane/DEVLOG.zh-CN.md`；
4. 前一 Stage 正式 spec 与证据。

## 2. 目标

1. 收敛 Memory：一个 durable owner，其他后端为 provider/adapter；每 namespace 一个 semantic-memory authority。
2. 替换字符前缀截断为 unit-aware token packer。
3. 用真实任务对照收集探索证据，不直接 default-on。

## 3. 第一步：创建 harness spec

```text
harness/specs/tasks/context-control-plane-stage5.md
```

- 定义 Memory 写入必须经过 effect boundary；
- 定义 `parallelMemoryWriters === 0` 的机器检查；
- 定义 critical/constraint/evidence 保留率、P95 编译延迟/成本；
- 定义真实任务对照章程：真实 provider、单 workspace、Windows x64、至少 10 个真人 coding 任务、基线/试验配对。

## 4. 允许实现

- 现有 `memory_search / memory_get / memory_query / context_search / context_read` 保留工具名兼容，底层统一到 Memory Facade；
- 结果标注 backend/source/freshness/evidence；
- 不迁移用户数据；
- 已证明收益的 Runtime Memory 模块接入主链；其余标 `eval-only`；
- unit-aware packer 覆盖 token、tool schema、多模态、输出 reserve；
- critical/constraint/evidence 整单元保留，超窗显式失败/降级。

## 5. 禁止事项

- 新增第三个 durable memory writer；
- 让 Memory 拥有 DCS 决策权；
- 把 `context_*` 伪装成 memory；
- 未授权真实 provider/远端副作用；
- 用 synthetic 替代真人任务；
- 翻默认值或产品锁；
- commit/push/PR。

## 6. 验证命令

```bash
pnpm harness context --spec harness/specs/tasks/context-control-plane-stage5.md
pnpm harness validate --spec harness/specs/tasks/context-control-plane-stage5.md
pnpm exec vitest run <Stage 5 tests>
pnpm contract:check
pnpm run typecheck
pnpm run lint:check
git diff --check
```

## 7. 完成定义

- `parallelMemoryWriters === 0`；
- 记忆注入只来自权威路径；
- critical 保留率达标；
- P95 延迟/成本达标；
- 真人任务对照章程完成并产出探索证据；
- 产品锁 false；
- DEVLOG 完整；
- owner 接受后解锁 Stage 6。
