---
id: token-dense-recovery-compression-v1
title: Token-dense recovery compression v1
scenario: gateway-backend-communication
taskType: runtime-bridge
intent: Upgrade session compaction from legacy string summaries to structured, evidence-aware recovery artifacts that can seed the next prompt or handoff without rereading the full transcript.
touchedAreas:
  - openclaw_runtime/packages/agent-core/src/harness/compaction/**
  - openclaw_runtime/packages/gateway-protocol/src/**
  - openclaw_runtime/src/gateway/server-methods/**
  - openclaw_runtime/src/gateway/session-compaction-checkpoints.ts
  - openclaw_runtime/src/config/sessions/types.ts
  - electron/services/sessions-api.ts
  - shared/host-api/contract.ts
  - src/lib/host-api.ts
  - src/pages/Chat/**
  - shared/i18n/locales
expectedUserBehavior:
  - Manual and automatic compaction preserve a structured CompressionArtifact when available.
  - Existing summary/history consumers keep working through the rendered legacy summary.
  - Chat can show compaction quality, score, evidence coverage, unverified count, and projected recovery tokens.
  - Handoff uses recoveryContext before falling back to checkpoint/transcript-only continuation.
requiredProfiles:
  - fast
  - comms
requiredRules:
  - renderer-main-boundary
  - backend-communication-boundary
  - api-client-transport-policy
  - comms-regression
  - docs-sync
requiredTests:
  - pnpm run typecheck
  - pnpm exec vitest run tests/unit/compression-artifact.test.ts tests/unit/host-api-facade.test.ts tests/unit/host-services.test.ts tests/unit/chat-input.test.tsx
  - pnpm run comms:replay
  - pnpm run comms:compare
acceptance:
  - Runtime compaction details include artifact/quality metrics or deterministic fallback warnings.
  - Gateway exposes sessions.compressionArtifact and sessions.recoveryContext through formal protocol validators.
  - Renderer calls only Host API facade methods; it does not read transcripts or call Gateway directly.
  - Quality gates surface warnings instead of silently presenting low-evidence compression as high confidence.
docs:
  required: true
  files:
    - docs/clawx-design-overview.md
    - README.md
    - README.zh-CN.md
    - README.ja-JP.md
---

`CompressionArtifact v1` is a recovery carrier, not a proof of task completion. Task Ledger, ClawGraph handoffs, and observability remain the authoritative evidence layers for durable long-task truth.
