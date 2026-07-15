# D1 Observation (Phase C would_trigger) — synthetic lab close-out

**Status:** **Pass-D1**  
**Generated:** 2026-07-15T02:35:01.472Z  
**Mode:** synthetic agent trajectories (agent-only lab)  
**N1:** pass_proxy_permanent (not live-human)

## N3 acceptance matrix

| Gate | Result |
| --- | --- |
| N3.1 Functional (default-off; evidence only) | **Pass** |
| N3.2 Safety / parity | **Pass** |
| N3.3 Observation window (≥200 synthetic) | **Pass** |
| N3.4 Rollback drill | **Pass** |

Embedded 7-day traffic: **N/A (agent-only lab)** — product count met via **220** synthetic trajectories.

## Metrics

| Metric | Value |
| --- | --- |
| Synthetic trajectories | 220 |
| Evidence count | 220 |
| wouldTrigger true | 154 |
| wouldTrigger false | 66 |
| Trigger rate | 0.7000 |
| Error rate | 0 |
| Score &lt;50 / ≥50 | 66 / 154 |
| Eval batch ms | 0.30 |
| Latency p50/p95 (on-path projection) | 0.01 / 0.04 |
| Latency budget | **Pass** (mean_on <= baseline*1.05 OR absolute_delta_ms<=25) |
| Principles before→after | 0 → 0 |
| Trajectories before→after | 220 → 220 |
| durableMutation | **false** (detected=false) |
| offlineArtifactsUsed | **false** |

## Flags

- Default: **off**
- Lab temporarily evaluated with flag on in isolated workspace only
- After lab: document as off; no ambient Phase C activation
- Shadow V1 threshold: **50** (not retuned)

## Hard fails

- none

## Machine snapshot

See [d1-observation.v1.json](./d1-observation.v1.json) and [d1-rollback-drill.v1.json](./d1-rollback-drill.v1.json).

## Explicit non-goals

No D2 ranking mutation, no capture filtering, no default-on, no live-human dual-review claim.
