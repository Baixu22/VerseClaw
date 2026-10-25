# TF-0510 coding control dispositions

- Task: `TF-0510` - give stale-write-guard, symbol-lease/WAL, patch-flow, worktree/isolation an explicit graduate-or-retire outcome
- Actor: `codex` | Evidence driver: `agent`
- **Completion verdict: `complete`** (5 of 5 components closed; 3 advanced, 2 retired)
- Release boundary: no public release, GA, liveReady or productApproved claim

## Outcome

| Component | Disposition | State | Gap |
|---|---|---|---|
| stale-write-guard | advanced | implemented-opt-in | none |
| worktree-backend | advanced | implemented-opt-in | none |
| isolation-request | advanced | implemented-opt-in | none |
| symbol-lease | **retired** | implemented-opt-in | none |
| patch-flow | **retired** | implemented-opt-in | none |

## Why the two experiments were retired (owner-authorised)

Both targeted the same problem: several writers touching one shared checkout. Isolated git
worktrees plus the merge queue already solve that, and they are what this repo ships as
`worktree-backend` / `isolation-request` (both `advanced`, gap 0).

- **symbol-lease**: correctness proven, but the measured 4-process benchmark refuses 75% of
  attempts (12 wins / 36 denials) with zero duplicate side effects. That is throughput cost,
  not added safety.
- **patch-flow**: no evidence that serial fenced patch application improves coding outcomes over
  ordinary tool writes; its benefit gate could only ever recommend, never demonstrate.

External basis (recorded in `retirement-evidence.json`, including the counter-evidence that
worktrees share one `.git` and still conflict on lockfiles):

- https://dsplce.co/agentic-engineering/core/worktree-isolation
- https://docs.bswen.com/blog/2026-03-12-prevent-file-conflicts-ai-agents/
- https://aiarch.dev/workflows/parallel-agent-writes
- https://www.termdock.com/en/blog/git-worktree-conflicts-ai-agents

## What retirement actually did (non-destructive)

| Surface | Change |
|---|---|
| `coding-runtime-flags.ts` | `SYMBOL_LEASE_RETIRED` / `PATCH_FLOW_RETIRED`; both resolvers now always return `false`, so no config or override can re-enable them |
| `shared/dcs/component-disposition-catalog.ts` | both entries move `experiment` -> `retired` with `retirementNodeId=TF-0510`, `visibility=retired`, no `userEntry`, experiment window removed |
| `shared/dcs/prod-flags-control.ts` | the `symbol-lease` writable control-plane spec was removed |
| `agents/tools/team-orchestrate-tool.ts` | the model-facing `patchFlowExecution` parameter and its reader were removed |
| implementations | **kept unchanged** - `symbol-lease.ts`, `symbol-lease-guard.ts`, `patch-flow.ts`, `patch-flow-graduation.ts` |

No user data was deleted or migrated: neither component persisted user records, and the write
journal remains the mutation authority. Rollback is a revert; the prior resolver bodies are in
git history at `d86edc8ab`.

## Measured evidence retained

- stale guard false-block corpus: 1 genuine stale block + 4 must-allow, **false-block rate 0**, 0 missed blocks
- symbol-lease multi-process benchmark: 4 real processes x 12 rounds, 12 wins / 36 denials, **duplicate side effects 0**
- patch-flow serial apply, destructive holds and a 10-cycle soak still covered by their own suites

## Gates

See `verification.json`: ledger guard, patch-flow, patch-flow trigger, stale/lease, false-block
corpus, multi-process benchmark, worktree/isolation, root worktree+WAL, typecheck, lint, contract,
no-BOM, diff check, regenerate-evidence, scope audit and checksums.

## Unverified boundary

- Retirement removes reachability, not code: the modules are deliberately retained for rollback,
  so a future reader can still find dead implementations in the tree.
- The product semantics and default-matrix docs still describe the pre-retirement rows; `docs/` is
  outside this node and is owned by TF-0506.
- The external sources are used as engineering context for the decision, not as acceptance evidence;
  the acceptance evidence is the measured corpus and the on-disk retirement state.
- Agent-driven only; no human evidence is claimed.
