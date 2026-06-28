# Line C Grounding Production-entry Readiness Plan Implementation Synthesis

## Spec Decision Table

| Requirement | Decision | Evidence |
| --- | --- | --- |
| Fresh production-entry task spec | accepted | `harness/specs/tasks/line-c-grounding-production-entry-readiness-plan.md` created; context passed and `--no-diff` validation passed. Normal validation is blocked by unrelated dirty worktree files outside this task. |
| Planning-only stage | accepted | Spec and handoff reject default-on, runtime authority, prompt/model-message/provider ordering/runtime decision/memory promotion/persistence/UI cutover. |
| Future phases split into specs | accepted | Phase A through Phase G are mapped to separate future task spec names. |
| Runtime code change | rejected for this stage | This package is docs/spec/report/index only. |
| Boundary markers | accepted | The plan preserves `authority: "none"`, `rawRetained: false`, `includeRaw: false`, and `includeUntrusted: false`. |

## Production Readiness Gap Table

| Gap | Current status | Required before production entry |
| --- | --- | --- |
| Controlled internal pilot evidence | Predecessor readiness accepted; pilot itself not yet run. | Phase A spec and pilot proof. |
| Operator presentation/readiness | Proposal/planning only. | Phase B spec with redaction, docs, i18n/E2E if UI exists. |
| Limited production diagnostics | Not approved. | Phase C spec with owner approval, sampling limits, and rollback drill. |
| Runtime shadow replay | Existing diagnostics tests pass; production-like replay not approved here. | Phase D replay proof over sanitized corpus. |
| Cutover readiness | Not approved. | Phase E review, scorecard, owner/security approval, and zero veto gates. |
| Controlled production opt-in | Not approved. | Phase F controlled opt-in spec and production metrics. |
| Default-on | Rejected for this stage. | Phase G proposal only, then a later implementation spec if ever accepted. |

## Phase Roadmap Table

| Phase | Status after this task | Next spec |
| --- | --- | --- |
| Phase A: controlled internal opt-in pilot | Planned only | `line-c-grounding-controlled-internal-opt-in-pilot.md` |
| Phase B: diagnostics presentation/operator readiness | Planned only | `line-c-grounding-diagnostics-presentation-operator-readiness.md` |
| Phase C: limited production opt-in, still diagnostics-only | Planned only | `line-c-grounding-limited-production-opt-in-diagnostics-only.md` |
| Phase D: runtime shadow replay proof | Planned only | `line-c-grounding-runtime-shadow-replay-proof.md` |
| Phase E: cutover readiness review | Planned only | `line-c-grounding-cutover-readiness-review.md` |
| Phase F: controlled production opt-in | Planned only | `line-c-grounding-controlled-production-opt-in.md` |
| Phase G: default-on proposal | Proposal only | `line-c-grounding-default-on-proposal.md` |

## Risk Register Summary

The risk register covers default-on drift, runtime authority drift, prompt/model-message injection, provider ordering drift, memory promotion/fact acceptance/episode write, persistence/database/sidecar/cache/exporter/listener/service creep, raw prompt/raw trace/full payload/tool args/output/stdout/stderr/env/secret/API key/auth header/traceparent/tracestate/baggage leakage, untrusted refs leakage, budget/token/performance regressions, renderer/Main/Gateway/host-api/api-client transport boundary violations, UI/docs/i18n mismatch, and rollback failure.

All listed risks remain blockers for implementation phases unless a future accepted task spec narrows and validates a specific boundary.

## Validation Strategy Summary

Validation requires fresh spec context, fresh spec validate, predecessor spec validates with `--no-diff`, the seven-file grounding diagnostics unit test command, TypeScript node check, touched-file diff check, README review, focused boundary scans, and an explicit comms replay/compare decision.

## Rollout/Rollback Summary

Rollout is staged from internal pilot through default-on proposal, with each phase requiring a separate accepted spec. Rollback for this planning package is deletion of the spec, handoff directory, and runtime index entry. No data, UI, provider, transport, cache, sidecar, service, or database cleanup is required because this package must not add runtime behavior.

## Test And Scan Results

