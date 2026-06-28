# Phase 8 AST Patch Planner Readonly Scan Window Prompts

Use these prompts to run a one-conversation MVP implementation under Goal mode. The MVP is intentionally readonly: it may validate rules, scan explicit TypeScript/TSX targets, return match evidence, produce preview diffs, and detect drift/conflicts. It must not apply patches or mutate the workspace.

## Goal Prompt

```text
Goal: Implement the Phase 8 AST Patch Planner Readonly Scan MVP end to end in one conversation.

Required reading first:
- AGENTS.md
- runtime-research/agent-runtime-index.md
- runtime-research/implementation-roadmap.md
- runtime-research/migration-execution-plan.md
- runtime-research/agent-runtime-core-spec.md
- runtime-research/ast-grep/rule-structure.md
- runtime-research/ast-grep/patch-flow.md
- runtime-research/ast-grep/useful-tests.md
- runtime-research/ast-grep/clawx-mapping.md
- harness/specs/tasks/phase-8-ast-patch-planner-readonly-scan.md
- runtime-research/handoffs/phase-8-ast-patch-planner-readonly-scan/README.md
- runtime-research/handoffs/phase-8-ast-patch-planner-readonly-scan/parallel-lanes.md
- runtime-research/handoffs/phase-8-ast-patch-planner-readonly-scan/submission-template.md
- runtime-research/handoffs/phase-8-ast-patch-planner-readonly-scan/synthesis.md

Run before implementation:
- pnpm --config.verify-deps-before-run=false harness context --spec harness/specs/tasks/phase-8-ast-patch-planner-readonly-scan.md
- pnpm --config.verify-deps-before-run=false harness validate --spec harness/specs/tasks/phase-8-ast-patch-planner-readonly-scan.md --no-diff

MVP target:
- Add a runtime-core AST patch planner readonly module for TypeScript/TSX explicit target files.
- Add default-off flag resolution for readonly scan and preview diff only.
- Add rule validation for pattern/fix shape, language, metavariable binding, unsupported transforms, overbroad patterns, and invalid inputs.
- Add readonly scan output with ordered match evidence, bounded diagnostics, and preview diff text.
- Add checkpoint/drift diagnostics for rule hash, target files, match counts/ranges, preview diff hash, and source file hashes.
- Add focused tests and fixtures covering accepted MVP cases.
- Write A-E lane submissions and update synthesis only if evidence passes.
- Update runtime-research/agent-runtime-index.md only after synthesis reaches accepted status.

Hard boundaries:
- No patch apply, file write, workspace edit, rename, replaceBody, insertBefore, insertAfter, safeDelete, or symbol mutation.
- No TaskLoop, Gateway, Main, renderer, host-api, api-client, provider transport, provider ordering, prompt/model-message, service, listener, daemon, persistence, or default-on behavior.
- Preview diffs are diagnostics only and do not prove task completion.
- Invalid/overbroad/overlap/range drift cases must fail closed into structured diagnostics.

Primary files likely to create:
- openclaw_runtime/src/runtime-core/ast-patch-planner.ts
- tests/unit/runtime-ast-patch-planner-contracts.test.ts
- tests/unit/runtime-ast-patch-planner-rule-validation.test.ts
- tests/unit/runtime-ast-patch-planner-readonly-scan.test.ts
- tests/unit/runtime-ast-patch-planner-resume-drift.test.ts
- tests/fixtures/ast-patch-planner/**

Do not broaden owned paths unless the synthesis explains why and preserves all forbidden boundaries.
```

## One-Conversation MVP Implementation Prompt

