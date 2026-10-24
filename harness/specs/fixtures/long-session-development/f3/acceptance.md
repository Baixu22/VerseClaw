# Long-session final acceptance (F3)

Source candidate: 4e993607f2192a3a809b1717daff5e50a9c60bc8 (branch codex/long-session-integration-20261024, tree 0f3d110a517bb734bc236b8fd6eae81a3f2e9e94).

This is an agent-driven read-back of every peer node on disk. No real-human verdict or human data is claimed.

## Execution nodes

| Node | Contract | Candidate | Verdict | Criteria | Evidence | SHA256 |
| --- | --- | --- | --- | --- | --- | --- |
| TF-0548 | A1 | b08863510 | pass-with-deferred-gaps | 4 | 5 files | verified |
| TF-0549 | A2 | 5daef609d | pass-with-residuals | 0 | 4 files | verified |
| TF-0550 | B1 | 5eef970b9 | pass | 4 | 5 files | verified |
| TF-0551 | B2 | b7b090779 | pass | 4 | 5 files | verified |
| TF-0552 | C1 | 09dcda176 | pass | 4 | 4 files | verified |
| TF-0553 | C2 | 57b82e740 | pass | 4 | 4 files | verified |
| TF-0554 | C3 | 53db65bd5 | pass | 4 | 5 files | verified |
| TF-0555 | C4 | 4a4f53f37 | pass | 4 | 6 files | verified |
| TF-0556 | D1 | 6f9532374 | - | 4 | 7 files | verified |
| TF-0557 | D2 | 6d8d9d97d | EVIDENCE_INSUFFICIENT | 4 | 6 files | verified |
| TF-0558 | D3 | beae6d396 | keep-baseline | 0 | 5 files | verified |
| TF-0559 | E1 | 8eeb2823e | pass | 4 | 5 files | verified |
| TF-0560 | E2 | 7c8348b57 | pass | 4 | 6 files | verified |
| TF-0561 | F1 | 504b284ba | pass | 4 | 6 files | verified |
| TF-0562 | F2 | 18982d5e6 | pass | 4 | 7 files | verified |

## Phases

- P1 Session lifecycle truth: 2 nodes, present=true, hashes=true, criteria=true
- P2 Effective session policy and user surface: 2 nodes, present=true, hashes=true, criteria=true
- P3 Long-session coordination MVP: 4 nodes, present=true, hashes=true, criteria=true
- P4 Continuity evaluation and decision: 3 nodes, present=true, hashes=true, criteria=true
- P5 Follow-up scheduling and resources: 2 nodes, present=true, hashes=true, criteria=true
- P6 Automated long-run acceptance and claims: 2 nodes, present=true, hashes=true, criteria=true

## Acceptance

- [pass] all six phase criteria are read from disk; each of the 15 peer execution nodes (A1-F2) has current candidate/input/command/exit/counts/artifact/negative proof, and history is not re-signed
- [pass] clean scoped candidate, uncached typecheck, contract/comms, same-scope real Electron E2E, secret scan and artifact/hash verification are complete; directory existence and final answers are not acceptance
- [pass] product semantics, READMEs, four-locale UI and model capability claims match the current backend scope; retired/unavailable/shadow/NO-GO never masquerades as implemented
- [pass] the core loop closes through a legal proposal after automated acceptance, then validate/export; public release, full defaults, product locks, independent Project and cloud execution stay outside this node authority

## Decisions kept as recorded

- D2: EVIDENCE_INSUFFICIENT
- D3: keep-baseline

## Unmeasured scope

- live-provider and native-backend thread continuity: no authorized provider credential in this environment
- macOS, Linux and packaged-install long-use measurement: the sample is Windows x64 built dist-electron only
- real-human multi-day long use: every artifact is agent-driven and the fixture is synthetic
- renderer in-window compaction/continuation latency: measured in-process against the shipped planners

## Authority boundary

Publication, full defaults, product locks, independent Project and cloud execution are not authorized by this node and are not claimed.
