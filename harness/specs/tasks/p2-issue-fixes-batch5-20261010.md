---
lifecycleStatus: archived
id: p2-issue-fixes-batch5-20261010
title: P2 issue batch 5 - role contract diagnostics, sensitive-sink taxonomy, memory baseline truthfulness
taskType: runtime-bridge
scenario: gateway-backend-communication
intent: Close three open [P2] issues (#109, #151, #146) with verified fixes, executable drift guards and no silently-dropped configuration.
touchedAreas:
  - openclaw_runtime/src/agents/role-contract.ts
  - openclaw_runtime/src/agents/role-registry.ts
  - openclaw_runtime/src/gateway/server-methods/role-orchestration-methods.ts
  - shared/security/content-provenance.ts
  - docs/runtime-design/mem.md
  - harness/specs/tasks/**
  - tests/unit/**
  - docs/dev/p2-issue-fixes-batch5-20261010.md
  - scripts/repository-artifacts.json
expectedUserBehavior:
  - A role contract whose declared tools are already removed by its own permission deny list, or whose handoff points at a role that does not exist, is reported when the role registers instead of only failing later at spawn time.
  - The centralized sensitive-sink taxonomy states how far each sink is actually enforced and resolves every enforcement claim against real policy modules.
  - The runtime memory design document quotes the tracked eval artefact with its judge version and exemptions instead of a stale hand-written baseline.
requiredProfiles:
  - fast
  - comms
requiredRules:
  - backend-communication-boundary
  - docs-sync
requiredTests:
  - node node_modules/vitest/vitest.mjs run tests/unit/role-contract-validation.test.ts tests/unit/role-spawn.test.ts tests/unit/role-runtime-mvp.test.ts tests/unit/role-orchestration-methods.test.ts tests/unit/agency-role-promotion.test.ts tests/unit/agency-role-importer.test.ts tests/unit/sensitive-sink-enforcement-drift.test.ts tests/unit/external-content-provenance.test.ts tests/unit/runtime-memory-baseline-doc-guard.test.ts tests/unit/handoff-artifacts.test.ts tests/unit/agent-browser-tool.test.ts --maxWorkers=1
  - node harness/src/cli.mjs validate --spec harness/specs/tasks/p2-issue-fixes-batch5-20261010.md
  - node scripts/comms/replay.mjs
  - node scripts/comms/compare.mjs
  - node scripts/validate-policy-docs.mjs
  - node scripts/check-repository-artifacts.mjs
acceptance:
  - Issue #109 - a read-only or `none` filesystem (or `none` network) role that still lists a tool the permission mapping denies is reported with the field, the conflicting tools and the role name; a `handoff.to`/`handoff.from` target that is not a built-in or config-defined role is reported with that field; forward references inside the same config batch and built-in references stay valid; the new findings are warnings so no previously accepted role is dropped and no permission default changes; registry diagnostics are reachable through `roles.list`.
  - Issue #151 - the centralized sink table distinguishes narrow enforcement from classification-only, every enforced sink names its policy file, exported symbol, call site and denial style, and an executable guard resolves those references against the working tree (including a reverse sweep for provenance-gate modules) instead of pinning sinks to classification-only.
  - Issue #146 - the memory design document quotes the tracked report artefact and its metric paths with the frozen judge version and its five exemption rules, discloses that the tracked artefact has no escalation share (rather than inventing one), withdraws the stale 43.0% baseline and the stage targets derived from it, and an executable guard fails when the quoted baseline or metric paths drift from the tracked fixture.
  - No product default, frozen lock, tool policy or permission default changes; no real provider call, live eval run or packaging step is part of the verification.
docs:
  required: false
---

# P2 issue batch 5

Fifth batch of open `[P2]` issues on the private remote:

- **#109** a role contract could declare `permissions.filesystem=read` together
  with `write`/`edit` tools, or hand off to a role that does not exist, and still
  register with an empty diagnostics list;
- **#151** the centralized sensitive-sink table marked five sinks
  `classification-only` although narrow enforcement for all five is already wired
  into production tool paths, and a test pinned that stale state;
- **#146** `docs/runtime-design/mem.md` scheduled from a hand-written 43.0%
  baseline while the tracked evaluation artefact records 0.752.

#109 adds a diagnostics field to the existing `roles.list` gateway method, so this
spec carries the `gateway-backend-communication` scenario. The host-api contract,
the IPC-only renderer transport, all permission defaults and every product lock
are unchanged. #151 and #146 are taxonomy/documentation truthfulness fixes with
executable guards; no new framework, second taxonomy or policy engine is added.

Verification is agent-driven (`driven_by: agent`) with local fixtures; no live
provider call, real evaluation run, packaging step or human action is claimed.
