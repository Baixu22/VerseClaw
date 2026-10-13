# G02：精简规范入口并防止文档僵化

日期：2026-10-13（Asia/Shanghai）。包码：G02（TF-0290）。真实 provider 调用：无。

## 缺口与处置

- **规范生命周期不完整**：`node scripts/check-spec-lifecycle.mjs` 原报 17 个 task spec 缺 `lifecycleStatus`（含本轮新增的 harness-gap 包）。已为全部补齐 `lifecycleStatus`（本轮新增包 = `completed`）；现 **PASS：518/518**。
- **规范僵化（HG08）**：新增规则 `harness/specs/rules/spec-doc-gardening-boundary.md`，把「规范必须对应实现、退役走 archived」写成可执行检查，并提供维护口径。
- **文档园艺（HG09）**：`node scripts/validate-policy-docs.mjs`（10 checks PASS）与 `check-error-governance.mjs`（16 checks PASS）保持文档路径引用可解析。
- **规范数量/入口（HG28/HG29）**：AGENTS.md 维持轻量路由入口（≤400 行），规范归属 `harness/specs/**`；不新建平行清单。
- **规则新增（HG28）**：只新增一条 doc-gardening 规则，命名可执行检查；不做第二份 source of truth。

## 实测

| 断言 | 结果 |
|---|---|
| 每个 task spec 带合法 lifecycleStatus | ✅（check-spec-lifecycle PASS 518/518） |
| 文档引用可解析 | ✅（policy-docs PASS 10；error-governance PASS 16） |
| AGENTS.md ≤400 行且指向 harness/specs | ✅ |
| 仅一条 doc-gardening 规则且带可执行检查 | ✅ |
| 归档优先、无机械删除 | ✅ |

## 残余（residual）

- 本包不自动删除任何规范/文档；退役需显式 `archived` + 人审 diff。
- AGENTS.md 若未来 >400 行，应下沉规则到 `harness/specs/**`（规则已写明）。
- 不改产品默认值/锁/approval；非真人证据。
