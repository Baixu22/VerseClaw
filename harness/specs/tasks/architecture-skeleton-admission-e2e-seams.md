---
lifecycleStatus: active
id: architecture-skeleton-admission-e2e-seams
title: Admission A4 — rewrite the four E2E mock seams onto host:invoke
intent: Remove the last legacy-override bridges for gateway:status, gateway:rpc, file:stat and file:readText from the Electron E2E fixture, so every E2E mock is supplied through the typed host:invoke interceptor and the flat IPC channels have zero test-level consumers.
touchedAreas:
  - harness/specs/tasks/architecture-skeleton-admission-e2e-seams.md
  - tests/e2e/fixtures/electron.ts
  - tests/e2e/chat-agent-effort.spec.ts
  - tests/e2e/chat-cache-guard.spec.ts
  - tests/e2e/chat-file-changes.spec.ts
  - tests/e2e/chat-history-startup-retry.spec.ts
  - tests/e2e/chat-memory-injection-panel.spec.ts
  - tests/e2e/chat-model-picker-tiers.spec.ts
  - tests/e2e/chat-model-picker.spec.ts
  - tests/e2e/chat-welcome-hero-fakecoding.spec.ts
  - tests/e2e/chat-welcome-hero-verse-shot.spec.ts
  - tests/e2e/effort-intensity-smoke.spec.ts
  - tests/e2e/sidebar-session-folders-archive.spec.ts
  - tests/e2e/startup-loading-experience.spec.ts
  - tests/e2e/visual-tune.spec.ts
  - tests/unit/gateway-events.test.ts
  - scripts/contract-check-flat-ipc.json
  - docs/dev/architecture-skeleton/ADMISSION-SEAM-MIGRATION.md
requiredProfiles:
  - fast
requiredRules:
  - gateway-backend-communication
  - docs-sync
  - task-forest-autoclose-and-roles
  - agent-engineering-acceptance-boundary
requiredTests:
  - pnpm contract:check
  - pnpm run typecheck
  - pnpm exec vitest run tests/unit/gateway-events.test.ts
  - pnpm run test:e2e tests/e2e/chat-file-changes.spec.ts
acceptance:
  - tests/ 中对 gateway:status、gateway:rpc、file:stat、file:readText 的 ipcMain.handle / removeHandler 覆盖为 0；fixture 中 legacy-override 分支已删除。
  - 受影响 E2E spec 在 Electron 下通过，逐条记录 exit code；无法运行的写明环境原因且不得解读为通过。
  - tests/unit/gateway-events.test.ts 不再引用扁平 channel 名并通过。
  - pnpm contract:check 通过；清单 4 条状态更新一致。
  - pnpm run typecheck 全绿；改动文件 eslint 0 warning；git diff --check 0。
docs:
  required: true
  note: Record the migration in docs/dev/architecture-skeleton/ADMISSION-SEAM-MIGRATION.md; READMEs stay unchanged because no user-visible behaviour changes.
readmeUpdates: not-required
---

# Admission A4 — E2E seam rewrite

## Why

A3（TF-0649）已经把 4 个活体消费者迁到类型化入口。剩下的是 **测试侧的 legacy-override 桥**：
`tests/e2e/fixtures/electron.ts` 仍然为 `gateway:rpc` / `file:stat` / `file:readText`
查询 `ipcMain` 上的扁平 handler，多个 spec 也仍在 `ipcMain.handle(...)` 上覆盖
`gateway:status` / `gateway:rpc` / `file:stat` / `file:readText`。这让"扁平通道已退役"
的断言与测试现实不一致——测试是最后一批消费者。

A4 把它们改成**一份 typed mock 供给面**：所有 mock 都经 `host:invoke` 拦截器，
spec 只提供数据（`mockConfig`），不再注册/移除任何扁平 channel。

## Baseline（2026-11-02，`git grep` 实测）

