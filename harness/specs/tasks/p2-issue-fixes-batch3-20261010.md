---
lifecycleStatus: archived
id: p2-issue-fixes-batch3-20261010
title: P2 issue batch 3 - skill install byte identity, tool disclosure, snapshot skill limits
taskType: runtime-bridge
scenario: gateway-backend-communication
intent: Close three open [P2] issues (#131, #105, #104) with verified fixes, recorded byte identity and fail-closed guards.
touchedAreas:
  - electron/gateway/**
  - electron/services/**
  - openclaw_runtime/src/agents/**
  - openclaw_runtime/src/skills/**
  - tests/unit/**
  - harness/specs/**
  - docs/dev/p2-issue-fixes-batch3-20261010.md
  - scripts/repository-artifacts.json
expectedUserBehavior:
  - A managed skill install records the bytes that were installed, so the reported version and integrity can be traced to disk instead of repeating catalog metadata.
  - The system prompt never advertises tools that are not actually available for the run, and never claims an empty tool surface is populated.
  - low/minimal runtime intensity applies its skill prompt limits on snapshot-backed runs instead of silently keeping the full catalog.
requiredProfiles:
  - fast
  - comms
requiredRules:
  - renderer-main-boundary
  - backend-communication-boundary
  - docs-sync
requiredTests:
  - node node_modules/vitest/vitest.mjs run tests/unit/skill-installer-identity.test.ts tests/unit/skills-api-install-trust-gate.test.ts tests/unit/skills-errors.test.ts tests/unit/clawhub-service.test.ts tests/unit/p2-105-tool-disclosure.test.ts tests/unit/p2-104-snapshot-skill-limits.test.ts tests/unit/runtime-intensity-policy.test.ts tests/unit/prompt-quality-budget.test.ts
  - node harness/src/cli.mjs validate --spec harness/specs/tasks/p2-issue-fixes-batch3-20261010.md
  - node scripts/comms/replay.mjs
  - node scripts/comms/compare.mjs
  - node scripts/check-repository-artifacts.mjs
acceptance:
  - Issue #131 - the installer honors a requested version that resolves to a real git ref, records `requestedVersionStatus`, `trackedRef`, `resolvedRevision` and a sha256 digest of the installed tree, never writes the catalog-declared version as `installedVersion`, and removes an install whose recorded digest cannot be re-verified.
  - Issue #131 - Main only enables a skill after integrity verification succeeds; the renderer store never enables a skill whose install result was unsuccessful.
  - Issue #105 - an explicitly empty tool list produces no "This runtime enables:" catalog; `sessions_spawn`, `gateway`, `session_status`, `exec`/`process` and list-polling guidance appear only when the corresponding tool is in the supplied tool list; a normal populated list renders as before.
  - Issue #104 - snapshot-backed minimal/low runs re-project the snapshot's resolved skills under their transient limits (8 + compact / 16) without mutating the snapshot or rescanning the filesystem, and the reported included/total/saved counts come from the effective projection.
  - No tool policy, allowlist, product default, feature flag or product lock changes; no real third-party download or provider call is part of the verification.
docs:
  required: false
---

# P2 issue batch 3

Third batch of open `[P2]` issues on the private remote:

- **#131** the skill installer ignored the requested version, always fetched a
  mutable default branch, and recorded the catalog-declared version as
  `installedVersion` even though nothing tied it to the installed bytes;
- **#105** the canonical system-prompt builder advertised an 18-tool catalog for
  an explicitly empty tool list and kept positively recommending tools
  (`sessions_spawn`, `gateway`, `session_status`) that were filtered out;
- **#104** snapshot-backed embedded runs skipped the minimal/low skill-catalog
  limits entirely, so 20 skills stayed 20 while the run report still claimed full
  policy adherence.

#131 changes the renderer -> host-api -> Main install path (including the
`electron/services/skills-api.ts` handler), so this spec carries the
`gateway-backend-communication` scenario and the renderer/Main boundary rules.
Transport policy (`WS -> HTTP -> IPC`), the host-api contract surface and every
tool permission policy are unchanged. #105 and #104 are prompt-projection fixes
inside `openclaw_runtime`: they change what the model is told about capabilities
that already exist, not which capabilities exist.

Verification is agent-driven (`driven_by: agent`) with local git/archive
fixtures; no third-party repository is downloaded, no provider is called and no
human action, verdict or data is claimed.
