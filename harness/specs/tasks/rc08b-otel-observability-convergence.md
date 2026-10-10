---
lifecycleStatus: archived
id: rc08b-otel-observability-convergence
title: RC-08B OTel And Observability Convergence
taskType: engineering-acceptance
# Pinned to the commit RC-08BR starts from; the shared branch diverged from
# origin/main long ago.
diffBase: 4af2fadb401bcd0068e2f001ba97dafd21ba80af
intent: Let OTel/OTLP own trace export; ingress, run, model/tool, effect, and delivery share correlation IDs; receipts and domain journals remain facts; trajectory is bounded flight-recorder evidence; Observability JSONL is rebuildable cache only. Exporter-off parity passes; default raw prompt/tool leakage is zero; one golden trace exports to a neutral OTLP fixture; no second trace schema/store is introduced.
ownedPaths:
  - openclaw_runtime/extensions/diagnostics-otel/**
  - openclaw_runtime/src/observability/trace-recorder.ts
  - openclaw_runtime/src/observability/trace-buffer.ts
  - openclaw_runtime/src/observability/correlation-ids.ts
  - openclaw_runtime/src/observability/exporter-parity.ts
  - openclaw_runtime/src/observability/rc08b-otel.test.ts
  - openclaw_runtime/src/trajectory/runtime.ts
  - openclaw_runtime/src/context-engine/dcs-observability.ts
  - tests/unit/rc08b-otel-observability-convergence.test.ts
  - harness/specs/tasks/rc08b-otel-observability-convergence.md
  - artifacts/runtime-authority-convergence/rc-08b/**
  - .agent-workbench/task-forest/**
  - docs/dev/handoffs/LATEST.md
  - docs/dev/unified-agent-system/runtime-convergence/WORK-PACKAGES.md
touchedAreas:
  - openclaw_runtime/extensions/diagnostics-otel/**
  - openclaw_runtime/src/observability/**
  - openclaw_runtime/src/trajectory/**
  - openclaw_runtime/src/context-engine/**
  - tests/unit/**
  - harness/specs/**
  - artifacts/runtime-authority-convergence/rc-08b/**
expectedUserBehavior:
  - No runtime send behavior, ordering, tools, retries, approvals, delivery, or payload bytes change.
  - OTel/OTLP owns trace export; no second trace schema or store is introduced.
  - Ingress, run, model/tool, effect, and delivery share correlation IDs.
  - Receipts and domain journals remain factual evidence; trajectory is bounded flight-recorder evidence; Observability JSONL is rebuildable cache only.
  - Exporter-off parity passes; default raw prompt/tool leakage is zero; one golden trace exports to a neutral OTLP fixture.
requiredProfiles:
  - fast
requiredRules:
  - agent-engineering-acceptance-boundary
  - runtime-authority-convergence-boundary
humanEvidence: not-required
forbiddenPatterns:
  - a second trace schema or store beyond the OTel exporter and the in-memory observability cache
  - default raw prompt/tool content leakage into the exporter
  - changing product locks, liveReady, productApproved, defaultOn, or human/live evidence counts
featureFlags:
  - The OTel exporter is the diagnostics-otel extension, gated by the existing `diagnostics.otel.enabled` config (default off); with it off the extension never subscribes and exports nothing.
rollback:
  - Set `diagnostics.otel.enabled=false` to restore exporter-off behavior.
  - No migration rollback is required because no data migration occurs.
requiredTests:
  - pnpm exec vitest run tests/unit/rc08b-otel-observability-convergence.test.ts
  - pnpm --dir openclaw_runtime exec vitest run src/observability/rc08b-otel.test.ts
  - pnpm exec vitest run tests/unit/agent-engineering-acceptance.test.ts
  - pnpm exec vitest run tests/unit/runtime-authority-convergence-control-pack.test.ts
  - pnpm harness validate --spec harness/specs/tasks/rc08b-otel-observability-convergence.md
acceptance:
  - OTel/OTLP owns trace export; no second trace schema/store is introduced.
  - Ingress, run, model/tool, effect, and delivery share correlation IDs.
  - Receipts and domain journals remain factual evidence; trajectory is bounded flight-recorder evidence; Observability JSONL is rebuildable cache only.
  - Exporter-off parity passes; default raw prompt/tool leakage is zero; one golden trace exports to a neutral OTLP fixture.
  - Product locks remain false; an RC-08B independent Verifier accepts using the RC-00 infrastructure.
docs:
  required: true
  files:
    - docs/dev/unified-agent-system/runtime-convergence/STATUS.md
    - docs/dev/unified-agent-system/runtime-convergence/WORK-PACKAGES.md
    - docs/dev/unified-agent-system/runtime-convergence/TARGET-ARCHITECTURE.md
    - docs/dev/unified-agent-system/runtime-convergence/AGENT-START.md
---

# RC-08B OTel And Observability Convergence

The diagnostics-otel extension (OTel NodeSDK with the OTLP/protobuf trace exporter) is the only
trace exporter. A hand-rolled OTLP JSON exporter in `src/observability/exporter-parity.ts` and its
trace-buffer install hook had no production caller and were a dormant second export path; they are
removed, and the trace buffer is an in-memory cache that exports nothing. Correlation comes from the
production diagnostic trace context: ingress, run, model call, tool execution, the process effect it
runs, and delivery export as one trace with a parent chain. The process-effect span (`openclaw.exec`)
previously had no parent and exported as an unrelated root trace; it now parents on the active trace.
The golden test starts the extension through the real plugin-service host, receives the export on a
local HTTP collector, and decodes it by OTLP field number; with the exporter off the same events export
nothing, and default content capture leaks no raw prompt text.
