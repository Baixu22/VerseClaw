---
id: prompt-contribution-authority
title: Prompt Contribution Authority
type: ai-coding-rule
severity: error
pathPatterns:
  - openclaw_runtime/src/context-engine/context-candidate.ts
  - openclaw_runtime/src/context-engine/prompt-contribution-authority.ts
  - openclaw_runtime/src/plugins/hook-before-agent-start.types.ts
  - openclaw_runtime/src/plugins/hooks.ts
  - openclaw_runtime/src/plugins/registry.ts
requiredTests:
  - pnpm exec vitest run tests/unit/semantic-convergence-prompt-authority.test.ts --maxWorkers=1
---

Every supported prompt mutation maps to exactly one required authority. Producer
declarations name authority, source, exact field/target scope and a nonempty reason.
Candidate identity/digests and hook result content do not grant mutation privileges.
The admitting host supplies candidate declarations; plugin hook declarations come from
registration metadata, copied independently of plugin-owned mutable arrays.

Enforce mode admits undeclared append-data contributions only. It checks source, scope,
and authority before candidate collection/budget charging or per-producer hook merging.
Denial throws `PROMPT_CONTRIBUTION_AUTHORITY_DENIED`; normal fail-open hook error handling
must not swallow it, return a partial merge, or convert a replacement into append data.
An empty systemPrompt is still a replacement. A prior hook cannot grant a later hook rights.

Warn mode preserves existing prompt behavior while reporting violations. It is not
enforcement evidence. New claims must state the tested mode; changing a frozen default
still requires the publisher's authority. These declarations govern declared mutation
surfaces, not the semantic safety of arbitrary appended data or a malicious in-process
plugin. Native assembly, post-orchestrator additions and seal coverage have separate gates.
