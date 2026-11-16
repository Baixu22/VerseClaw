---
lifecycleStatus: active
id: session-handoff-recovery
title: Persist fork questions and recover handoff creation and first delivery
scenario: gateway-backend-communication
taskType: runtime-bridge
diffBase: 806855309
intent: Keep source generation, child identity and first-send identity in the existing Workspace owner and reconcile through runtime/transcript facts.
ownedPaths:
  - shared/types/session-handoff.ts
  - shared/types/workspace.ts
  - shared/chat/types.ts
  - shared/host-api/contract.ts
  - electron/services/workspaces-api.ts
  - electron/services/sessions-api.ts
  - electron/services/chat-api.ts
  - openclaw_runtime/src/gateway/server-methods/sessions.read.ts
  - src/lib/host-api.ts
  - src/lib/workspace-session.ts
  - src/stores/chat.ts
  - src/pages/Chat/index.tsx
  - src/pages/Chat/ChatMessage.tsx
  - shared/i18n/locales/**/chat.json
  - tests/unit/session-handoff-recovery.test.ts
  - tests/unit/chat-message.test.tsx
  - tests/unit/electron-process-identity.test.ts
  - tests/e2e/fixtures/windows-process.ts
  - tests/e2e/session-fork-intent.spec.ts
  - tests/unit/host-services.test.ts
  - tests/unit/workspace-session.test.ts
  - tests/e2e/chat-session-handoff.spec.ts
  - tests/e2e/chat-session-fork.spec.ts
  - tests/e2e/session-task-scope-derivation.spec.ts
  - tests/e2e/session-derivation-ui.spec.ts
  - harness/specs/tasks/session-handoff-recovery.md
  - harness/specs/fixtures/session-derivation-ui/**
  - docs/modules/multi-agent-and-tasks.md
touchedAreas:
  - README.md
  - README.zh-CN.md
  - README.ja-JP.md
  - README.ru-RU.md
  - harness/specs/fixtures/session-intent-recovery/**
  - shared/**
  - electron/services/**
  - openclaw_runtime/src/gateway/server-methods/sessions.read.ts
  - src/**
  - tests/**
  - harness/specs/tasks/session-handoff-recovery.md
  - harness/specs/fixtures/session-derivation-ui/**
  - docs/modules/multi-agent-and-tasks.md
requiredRules:
  - identity-scope-boundary
  - backend-communication-boundary
  - renderer-main-boundary
  - session-derivation-ui-contract
  - i18n-locale-coverage
  - comms-regression
  - docs-sync
  - disk-temp-policy
requiredProfiles:
  - fast
  - comms
  - e2e
expectedUserBehavior:
  - Ask in a new session previews the preceding-assistant boundary and opens an editable question without sending.
  - Handoff explicitly creates and sends; Main confirms a runtime parent before activation.
  - Repeated requests and lost responses retain one operation, child and first-send key across restart.
  - Unknown delivery is reconciled against the exact run or transcript identity and is never silently resent.
acceptance:
  - Cancel and invalid fork boundaries create nothing and preserve the source draft.
  - Creation recovery reuses a runtime-confirmed child and verifies source generation.
  - First delivery has separate pending, accepted, transcript-confirmed, failed and unknown states.
  - Changed payload cannot reuse a send identity; existing task states and writer fences are preserved.
  - Focused owner tests and Electron journeys retain negative and restart evidence with four-locale UI.
requiredTests:
  - pnpm exec vitest run tests/unit/chat-message.test.tsx --maxWorkers=1
  - pnpm exec playwright test tests/e2e/session-fork-intent.spec.ts --workers=1
  - pnpm exec vitest run tests/unit/session-handoff-recovery.test.ts tests/unit/host-services.test.ts tests/unit/workspace-session.test.ts --maxWorkers=1 --no-file-parallelism
  - pnpm exec playwright test tests/e2e/chat-session-handoff.spec.ts tests/e2e/chat-session-fork.spec.ts tests/e2e/session-derivation-ui.spec.ts --workers=1
  - pnpm run typecheck
  - pnpm run contract:check
  - pnpm run i18n:lint
  - pnpm run comms:replay
  - pnpm run comms:compare
  - pnpm harness validate --spec harness/specs/tasks/session-handoff-recovery.md
  - pnpm harness run --spec harness/specs/tasks/session-handoff-recovery.md --dry-run
docs:
  required: true
  files:
    - README.md
    - README.zh-CN.md
    - README.ja-JP.md
    - README.ru-RU.md
    - docs/modules/multi-agent-and-tasks.md
---

U3 keeps runtime session ancestry authoritative. Workspace stores operation metadata;
Task Ledger stores task references. A Gateway acknowledgement is recorded separately
from a transcript-confirmed first turn.
