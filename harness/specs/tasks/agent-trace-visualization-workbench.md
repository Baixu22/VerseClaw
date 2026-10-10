---
lifecycleStatus: archived
id: agent-trace-visualization-workbench
title: Deepen Observability into an agent trace visualization workbench
scenario: gateway-backend-communication
taskType: runtime-bridge
intent: Upgrade the Observability page from trace tables and span waterfalls into an agent-chain diagnostic workbench with Host API graph data, node diagnostics, trajectory recovery, interactive graph exploration, and a Chat-to-trace deep link while preserving Main-owned communication boundaries.
touchedAreas:
  - harness/specs/tasks/agent-trace-visualization-workbench.md
  - shared/types/observability.ts
  - shared/host-api/contract.ts
  - src/lib/host-api.ts
  - electron/services/observability-api.ts
  - electron/services/observability-service.ts
  - electron/services/observability-graph.ts
  - electron/services/observability-trajectory.ts
  - openclaw_runtime/src/observability/trace-buffer.ts
  - src/stores/observability.ts
  - src/pages/Observability/**
  - src/pages/Chat/ExecutionGraphCard.tsx
  - src/pages/Chat/index.tsx
  - shared/i18n/locales/*/observability.json
  - shared/i18n/locales/*/chat.json
  - tests/unit/observability-graph.test.ts
  - tests/unit/observability-trace-buffer.test.ts
  - tests/e2e/observability-trace-graph.spec.ts
expectedUserBehavior:
  - Observability opens as a three-column workbench with trace list, graph canvas, and details panel.
  - Selecting a trace renders a graph of the root task, agent/router/model/tool/file/error nodes and critical error paths.
  - The graph supports search, status/type/phase/focus filtering, pan/zoom, fit-to-screen, mini-map navigation, and collapse/expand for noisy branches.
  - Clicking graph nodes updates the diagnostic drawer and the Timeline tab without exposing full raw prompts or outputs.
  - Node diagnostics expose summary, events, redacted I/O, artifacts, and whitelisted attributes for engineering investigation.
  - Recent runtime traces are ordered newest-first and can be recovered from trajectory sidecars where available.
  - Active Chat execution graph cards expose a View Trace entry that deep-links to the corresponding Observability trace.
requiredProfiles:
  - fast
  - comms
requiredRules:
  - renderer-main-boundary
  - backend-communication-boundary
  - api-client-transport-policy
  - host-api-fallback-policy
  - host-events-fallback-policy
  - comms-regression
requiredTests:
  - pnpm run typecheck
  - pnpm exec vitest run tests/unit/observability-mvp.test.ts tests/unit/observability-service.test.ts tests/unit/observability-graph.test.ts tests/unit/observability-trace-buffer.test.ts tests/unit/role-orchestration-methods.test.ts tests/unit/host-events.test.ts
  - pnpm run test:e2e -- tests/e2e/observability-trace-graph.spec.ts
  - pnpm harness validate --spec harness/specs/tasks/agent-trace-visualization-workbench.md
acceptance:
  - Renderer Observability and Chat code use src/lib/host-api.ts and do not add direct IPC or Gateway HTTP calls.
  - observability.traceGraph({ id }) returns trace, graph, and timeline data or null for an unknown trace.
  - observability.traceNodeDiagnostics({ traceId, nodeId }) returns structured redacted diagnostics or null for an unknown trace/node.
  - Graph summary exposes critical path, error, slow, token hotspot, and artifact node ids for UI highlighting.
  - Graph nodes and detail previews use redacted/truncated summaries rather than full raw prompt/output payloads.
  - Graph UI uses local React/SVG/HTML and does not introduce a graph visualization dependency.
  - All new user-facing strings are covered in en, zh, ja, and ru locale files.
docs:
  required: true
---
