# TF-0768 source-runtime acceptance

Agent-driven only. Candidate: c8e10fb894406c4498e4cb99266fefe3d201e411; tracked source clean at execution.

- 131 host tests in six files; 39 runtime tests in three files; zero failures/skips in the final runs.
- Two real Windows Electron/Gateway scenarios with a local scripted provider. Each child executes a process, persists its workspace/cwd, and reaches agent.wait=ok. Git receipt reports verifiedCheckout=true; inprocess reports false.
- Generation reset during native spawn preparation rejects dispatch, rolls back preparation and deletes the provisional child. Removing the guard makes the regression fail.
- Git metadata creation failure rejects checkout creation without a directory fallback.
- Source archive projection: 20,510 tracked files extracted from this candidate; all bytes compared with git archive. Dependencies were reused; runtime packages were installed privately from the frozen lockfile with lifecycle scripts disabled.

Read acceptance.json for criteria, commands and limitations; gates.json preserves failed attempts as well as the final successful exits. typecheck-direct.json lists the exact bridge and uncached node/web/test compiler commands; runtime-test-types uses the included runtime-test-types.json. The high-level typecheck wrapper timed out; this is not recorded as a successful wrapper run.

Run the source test commands in harness/specs/tasks/coding-orchestration-workspace-authority.md. Electron E2E uses test-owned profile and TEMP directories under D:/ClawX/.tmp because this environment denies Electron writes beneath the implementation checkout. Actual paths are recorded in gates.json.

before.json and git-create-failure.json are original failing controls, not current failures. guard-removed.json and guard-restored.json are a local guard sensitivity pair. cwd-recheck.json is a targeted replay and includes filtered-out tests; it does not replace the final complete suite.

No packaged build, live-model quality, GA or publication approval is claimed. Worktree merge content and journal persistence remain later nodes.
