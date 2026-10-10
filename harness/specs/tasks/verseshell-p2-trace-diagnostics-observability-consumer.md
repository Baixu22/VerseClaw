---
lifecycleStatus: archived
id: verseshell-p2-trace-diagnostics-observability-consumer
title: VerseShell P2-03 Host Diagnostics Observability Consumer
scenario: gateway-backend-communication
taskType: runtime-bridge
intent: Connect the Main-owned host trace diagnostics sink to the existing Main observability service through a safe, bounded diagnostics-only projection.
ownedPaths:
  - harness/specs/tasks/verseshell-p2-trace-diagnostics-observability-consumer.md
  - electron/services/host-trace-diagnostics.ts
  - electron/services/observability-service.ts
  - electron/main/ipc-handlers.ts
  - shared/types/observability.ts
  - tests/unit/host-trace-diagnostics.test.ts
  - tests/unit/observability-service.test.ts
touchedAreas:
  - harness/specs/tasks/verseshell-p2-trace-diagnostics-observability-consumer.md
  - electron/services/host-trace-diagnostics.ts
  - electron/services/observability-service.ts
  - electron/main/ipc-handlers.ts
  - shared/types/observability.ts
  - tests/unit/
expectedUserBehavior:
  - Failed approved terminal executions remain visible only as bounded, redacted host diagnostic summaries.
  - Existing observability traces, graph data, execution results, approval behavior, and runtime behavior remain unchanged.
  - Host diagnostics carry approval-bound lineage and fixed failure taxonomy without command, prompt, output, error text, credentials, or signatures.
requiredProfiles:
  - fast
  - comms
requiredRules:
  - contract-first-boundary
  - runtime-lineage-boundary
  - runtime-authority-convergence-boundary
  - renderer-main-boundary
  - backend-communication-boundary
  - verseshell-foundation-p0-boundary
forbiddenPatterns:
  - Converting a host diagnostic summary into an ObservabilityTrace, span, event, graph node, or trajectory row.
  - Copying command, prompt, stdout, stderr, arbitrary error text, approval token, credential, secret, or signature into the consumer projection.
  - Exposing the HMAC secret or envelope authority to renderer, runtime, model, Gateway, receipt, support, or OTLP consumers.
  - Adding receipt-store, support-bundle, diagnostic-events, OTLP, persistence, database, UI, renderer, feature-flag, default-on, retry, fallback, approval, or rollout wiring.
  - Making the diagnostic projection affect execution, provider selection, prompt assembly, completion, failure, retry, approval, security, or runtime state.
featureFlags:
  - No feature flag is added or changed; the existing Main adapter remains active only at its existing approved-failure callsite.
rollback:
  - Remove the observability callback and bounded projection. The Main terminal diagnostic sink and existing terminal behavior remain independently reversible.
requiredTests:
  - pnpm harness context --spec harness/specs/tasks/verseshell-p2-trace-diagnostics-observability-consumer.md
  - pnpm harness validate --spec harness/specs/tasks/verseshell-p2-trace-diagnostics-observability-consumer.md --no-diff
  - pnpm exec vitest run tests/unit/host-trace-diagnostics.test.ts tests/unit/observability-service.test.ts tests/unit/terminal-api.test.ts tests/unit/support-bundle-redaction.test.ts --maxWorkers=1
  - pnpm run typecheck:node
  - git diff --check -- harness/specs/tasks/verseshell-p2-trace-diagnostics-observability-consumer.md electron/services/host-trace-diagnostics.ts electron/services/observability-service.ts electron/main/ipc-handlers.ts shared/types/observability.ts tests/unit/host-trace-diagnostics.test.ts tests/unit/observability-service.test.ts tests/unit/terminal-api.test.ts tests/unit/support-bundle-redaction.test.ts
acceptance:
  - The Main diagnostics service verifies and emits a safe record to an explicitly injected consumer callback after approval binding.
  - The Observability consumer stores only a separately projected, bounded summary with validated lineage, fixed failureKind, bounded numeric metadata, and the raw-fields-omitted marker.
  - The consumer is never represented as a full trace and does not enter trace indexing, graph construction, trajectory projection, receipt storage, support bundle export, or OTLP.
  - The projection keeps at most 200 records, drops the oldest record first, returns defensive copies, and is cleared with the existing observability memory reset.
  - Tests prove callback reachability, safe projection, bounded retention, defensive copies, clear behavior, and no raw-field leakage.
  - Existing terminal approval and execution results remain unchanged and successful or unapproved executions produce no host diagnostic record.
docs:
  required: false
  notes:
    - This is an internal Main-process consumer with no new user-visible flow or locale surface.
---

# VerseShell P2-03 Host Diagnostics Observability Consumer

This follow-up connects the already production-reachable Main adapter to the
existing Main observability service. The consumer receives a safe summary only;
it does not create or extend a full ObservabilityTrace.

The host adapter remains the authority for the process-local signing secret,
approval binding, envelope verification, and raw-field redaction. Observability
owns only a bounded in-memory list of projected summaries for Main-side
diagnostic inspection. It is not a receipt, support artifact, trajectory row,
runtime event, or execution decision.
