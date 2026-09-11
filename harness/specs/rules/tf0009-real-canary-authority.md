---
id: tf0009-real-canary-authority
title: TF-0009 Agent-Surrogate and Real Canary Evidence Authority
type: ai-coding-rule
appliesTo:
  - gateway-backend-communication
severity: error
---

# Rule: TF-0009 keeps human-canary authority separate from agent evidence

## R1: A qualifying human run remains a real operator task

Each `dcs-coding`, `sekb-assisted`, and `browser-supervised` profile still requires at least ten
recorded internal tasks through the product path for human-canary graduation. A qualifying
record has a named human operator, real task intent, complete lineage, and
`notHumanProductChat=false` where that field exists.

## R2: Agent-surrogate evidence has a separate count

Agent-surrogate tasks, fixture records, synthetic soak, scripted replay, unit tests, Electron
E2E, true-child harness tests, and Harness green may prove implementation behavior. They must
not increment the three human profile run counts or be represented as human/live canary
evidence. Agent records require `humanEquivalent=false` and `liveEvidence=false`.

## R3: The degraded agent campaign is bounded and reproducible

The agent campaign requires exactly ten records for each profile through existing component
entrypoints. DCS uses real context tools over a temporary workspace. SEKB agents may capture,
suggest, retrieve, and reject, but must not perform the positive human-confirm write. Browser
uses the approval state machine and supervised executor over an isolated page runtime; it is
not public-network evidence. Every record includes component lineage and an agent actor.

## R4: Safety rates need a qualifying human population

Automated and agent guards can prove fail-closed mechanisms. They cannot establish the human
canary rate for unauthorized writes, privacy leaks, or user success while qualifying human run
count is zero.

## R5: Agent kill proof is not the human canary drill

FP-P1-05 remains valid mechanism evidence. The agent campaign includes its own kill/rollback
drill, but it does not replace a future canary-period human operator drill or establish its
success rate.

## R6: Agent deferral is not the owner exit decision

Fixture verdicts, agent deferral, and L0/L1 engineering summaries are not the TF-0009
`continue` / `shrink` / `stop` decision. The accountable human owner may decide only after the
real run ledger and safety inputs are complete.

## R7: Degraded status and downstream authority fail closed

After the agent campaign, the evidence label is `degraded-agent-complete`. Pending review may
use `review_needed`; once review confirms that the remaining work requires human evidence,
TF-0009 must be `blocked`, never `done` on agent evidence alone. This workflow distinction follows
the user's explicit 2026-09-10 closeout instruction; frozen historical reports retain their
original status. The agent charter/report cannot self-authorize
TF-0011 release. A separate, explicitly confirmed governance proposal may allow TF-0011 to
consume the engineering evidence through a non-blocking `derived_from` edge while TF-0009 keeps
all human/live residuals. That engineering release is not TF-0009 completion.
`liveReady`, `productApproved`, and `defaultOn` remain false; C1 remains `4.5x`,
`meetsGate=false`, `recommendation=keep-off`; TF-0006 remains blocked.

## Validation

- `pnpm run tf0009:agent-surrogate`
- `pnpm exec vitest run tests/unit/tf0009-agent-surrogate.test.ts tests/unit/tf0009-engineering-evidence-audit.test.ts tests/unit/dcs-ops-canary-hard-veto.test.ts`
- `node scripts/dcs-ops-preflight.mjs`
- `pnpm harness validate --spec harness/specs/tasks/tf0009-engineering-evidence-audit.md --since HEAD`
- `git diff --check`
