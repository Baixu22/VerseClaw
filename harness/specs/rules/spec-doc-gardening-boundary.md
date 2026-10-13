---
id: spec-doc-gardening-boundary
title: 规范与文档园艺（避免僵化 / 数量与入口风险）
type: ai-coding-rule
appliesTo:
  - gateway-backend-communication
severity: error
driven_by: agent
pathPatterns:
  - harness/specs/tasks/**
  - harness/specs/rules/spec-doc-gardening-boundary.md
  - scripts/check-spec-lifecycle.mjs
  - AGENTS.md
---

# 规范与文档园艺

规范会僵化（ossification）：当规范不再对应实现、旧约束长期未复核、或数量增长到无法维护时，规范就从资产变成噪声。本规则把「可维护」变成可执行检查，而不是靠记忆。

## R1 — 每个 task spec 必须有生命周期

`node scripts/check-spec-lifecycle.mjs` 要求 `harness/specs/tasks/**/*.md` 的 frontmatter 带 `lifecycleStatus`，取值 `active | completed | archived`。缺失即失败。**归档优先，不机械删除**：`archived` 表示保留历史但不再作为当前约束；不要用删除来“清理”。

Executable check: `node scripts/check-spec-lifecycle.mjs`（package script `pnpm harness:specs:lifecycle`）。

## R2 — 文档与实现一致优先于文档数量

`node scripts/validate-policy-docs.mjs`（`pnpm docs:policy:validate`）与 `node scripts/check-error-governance.mjs` 校验策略/错误治理文档的路径引用与单一 envelope。文档引用的路径必须能解析；文档声称的行为必须能被某个可执行检查证伪。**新增规范前先问：现有规则能否覆盖？** 只迁移可证伪的约束，不复制一份平行清单。

## R3 — 入口保持可用（AGENTS 不被撑爆）

`AGENTS.md` 是跨工具轻量入口，不是规范仓库。硬规则应放在 `harness/specs/rules/**` 并由 `pnpm harness validate`/`harness:ci` 校验；`AGENTS.md` 只做路由与最小长期声明。若 `AGENTS.md` 的增长超过 400 行，应先下沉到 `harness/specs/**` 而不是继续堆叠。

## 不做项

- 不机械删除规范；退役走 `archived`。
- 不新建第二份「规范清单」或平行 source of truth。
- 不改产品默认值/产品锁/approval。
