# P2 issue batch 6: admission fence bounds and reclamation, CVK rollback honesty

Date: 2026-10-10 (agent-driven)
Base: private `main` = `4ffb76cc9` ("fix(runtime,security,docs): close P2 batch 5")
Issues closed by this change: **#102, #150** (both `[P2]`).

This batch bounds a lifecycle wait that could hang forever, makes a rollback
declaration stop claiming an executor that does not exist, and corrects a stale
judge-rule comment. No product default, permission default, frozen lock, tool
policy or release state changes, and no claim of human execution is made here.

## #102 - SessionAdmissionRegistry had no retirement and an unbounded fence wait

**Verified at HEAD:** `acquirePermit` only decremented `active` on release and
never removed an entry, so every identity ever seen stayed in the map (the only
clear path was `clearForTests`). `fence()` waited for in-flight permits with
`while (entry.active > 0) await new Promise(setImmediate)`, with no deadline and
no cancellation, so a leaked permit made the caller wait forever.

**Change (`openclaw_runtime/src/sessions/session-admission-registry.ts`)**

- Release-event notification: entries now hold a waiter set; the last permit
  release wakes every parked fence instead of the fence polling the event loop.
- Bounded wait: `fence(identity, { timeoutMs, signal, operation })` races the
  drain against a budget (default `SESSION_ADMISSION_FENCE_DEFAULT_TIMEOUT_MS =
  15_000`, matching the session drain budget) and an optional caller abort
  signal. On failure it throws `SessionAdmissionFenceWaitError` with
  `reason: "timeout" | "aborted"`, `activeAtFailure`, `waitedMs` and the
  operation label. The fence **stays closed**: nothing is released
  automatically, so the old generation cannot re-admit; the existing
  `removeFence` path is the only recovery.
- Reclamation: `retireInactiveEntries()` reclaims entries that are idle,
  unfenced and have no waiter, and reports `{ retired, live }`. A capacity bound
  (`maxEntries`, default `SESSION_ADMISSION_DEFAULT_MAX_ENTRIES = 1024`) evicts
  the oldest reclaimable entry when a new identity is inserted. Entries holding
  a closed fence (the deleted-generation tombstone), an in-flight permit or a
  parked waiter are **never** dropped: dropping a tombstone would let a deleted
  generation re-admit, and dropping a waiter would lose the notification.
- Diagnostics: `stats()` reports entries/fenced/active/waiters, cumulative
  retirements, fence waits/timeouts/aborts, total and max observed wait time, and
  the configured bound. The lifecycle-audit printed-counter convention is used to
  publish measured values (see the gate log): `admissionEntriesAfterCap=16`,
  `admissionRetiredEntries=48`, `admissionLiveEntriesAfterSweep=0`,
  `admissionFenceTimeouts=1`, `admissionMaxFenceWaitMs=44`,
  `admissionWaitersAfterTimeout=0`. No memory-growth rate is claimed.
- Production callers (`openclaw_runtime/src/gateway/session-reset-service.ts`,
  both the stop path and the reset/delete path) now pass `SESSION_DRAIN_TIMEOUT_MS`
  and an operation label, and translate a wait failure into a retryable
  `UNAVAILABLE` error with no mutation performed. Delete success still keeps the
  fence as the generation tombstone, unchanged.

**Tests:** `openclaw_runtime/src/sessions/session-admission-registry-reclamation.test.ts`
(11) covers release-wake, timeout (fence stays closed, `acquirePermit` still
rejects, `removeFence` recovers), abort, idempotent duplicate release, stale
handle vs newer fence, retirement counts, the capacity bound with a live entry
surviving, tombstone retention, waiter/permit non-retirement, snapshot
compatibility, and the measured audit counters. Existing registry tests (12), the
runtime admission shard (8 files / 62 tests: registry, reset stop/subagent-stop,
drain, send-permit lifetime, goal-wake durable cleanup, compaction
addressability), the CVK recovery suites (12) and the runtime 50-cycle ecosystem
reclamation test (`cycles=50 activeRecordResidual=0 ownedPidResidual=0
finishedResidual=0`) all pass in the frozen state.

The repo-root `tests/unit/runtime-lifecycle-governance.test.ts` ran 5/5 earlier in
this session (50-cycle drain, `leak50CycleHeapDeltaMb=0.558`,
`leak50CycleActiveRecords=0`); its later re-runs report 4 passed + 1 skipped
because the test's own environment gate — a 1-second PowerShell
`Get-CimInstance Win32_Process` probe — exits 1 in this environment (measured
exit=1 in 355-2233 ms). That skip belongs to the fixture's gate, not to this
change, and the same 50-cycle lifecycle coverage executed and passed through the
runtime ecosystem reclamation test above.

**Residual (recorded, not hidden):** a closed fence is a tombstone and is
therefore never reclaimed, so the number of deleted generations still grows with
the number of lifetime deletions; bounding that requires a durable tombstone
authority outside this registry. The capacity bound only bounds *idle* entries,
and live entries may legitimately exceed it under sustained concurrency.

## #150 - CVK recovery declared an available rollback with no executor

**Verified at HEAD:** `CvkRecoveryContextResult.rollback` and
`CvkDefaultRecoveryProjectionResult.rollback` were hardcoded
`{ available: true, strategy: 'legacy_transcript_replay' }`. A repo-wide search
(`git grep`) found no consumer that executes the strategy: `rollback.strategy`
and `rollback.available` have zero hits anywhere, the only importer forwards the
value, and the desktop `prepareHandoff` path never sees a rollback field at all.

