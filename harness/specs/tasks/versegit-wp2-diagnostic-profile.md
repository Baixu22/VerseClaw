---
lifecycleStatus: active
id: versegit-wp2-diagnostic-profile
title: WP2 - add the opt-in concurrency diagnostic profile
scenario: versegit-validation-layer-extension
taskType: planning
intent: Add a host-selected, opt-in harness profile that produces a read-only VerseGit evidence pack only when multiple worktrees or active sessions exist, while preserving zero-call default behavior, fail-open availability and explicit unobserved coverage.
touchedAreas:
  - harness/specs/tasks/versegit-wp2-diagnostic-profile.md
  - harness/specs/tasks/versegit-module-implementation-contracts.md
  - harness/specs/scenarios/versegit-validation-layer-extension.md
  - harness/specs/fixtures/versegit-planning-correction/wp2-diagnostic-profile-fixture.json
  - harness/specs/fixtures/versegit-planning-correction/wp2-evidence/**
  - artifacts/versegit/wp2/**
  - artifacts/versegit-planning-correction/SHA256SUMS
  - harness/src/profiles.mjs
  - scripts/versegit-wp2-profile.mjs
  - scripts/verify-versegit-wp2.mjs
  - tests/unit/versegit-wp2-profile.test.ts
expectedUserBehavior:
  - The concurrency profile is selectable only through explicit `concurrency-aux` membership and is absent from `fast`, `comms` and all implicit profiles.
  - A single-worktree, single-session run records `not_applicable` with zero VG process calls; a multi-worktree/multi-session run records diagnostic observed/partial facts.
  - Missing binary and unavailable provider seams are visible as `unavailable` or `partial`, do not change the host verdict and leave no sidecar or candidate temporary resource.
  - The report never stores raw absolute provider paths, does not invoke land/admit or a second verifier and retains unobserved conflict/shell/network/direct-fs surfaces.
requiredProfiles:
  - concurrency-aux
requiredRules:
  - versegit-validation-layer-extension-boundary
  - task-forest-autoclose-and-roles
  - repository-artifact-retention
requiredTests:
  - node scripts/versegit-wp2-profile.mjs --fixture harness/specs/fixtures/versegit-planning-correction/wp2-diagnostic-profile-fixture.json --out artifacts/versegit/wp2/report.json
  - node scripts/verify-versegit-wp2.mjs --artifact artifacts/versegit/wp2/report.json
  - pnpm exec vitest run tests/unit/versegit-wp2-profile.test.ts
  - pnpm harness validate --spec harness/specs/tasks/versegit-wp2-diagnostic-profile.md
acceptance:
  - `concurrency-aux` exists as an explicit profile and is not present in fast or comms; the profile is not in any implicit default.
  - The single-worktree fixture case starts zero VG processes and reports `not_applicable`; multi-worktree starts the fixed version/capabilities/doctor seams and reports `partial` because the pure conflicts-plan seam is unavailable; missing binary reports `unavailable` without spawning.
  - Every case leaves host verdict unchanged, records zero surviving sidecar processes, no candidate temp directories, no host worktree deletion and no provider-source modification.
  - The report contains opaque identities and no raw absolute provider paths; coverage retains conflicts-plan, shell-write, network and direct-fs as unobserved.
  - Independent verifier replays the stored report and rechecks profile registration, zero-call behavior, fail-open behavior, digest reproducibility and cleanup.
docs:
  required: true
  files:
    - harness/specs/guides/versegit-concurrency/verseshell-and-behavior-observability.md
---

# WP2 opt-in concurrency diagnostic profile

WP2 is the lowest-risk host integration proof: it uses only the explicit profile,
does not attach on a single-worktree/session trigger, and treats diagnostic gaps as
summaries rather than permission to run arbitrary VG commands. The current conflicts
CLI has no pure plan seam, so it is recorded as unavailable instead of being invoked.

## Runtime boundaries

- No renderer route, host IPC method, default-on setting, land/admit call or native
  verifier is added.
- The profile writes a digest-bound evidence report and does not retain raw provider
  paths or doctor payloads.
- A missing sidecar is an availability observation, not a harness failure.