```text
Implement Phase 8 AST Patch Planner Readonly Scan MVP.

Work in this order:
1. Read the required docs and run harness context/structural validate.
2. Inspect existing runtime-core export style and test naming conventions.
3. Design the smallest explicit-call runtime-core module:
   - AstPatchPlannerRule
   - AstPatchPlannerTargetFile
   - AstPatchPlannerMatch
   - AstPatchPlannerPreviewDiff
   - AstPatchPlannerCheckpoint
   - AstPatchPlannerDiagnostic
   - AstPatchPlannerResult
4. Implement safe default flags:
   - readonlyScan false by default
   - previewDiff false by default
   - no apply flag exists
5. Implement rule validation:
   - reject missing pattern
   - reject unsupported language
   - reject fix metavariables not bound by pattern
   - reject unsupported transform/rewriter fields for MVP
   - reject likely overbroad patterns unless explicitly allowlisted by a test-only option
6. Implement readonly scan over explicit in-memory target files. Keep it deterministic and local.
   - If an ast-grep dependency/binary is not already available, implement a conservative MVP matcher for explicit simple pattern/fix fixtures and document the limitation in diagnostics. Do not add a new service or network dependency.
   - Prefer structured inputs and outputs over ad hoc strings.
7. Implement preview diff generation as bounded diagnostic text only.
8. Implement checkpoint/drift helper:
   - rule config hash
   - target file ids
   - source file hashes
   - match count/ranges
   - preview diff hash
   - review_required on any mismatch
9. Add tests for:
   - flags disabled
   - valid fixable TypeScript pattern
   - unfixable match
   - invalid rule
   - unbound metavariable
   - overbroad pattern
   - overlapping ranges
   - multi-file deterministic preview ordering
   - resume range drift
   - no write/apply helper exported
10. Run focused tests, typecheck if feasible, boundary scans, comms replay/compare if required by spec.
11. Fill lane submissions A-E with evidence.
12. Update synthesis from needs_revision to accepted only if all gates pass.
13. Update agent-runtime-index.md only after accepted synthesis.

Final answer must include:
- files changed
- tests/commands run and result
- validation blocked by unrelated dirty worktree if applicable
- explicit confirmation that no apply/write/runtime-authority path was added
```

## Lane A Prompt: Contracts And Flags

```text
Implement Lane A for Phase 8 AST Patch Planner Readonly Scan.

Scope:
- Define runtime-core contracts and diagnostics for the readonly planner.
- Add default-off readonlyScan and previewDiff flag resolution.
- Export only explicit-call helpers.
- Do not implement scanning or preview diff beyond stubs needed for tests.
- Do not create any apply or write API.

Acceptance:
- Contract tests cover validation of input/result shapes and default flags.
- Search proves no apply/write/mutation helper exists in the touched planner module.
- Submission file:
  runtime-research/handoffs/phase-8-ast-patch-planner-readonly-scan/submissions/lane-a-contracts-and-flags.md
- Status line exactly one of accepted / needs_revision / blocked.
```

## Lane B Prompt: Rule Validation

```text
Implement Lane B for Phase 8 AST Patch Planner Readonly Scan.

Scope:
- Validate rule shape for TypeScript/TSX MVP.
- Reject invalid pattern/fix inputs.
- Extract pattern metavariables and ensure every fix metavariable is bound.
- Reject unsupported transform/rewriter fields for MVP.
- Reject overbroad patterns with fail-closed diagnostics.
- Return structured diagnostics only.

Acceptance:
- Tests cover missing pattern, unsupported language, unbound metavariable, unsupported transform, overbroad pattern, and valid rule.
- Diagnostics include stable codes suitable for synthesis evidence.
- No scan/apply/runtime integration is added.
- Submission file:
  runtime-research/handoffs/phase-8-ast-patch-planner-readonly-scan/submissions/lane-b-rule-validation.md
```

## Lane C Prompt: Readonly Scan And Preview Diff

```text
Implement Lane C for Phase 8 AST Patch Planner Readonly Scan.

Scope:
- Run readonly scan over explicit TypeScript/TSX target files supplied by caller.
- Return ordered match evidence with path, range, excerpt hash/snippet, and rule id.
- Generate bounded preview diff text for fixable rules.
- Report unfixable matches without diff.
- Preserve deterministic multi-file ordering.
- Do not read arbitrary workspace files unless explicitly supplied paths are part of the test fixture and no write occurs.

Acceptance:
- Tests cover fixable rule preview, unfixable match, multi-file ordering, bounded output, and no file writes.
- Boundary scan over touched files finds no write/apply APIs.
- Submission file:
  runtime-research/handoffs/phase-8-ast-patch-planner-readonly-scan/submissions/lane-c-readonly-scan-preview-diff.md
```

## Lane D Prompt: Resume Drift And Conflict Diagnostics

