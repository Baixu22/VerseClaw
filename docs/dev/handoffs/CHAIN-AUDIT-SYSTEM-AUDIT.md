# Chain-Audit Acceptance System ? Independent Audit + Hardening (2026-08-13)

Scope: the locally added "real-chain" test acceptance system under
`scripts/chain-audit/` (authored by deepseek-v4-flash). This audit evaluated
whether it can truthfully verify the harness/runtime development state,
quantified the result, fixed untruthful results and holes, and broadened
coverage without touching production runtime code.

## Verdict

- Pre-fix system: **NOT trustworthy as acceptance** (score 48/100 on the audit rubric).
- Post-fix system: **evidence-grade with fail-closed gating**; the checker itself is unit-tested (11/11) and its verdicts are now bound to real transcript/tool-result/workspace evidence and HEAD/build/config digests.
- The hardened monitor then exposed **real runtime defects the old system hid** (see Findings).

## Quantified pre-fix evidence (captured before changes)

| Probe | Result | Why it was false/unreliable |
|---|---|---|
| Live RPC run | 97/100 (30/31 groups) | `device.pair.list` and `secrets.resolve` normal probes returned `missing scope` but were counted PASS because admin-gated matching was by method name; duplicate calls to the same method; `tools.effective` cold-timeout flake; `sessions.fork`/`memory.propose` mutated real state on every run. |
| Live agent subset (readonly/write/exec/web/memory) | 77/100 | `tools.exec` not called at all -> still "?? 77"; `write` declared check `verified` was never evaluated (silently dropped); `memory.available` used a brittle whole-transcript regex. |
| Static | - | `hasAnswer` = "modelRounds > 0" (no answer content); `tools.*` = "tool was called" (denied/errored tools passed); task `checks` array was decorative (only memory chain special-cased); matrix had machine-specific absolute workspace paths; jforum fix verdicts came from a separate analyzer against already-fixed state, not attributable to the run; runner always exited 0; no HEAD binding; destructive prompt falsely claimed the workspace "is not a git repo" while it is one (a `git clean -fd` there could wipe the whole untracked JForum tree). |

## Fixes delivered (scripts/chain-audit only + package.json + docs)

1. Outcome-check engine (`lib/checks.js`): tool calls linked to tool results via
   `toolCallId`; success requires `isError=false` (per-tool `toolModes: call`
   relaxes for error-path probes); `hasAnswer` requires model round + real answer
   text (`NO_REPLY` excluded); added `answerContains`, `fileCheck` (file
   state/positive/negative regexes), `toolResult` checks; `memory.available`
   reads the actual tool result. Unknown check names abort (fail closed).
2. Config validation (`lib/validate.js`) runs before any work: duplicate
   ids/methods, invalid regexes, unresolvable checks.
3. RPC probe semantics (`run-chain-audit.mjs` + `rpc-checks.json`):
   normal / admin-deny / admin-allow faces; a scope denial is now a failure for
   normal probes; an unexpected success of a gated/expectError probe is a
   failure; payload assertions (`expect`); one cold-start retry; mutating probes
   (`sessions.fork`, `memory.propose`) are skipped unless `--allow-mutations`;
   any critical-group failure forces F and propagates to the aggregate.
4. Evidence binding (`lib/evidence.js`): HEAD/branch/tree-dirty/matrix+rpc
   digests/runtime entry mtime/build stamp/node/platform in every report and in
   `history.json`.
5. Fail-closed exits: `--ci`, `--fail-on-score`, `--fail-on-rpc-score`;
   exit 4 on critical failures; exit 2/3 on thresholds; fixed the empty-aggregate
   "0/100" mislabel.
6. Transcript attribution: only post-snapshot files that contain the task's own
   first user message; must end with an assistant message; no silent fallback to
   a concurrent session's transcript (`evidence.matched`/`evidence.complete`
   are critical checks).
7. Workspace isolation/reproducibility: `CHAIN_AUDIT_WORKSPACE` override,
   `{{workspace}}` placeholders; destructive chains run in per-run scratch-git
   fixtures (untracked sentinel detects real `git clean -fd`); jforum-fix refuses
   to run on a diverged workspace unless `--restore-baseline` (current files
   backed up first); per-task before/after file hashes + `fileCheck.fixed`
   make each fix verdict attributable to that run.
8. Scoring correction: cache metric only when declared; missing required tools
   are critical, not diluted to "??".
