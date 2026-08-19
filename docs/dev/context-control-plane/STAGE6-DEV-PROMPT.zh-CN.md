# Stage 6 开发提示词（Context diff / why-included / policy simulation / replay debugger）

> 启用条件：Stage 5 完成且 owner 接受。本提示词是 Stage 6 唯一任务入口。

## 0. 工作环境

```text
工作树：D:\verse_claw_worktree
分支：codex/context-control-plane-stage0
包管理：pnpm 11.2.2
```

## 1. 必读材料

1. `docs/dev/context-control-plane/DEVELOPMENT-CONSTRAINTS.zh-CN.md`
2. Stage 0 的 golden-path-contract / artifacts-schema；
3. `docs/dev/context-control-plane/DEVLOG.zh-CN.md`；
4. 前一 Stage 正式 spec 与证据。

## 2. 目标

把控制平面变成用户可理解、可控制的产品能力：

- Context diff；
- why-this-was-included；
- policy simulation；
- replay debugger。

## 3. 第一步：创建 harness spec

```text
harness/specs/tasks/context-control-plane-stage6.md
```

- 任何 UI 变更必须同步 Electron E2E 与四语 i18n；
- 只读投影，不允许 UI 写 context authority。

## 4. 允许实现

- 基于 PromptPlan / RequestEnvelope / Receipt 的只读投影；
- 显示 selected/omitted/why；
- policy simulation 为 dry-run，不得产生副作用；
- replay debugger 只重放可恢复输入，不重放 effect；
- 用户可见入口走 host-api，不直接访问 Gateway HTTP。

## 5. 禁止事项

- UI 成为第二上下文/权限权威；
- replay debugger 重放工具副作用；
- 显示或落盘 raw payload、凭据、秘密；
- 把 dry-run 当作真实效果；
- 改产品锁/默认值；
- commit/push/PR。

## 6. 验证命令

```bash
pnpm harness context --spec harness/specs/tasks/context-control-plane-stage6.md
pnpm harness validate --spec harness/specs/tasks/context-control-plane-stage6.md
pnpm exec vitest run <Stage 6 tests>
pnpm run typecheck
pnpm run lint:check
pnpm i18n:lint
pnpm run test:e2e <stage6 specs>
git diff --check
```

## 7. 完成定义

- 用户能解释一次 coding turn 的上下文与效果来源；
- dry-run 零副作用；
- replay 不重放 effect；
- 四语与 E2E 通过；
- 产品锁 false；
- DEVLOG 完整。
