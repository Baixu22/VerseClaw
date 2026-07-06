# Deep Validation Results

Status: accepted_registry_pilot_ast_current_pilot_needs_revision

## Summary

Deep validation accepts the Registry controlled diagnostic consumer as the next pilot direction and rejects AST as a current usable pilot direction.

Registry showed lower operational risk because it consumes already-shaped diagnostics, summarizes bounded evidence, preserves provider ordering, and does not scan source text. AST showed real positive value for narrow explicit readonly rules, but the larger-source test intentionally crossed the match limit and returned `review_required`, confirming that AST cost and review burden grow with scanned source volume.

This means AST is not qualified for the next "real usable direction" pilot. It should not proceed as a parallel pilot beside Registry.

## Direction Decision

Accepted direction:

1. Proceed with Registry controlled diagnostic consumer pilot.
2. Do not proceed with AST controlled readonly candidate-generation pilot in the current phase.
3. Keep AST only as a future optimization/research track with a stricter entry gate.

This is not approval for formal production use, default-on behavior, provider ordering cutover, AST apply, workspace edit, TaskLoop authority, Gateway/provider transport changes, or task-completion authority.

## Optimize Or Abandon

Decision: abandon AST as a current pilot, optimize only as a later narrow evaluation track.

Rationale:

- Direct abandonment of the runtime-core helper is unnecessary because existing readonly behavior is bounded, explicit, and covered by tests.
- Advancing AST now would create more review burden and source-scan cost than proven positive value.
- Optimizing AST is only worthwhile if the next AST-specific task reduces scope instead of expanding it.

Required AST re-entry conditions:

- fixed target-file allowlist, no repository-wide scan;
- max file count, max source bytes, max matches, and max preview diff bytes;
- measured false-positive rate and review time on at least 30 narrow-rule samples;
- no apply/write/mutation/completion evidence;
- no TaskLoop/Gateway/Main/renderer/host-api/api-client/provider transport path;
- hard fail-closed on overbroad, ambiguous, or budget-exceeded cases.

## Metrics

| Metric | AST | Registry |
|---|---|---|
| Default-off behavior | Pass: omitted AST flags return `skipped`, no matches, no preview diff. | Pass: omitted collector flag returns disabled output, no diagnostics emitted, omitted count retained. |
| Positive value signal | Mixed: pass for narrow explicit rule, 6 files / 24 exact matches / 6 preview diff files; not sufficient for pilot acceptance. | Pass: summarizes provider exception, unsupported MCP content, denied, waiting, cancelled, and tool error outcomes. |
| Fail-closed behavior | Pass: overbroad pattern, unbound metavariable, invalid glob target, and gated-off config all produce no matches and no preview diff. | Pass: invalid diagnostic input is filtered; limit keeps 5 included diagnostics and 1 omitted diagnostic from 6 valid inputs. |
| Cost envelope | Not accepted for current pilot: larger 24-file / 288-match source-volume case returns `review_required` at 64-match limit; cost/review burden grows with source volume. | Lower cost: representative mixed diagnostic aggregation stays under the 50ms test threshold. |
| Authority/provider-order stability | Pass: readonly authority metadata still marks preview diff as non-completion evidence. | Pass: provider order remains `a-context`, `z-context`; collector output contains no provider-ordering/tool-authority/TaskLoop-authority/transport authority fields. |

## Commands Run

- `pnpm --config.verify-deps-before-run=false exec vitest run tests/unit/runtime-controlled-runtime-use-deep-validation.test.ts`: pass, 1 file / 6 tests.
- `pnpm --config.verify-deps-before-run=false exec vitest run tests/unit/runtime-controlled-runtime-use-deep-validation.test.ts tests/unit/runtime-controlled-runtime-use-pilot-readiness.test.ts tests/unit/runtime-controlled-runtime-use-readiness-boundary.test.ts`: pass, 3 files / 18 tests.
- `pnpm --config.verify-deps-before-run=false run typecheck`: pass.
- `rg -n "AST Patch Planner|astPatchPlanner|controlled runtime-use|controlled pilot|diagnostic consumer|registryDiagnostics|Provider/Tool Registry|runtime-use readiness|candidate generation|deep validation" README.md README.zh-CN.md README.ja-JP.md README.ru-RU.md`: no matches; no README update required.
- `git diff --check -- tests/unit/runtime-controlled-runtime-use-deep-validation.test.ts runtime-research/handoffs/controlled-runtime-use-pilot-deep-validation/README.md runtime-research/handoffs/controlled-runtime-use-pilot-deep-validation/results.md`: pass.

## Remaining Gaps

- Registry still needs operator-value evidence: diagnostic usefulness, actionability, and noise rate over real internal runs.
- Registry still cannot receive provider ordering, tool, prompt, TaskLoop, Gateway, transport, persistence, or completion authority.
- AST is blocked from current pilot use and needs narrow-rule quality evidence before re-entry: false positive rate, rule authoring burden, review time, and source-volume cost.
- AST still cannot apply patches, edit files, mutate symbols, or prove task completion.
- Parallel use should wait until both pilots have separate run results and cost budgets.

## Required Command

```text
pnpm --config.verify-deps-before-run=false exec vitest run tests/unit/runtime-controlled-runtime-use-deep-validation.test.ts
```
