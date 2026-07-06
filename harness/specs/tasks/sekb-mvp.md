---
id: sekb-mvp
title: Self-evolving knowledge base MVP
scenario: gateway-backend-communication
taskType: runtime-bridge
intent: Add a runtime-side SEKB MVP that captures structured trajectories, stores three knowledge layers, retrieves relevant principles for advisory context, and supports manual distillation without bypassing the host API boundary.
touchedAreas:
  - openclaw_runtime/src/knowledge/sekb/**
  - openclaw_runtime/src/state/**
  - openclaw_runtime/src/agents/**
  - docs/enhancements/sekb-mvp.md
  - docs/superpowers/plans/2026-07-06-sekb-mvp.md
  - shared/knowledge/**
  - src/lib/host-api.ts
  - electron/services/knowledge-api.ts
  - harness/specs/tasks/sekb-mvp.md
expectedUserBehavior:
  - Runtime tasks can be recorded as structured L3 trajectories with bounded steps, outcome, cost, and deterministic error signatures.
  - Humans can confirm L2 principles from L3 trajectories; no MVP flow writes principles without an explicit confirmation call.
  - New tasks can retrieve active L2 principles for advisory context by task intent, task type, and context tags.
  - Error handling can request a second advisory retrieval by error_signature without blocking tools, retrying work, or silently correcting behavior.
  - The active L1 index remains bounded to 2K approximate tokens and contains only non-archived active principles.
requiredProfiles:
  - fast
  - comms
requiredRules:
  - sekb-runtime-development-loop
requiredTests:
  - openclaw_runtime/src/knowledge/sekb/*.test.ts
acceptance:
  - SEKB storage uses runtime-side SQLite/OpenClaw persistence patterns and does not introduce a required external database or vector service.
  - Embeddings are optional and nullable; lexical retrieval remains deterministic when embeddings are absent.
  - error_signature extraction is deterministic, idempotent, and cached by raw error hash.
  - Trajectory steps are compressed after 50 entries while preserving useful beginning and ending context.
  - Distillation suggestions are manual/advisory in MVP and confirm_and_save is the only path that marks source trajectories distilled.
  - Renderer code, if touched, calls SEKB/Knowledge functionality only through src/lib/host-api.ts and never directly invokes IPC or Gateway HTTP.
  - Stage 2/3 schema extension fields are present but no autonomous verifier, curator, pause, retry, hidden correction, or tool blocking is added.
  - AgentHarness integration, if enabled, uses existing hook seams and remains no-op unless explicitly installed.
  - SEKB hook failures do not fail agent execution; they are reported only through an optional diagnostic callback.
  - Tool-error advice is visible advisory context, not a hidden correction, retry, pause, or block.
  - The operator report is read-only and does not write principles or mark trajectories distilled.
docs:
  required: true
---

SEKB-MVP is a runtime knowledge substrate aligned with the existing Knowledge Hub and OpenClaw persistence work. It adds structured experience capture and advisory retrieval without changing default agent authority.
