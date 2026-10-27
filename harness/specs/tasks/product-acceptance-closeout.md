---
lifecycleStatus: active
id: product-acceptance-closeout
title: Windows Product Acceptance Closeout and GA Readiness
scenario: gateway-backend-communication
taskType: runtime-bridge
intent: Freeze the current-candidate acceptance contract, resource boundaries, failure baseline and evidence rules for the Windows ClawX GA-readiness closeout without claiming GA or release approval.
requiredRules:
  - backend-communication-boundary
  - repository-artifact-retention
  - task-forest-autoclose-and-roles
  - docs-sync
touchedAreas:
  - harness/specs/tasks/product-acceptance-closeout.md
  - harness/specs/tasks/runtime-memory-retirement-closeout.md
  - harness/specs/tasks/independent-acceptance-runner-output-roots.md
  - harness/specs/guides/product-acceptance-strategy.md
  - harness/specs/fixtures/product-acceptance-shortfalls/**
  - harness/specs/fixtures/product-acceptance-research/**
  - harness/specs/fixtures/product-acceptance-closeout/**
  - scripts/agent-engineering-acceptance.mjs
  - scripts/lib/agent-engineering-acceptance.mjs
  - scripts/lib/agent-engineering-acceptance.d.mts
  - tests/unit/agent-engineering-acceptance.test.ts
  - docs/dev/agent-engineering-acceptance.md
  - harness/specs/rules/agent-engineering-acceptance-boundary.md
  - tests/unit/product-acceptance-shortfalls.test.ts
  - tests/unit/task-loop-controller.test.ts
  - tests/unit/runtime-memory-context-contracts.test.ts
  - tests/unit/harness-specs.test.ts
  - tests/unit/docs-index.test.ts
  - docs/README.md
  - README.md
  - README.zh-CN.md
  - README.ja-JP.md
expectedUserBehavior:
  - A current-candidate verdict distinguishes functionalReadiness, distributionReadiness and releaseApproved.
  - Known shortfalls stay visible until evidence-backed resolution or an explicitly recorded non-blocking residual.
  - An agent-driven GUI journey is accepted only when a deterministic final-state oracle proves the effect.
  - Historical reports are labelled historical and are never promoted to current-candidate gates.
requiredProfiles:
  - fast
  - comms
requiredTests:
  - pnpm exec vitest run tests/unit/product-acceptance-shortfalls.test.ts tests/unit/harness-specs.test.ts tests/unit/docs-index.test.ts --maxWorkers=1
  - pnpm docs:policy:validate
  - pnpm harness validate --spec harness/specs/tasks/product-acceptance-closeout.md
  - pnpm harness run --spec harness/specs/tasks/product-acceptance-closeout.md --dry-run
  - git diff --check
acceptance:
  - The checked-in contract maps all eleven planned tasks to inputs, commands, oracles, negative cases, required gates, skip budgets and candidate binding.
  - The shortfall ledger permits evidence-backed status transitions but rejects resolution without evidence, inconsistent summaries, accepted P1 defects, and pass claims.
  - Focused constraints, policy validation and the harness dry-run exit zero; the 64/3 and 72/2 reports remain labelled as historical observations.
  - The verdict schema separates functionalReadiness, distributionReadiness and releaseApproved; publication and product locks remain outside agent authority.
  - A retained a0-contract manifest records candidate commit/tree/dirty state, commands, exit codes, counts, actor and limitations with SHA256.
docs:
  required: true
  files:
    - README.md
    - README.zh-CN.md
    - README.ja-JP.md
    - docs/README.md
---

# Windows Product Acceptance Closeout and GA Readiness

This is the aggregate contract for the Task Forest plan `TF-0571`–`TF-0585`. It turns the
research and shortfall ledger from the handoff into an executable, evidence-bound closeout
plan. It does not itself prove product readiness.

## Objective

Answer two separate questions on one frozen candidate:

1. **Functional readiness**: are the named Windows user journeys implemented, logically closed,
   recoverable and proven by deterministic final-state evidence?
2. **Distribution readiness**: does a packaged/installed artifact reach the same core behavior?

The internal verdict may conclude that one is ready and the other is not. Neither answer changes
`releaseApproved`, `productApproved`, `liveReady` or `defaultOn`.

## Candidate binding

Every observable claim records:

- candidate commit and tree, plus `dirty` and any preserved unrelated worktree files;
- build/release identity and dependency or binary versions where relevant;
- model/provider/protocol and fixture/seed/profile inputs for model-driven runs;
- valid feature flags and product locks;
- run, request, tool, trace, event and effect identifiers as applicable;
- actor and verifier, command and exit code, parsed counts and skip identifiers;
- raw artifact SHA256 and the retained evidence manifest;
- scope and explicit limitations, including `not-run` dimensions.

A missing or changed input makes the affected evidence stale. Historical evidence may explain
why a gap exists but cannot satisfy a current-candidate gate.

## Standing resource authorization

The local Task Forest execution hints preserve the owner-authorized development resources:
the local `space-bunny` OpenAI Responses endpoint and the `moyu` test-project path. They are
development resources, not acceptance evidence by themselves.

- The endpoint is injected only into a child process environment. Raw credentials and request
  headers must not be written into tracked files, screenshots, logs or final evidence.
- `moyu` is never modified in place. A disposable copy includes only reviewed source and
  fixtures; exclude `.git`, `.env`, secrets, caches, databases, virtual environments and old soak
  output.
- The model configuration proves only the recorded run. It does not prove model quality,
  arbitrary-provider compatibility or real-human evidence.
- UI actions, approvals, interruption/recovery and verifier decisions are performed by an agent
  and written as `driven_by: agent` with the actual actor.

## Test layers and required gates

The layered contract is defined in
`harness/specs/guides/product-acceptance-strategy.md`:

- **L0 source**: source anchors, contract/diff checks.
- **L1 automated**: focused unit/integration suites with exact counts and skip budgets.
- **L2 runtime**: real Electron and Gateway/runtime processes with acknowledgements.
- **L3 effect**: user-visible journey plus deterministic state, journal or file readback.
- **L4 packaged**: frozen artifact, installed launch, core journey and rollback/readback.
- **L5 operational**: recovery, cleanup, diagnostics and failure drills.
- **L6 release-approved**: an explicit publisher decision; never inferred by this plan.

Release-critical GUI journeys run three consecutive times on clean fixtures. Other dimensions
may reuse one fresh candidate-bound receipt. The 30-run flake/performance window is an
observation when enough samples exist; this closeout does not make it a functional blocker.

The final aggregate runs once per role on the same clean candidate:

- `pnpm test`
- `pnpm run typecheck`
- `pnpm run typecheck:test`
- `pnpm run lint`
- `pnpm contract:check`
- `pnpm i18n:lint`
- `pnpm comms:replay`
- `pnpm comms:compare`
- `pnpm harness validate --spec harness/specs/tasks/product-acceptance-closeout.md`
- `pnpm harness:ci`
- `pnpm repo:artifacts:check`
- `pnpm repo:evidence:check`
- `pnpm repo:test-coverage:check`
- the complete Electron E2E suite
- frozen-package launch, core journey, upgrade/uninstall and lock readback

A gate may be split into serial batches only when the split is recorded before execution and
preserves failure propagation. A cache hit, printed success without readable counts, a skipped
required test or a command from another candidate is not a pass.

## Required task matrix

The matrix is the acceptance contract for the eleven executable nodes. Each row names the
minimal deliverable, primary oracle, mandatory negative check, required gates and evidence exit.
The exact task text remains authoritative in Task Forest; this table prevents a task from being
closed by confidence alone.

| Node | Deliverable | Inputs and commands | Primary oracle | Mandatory negative case | Required gates | Evidence exit |
| --- | --- | --- | --- | --- | --- | --- |
| `TF-0573` a0-contract | Freeze this contract, resource boundaries and baseline | Current HEAD/tree/dirty, `package.json`, `.tmp/acceptance-runner-failures.json`; focused tests, docs policy, harness validate/dry-run | Contract contains every task row; ledger/verifier agrees with itself and disk | Resolved without evidence, stale summary, accepted P1, fabricated pass | `vitest` focused, `pnpm docs:policy:validate`, harness validate/run dry-run, `git diff --check` | `harness/specs/fixtures/product-acceptance-closeout/a0-contract/` |
| `TF-0574` a1-memory | Align retired Runtime Memory tests with product semantics | `openclaw_runtime/src/runtime-core/memory-context.ts`, `tests/unit/task-loop-controller.test.ts`; focused file then full unit gate | Retired flags cause no shadow/persist effect; non-retired inputs remain rejected or bounded | Old write/replay expectation is rejected, not silently rewritten as success | focused file, affected runtime suite, `pnpm test` after integration | a1 manifest and raw test JSON/log |
| `TF-0575` a2-runner-path | Correct independent acceptance fixture output roots | Acceptance runner/library and its complete focused test file | 74/74 focused tests pass with allowed output roots | Path traversal, repo-root overwrite and arbitrary outside-root cases fail closed | focused runner file, typecheck:test, harness validate | a2 manifest and runner report |
| `TF-0576` a3-source-safety | Stop Electron test startup from deleting skill source/link targets | Electron harness, skill-root fixture, worktree guard | Source and link target hashes are unchanged after start/stop | Guard rejects missing/aliased/write-target paths without deleting them | focused unit, Electron smoke, git source manifest before/after | a3 before/after tree and process report |
| `TF-0577` a4-coding-final | Make the coding journey reach a final response and complete undo | `tests/e2e/coding-loop-fp-p1-04.spec.ts`, provider transport diagnostics, write journal | File/tool effects exist and a visible final answer reports the actual outcome | Provider drop yields explicit failure, never a success-looking final response; undo restores state | focused E2E ×3, negative transport case, undo/readback | a4 three-run receipts and state snapshots |
| `TF-0578` a5-qa-pack | Restore a minimal executable QA Lab scenario pack | `openclaw_runtime/extensions/qa-lab`, canonical `qa/scenarios` fixtures, disposable profile | One mock-provider pack run reaches the declared final state | Missing/corrupt scenario and failed assertion produce a failure bundle, not an empty pass | QA Lab focused tests, one pack success, one negative/recovery run | a5 suite summary and failure bundle |
| `TF-0580` b1-space-bunny | Prove local Responses provider reachability and tool round trip through ClawX | Owner-authorized endpoint injected in environment, current adapter, tiny read-only prompt | Typed response, tool call/result and visible final state are bound to request IDs | 401/404/timeout/malformed stream fails visibly without fallback success | provider probe, focused adapter tests, Main/Gateway path smoke | b1 redacted request timeline and hash |
| `TF-0581` b2-moyu | Run coding, approval, undo and recovery on a disposable `moyu` copy | `demo/user_api_shitcode`, offline seed, model through ClawX host-api/Gateway | Deterministic file/test state and final response match the requested change; undo restores; recovery resumes once | Permission denial, pre-edit cancellation, crash/restart and stale journal all fail closed or recover exactly once | three GUI journeys, `python -m acceptance run --mode offline --seed 20260908`, `python -m pytest tests/acceptance -q` | b2 run manifest, timeline, diffs, tree hashes |
| `TF-0582` b3-product-matrix | Exercise the core product matrix and agent exploration | Setup, Chat, Sessions, Memory, Knowledge, Task Ledger, Task Loop, restart plus exploration | Each journey has visible state and durable readback | Forged approval, private-network access, duplicate run and missing recovery are denied/not counted | one fresh Electron journey per surface, critical three-run subset, security negatives | b3 matrix and screenshots/logs |
| `TF-0584` c1-package-oat | Validate frozen Windows package and failure recovery | Frozen `win-unpacked`/installer candidate, clean profile | Installed core journey, lock readback and uninstall/rollback succeed | Corrupt artifact, occupied port, unwritable temp and killed child produce bounded failure and cleanup | package SHA256/build, installed E2E, OAT drills, process/temp sweep | c1 package manifest and OAT receipts |
| `TF-0585` c2-verdict | Complete same-candidate full gates and independent verifier decision | One clean committed candidate, detached executor/verifier checkouts, required gates above | Disk artifacts, exit codes, counts, hashes and final states agree across both roles | Tampered verdict, missing receipt, changed source hash, same actor and false self-report are rejected | `pnpm acceptance:agent:full --spec harness/specs/tasks/product-acceptance-closeout.md ...`, full gate set, README truth review | c2 final report and SHA256 manifest |
| `TF-0579` phase-b | Release the real-model matrix only after a0–a5 are resolved | Task Forest dependencies and a0–a5 evidence | All prerequisite nodes are done with current evidence | Phase opens on a red or stale prerequisite | Task Forest validate; prerequisite readback | phase-b gate receipt |
| `TF-0583` phase-c | Release packaging and final verdict only after the real-model matrix | b1–b3 evidence, frozen source, package candidate | Prerequisites and artifact hashes are consistent | Phase opens on a dirty/unfrozen candidate | Task Forest validate; source/package manifest readback | phase-c gate receipt |

## Shortfall closure rules

The five recorded shortfalls form the baseline. Four remain open; one is resolved with
current evidence:

1. `runtime-memory-retired-test-contract` → **resolved by `TF-0574`** on candidate
   `07f60c029`; evidence is under `harness/specs/fixtures/product-acceptance-closeout/a1-memory/`
2. `agent-acceptance-harness-unconfigured-test-dirs` → `TF-0575` (open)
3. `e2e-skill-source-mutation` → `TF-0576` (open)
4. `coding-loop-e2e-final-response` → `TF-0577` (open)
5. `qa-lab-scenario-pack-not-present` → `TF-0578` (open)

A shortfall may become `resolved` only when all of the following are on disk and bound to the
same candidate:

- the repair or test-contract decision with a source/diff reference;
- the previously failing oracle now passing;
- the required negative control still failing closed;
- command, exit code, parsed counts and skip IDs;
- raw result SHA256 and retained evidence path.

A non-blocking residual may be recorded as `accepted-shortfall` only when it is not P1/critical,
its impact and user-visible consequence are recorded, reproduction evidence exists, a rollback
or kill switch is known, an agent owner and review date are present, and publication/product
locks remain unchanged. A shortfall is never written as `pass`.

## Evidence and retention

Raw run output goes under `D:/tmp/clawx-product-acceptance/<run-id>/<node>/`; curated evidence
goes under `harness/specs/fixtures/product-acceptance-closeout/<node>/`. Each retained directory
has a manifest with every file's SHA256 and a credential/path scan.

Test and build temp directories start at `D:/tmp`. If Electron rejects the low-integrity temp
root, use a unique agent-owned run root inside `D:/ClawX/.tmp`. Preserve `PATHEXT`, `APPDATA`,
`SystemRoot`, `SystemDrive`, `ComSpec` and `windir`.

The current checkout has no trusted package artifact. Packaging remains `not-run` until
`TF-0584` creates one. The current source build is a GA candidate, not GA; no public release or
real-human evidence is claimed.

## Closure sequence

1. Execute one ready leaf at a time in dependency order.
2. For each leaf, retain raw evidence, curate the manifest, and update the ledger only after
   reading the artifacts on disk.
3. Apply the Task Forest proposal only when all criteria, the base graph hash and the evidence
   chain are complete; then validate, export and refresh the handoff.
4. At `TF-0585`, produce one candidate-bound verdict. `functionalReadiness=ready` is permitted
   only if all five original shortfalls have lawful resolution evidence and no new blocking
   defect exists.
5. Report `distributionReadiness` separately. Do not infer it from a source build.
6. Leave `releaseApproved`, `productApproved`, `liveReady` and `defaultOn` unchanged. Publication
   or a lock/default change is a separate publisher decision.