| spec | 覆盖点 |
|---|---|
| `chat-agent-effort.spec.ts` | 6 |
| `chat-file-changes.spec.ts` | 4 |
| `chat-model-picker-tiers.spec.ts` | 4 |
| `effort-intensity-smoke.spec.ts` | 4 |
| `chat-history-startup-retry.spec.ts` | 2 |
| `chat-model-picker.spec.ts` | 2 |
| `startup-loading-experience.spec.ts` | 2 |
| `visual-tune.spec.ts` | 2 |
| `chat-cache-guard.spec.ts` | 1 |
| `chat-memory-injection-panel.spec.ts` | 1 |
| `chat-welcome-hero-fakecoding.spec.ts` | 1 |
| `chat-welcome-hero-verse-shot.spec.ts` | 1 |
| `sidebar-session-folders-archive.spec.ts` | 1 |
| **合计** | **31**（另有 fixture 内部 1 处 legacy 分支载体） |

## Migration shape

1. `tests/e2e/fixtures/electron.ts`
   - 删除 `unwrapLegacyResponse` / `getLegacyOverride` / `legacyPathForHostRequest` 与
     `originalLegacyGatewayRpc` / `originalLegacyFileStat` / `originalLegacyFileReadText`。
   - `hi` 的 mock 只保留 typed 字段：`gatewayStatus`、`gatewayRpc`、`hostApi.fileStat`、
     `hostApi.fileReadText`；未命中时返回显式错误，不再回落到扁平 handler。
2. 每个 spec 把 `ipcMain.handle('gateway:status', ...)` 换成
   `mockConfig.gatewayStatus = {...}`；`gateway:rpc` 换成 `mockConfig.gatewayRpc = { 'method': ... }`；
   `file:stat` / `file:readText` 换成对应的 `hostApi` typed 字段。
3. `tests/unit/gateway-events.test.ts` 的事件订阅键改为类型化事件名，不再出现扁平 channel 字面量。
4. `scripts/contract-check-flat-ipc.json` 的 4 条 `removalPlan` 状态改为 `seams-migrated`。

## Known migration constraints (2026-11-02, observed in Electron)

- `visual-tune.spec.ts` cannot be executed in this environment: the spec launches
  Electron directly and fails with `Process failed to launch!`. The same failure
  reproduces on the pre-migration baseline, so it is an environment limit, not a
  migration defect. Record it as `not-run`, never as a pass.
- `chat-model-picker.spec.ts` and `chat-model-picker-tiers.spec.ts` assert on a
  local `hostRequests` array populated inside the flat `gateway:rpc` handler.
  Migrating them requires reading the fixture's `__verseClawE2eHostCalls`
  observation instead, otherwise those assertions lose their source.
- `startup-loading-experience.spec.ts` depends on the *empty* `gatewayRpc: {}`
  semantics plus a 2s `chat.history` delay to observe the Chat skeleton. A second
  `installIpcMocks` call replaces the first one's mock surface; the migration must
  merge the rpc map into the existing install call and keep the delay, not add a
  parallel install.
- `chat-history-startup-retry.spec.ts` needs *stateful* rpc responses (first
  `chat.history` call fails, the retry succeeds) plus a 5s delay in the second
  test. A static `gatewayRpc` map cannot express that; a sequence seam was tried
  and the spec still failed, so it needs a dedicated pass rather than a mechanical
  rewrite.
- `chat-history-startup-retry.spec.ts` matches rpc responses by
  `stableStringify([method, params])`; the fixture's `gatewayRpc` map already uses
  that key shape, so it can migrate without a new seam.

## Non-goals

- 不改 `electron/main/ipc-handlers.ts`、`electron/preload/index.ts`。
- 不新增 Host API action、不改权限路径、默认值、产品锁或 approval 语义。
- 不因为迁移失败而放宽 E2E 断言。

## Verification

- `git grep -c "ipcMain.handle('gateway:status'|'gateway:rpc'|'file:stat'|'file:readText'" tests/` 必须为 0。
- fixture 中 `legacy` 相关标识必须为 0（`git grep -i legacy tests/e2e/fixtures/electron.ts`）。
- 每个受影响 spec 在 Electron 下真实运行并记录 exit code；无法运行写明环境原因，不解读为通过。
- `pnpm contract:check`、`pnpm run typecheck`、改动文件 eslint、`git diff --check` 全绿。

## Evidence labelling

所有运行由 agent 执行并记录 `driven_by: agent`；不声称真人证据，不据此宣称默认值或产品锁变化。