```text
Implement Lane D for Phase 8 AST Patch Planner Readonly Scan.

Scope:
- Add explicit checkpoint helpers for readonly planner results.
- Store rule hash, target file list, source file hashes, match counts/ranges, and preview diff hash.
- Recompare current scan output to checkpoint.
- Detect file hash drift, match count drift, range drift, diff hash drift, and overlapping ranges.
- Return review_required/fail-closed diagnostics.
- Do not continue from drift into apply or mutation.

Acceptance:
- Tests cover unchanged replay, file hash drift, range drift, match count drift, diff hash drift, and overlap conflict.
- Result never includes an apply recommendation stronger than review_required.
- Submission file:
  runtime-research/handoffs/phase-8-ast-patch-planner-readonly-scan/submissions/lane-d-resume-drift-and-conflict-diagnostics.md
```

## Lane E Prompt: Validation Boundary Synthesis

```text
Run Lane E validation for Phase 8 AST Patch Planner Readonly Scan.

Required:
- Validate task spec with --no-diff and record normal validate result. If normal validate fails because of unrelated dirty files, classify and quote that.
- Run focused AST planner tests.
- Run typecheck if feasible.
- Run boundary scans:
  - write/apply/mutation patterns over touched files
  - TaskLoop/Gateway/Main/renderer/host-api/api-client/provider/model prompt insertion over touched files
  - service/listener/daemon patterns over touched files
- Run comms replay/compare if the spec or touched paths require it; if no communication paths changed, still record the spec-required result or justified not-run.
- Verify every lane submission has exactly one Status line.
- Update synthesis to accepted only if A-D evidence and boundary scans pass.
- Update agent-runtime-index.md only after accepted synthesis.

Submission file:
runtime-research/handoffs/phase-8-ast-patch-planner-readonly-scan/submissions/lane-e-validation-boundary-synthesis.md
```

## Synthesis Prompt

```text
Synthesize Phase 8 AST Patch Planner Readonly Scan.

Read A-E submissions, tests, commands, touched files, and boundary scans.

Classify each lane as accepted, needs_revision, or blocked.

Accept only if:
- readonly planner contracts exist and are explicit-call only;
- flags default off;
- rule validation fails closed;
- readonly scan and preview diff are deterministic and bounded;
- checkpoint/drift diagnostics fail closed to review_required;
- no apply/write/workspace edit/symbol mutation path exists;
- no TaskLoop/Gateway/Main/renderer/host-api/api-client/provider/model prompt/runtime authority path exists;
- focused tests pass;
- task spec validates structurally;
- normal validate is either pass or blocked only by unrelated dirty files and clearly recorded.

If accepted:
- Change synthesis status to `Status: accepted`.
- Update agent-runtime-index.md AST Patch Planner status with code/tests/handoff.

If any gate fails:
- Keep `Status: needs_revision` and list exact required fixes.
```

## MVP Acceptance Matrix

| Gate | Required Result |
|---|---|
| Spec context | `pnpm --config.verify-deps-before-run=false harness context --spec harness/specs/tasks/phase-8-ast-patch-planner-readonly-scan.md` passes |
| Spec structural validate | `pnpm --config.verify-deps-before-run=false harness validate --spec harness/specs/tasks/phase-8-ast-patch-planner-readonly-scan.md --no-diff` passes |
| Focused tests | `pnpm --config.verify-deps-before-run=false exec vitest run tests/unit/runtime-ast-patch-planner*.test.ts` passes |
| Typecheck | Passes, or unrelated existing failures are documented with exact paths |
| No mutation | Touched-file scan finds no write/apply/workspace edit/symbol mutation API |
| No runtime authority | Touched-file scan finds no TaskLoop/Gateway/Main/renderer/provider/model prompt cutover |
| No service | Touched-file scan finds no listener/server/daemon/database additions |
| Lane submissions | A-E exist and each has exactly one Status line |
| Synthesis | Accepted only after evidence passes |
| Index | Updated only after accepted synthesis |

## Failure Handling

- If a test fails, keep synthesis `needs_revision`.
- If normal harness validate fails because of unrelated dirty files, record it as blocked-by-dirty-worktree but require `--no-diff` structural validate to pass.
- If any apply/write/mutation path appears, reject the MVP.
- If planner output reaches TaskLoop, Gateway, renderer, provider transport, model messages, or prompt assembly, reject the MVP.
