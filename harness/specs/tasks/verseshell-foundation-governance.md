---
id: verseshell-foundation-governance
title: VerseShell Foundation P0 Governance and Evidence Freeze
scenario: gateway-backend-communication
taskType: runtime-bridge
intent: Freeze the current VerseShell P0 baseline, single-owner boundaries, and implementation gates before any runtime, bundle, protocol, rollout, or product behavior changes begin.
touchedAreas:
  - harness/specs/tasks/verseshell-foundation-governance.md
  - harness/specs/rules/verseshell-foundation-p0-boundary.md
  - docs/dev/verseshell-foundation/FOUNDATION-ORCHESTRATION-PLAN.zh-CN.md
  - docs/dev/verseshell-foundation/P0-EVIDENCE-BASELINE-2026-08-14.md
  - docs/dev/handoffs/LATEST.md
  - .agent-workbench/task-forest/**
expectedUserBehavior:
  - Maintainers can see exactly which P0 failures are currently reproduced, conditional, or historical, without treating any result as rollout approval.
  - Every later VerseShell foundation package has one scoped Harness spec, one primary owner boundary, and explicit evidence prerequisites.
  - The default-off route, product locks, existing rollout status, runtime configuration, and model-facing tool surface remain unchanged during this governance package.
requiredProfiles:
  - fast
  - comms
requiredRules:
  - backend-communication-boundary
  - active-config-guards
  - capability-owner-resolution
  - comms-regression
  - docs-sync
  - supply-chain-integrity-pinning
  - verseshell-foundation-p0-boundary
requiredTests:
  - pnpm harness context --spec harness/specs/tasks/verseshell-foundation-governance.md
  - pnpm harness validate --spec harness/specs/tasks/verseshell-foundation-governance.md --no-diff
  - python C:\\Users\\27933\\.codex\\skills\\task-forest\\scripts\\task_forest.py validate
  - python C:\\Users\\27933\\.codex\\skills\\task-forest\\scripts\\task_forest.py export
  - git diff --check -- harness/specs/tasks/verseshell-foundation-governance.md harness/specs/rules/verseshell-foundation-p0-boundary.md docs/dev/verseshell-foundation/FOUNDATION-ORCHESTRATION-PLAN.zh-CN.md docs/dev/verseshell-foundation/P0-EVIDENCE-BASELINE-2026-08-14.md docs/dev/handoffs/LATEST.md
acceptance:
  - The P0 baseline records the exact candidate SHA, current binary and source identity hashes, machine uptime context, commands, exit codes, and the difference between current and historical evidence.
  - The baseline distinguishes a passing packaged handshake and TypeScript real-binary suite from failing Rust test compilation and source/build/protocol drift; no green subset is promoted to release or canary evidence.
  - OpenClaw, ClawX Main/Electron, VerseShell runtime, and MCP compatibility responsibilities and forbidden crossings are explicit.
  - The next package is limited to VS-P0-01 and cannot alter rollout locks, runtime configuration, feature flags, model tool schema, or product status.
  - The task forest shows TF-0057 as the only completed governance package before TF-0058 becomes the next serial work item.
docs:
  required: true
  files:
    - docs/dev/verseshell-foundation/UAS-06-REAL-CANARY-RUNBOOK.md
    - docs/dev/verseshell-foundation/UAS-06-REAL-CANARY-RUNBOOK.md
    - docs/dev/Sustained-Development-Playbook.md
---

# VerseShell Foundation P0 Governance and Evidence Freeze

This specification owns only VS-G0-01 / Task Forest `TF-0057`. It converts the approved
VerseShell Foundation orchestration into a testable P0 starting point. It does not implement
VS-P0-01 or later packages.

## Frozen rollout state

- `default-off` remains in force.
- `liveReady=false`, `productApproved=false`, and `defaultOn=false` remain unchanged.
- Do not edit `docs/dev/verseshell-foundation/STATUS.md`, feature flags, runtime configuration,
  model-facing exec schema, `TF-0006`, `TF-0009`, or `TF-0016`.
- Do not launch a canary, claim GA, enable MCP compatibility, or add native fallback.

## P0 ownership map

| Surface | Sole owner | Explicit non-owner boundary |
|---|---|---|
| Command interpretation, risk, approval, action token, sanitized environment, fail-closed decision | OpenClaw runtime | VerseShell and Renderer never infer or grant approval. |
| Bundle identity, canonical workspace, journal/undo, Main transport, diagnostics, kill switch | ClawX Main/Electron | Renderer never spawns `ae.exe` or calls Gateway directly; VerseShell never commits product writes. |
| Typed JSONL request decoding, operation validation, argv/process lifecycle, bounded observation and artifact creation | VerseShell runtime | It does not claim OS sandboxing, product authorization, or native fallback authority. |
| External compatibility only | MCP adapter | It is not an internal execution path and cannot bypass policy, workspace, approval, or governed ownership. |

## Evidence policy

- Historical UAS-05/UAS-06 reports and the 2026-08-13 real-capability audit are implementation
  input. They are not current release, canary, or product approval evidence.
- A passing narrow check does not cancel a failing broader gate. In particular, a passing packaged
  `ae.exe` handshake or `pnpm verseshell:test` does not satisfy the Rust compile gate or prove
  source/build/protocol reproducibility.
- The baseline must label a result as `current-pass`, `current-fail`, `conditional-source-defect`,
  `historical-fail`, or `not-run`; it must never convert an unavailable condition into a pass.

## Handoff to VS-P0-01

VS-P0-01 may change only the VerseShell Rust runtime and its tightly scoped tests/spec evidence
needed to remove the startup and test-compilation blockers. It must first preserve this baseline,
then establish a controlled short-uptime test seam rather than relying on the current machine
uptime. Bundle identity, manifest synchronization, governed real probes, lifecycle expansion,
MCP, facade, writes, and canary remain out of scope until their serial packages.
