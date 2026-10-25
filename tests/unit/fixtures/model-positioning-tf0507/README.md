# TF-0507 model positioning acceptance

- Task: TF-0507 - evaluate whether the model accurately describes the current tool, Memory, Knowledge, Browser, approval and unavailable-capability state.
- Actor: codex | Evidence driver: agent
- Provider/model: space-bunny via the local Responses-compatible endpoint http://127.0.0.1:3065/v1/responses
- Dataset: frozen 24-row fixture (POS-P0-A..H, POS-P1-A..H, POS-P2-A..H)
- Repeats: 3 per row (72 provider calls)
- Scorer: tf0507-semantic-json-v11 version 11
- Bound: this result does not generalize to other providers/models, other datasets, or real-human evidence.

## Result

The accepted run is run-v11.json; the predeclared protocol is protocol-v11.json.

| Metric | Result |
|---|---:|
| rows passed | 24 / 24 |
| calls passed | 72 / 72 |
| provider errors | 0 |
| observed false capability claims | 0 |
| internal-name leaks | 0 |
| protocol hash matches | yes |

The independent readback in verification.json recomputes the protocol hash, every profile digest, every prompt hash, the six tool probes, and every answer score. negative/negative-checks.json separately proves cross-scope isolation, stale/unapplied knowledge, restart degradation and a revoked navigate denial.

## Historical failures retained

The directory intentionally keeps earlier failed protocols/runs. They are evidence of protocol and production-prompt defects, not accepted results:

- v1/v2 exposed a missing authoritative capability projection and hard-coded example values.
- v3 exposed a runner tool-probe binding bug.
- v4 exposed incomplete state axes in the production prompt.
- v5-v8 progressively exposed browser approval/runtime conflation, memory read/write derivation, inventory semantics, and a single flaky inventory repeat.
- run-v11.json is the accepted, fully passing run; no historical failed run is relabeled as pass.

## Reproduction

Set LOCAL3065_API_KEY, then run prepare-protocol.mts --write, run-live.mts, verify-run.mts and negative-checks.mts with pnpm --dir openclaw_runtime exec tsx for each script. The run script refuses to overwrite run-v11.json; a new run requires a newly frozen protocol id.

## Boundary

This is a bounded agent-driven evaluation of one local provider/model over 24 scenarios and 3 repeats. It proves the model accepted the authoritative projection for this frozen run; it does not prove universal model behavior, live-provider quality across vendors, release readiness, or real-human acceptance.