**Change**

- `openclaw_runtime/src/context-engine/cvk/recovery.ts` now declares
  `CvkRecoveryRollback` as a discriminated union: `available: false` with
  `strategy: 'unimplemented'` and a reason code
  (`no_executor_wired` | `legacy_projection_retained`), or `available: true`
  which **requires** an `executorId` naming the wired executor. A factory
  `unavailableCvkRecoveryRollback(reason)` produces the honest state;
  `buildCvkRecoveryContext` always returns `no_executor_wired`.
- `recovery-default.ts` widens its result type to the same union and returns
  `legacy_projection_retained` on every fallback branch, so a fallback no longer
  implies rollback availability. `ok`, `projection` and `diagnostics` are
  untouched.
- Lead follow-up outside the subagent's scope:
  `harness/specs/tasks/token-dense-recovery-compression-v1.md:100` claimed "P3
  keeps legacy transcript replay as the rollback path"; it now states that the
  rollback is recorded as unavailable with a reason code. The historical phase
  ledger entries in `docs/context-runtime-kit/goal-progress.md` that mention
  "rollback metadata" remain accurate (the metadata exists and is explicit) and
  were left as history.

**Tests:** `tests/unit/context-runtime-kit-recovery-context.test.ts` and
`context-runtime-kit-recovery-default.test.ts` (12, from 10) assert the
unavailable state on the ok path, the degraded paths and all fallback branches,
plus a union-shape test. The runtime consumer
`openclaw_runtime/src/agents/agent-hooks/compaction-addressability.test.ts` (8)
still passes.

## #144 - deferred, NOT fixed by this change set

The LoCoMo full-500 evaluation still mirrors its cached and fresh retrieval paths
(~1300 duplicated lines). It is **not** closed here and no part of it was merged:
the suite is wrapped in `describe.skipIf(!hasDeepSeekKey() || (!hasSiliconFlowKey()
&& !canRunWithoutSiliconFlow()))` (`tests/unit/runtime-memory-locomo-full-500.test.ts:1439-1440`)
and this environment has no authorized DeepSeek credential, so neither mode can
execute and a merge could not be A/B verified. A paid 150q/500q evaluation is a
money decision and was deliberately not taken.

The cost-free verification recipe is verified and recorded on the issue:
`RUNTIME_MEMORY_REAL_LLM=1` + `RUNTIME_MEMORY_LLM_API_KEY=<synthetic>` +
`RUNTIME_MEMORY_LLM_BASE_URL=http://127.0.0.1:<port>/v1` un-skips the suite
(the helper explicitly allows loopback HTTP, `runtime-memory-real-llm-client.ts:52-66`),
a local OpenAI-compatible mock serves deterministic responses, the repository's own
siliconflow embedding key covers embeddings, and byte-identical dev-slice cache
snapshots give the A/B comparison. That work continues in the batch-6 worktree
(`D:\ClawX-candidates\p2-issues-batch6-20261010`), which is intentionally kept
alive instead of being cleaned up.

## Also fixed in this change set (carried from the batch-5 report)

`tests/unit/helpers/locomo-judge-registry.ts` documented the frozen judge as
"9 rules"; the frozen prompt template actually has **8** rule bullets
(`tests/unit/helpers/runtime-memory-judge-freeze.ts:9-16`). The comment now says
8. Comment-only, no behaviour change. The five *exemption* rules quoted by
`docs/runtime-design/mem.md` are a different list
(`FROZEN_JUDGE_INTERPRETATION.limitations`) and were already correct.

## Gates executed on the candidate (agent-driven)

| Gate | Command | Result |
| --- | --- | --- |
| Focused unit/lifecycle | repo-root `runtime-lifecycle-governance` + CVK recovery tests; runtime projects for registry, reset, drain, ecosystem reclamation, send-permit lifetime, goal-wake cleanup, compaction addressability | all pass (see the evidence log) |
| Typecheck (node/web/test) | `tsgo --noEmit -p tsconfig.{node,web,test}.json --composite false` | all exit 0 (after `node scripts/generate-ext-bridge.mjs`) |
| Lint (changed files) | `node node_modules/eslint/bin/eslint.js <changed files>` | exit 0 |
| Harness spec | `validate --spec harness/specs/tasks/p2-issue-fixes-batch6-20261010.md` | see the evidence log |
| i18n lint / comms / policy docs / artifact retention / whitespace | see `gates.json` | see the evidence log |

**Environment note (external to this change):** the shared checkout's
`D:\ClawX\node_modules` was emptied earlier by a process outside this session, so
the candidate's dependency junctions point at the populated sibling install
`D:\ClawX-candidates\tf0029-unblock-20260916\{node_modules,openclaw_runtime\node_modules}`
(123 / 776 entries). All gates above ran against that install; the shared
checkout was not modified. `pnpm run <script>` cannot run in this worktree, so the
wrapped `node` commands were invoked directly.

**Not run:** full repository unit suite, `harness:ci`, Electron E2E, Agent Dev
deep-test/audit, packaging, cross-platform checks, live provider calls.

**Credentials:** the changed files and evidence are scanned for common credential
shapes by the evidence driver; results are in `credential-scan.json`.

**Boundaries:** evidence is `driven_by: agent`; no human action, verdict or data
is claimed.
