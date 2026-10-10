---
lifecycleStatus: archived
id: runtime-intensity-policy
title: Runtime Intensity Policy
scenario: gateway-backend-communication
taskType: runtime-bridge
intent: Promote thinking intensity from provider reasoning payload selection into a runtime-owned prompt, context, skills, and output-density policy while preserving ordinary Chat capability parity.
touchedAreas:
  - harness/specs/tasks/runtime-intensity-policy.md
  - openclaw_runtime/src/agents/**
  - openclaw_runtime/src/skills/loading/**
  - openclaw_runtime/src/config/sessions/types.ts
  - tests/unit/runtime-intensity-policy.test.ts
  - docs/clawx-design-overview.md
  - README.md
  - README.zh-CN.md
  - README.ja-JP.md
expectedUserBehavior:
  - Minimal and low thinking intensity prefer lower token use through slimmer prompt/context defaults, compact skills catalog exposure, tighter tool-result projection, and concise final output guidance.
  - Medium, auto, adaptive, off, and unset thinking intensity preserve the current baseline runtime behavior.
  - High and xhigh thinking intensity preserve full prompt/context defaults and may guide the assistant to consider explicit long-task, ClawGraph, or role orchestration workflows for complex work.
  - Intensity never grants or removes permissions, runtime tools, MCP tools, Skills, Office/Web providers, file access, terminal access, approval bypasses, Task Ledger authority, Knowledge write authority, or `/loop` authority.
requiredProfiles:
  - fast
  - comms
requiredRules:
  - backend-communication-boundary
  - chat-loop-boundary
  - docs-sync
requiredTests:
  - pnpm harness validate --spec harness/specs/tasks/runtime-intensity-policy.md
  - pnpm test tests/unit/runtime-intensity-policy.test.ts
  - pnpm test tests/unit/chat-agent-effort-popover.test.tsx tests/unit/agent-config.test.ts
  - pnpm run typecheck
acceptance:
  - Runtime resolves one additive intensity policy per embedded agent attempt from the requested thinking level before model downgrade (linked-v1), while legacy paths still derive it from the effective thinking level.
  - Explicit prompt mode overrides, raw model runs, and promptMode none are not overridden by intensity policy.
  - Minimal and low may select minimal prompt density, compact/top-K skills prompt exposure, and tighter tool-result/context-pressure thresholds for the current run only.
  - Runtime skill registry, user-invocable skills, tool allowlists, provider capabilities, approvals, Task Ledger state, ClawGraph, Mission, and `/loop` entry behavior are unchanged by low/minimal intensity.
  - System prompt reporting includes additive runtime intensity metadata without storing raw prompts or introducing new persistence.
  - Documentation explains thinking intensity as a cost/context/output-density preference, not an authorization or capability switch.
docs:
  required: true
  files:
    - docs/clawx-design-overview.md
    - README.md
    - README.zh-CN.md
    - README.ja-JP.md
---

This task implements the first runtime-owned intensity policy layer. It intentionally avoids adding new UI or a new persistent config schema in v1.
