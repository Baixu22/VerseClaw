---
id: line-c-grounding-formal-runtime-use-readiness
title: Line C grounding formal runtime-use readiness boundary
scenario: gateway-backend-communication
taskType: runtime-bridge
intent: Evaluate the next formal-use boundary after accepted default-on diagnostics-only Runtime Grounding metadata, without expanding authority or implementing any runtime consumption path unless a later spec explicitly approves it.
ownedPaths:
  - harness/specs/tasks/line-c-grounding-formal-runtime-use-readiness.md
  - runtime-research/handoffs/line-c-grounding-formal-runtime-use-readiness/**
  - runtime-research/agent-runtime-index.md
touchedAreas:
  - harness/specs/tasks/line-c-grounding-formal-runtime-use-readiness.md
  - runtime-research/handoffs/line-c-grounding-formal-runtime-use-readiness/**
  - runtime-research/agent-runtime-index.md
expectedUserBehavior:
  - The already accepted surface remains the default-on diagnostics-only metadata helper in runtime-core.
  - Default-on output remains local, bounded, summary-only, metadata-only, diagnostics-only, non-authoritative, and rollbackable with `enabled: false` or `killSwitch: true`.
  - Required markers remain `authority: "none"`, `rawRetained: false`, `includeRaw: false`, and `includeUntrusted: false`.
  - Any proposal for a formal consumer surface must first prove it does not influence prompt/model-message/provider/Gateway/TaskLoop/runtime decisions or any completion/tool/security/approval/retry authority.
  - If formal use requires crossing a forbidden boundary, the readiness verdict must be `needs_revision`.
requiredProfiles:
  - fast
  - comms
requiredRules:
  - renderer-main-boundary
  - backend-communication-boundary
  - api-client-transport-policy
  - host-api-fallback-policy
  - host-events-fallback-policy
  - gateway-readiness-policy
  - comms-regression
  - docs-sync
allowedSurface:
  - Existing runtime-core `createGroundingShadowConsumerSummary` default-on diagnostics-only metadata helper for valid sanitized refs.
  - Bounded summary metadata and local diagnostics output with `authority: "none"`, `rawRetained: false`, `includeRaw: false`, and `includeUntrusted: false`.
  - Disable rollback through `enabled: false` and emergency rollback through `killSwitch: true`.
pendingEvaluation:
  - Whether any formal consumer surface can exist while remaining metadata-only, diagnostics-only, non-authoritative, non-persistent, non-transport, non-prompt, non-model-message, and outside runtime decisions.
  - Whether a future consumer can be explicit, bounded, operator-auditable, reversible, and proven with byte-identical prompt/model/provider/runtime-decision drift checks.
  - Whether the existing helper can support a formal diagnostics presentation without adding persistence, cache, listener, exporter, service, UI/API, provider registration, TaskLoop authority, or memory mutation.
forbiddenPatterns:
  - runtime authority, prompt authority, model-message authority, provider ordering authority, provider selection authority, Gateway request authority, TaskLoop authority, completion authority, tool authority, security authority, approval authority, retry authority, runtime decision authority, memory promotion authority, fact acceptance authority, episode write authority, persistence authority, patch authority, symbol authority, or workspace mutation authority
  - prompt/model-message/provider payload insertion, Gateway request payload insertion, provider ordering drift, provider selection drift, runtime decision drift, TaskLoop cutover, default provider registration, provider transport mutation, runtime send/receive changes, delivery changes, fallback changes, or comms path changes
  - raw prompt, raw trace, full payload, full event payload, tool args, tool output, stdout, stderr, env, secrets, API keys, auth headers, traceparent, tracestate, baggage, transcripts, JSONL imports, raw retention, untrusted refs, includeRaw true, or includeUntrusted true
  - persistence, cache, database, sidecar, service, listener, exporter, daemon, server, memory promotion, fact acceptance, episode write, memory store write, fact store write, patch apply, workspace edit, symbol mutation, rename, replaceBody, insertBefore, insertAfter, safeDelete, UI setting, public API, renderer IPC, host-api/api-client contract, Gateway route, or provider registration
featureFlags:
  - No new flag is authorized by this readiness task.
  - Existing rollback remains `enabled: false` or `killSwitch: true` at the metadata helper call site.
  - No UI setting, public API, Gateway route, IPC route, host-api contract, api-client contract, provider registration, provider ordering, TaskLoop gate, prompt/model-message gate, persistence gate, cache gate, service gate, listener gate, exporter gate, memory-write gate, patch gate, workspace-edit gate, or runtime decision gate is authorized.
rollback:
  - Keep the current accepted helper within diagnostics-only metadata boundaries.
  - If any formal-use design requires a forbidden boundary, mark synthesis `needs_revision` and do not implement runtime integration.
  - If validation finds drift, retain or force `enabled: false` / `killSwitch: true` and revise the design.
rejectedBoundaries:
  - runtime authority, prompt/model-message/provider/Gateway/TaskLoop/runtime decision integration, completion/tool/security/approval/retry authority, raw retention, untrusted refs, persistence/cache/service/listener/exporter/database/sidecar, memory promotion, fact acceptance, episode write, patch apply, workspace edit, symbol mutation, UI/API/transport changes, and any production rollout beyond diagnostics metadata
requiredTests:
  - node harness/src/cli.mjs context --spec harness/specs/tasks/line-c-grounding-formal-runtime-use-readiness.md
  - node harness/src/cli.mjs validate --spec harness/specs/tasks/line-c-grounding-formal-runtime-use-readiness.md
  - node harness/src/cli.mjs validate --spec harness/specs/tasks/line-c-grounding-formal-runtime-use-readiness.md --no-diff
  - git status --short
  - git diff --stat
  - git diff --check -- harness/specs/tasks/line-c-grounding-formal-runtime-use-readiness.md runtime-research/handoffs/line-c-grounding-formal-runtime-use-readiness/README.md runtime-research/handoffs/line-c-grounding-formal-runtime-use-readiness/implementation-synthesis.md runtime-research/agent-runtime-index.md
  - rg boundary scan for runtime authority/prompt/model-message/provider ordering/provider selection/Gateway request/TaskLoop/runtime decision/completion/tool/security/approval/retry/raw retention/includeRaw/includeUntrusted/untrusted refs/persistence/cache/service/listener/exporter/database/sidecar/memory promotion/fact acceptance/episode write/patch apply/workspace edit/symbol mutation
acceptance:
  - Fresh readiness spec exists and validates structurally.
  - The handoff documents that allowed capability remains diagnostics-only metadata helper default-on.
  - The handoff documents that any broader formal use is pending evaluation and cannot proceed if it needs a forbidden boundary.
  - No runtime code, prompt/model-message/provider/Gateway/TaskLoop/runtime decision path, persistence/cache/service/listener/exporter, UI/API/transport, memory write, patch, workspace edit, or symbol mutation is implemented.
  - Final synthesis status is `needs_revision` if broader formal use requires any forbidden boundary.
docs:
  required: true
  files:
    - runtime-research/handoffs/line-c-grounding-formal-runtime-use-readiness/README.md
    - runtime-research/handoffs/line-c-grounding-formal-runtime-use-readiness/implementation-synthesis.md
    - runtime-research/agent-runtime-index.md
nextPhaseEntry:
  Allowed next phase:
    - A narrower future spec may propose a single explicit diagnostics-only consumer surface only if it preserves all required markers and proves zero prompt/model-message/provider/Gateway/TaskLoop/runtime-decision drift.
  Still forbidden:
    - runtime authority, prompt/model-message/provider/Gateway/TaskLoop/runtime decision integration, completion/tool/security/approval/retry authority, raw retention, untrusted refs, persistence/cache/service/listener/exporter/database/sidecar, memory promotion, fact acceptance, episode write, patch apply, workspace edit, symbol mutation, UI/API/transport changes, and broader formal use without a later accepted spec
---

# Line C Grounding Formal Runtime-use Readiness Boundary

This task is a boundary evaluation and documentation step. It does not authorize formal runtime integration beyond the already accepted diagnostics-only metadata helper.
