---
lifecycleStatus: active
id: runtime-resource-governance-p0d-20261014
title: Runtime Resource Governance P0D - end-to-end stress benchmark and fail-closed report
scenario: gateway-backend-communication
taskType: runtime-bridge
intent: Close issue #213 Work Package D by adding a fixed-fixture stress harness that measures shell, FactStore, MCP/provider stubs, multi-agent pressure and cancel recovery, preserves raw samples, aggregates p50/p95/p99 and fails closed on zero or insufficient coverage.
touchedAreas:
  - scripts/resource-governance-stress.mts
  - tests/integration/resource-governance-stress.produce.test.ts
  - artifacts/resource-governance/stress-2026-10-14T06-40-10-565Z/**
  - harness/specs/tasks/runtime-resource-governance-p0d-20261014.md
  - docs/dev/runtime-resource-governance-p0d-20261014.md
expectedUserBehavior:
  - The stress command writes raw samples and an aggregate report with fixture version, environment, scenario config and latency percentiles.
  - Shell snapshot cold/warm, FactStore unchanged/changed, MCP cold/warm/shutdown, provider cold/warm/failure/restart, multi-agent pressure and cancel recovery have explicit coverage requirements.
  - Synthetic provider/MCP stubs are labeled separately from real OS process-tree and FactStore measurements.
  - Zero samples, missing scenarios, unknown process-tree discovery or insufficient coverage produce a blocked decision and non-zero exit.
  - Cancel recovery reports residual process count and recovery latency.
requiredProfiles:
  - fast
  - comms
requiredRules:
  - backend-communication-boundary
  - runtime-efficiency-observability-boundary
  - docs-sync
requiredTests:
  - pnpm harness context --spec harness/specs/tasks/runtime-resource-governance-p0d-20261014.md
  - pnpm harness validate --spec harness/specs/tasks/runtime-resource-governance-p0d-20261014.md --since origin/codex/issue-213-background-work-gate-20261014
  - RESOURCE_GOVERNANCE_STRESS=1 pnpm exec vitest run tests/integration/resource-governance-stress.produce.test.ts
  - pnpm run typecheck
acceptance:
  - Raw raw-samples.jsonl and aggregate report.json are produced for a fixed resource-governance-p0d-v1 fixture.
  - Report includes p50/p95/p99 and max for shell warm samples, FactStore unchanged/changed timings, sidecar startup/shutdown, multi-agent task and queue-wait timings.
  - Report includes process-tree count, RSS and CPU percent for OS scenarios, plus synthetic labels for provider/MCP stubs.
  - Multi-agent pressure includes task count, concurrency, queue wait, cache-hit evidence and observed process count.
  - Cancel kill scenario captures the process tree, verifies zero residual PIDs, and records recovery time.
  - decision.status is stress-ok only when all required coverage is present and no warnings exist; otherwise it is blocked and the command exits non-zero.
  - Artifact directory contains report.json, raw-samples.jsonl, README.md and SHA256SUMS.
docs:
  required: true
  paths:
    - docs/dev/runtime-resource-governance-p0d-20261014.md
---

# Runtime Resource Governance P0D

This task closes issue #213 Work Package D with a reproducible, agent-driven stress harness. It measures real OS process-tree behavior for shell/FactStore/multi-agent/cancel scenarios and explicitly labels synthetic MCP/provider stubs.

## Scope

- Fixed fixture version and environment metadata.
- Cold/warm and changed/unchanged scenarios.
- Multi-agent p50/p95/p99, queue wait, tree metrics and cache evidence.
- Cancel residual/recovery evidence.
- Raw-sample plus aggregate fail-closed report.

## Out of scope

- Product-lock or default changes.
- External telemetry upload.
- Replacing the Work Package B/C runtime behavior.