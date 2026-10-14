# Runtime Resource Governance P0D

Status: implemented and executed on Windows with Node v24.15.0, 2026-10-14.

Issue: #213 Work Package D.

## Delivered

- `scripts/resource-governance-stress.mts` writes a fixed-fixture (`resource-governance-p0d-v1`) stress run to `artifacts/resource-governance/stress-<timestamp>/`.
- Raw samples are preserved in `raw-samples.jsonl`; aggregate p50/p95/p99/max values and coverage are in `report.json`.
- Scenarios:
  - shell snapshot cold/warm;
  - real FactStore unchanged/changed with cache-hit evidence;
  - synthetic MCP process stub cold/warm/startup/shutdown;
  - synthetic provider sidecar stub cold/warm/failure/restart/shutdown;
  - multi-agent queue pressure;
  - real process-tree cancel/kill residual recovery.
- The report labels synthetic provider/MCP stubs separately from real OS/FactStore scenarios.
- Coverage is fail-closed: zero samples or missing required coverage yields `decision.status = blocked` and a non-zero process exit.

## Latest evidence

Artifact: `artifacts/resource-governance/stress-2026-10-14T06-40-10-565Z/`.

- `decision.status = stress-ok`
- `zeroSampleFailClosed = true`
- All six required scenarios met coverage.
- Shell warm p50/p95/p99: 62.34 / 217.63 / 217.63 ms.
- FactStore unchanged p50/p95/p99: 0.17 / 0.32 / 0.71 ms.
- FactStore changed p50/p95/p99: 0.14 / 0.27 / 0.29 ms.
- Multi-agent task p50/p95/p99: 44 / 120 / 127 ms.
- Multi-agent queue wait p50/p95/p99: 103 / 169 / 176 ms.
- Cancel recovery: 0 residual PIDs, 880.18 ms.
- Windows CIM process-tree samples recorded count, RSS and CPU percent.

`driven_by: agent` / `actor: codex`. No real-human evidence is claimed.