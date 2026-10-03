---
id: tf0009-real-canary-authority
title: TF-0009 Agent-Surrogate and Real Canary Evidence Authority
type: ai-coding-rule
appliesTo:
  - gateway-backend-communication
severity: error
---

# Rule: TF-0009 accepts verified agent evidence without claiming human or product authority

Effective 2026-09-27, per AGENTS.md. This supersedes the September 10 R7 human-only gate. Historical v1 reports keep their original values; current campaigns use v2.

## R1: A qualifying human run remains a real operator task

Each `dcs-coding`, `sekb-assisted`, and `browser-supervised` profile requires ten recorded agent tasks through the existing component entrypoints, with task intent, lineage and named agent attribution. Human counts remain zero. No human population or verdict is a prerequisite for node completion.

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
drill, which satisfies the node drill criterion. Its success rate describes only the observed agent campaign, never an unobserved human population.

## R6: Agent deferral is not the owner exit decision

A named agent records the bounded `continue` / `shrink` / `stop` decision after reading the run ledger, safety observations and kill/rollback result. Record `driven_by: agent`; this grants no product approval.

## R7: Degraded status and downstream authority fail closed

Current v2 evidence uses `agent-acceptance-complete`. TF-0009 may be `done/100` after all four criteria are verified from a clean candidate, with artifact hashes and zero credential findings. Missing, unsafe or unverifiable agent evidence keeps the node open; missing human evidence never does. TF-0007 may close only after TF-0008 and TF-0009 are verified complete. Use the proposal/apply/validate/export workflow from `task-forest-autoclose-and-roles`.

The v1 validator remains available for frozen July evidence; a v1 report cannot authorize current closure. The v2 validator rejects missing policy/driver/candidate identity, duplicate or missing runs, unsafe records, failed drill steps, human/live relabeling and product-lock changes. The historical `0/10` human counts remain factual limitations, not permanent blocking residuals. TF-0011 retains its separate non-blocking `derived_from` evidence edge.
`liveReady`, `productApproved`, and `defaultOn` remain false; C1 remains `4.5x`,
`meetsGate=false`, `recommendation=keep-off`; TF-0006 remains blocked.

## Validation

- `pnpm run tf0009:agent-surrogate`
- `pnpm exec vitest run tests/unit/tf0009-agent-surrogate.test.ts tests/unit/tf0009-engineering-evidence-audit.test.ts tests/unit/dcs-ops-canary-hard-veto.test.ts`
- `node scripts/dcs-ops-preflight.mjs`
- `pnpm harness validate --spec harness/specs/tasks/tf0009-engineering-evidence-audit.md --since HEAD`
- `git diff --check`