9. Self-tests: `scripts/chain-audit/tests/*.test.mjs` (11 tests, node:test) for
   monitor/checks/validation/grading semantics; `pnpm chain-audit:test`.
10. Cross-run reliability reporter (`reliability.mjs`,
    `pnpm chain-audit:reliability`): per-task spread/pass-rate/stability over N
    runs so a single green run cannot masquerade as stable acceptance.
11. Analyzer scripts now honor `CHAIN_AUDIT_WORKSPACE` and prefer the run's own
    `fileCheck.fixed` verdict over stale workspace-vs-baseline comparison.
12. Docs/scripts updated (`chain-audit:rpc`, `chain-audit:ci`,
    `chain-audit:analyze-fix`, `chain-audit:score`, `chain-audit:reliability`,
    `chain-audit:verify-compaction`).

## Post-fix quantified results (real runs, DEEPSEEK_API_KEY, real gateway)

- Unit tests: **11/11 pass**.
- RPC-only run: **100/100**, 29/31 groups executed, 2 mutating groups correctly
  skipped; device/secrets/config admin allow-faces verified with proper scopes.
- Full matrix run #1 (baseline copy, before tool-config alignment):
  agent **85/100**, 32/38 tasks pass; run failed to gate on criticals (bug in
  `grade.aggregate` breakdown, since fixed).
- Full matrix run #2 (after gate fix + tool-surface alignment): agent
  **69/100**, 26/38 pass, 12 critical-fail tasks; `--ci` exited **4** (FAIL) as
  required. `NODE_EXIT=4` confirmed.
- Cross-run reliability over the last runs: **21/38 tasks stable, 17 volatile**
  (spread up to 90 points). A single-run grade is therefore not acceptance; the
  new reliability reporter makes this explicit.

## Real runtime defects the hardened monitor surfaced (evidence, not narrative)

- **P1: broken runtime chunk graph.** Tool/RPC errors reference missing dist
  modules: `bash-tools-CNYGmtk8.js`, `io-B86lst6B.js`,
  `server-methods-YQ4yf_rP.js`, `tools-DsggoUbD.js` do not exist in
  `openclaw_runtime/dist` (sibling generations of the same chunks do exist).
  This broke sessions/spawn/cron/gateway/memory tool paths in run #2 and is
  reproducible in the saved reports.
- **P1: destructive-command policy gap.** In a scratch git repo the agent ran
  `git reset --hard` and `git clean -fd` with no interception; the untracked
  sentinel was deleted (`fileCheck.repo-intact=false`, run evidence).
- **P2: memory search unusable.** Real `memory_search` result:
  `disabled/unavailable, "index metadata is missing"` -> `memory.available=F`.
- **P2: empty-reply turns.** `context/multi-turn` and `sandbox/sandbox-exec`
  produced only `NO_REPLY` in one run (`hasAnswer=F`) ? the old checker
  green-lit these via `modelRounds>0`.
- **Observation:** 20/38 tasks changed grade between two consecutive full runs;
  LLM-chain grades are noisy and require multi-run reporting.

## Boundaries / residual

- Production runtime code was NOT modified. The working tree already contained
  other agents' in-flight edits (a `reasonix-desktop` process was active during
  this audit); only `package.json`, `scripts/chain-audit/**`, and this document
  were changed by this audit. `openclaw_runtime/dist` was rebuilt because the
  prior session left it cleared; `dist` is gitignored.
- Two disposable external copies remain under
  `%TEMP%\chain-audit-jforum-20260813-005701` and
  `%TEMP%\chain-audit-jforum-20260813-011341` (deletion was blocked by policy;
  safe to remove manually). Evidence under `artifacts/chain-audit/` is gitignored.
- Recommended next steps (not performed, separate tasks): repair the dist chunk
  graph, close the destructive-command policy gap, restore the memory index,
  and investigate `NO_REPLY` turns ? then re-run `pnpm chain-audit:ci` plus
  `pnpm chain-audit:reliability` for multi-run acceptance.

## Commands

```bash
node --test scripts/chain-audit/tests/*.test.mjs
node scripts/chain-audit/run-chain-audit.mjs --rpc-only
DEEPSEEK_API_KEY=sk-... CHAIN_AUDIT_WORKSPACE=<baseline-copy> \
  node scripts/chain-audit/run-chain-audit.mjs --ci
node scripts/chain-audit/reliability.mjs --runs 4
```
