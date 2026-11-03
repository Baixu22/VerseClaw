# Context Folding Multi-Round Acceptance

<!-- driven_by: agent; actor: codex/context-folding-rlm -->

This folder contains the formal TF-0698 positive-benefit acceptance evidence: **10 independent paired rounds in 2 profiles**.

## Verdict

- Status: **PASS**
- Profiles: 2 (`frozen`, `varied-noise`)
- Rounds: 5 frozen + 5 varied-noise = 10
- Every round: 4/4 tests in baseline, expand-only, folded-child; oracle PASS
- Every round: evidence refs 100%, scope/stale 0, raw transcript 0, depth 1
- Every round: main-context reduction >= 30% and total-token proxy < baseline
- Latency maximum: 1.055556x (limit 2.5x)

## Aggregate metrics

| Metric | Median | P95 | Worst |
|---|---:|---:|---:|
| Total-token multiplier | 0.057512x | 0.058869x | 0.058869x |
| Main-context reduction | 99.816% | 99.812% (P05) | 99.812% |
| Latency multiplier | 0.99705x | 1.049151x | 1.055556x |

The varied-noise profile changes the distractor size per round: 4,000, 8,000, 12,000, 16,000, 24,000 chars. This prevents the result from relying on a single fixed text length.

## Layout

- `aggregate.json`: machine-readable 10-round verdict, per-round checks, statistics and profile provenance.
- `multiround-frozen-raw/`: 5 independent frozen-fixture round directories with manifest + oracle output + test logs.
- `multiround-perturbed-raw/`: 5 independent varied-noise round directories with the same artifacts.
- `SHA256SUMS`: hashes for the formal aggregate plus every raw manifest, oracle output and mode log.

## Reproduction

See `scripts/context-folding-multiround-eval.mjs`; the two formal profiles use `CF_MULTI_PERTURBATION=none` and `CF_MULTI_PERTURBATION=noisy-distractor` with `CF_MULTI_PROFILE=varied`.

## Boundary

This is an agent-driven deterministic local eval. It does not claim live-provider token/cost/semantic quality, real-human evidence, release approval, or production rollout. Any negative round invalidates the aggregate verdict; the result is not based on averaging away failures.
