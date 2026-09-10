# TF-0080 Handoff

更新时间：2026-08-22  
工作区：`D:\ClawX`  
分支：`feat/runtime-lifecycle-governance`

## 当前节点

`TF-0080`「会话安全闸门与删除重试一致性」已启动，状态为 `in_progress`，进度仍为 5%。Task Forest 下一动作：

> 先建立 TF-0080 Harness task spec 和 admission/delete 生产失败矩阵，再只修复一个 owner path。

规格：[session-ecosystem-safety-gate-consistency.md](/D:/ClawX/harness/specs/tasks/session-ecosystem-safety-gate-consistency.md)

## 已完成

- `TF-0079` 已完成并关闭，`sessions.stop` 已接入真实 Gateway registry/descriptor/readiness gate。
- 来源治理前一阶段已完成并应用 closeout：runtime coding 的 `write/edit/apply_patch` 对 workspace 外部目标执行 provenance 检查。
- `TF-0080` 规格 `context` 和 `validate --no-diff` 已通过。
- 当前工作树已有 admission、delete journal、Electron mirror gate、sessions API、terminal API 的用户/前序改动，必须在其上继续，禁止 reset、stash、clean 或 checkout。

## 已知验证结果

- 默认 agents shard 不包含 `src/sessions/session-admission-registry.test.ts`，直接按规格命令会报告 `No test files found`；需要使用临时 include 配置或合适的 OpenClaw shard 执行。
- admission registry 测试在临时 include 配置下通过。
- delete journal 测试：37 tests 中 8 failed，失败集中在 manifest round-trip/digest：
  - property insertion order digest 不稳定；
  - journal round-trip 报 `session delete journal manifest is missing required fields`；
  - 受影响测试包括 upsert、state transition、runtime receipt、partial retry、intent round-trip。
- 根 Electron 单测当前被既有依赖错误阻断：缺少 `@adobe/css-tools`。
- Main typecheck 当前已有无关错误：`openclaw_runtime/src/gateway/server-methods/sessions.lifecycle.ts:51` 的 `buildSessionDeleteManifestDigest` 未使用。
- comms replay/compare 在前一阶段通过；本节点继续修改后必须重新运行。

## 首个修复建议

只修 delete-journal owner path，不同时改 Electron mirror：

1. 复现并定位 `buildSessionDeleteManifestDigest` 与 `parseManifestJson` 的 schema/兼容问题。
2. 确认 `manifest_json`、`manifest_digest` 在 SQLite round-trip 中保持同一 canonical manifest。
3. 保留递归 canonicalization，确保 nested `archivePlan`、generation、transcript、operation 改变都会产生 digest conflict。
4. 让旧/兼容测试数据明确迁移或 fail-closed，不能静默接受旧 manifest。
5. 修复后只重跑 admission + journal focused matrix，再决定是否进入 Electron mirror。

## 硬约束

- 不启动 `TF-0081+`。
- 不改 Goal-wake、durable-helper、universal resource ledger 或产品批准状态。
- 不允许 unknown RPC 下 sweep 文件、关闭 terminal 或释放 mirror gate。
- 不允许 agent-wide kill fallback，不自动 replay spawn。
- runtime truth 由 OpenClaw/SQLite owner 持有；Electron 只维护 mirror/projection。
- 保留所有无关用户改动；不要通过扩大 Harness `touchedAreas` 绕过脏树失败。

## 收口要求

完成一个 owner path 后，按顺序运行：

```text
pnpm harness context --spec harness/specs/tasks/session-ecosystem-safety-gate-consistency.md
pnpm harness validate --spec harness/specs/tasks/session-ecosystem-safety-gate-consistency.md --no-diff
runtime focused admission/journal tests
pnpm run contract:check
pnpm run comms:replay
pnpm run comms:compare
pnpm run typecheck
pnpm run test:e2e:run tests/e2e/runtime-lifecycle-governance.spec.ts
git diff --check
```

Task Forest 状态变更必须先保存 proposal，经确认后再 apply、validate、export。不要把 focused 绿色测试描述为 live-ready、product-approved 或 GA。