| Command | Result |
| --- | --- |
| `node harness/src/cli.mjs context --spec harness/specs/tasks/line-c-grounding-production-entry-readiness-plan.md` | pass |
| `node harness/src/cli.mjs validate --spec harness/specs/tasks/line-c-grounding-production-entry-readiness-plan.md` | blocked by unrelated dirty/untracked worktree files outside this task's touched areas |
| `node harness/src/cli.mjs validate --spec harness/specs/tasks/line-c-grounding-production-entry-readiness-plan.md --no-diff` | pass |
| `node harness/src/cli.mjs validate --spec harness/specs/tasks/line-c-grounding-controlled-internal-opt-in-readiness.md --no-diff` | pass |
| `node harness/src/cli.mjs validate --spec harness/specs/tasks/line-c-grounding-diagnostics-authority-sentinel-effectiveness-evaluation.md --no-diff` | pass |
| `node node_modules/vitest/vitest.mjs run tests/unit/runtime-grounding-authority-effectiveness.test.ts tests/unit/runtime-grounding-shadow-consumers.test.ts tests/unit/context-provider-registry.test.ts tests/unit/runtime-trace-context-provider.test.ts tests/unit/runtime-symbol-context-provider.test.ts tests/unit/runtime-agent-map-context-provider.test.ts tests/unit/runtime-memory-context-provider.test.ts` | pass, 7 files / 51 tests |
| `node node_modules/typescript/bin/tsc --noEmit -p tsconfig.node.json --composite false` | pass |
| `git diff --check -- <touched-files>` plus `git diff --no-index --check` for new untracked spec/handoff files | pass; Git printed LF-to-CRLF working-copy warnings only |

Earlier validation had been blocked by an unrelated untracked `openclaw_runtime/src/runtime-core/ast-patch-planner.ts` syntax error. Current-state revalidation shows that blocker is gone; the required seven-file unit command and TypeScript node check now pass.

Boundary scans:

| Scan | Result |
| --- | --- |
| Fixed-string renderer/Main transport scan | Existing localized policy text and existing Electron-owned WebSocket clients only; no new renderer direct IPC/Gateway bypass from this task. |
| Service/exporter/listener/database scan over touched files | Matches only rejected-boundary/policy text and historical runtime index entries. |
| Raw-retention scan over touched files | Matches only rejected-boundary/policy text and historical runtime index entries. |
| Authority-grant scan over touched files | Matches only scan patterns, roadmap metrics, and validation policy text. |
| Memory promotion/fact acceptance/episode write scan over touched files | Matches only rejected-boundary/policy text and historical runtime index entries. |
| Patch/workspace/symbol mutation scan over touched files | Matches only rejected-boundary/policy text and historical runtime index entries. |

RTK note: local instructions require prefixing shell commands with `rtk`, but `rtk` was not available on PATH in this PowerShell session. Commands are run directly after recording that limitation.

Git Bash MCP note: the project requests the `bash-shell` MCP `bash_command` tool, but that tool was not exposed in this session. PowerShell `shell_command` is used instead.

Comms replay/compare were not run because this task touched only the task spec, handoff documentation, and runtime index. It did not touch Main, Gateway, host-api, api-client, provider transport, gateway events, runtime send/receive, delivery, or fallback paths.

## README Review

`README.md`, `README.zh-CN.md`, and `README.ja-JP.md` were reviewed with a focused scan for Runtime Grounding, grounding, diagnostics, Line C, production-entry, default-on, and runtime authority references.

Existing matches describe unrelated user-visible diagnostics, observability, sandbox policy, and agent-dev surfaces. No README updates are required because this package is internal planning-only documentation and does not change behavior, API, UI, settings, commands, Gateway routes, host APIs, renderer behavior, or public user flows.

## Final Status

Line C production-entry readiness planning is accepted as planning complete only. It defines the Phase A-G route, risk model, validation strategy, rollout/rollback playbook, production-entry gates, and next phase entry criteria.

Line C is not approved for default-on behavior, production default behavior, runtime authority, prompt/model-message/provider-ordering use, runtime decision use, memory promotion, persistence, UI cutover, or transport changes by this task.

Status: accepted
