---
id: p1-telemetry-opt-out
title: Stop telemetry immediately when runtime consent is revoked
scenario: gateway-backend-communication
taskType: runtime-bridge
diffBase: origin/main
intent: Fix GitHub issue 129 by applying telemetry consent changes to the existing Main-owned SDK lifecycle, discarding queued events on opt-out and preserving all frozen defaults.
ownedPaths:
  - electron/utils/telemetry.ts
  - electron/services/settings-api.ts
touchedAreas:
  - electron/utils/telemetry.ts
  - electron/services/settings-api.ts
  - tests/unit/telemetry.test.ts
  - tests/unit/telemetry-consent.test.ts
  - tests/unit/host-services.test.ts
  - tests/e2e/telemetry-consent.spec.ts
  - docs/dev/telemetry-consent-lifecycle.md
  - harness/specs/tasks/p1-telemetry-opt-out.md
  - harness/specs/rules/telemetry-consent-lifecycle.md
  - scripts/repository-artifacts.json
  - .gitignore
  - README.md
  - README.zh-CN.md
  - README.ja-JP.md
  - README.ru-RU.md
expectedUserBehavior:
  - settings.set and settings.setMany disabling telemetry stop accepting subsequent events without restarting the application.
  - Opt-out cancels pending initialization and aborts in-flight transport best-effort; already queued events are discarded locally, never flushed to the collector after revocation or a later opt-in.
  - Repeated opt-in and opt-out are idempotent, use one active client and never repeat app_installed merely because the user toggles the setting.
  - Cold-start opt-out does not create a client, read a machine identifier or send telemetry.
requiredProfiles:
  - fast
  - comms
requiredRules:
  - docs-sync
  - repository-artifact-retention
  - telemetry-consent-lifecycle
requiredTests:
  - pnpm exec vitest run tests/unit/telemetry.test.ts tests/unit/telemetry-consent.test.ts tests/unit/host-services.test.ts
  - pnpm run typecheck
  - pnpm run typecheck:test
  - pnpm exec playwright test tests/e2e/telemetry-consent.spec.ts --workers=1
forbiddenPatterns:
  - changing telemetry defaults, collector ownership, public ingest identifier or frozen product locks
  - sending real telemetry or collecting a real machine identifier in tests
  - treating SDK disable alone as proof that its preexisting queue cannot flush
  - using renderer-owned network or direct IPC for the setting
riskNotes:
  - The SDK disable API only gates new capture; its existing flush queue requires a separate revoked-consent transport guard and shutdown.
  - A request already delivered before opt-out cannot be recalled; abort is best effort, not a claim to undo prior external effects.
  - GitHub issue 86 remains a separate endpoint/default-policy decision; this fix does not change its scope or close it.
docs:
  required: true
  reason: Document immediate runtime opt-out, local queue discard and the in-flight boundary in all README locales.
acceptance:
  - Synthetic no-network sinks exercise the real installed SDK queue and both host settings mutation entry points, including a queued flush after re-enable.
  - Tests cover opt-out during asynchronous initialization, idempotent re-enable, cold-start opt-out and settings reset behavior.
  - An Electron E2E test covers the existing settings switch and persisted host settings without contacting the collector or using a real machine identifier.
  - Record actual exits and disk evidence; keep full500 source and all unrelated dirty worktrees unchanged.
---

All verification is agent-driven. No real-human data, live collector traffic,
new analytics project, product default changes or publication is authorized here.
