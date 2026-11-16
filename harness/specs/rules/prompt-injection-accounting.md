---
id: prompt-injection-accounting
title: Prompt Injection Accounting
type: ai-coding-rule
severity: error
pathPatterns:
  - openclaw_runtime/src/context-engine/turn-injection-budget.ts
  - openclaw_runtime/src/context-engine/context-final-snapshot.ts
  - openclaw_runtime/src/context-engine/context-orchestrator.ts
  - openclaw_runtime/src/agents/embedded-agent-runner/run/attempt.ts
requiredTests:
  - pnpm exec vitest run tests/unit/semantic-convergence-prompt-budget.test.ts --maxWorkers=1
---

The managed character budget retains its existing ceiling, ordering and truncation.
Post-orchestrator prompt additions/replacements have separate accounting on the same
turn ledger; they do not silently spend or enlarge the managed budget. Joining characters
are counted in the same UTF-16 character units used by the existing budget.

The runner must call the real composer and successful-write observer. Replaying a
source or cached projection cannot charge it twice. Failed application does not record
a successful change. Replacing the base system component retires its prior attribution.

Final snapshots use the actual system prompt length to check accounting independently.
They expose managedChars, postOrchestratorChars, totalPromptChars, basePromptChars,
unaccountedChars, overaccountedChars and unbudgeted. Missing turn IDs or baseline
observations remain visible; never infer complete coverage from an accounted sum.
Snapshot accounting must stay immutable when the next call updates the ledger.

Coverage measures the system prompt and turn injection charges. It excludes ordinary
history/user/tool data and does not claim actual provider tokens or wire size. Token
window controls and structured provider usage remain separate. No new default,
product lock or release-readiness claim is authorized by this rule.
