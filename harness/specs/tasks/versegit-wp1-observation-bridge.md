---
lifecycleStatus: active
id: versegit-wp1-observation-bridge
title: WP1 - bind host tool events to repo, worktree, session and trace identity
scenario: versegit-validation-layer-extension
taskType: planning
intent: Normalize the existing ChatRuntimeEvent stream into bounded VerseGit behaviour facts with stable repo/worktree/agent-session/VG-session/epoch/run/request/trace identity, explicit coverage, duplicate suppression, stale-event rejection and a pre-cleanup evidence seal.
touchedAreas:
  - harness/specs/tasks/versegit-wp1-observation-bridge.md
  - harness/specs/tasks/versegit-module-implementation-contracts.md
  - harness/specs/scenarios/versegit-validation-layer-extension.md
  - harness/specs/fixtures/versegit-planning-correction/wp1-observation-fixture.json
  - harness/specs/fixtures/versegit-planning-correction/wp1-evidence/**
  - artifacts/versegit/wp1/**
  - artifacts/versegit-planning-correction/SHA256SUMS
  - electron/services/versegit-observation.ts
  - scripts/versegit-wp1-observation.mjs
  - scripts/verify-versegit-wp1.mjs
  - tests/unit/versegit-wp1-observation.test.ts
expectedUserBehavior:
  - Two concurrent worktree/session owners can emit host tool events without crossing repo, worktree, owner, epoch or trace identity.
  - Duplicate events do not increment observation counts; stale/future epoch, wrong owner and wrong session key produce explicit stale or rejected_by_policy results.
  - File read/write/search events are host-event coverage; shell read stays unobserved; shell write is only inferred; MCP/network/browser effects stay partial; direct filesystem access stays unobserved.
  - Detaching a session seals coverage and a session-end fact before host cleanup; events arriving afterward become stale and VG never deletes the host worktree.
requiredProfiles: []
requiredRules:
  - versegit-validation-layer-extension-boundary
  - task-forest-autoclose-and-roles
  - repository-artifact-retention
requiredTests:
  - node scripts/versegit-wp1-observation.mjs
  - node scripts/verify-versegit-wp1.mjs
  - pnpm exec vitest run tests/unit/versegit-wp1-observation.test.ts
  - pnpm harness validate --spec harness/specs/tasks/versegit-wp1-observation-bridge.md
acceptance:
  - The evidence harness imports the shipped `VerseGitObservationBridge` and drives it with `ChatRuntimeEvent`-shaped host records rather than a parallel event model.
  - Two run identities bind to distinct worktrees and agent/VG sessions; every emitted event preserves repoId, worktreeId, agentSessionId, vgSessionId, epoch, runId, requestId and traceId with zero cross-worktree violations.
  - Replaying an identical host event yields duplicate with no count increase; an older epoch, wrong owner, wrong sessionKey and a post-detach event are rejected as stale or rejected_by_policy with `host_verdict: unchanged`.
  - Coverage records file read/write/search as `host-event`, shellRead as `unobserved`, shellWrite as `inferred`, MCP/network/browser as `partial`, and directFs as `unobserved`; known gaps are retained in every session seal.
  - Session detach returns a digest-bound coverage snapshot and session-end event before cleanup; the bridge never starts a VG process, writes the workspace, deletes a worktree, invokes land/admit or changes the host verdict.
  - The fixture produces exactly 20 evidence lines: 3 attachments, 9 normalized behaviour events, 3 session-end seals, 1 duplicate, 2 stale, 2 rejected and 6 observed/2 partial/1 unobserved events.
  - The independent verifier replays the JSONL byte-for-byte and re-fires duplicate, stale, wrong-owner, wrong-session and cleanup-barrier controls.
docs:
  required: true
  files:
    - harness/specs/guides/versegit-concurrency/verseshell-and-behavior-observability.md
---

# WP1 host observation bridge

WP1 is a host-owned normalization layer. It consumes `ChatRuntimeEvent` and produces
privacy-bounded behaviour facts. It does not attach VerseGit, add a harness profile,
execute verification or expose a renderer route.

## Identity

Each active run has one binding containing repo, worktree, agent session, VG session,
owner, actor, epoch, run and trace identity. Active `agentSessionId + epoch` may belong
to only one run. Rebinding a detached run requires a higher epoch.

## Coverage

Coverage is a vector, not a boolean. Structured host events improve only the surface they
actually observe. Bash/direct-fs reads remain unobserved, shell writes remain inferred,
and MCP/network/browser effects remain partial until a stronger receipt exists.

## Cleanup barrier

`detach` seals coverage and emits `session.end` before host cleanup. A late event cannot
mutate the sealed state; it is recorded as stale. Resource deletion remains owned by the
host worktree service and is outside WP1.

## Deferred integration

WP2 owns the opt-in diagnostic profile and evidence pack. WP3 adds VerseShell execution
receipts. WP4 adds richer feedback delivery and behavior metrics. WP5 supplies replay and
soak evidence.