# TF-0769 worktree merge acceptance

Agent-driven source-runtime proof, candidate f51de63b27f9ee4fbbc9997e568787446e857b7e, clean at execution.

190 host tests and 35 runtime tests passed with no skips. Four Windows Electron/Gateway scenarios use a scripted local provider, real child execution, filesystem checks and the SQLite subagent owner: inprocess/Git deletion+rename both merge; inprocess/Git concurrent edits both conflict and retain all user bytes. Postimage hashes and journal references are read back. Cleanup records zero surviving processes.

before-unit.json preserves 8 original failing regressions; before-duplicate-completion.json preserves both failing concurrent duplicate callbacks. original-probe-results.json confirms all four original A4 probes no longer reproduce. CodingRun failures in the same original probe remain TF-0771 work.

prior-e2e-failures.json is from candidate 1acb04518: two inprocess scenarios read the retired JSON registry and two Git cases timed out launching Electron. It is not a passing E2E result. The final fixture reads state/openclaw.sqlite/subagent_runs; final e2e.json has 4 expected, 0 unexpected, 0 skipped, 0 flaky.

Commands, exits and timing are in gates.json. Typecheck uses the uncached bridge plus node/web/test compiler projects listed in typecheck-direct.json; additional runtime test types use runtime-test-types.json. Source archive projection verified 20,558 tracked files; root dependencies are reused and runtime dependencies use the private frozen-lock installation described in TF-0768.

Journaled application and file leases are reused. This is not a kernel filesystem transaction: arbitrary external writes during an individual OS operation are not claimed atomic. Baseline snapshots are in-memory; restart without an owner fails closed. Crash recovery and package acceptance remain later nodes. No live-model quality, GA or release approval is asserted.
