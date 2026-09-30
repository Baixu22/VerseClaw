---
id: uas-00-evidence-freeze-boundary
title: UAS-00 Evidence Freeze Boundary
type: ai-coding-rule
appliesTo:
  - gateway-backend-communication
severity: error
---

# Rule: UAS-00 freezes engineering evidence without promoting product authority

## R1: The frozen baseline binds dirty state explicitly

The UAS-00 manifest must record the current HEAD, tracked and staged diff hashes, hashes for
untracked files, environment identity, relevant executable hashes, and exact reproduction
commands. A dirty tree must never be described as a clean release snapshot.

## R2: Agent evidence and human authority remain separate

TF-0011 may consume TF-0009 agent-surrogate engineering evidence after the explicit governance
split. TF-0009 keeps `humanEquivalent=false`, `liveEvidence=false` and zero qualifying human runs. Under the 2026-09-27 owner policy, validated agent evidence may complete TF-0009 independently of that dependency split. Missing human evidence is never a blocker. Historical frozen manifests keep their original status; current closure requires a clean v2 report.

## R3: Authority ownership remains singular

The evidence manifest must identify the existing or future sole owner for the event spine,
context assembly, VToken packing, Coding mutation, local process execution, and long-term
Memory lifecycle. UAS-00 must not implement or duplicate those authorities.

## R4: Existing product locks remain frozen

UAS-00 must preserve `liveReady=false`, `productApproved=false`, `defaultOn=false`, C1 `4.5x`
with `meetsGate=false` and `recommendation=keep-off`, `TF-0006=blocked`, and Runtime Memory
`diagnostics-only`.

## R5: UAS-00 is governance-only

UAS-00 may add evidence generation, stale checks, Harness coverage, and documentation
corrections. It must not start TF-0012/TF-0013/TF-0014, implement FP-P4-03/04, change runtime
defaults, add Memory lifecycle behavior, or claim live/product/GA readiness.
