---
id: cache-impact-declaration
title: Cache Impact Declaration
type: ai-coding-rule
severity: error
appliesTo:
  - gateway-backend-communication
pathPatterns:
  - openclaw_runtime/src/agents/provider-payload-cache-shape.ts
  - openclaw_runtime/src/agents/prompt-cache-stability.ts
  - openclaw_runtime/src/agents/system-prompt-cache-boundary.ts
  - openclaw_runtime/src/agents/compaction.ts
  - openclaw_runtime/src/agents/compaction-planning.ts
  - openclaw_runtime/src/agents/embedded-agent-runner/prompt-cache-*.ts
  - openclaw_runtime/src/agents/embedded-agent-runner/vendor-cache-policy.ts
  - openclaw_runtime/src/llm/providers/**
  - openclaw_runtime/extensions/**/openclaw.plugin.json
systemPromptPaths:
  - openclaw_runtime/src/agents/system-prompt-cache-boundary.ts
  - openclaw_runtime/src/agents/system-prompt.ts
  - openclaw_runtime/src/agents/prompt-surface.ts
  - openclaw_runtime/src/agents/tool-catalog.ts
  - openclaw_runtime/src/agents/tool-description-presets.ts
  - openclaw_runtime/src/agents/tools/common.ts
  - openclaw_runtime/src/config/types.tools.ts
---

# Rule: Cache Impact Declaration

> Mirrors the DeepSeek-Reasonix `scripts/check-cache-impact.sh` guard. Provider
> prompt-cache prefixes must stay byte-stable across turns; any change that can
> mutate the system prompt, tool schemas, or final provider payload shape is a
> cache-impacting change and must be declared.

## Requirements

- A change that touches a `pathPatterns` path must declare two lines in the PR
  body: `Cache-impact: none|low|medium|high` and `Cache-guard: <focused guard
  test/command or existing-guard rationale>`.
- A change that also touches a `systemPromptPaths` path must additionally declare
  `System-prompt-review: <reviewer/approval note>`.
- `high` means the system-prompt prefix or tool-schema set changes in a way that
  invalidates warm provider cache; `medium`/`low` mean the change is additive or
  order-normalizing; `none` means no provider payload shape is affected.
- The declaration must be absent only when no matched path is changed.

## Forbidden Patterns

- Mutating the stable system-prompt prefix or tool schema ordering in a way that
  is not deterministic (reuse `prompt-cache-stability.ts` normalization).
- Introducing non-deterministic payload keys (timestamps, random ids, unordered
  maps) into the cached prefix or tool schemas.

## Validation

- A harness check fails when a matched path is modified without a `Cache-impact:`
  declaration in the same change set.
