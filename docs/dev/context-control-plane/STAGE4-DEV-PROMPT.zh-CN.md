# Stage 4 开发提示词（CapabilityGrant + Tool Guard + 子 agent 衰减授权）

> 启用条件：Stage 3 完成且 owner 接受。本提示词是 Stage 4 唯一任务入口。

## 0. 工作环境

```text
工作树：D:\verse_claw_worktree
分支：codex/context-control-plane-stage0
包管理：pnpm 11.2.2
```

## 1. 必读材料

1. `docs/dev/context-control-plane/DEVELOPMENT-CONSTRAINTS.zh-CN.md`
2. Stage 0 的 authority-adapters / artifacts-schema / golden-path-contract；
3. `docs/dev/context-control-plane/DEVLOG.zh-CN.md`；
4. 前一 Stage 正式 spec 与证据。

## 2. 目标

把 Stage 1 的临时最小 grant 提升为统一 `CapabilityGrant`：

- 由现有 policy/approval/session identity 派生；
- 支持 delegation/attenuation；
- 支持 TTL、revocation epoch、重启恢复；
- 子 agent 权限严格 ≤ 父 agent；
- 不新增权限数据库。

## 3. 第一步：创建 harness spec

```text
harness/specs/tasks/context-control-plane-stage4.md
```

验收必须包含：

- 合法 grant 通过；
- denied/expired/governance mismatch/revoked 拒绝且零副作用；
- 子 agent 扩权反例全部失败；
- 重启后 grant 状态可恢复或明确失效；
- grant 拒绝原因可查询。

## 4. 允许实现

- `CapabilityGrant/v1` 纯派生凭证；
- Tool Guard 在执行点验证 actor、scope、TTL、approval ref、effect idempotency、revocation；
- 与现有 approval ledger / MCP policy / tool allow-deny 适配，不复制；
- 审计：每次签发/拒绝/撤销记录 policy digest 与 actor chain。

## 5. 禁止事项

- 新增第二个权限数据库或 approval ledger；
- 让模型/Skill/renderer 注册 executor；
- grant 扩大现有工具权限；
- 子 agent 获得大于父 agent 的权限；
- 改产品锁/默认值；
- commit/push/PR。

## 6. 验证命令

```bash
pnpm harness context --spec harness/specs/tasks/context-control-plane-stage4.md
pnpm harness validate --spec harness/specs/tasks/context-control-plane-stage4.md
pnpm exec vitest run <Stage 4 tests>
pnpm contract:check
pnpm run typecheck
pnpm run lint:check
git diff --check
```

## 7. 完成定义

- 完整 CapabilityGrant 契约落地；
- Tool Guard 在黄金路径 enforce；
- 子 agent 扩权 = 0；
- 拒绝/撤销可查询；
- 重启恢复语义明确；
- 产品锁 false；
- DEVLOG 完整；
- owner 接受后解锁 Stage 5。
