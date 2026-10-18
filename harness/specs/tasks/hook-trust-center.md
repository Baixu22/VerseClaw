---
lifecycleStatus: active
id: hook-trust-center
title: Hook Trust and Lifecycle Center (TF-0384)
type: task
scenarios:
  - identity-scope-compatibility
requiredRules:
  - identity-scope-boundary
  - docs-sync
  - repository-artifact-retention
  - task-forest-autoclose-and-roles
touchedAreas:
  - openclaw_runtime/src/config/types.hooks.ts
  - openclaw_runtime/src/hooks/trust.ts
  - openclaw_runtime/src/hooks/loader.ts
  - openclaw_runtime/src/hooks/hooks-status.ts
  - electron/services/hooks-api.ts
  - electron/main/ipc-handlers.ts
  - shared/host-api/contract.ts
  - src/lib/host-api.ts
  - src/components/settings/HooksTrustPanel.tsx
  - src/pages/Settings/index.tsx
  - shared/i18n/locales/en/settings.json
  - shared/i18n/locales/zh/settings.json
  - shared/i18n/locales/ja/settings.json
  - shared/i18n/locales/ru/settings.json
  - tests/unit/hook-trust.test.ts
  - tests/e2e/settings-hooks-trust.spec.ts
  - harness/specs/tasks/hook-trust-center.md
  - harness/specs/fixtures/tf0384-hook-trust-center/**
---

# TF-0384 Hook Trust and Lifecycle Center

## Objective

Make hook code executable only when its owner trust policy is satisfied. Expose
the actual source, content hash, trust state and managed status through the
existing Main host API and Settings UI, and audit trust/enable changes.

## Scope

- Workspace hooks require explicit `trusted: true` and a matching
  `trustedHash`; an untrusted or changed handler is not registered.
- Bundled/managed/plugin hooks stay managed by their owner; a pinned hash that
  no longer matches disables execution and is reported as changed.
- Main exposes `hooks.list` and `hooks.setTrusted` through the existing
  host-api boundary. Renderer does not access the filesystem directly.
- Settings lists source, sha256, trust state and managed state, and allows
  trust/untrust and enable/disable only where the owner permits it.
- Trust/enable mutations append a JSONL audit event.
- No second hook runtime, event vocabulary or marketplace is introduced.

## Acceptance

- `pnpm typecheck` passes.
- `pnpm contract:check` passes.
- `pnpm run i18n:lint` passes.
- `pnpm exec vitest run tests/unit/hook-trust.test.ts` passes.
- `pnpm run test:e2e:run tests/e2e/settings-hooks-trust.spec.ts` passes under
  Node 24.16.0.
- `pnpm harness validate --spec harness/specs/tasks/hook-trust-center.md` passes.
- `git diff --check` passes.
- Managed hooks cannot be disabled and non-workspace hooks remain owner-managed.

## Notes

The Main-side list uses a lightweight HOOK.md scan to avoid bundling the full
runtime discovery dependency graph; the runtime loader and Main list share the
same pure trust resolver. Receipts are agent-driven.
