> 2026-09-30 政策修订：2026-09-27 AGENTS.md 优先于下文历史口径。TF-0009 以具名 agent 三 profile 各 10 条、安全/kill/rollback 和 continue/shrink/stop 裁决验收；证据齐全可收口。真人 0/10 仅为事实局限，不是节点前置。下文旧轮次数值及 review_needed/degraded 判定按当时快照保留。当前决策见 `docs/dev/tf0009-policy-decision-20260930.md`。

# TF-0009 engineering and agent-surrogate evidence audit

> Date: 2026-07-29  
> Decision authority: user replaced unavailable human testing with a downgraded agent-surrogate track  
> Result: `degraded-agent-complete`; propose `review_needed`, never `done`

## Decision

TF-0009 now has two explicitly separate evidence tiers:

1. The agent-surrogate engineering tier is complete. DCS, SEKB, and Browser each have 10
   agent-operated records plus an agent kill/rollback drill.
2. The original human/live tier remains incomplete at `0/10` for every profile. It is deferred
   for later development and still owns any human success rate, product approval, live A/B, or
   soak claim.

The user asked for implementation and process completeness without paying the unavailable
human-test cost. This authorizes the first tier only. It does not turn agent evidence into human
evidence. The TF-0009 report cannot self-authorize `TF-0011`; a later, separately confirmed
governance proposal may release only the engineering chain without completing TF-0009.

Machine-readable evidence:

- `artifacts/first-product-preview/TF-0009/evidence-audit.json`
- `artifacts/first-product-preview/TF-0009/agent-surrogate-charter.json`
- `artifacts/first-product-preview/TF-0009/agent-surrogate-report.json`

## Evidence matrix

| Surface | Agent-surrogate result | Human/live result | Honest conclusion |
|---|---:|---:|---|
| DCS coding | `10/10` real context-tool component runs over an isolated workspace | `0/10` | Engineering path complete; no human benefit claim |
| SEKB assisted | `10/10` capture → suggest → reject → retrieve runs; confirmed principle writes `0` | `0/10` | Safe agent review path complete; positive human confirm intentionally deferred |
| Browser supervised | `10/10` approval-state-machine + supervised-executor runs over an isolated page runtime | `0/10` | Policy/executor flow complete; no real public-network or human approval claim |
| Kill/rollback | Agent drill pass | No canary-period human drill | Agent mechanism/process complete; human drill deferred |
| Exit decision | `deferred-human-validation` | No named human owner decision | Task may be proposed as `review_needed`, not `done` |

## Process implementation

- `pnpm run tf0009:agent-surrogate` executes all 30 records through existing components and
  writes the bounded report.
- Every record is locked to `actor.kind=agent`, `humanEquivalent=false`, and
  `liveEvidence=false`.
- DCS runs the real impact, understand, verify, and registration tools without touching the
  working repository.
- SEKB uses an isolated database. The agent may reject a suggestion but may not call the
  positive human-confirm write path; this preserves the SEKB human-confirm-only boundary.
- Browser uses the real task approval state machine, URL guard, supervised executor, ordered
  steps, and verification. Its page runtime and DNS answer are isolated, so it is not public
  network evidence.
- Preflight exposes both states: `agentSurrogateReady=true` and `l3Ready=false`.

## Earlier Day-1 engineering gates

Day-1 L0/L1/L2 remains valid engineering evidence. DCS lint, `35 files / 314 tests`, P0
`8 files / 120 tests`, packaging, C1, corpus validation, runtime/Vite builds, and the final
Windows Electron matrix `9/9` passed. The first Electron matrix exposed a cold-build SEKB
`runtimeUnavailable` gap; the runtime build now restores and smoke-imports the SEKB entry.

None of these results increments the human run count.

## Status semantics

Task Forest has no `degraded` status. The durable mapping is:

- evidence label: `degraded-agent-complete`
- proposed Task Forest status: `review_needed`
- forbidden Task Forest status: `done`
- downstream: the TF-0009 proposal itself does not release `TF-0011`

Proposal `TFP-tf0009-agent-surrogate-degraded-20260729` was explicitly confirmed and applied.
The canonical graph records `TF-0009=review_needed, 50%`.

The user later confirmed `TFP-tf0011-engineering-chain-release-20260729`. That independent
governance proposal removed the blocking dependency, added a non-blocking
`TF-0011 derived_from TF-0009` evidence edge, and set `TF-0011=ready`. This is an engineering
dependency split only: the TF-0009 human counts, status, progress, and product boundaries did
not change.

The export still embeds the prior workspace metadata value `ClawX-maturity-p0` even though the
canonical files and export are under the current `ClawX` workspace. That relocation residual is
not evidence of a second graph and was not silently migrated in this proposal.

## Frozen boundaries

- `liveReady=false`
- `productApproved=false`
- `defaultOn=false`
- C1 `4.5x`, `meetsGate=false`, `recommendation=keep-off`
- `TF-0006=blocked`
- Runtime Memory remains `diagnostics-only`
- No agent-positive SEKB confirmation, real remote side effect, commit, push, branch, PR, or GA

## Future residual

Later development may reopen the human tier with named owner/operator/safety, 10 qualifying
tasks per profile, a human canary kill/rollback drill, and an accountable
`continue`/`shrink`/`stop` decision. Until then TF-0009 is a degraded engineering closure, not
a completed canary.
