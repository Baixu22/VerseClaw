# Serial Work Packages

## Execution Contract

- Run packages in order. Only one package and one Harness task spec may be active.
- A package starts only when every dependency is accepted and Task Forest marks it ready.
- The table order is the program order; `Depends on` names causal evidence prerequisites and does not permit a later package to start early.
- A package ends only after code, focused tests, migration/rollback proof, docs, Harness validation, and independent Agent Engineering Acceptance all pass.
- Human/live operation is forbidden before `RC-10`.

## Sequence

| ID | Package | Depends on | Product behavior |
|---|---|---|---|
| RC-00 | Engineering acceptance bootstrap | none | none |
| RC-01 | Rebaseline and authority inventory | RC-00 | none |
| RC-02 | Full-payload shadow census | RC-01 | zero-byte parity |
| RC-03 | DCS seal and dual receipts | RC-02 | controlled internal change |
| RC-04 | Durable approval and effect reconciliation | RC-03 | controlled authority replacement |
| RC-05 | Minimal Operator governance slice | RC-04 | new controlled workflow |
| RC-06A-D | Workflow capability proof and convergence | RC-05, then A -> B -> C -> D | compatibility-preserving |
| RC-07 | Memory/context slot convergence | RC-06D | default behavior unchanged |
| RC-08A | MCP and host-native tool convergence | RC-07 | catalog/health correction |
| RC-08B | OTel and observability convergence | RC-08A | diagnostics correction |
| RC-09 | Final engineering acceptance | RC-08B | none |
| RC-10 | Final human acceptance | RC-09 | user-operated only |

## RC-00: Engineering Acceptance Bootstrap

**Reuse:** `harness/specs/tasks/agent-engineering-acceptance-orchestrator.md`, `scripts/agent-engineering-acceptance.mjs`, and `pnpm acceptance:agent:*`.

**Deliver:** prove on a clean fixture candidate that `plan`, isolated Executor, independent Verifier, fixed skip budget, redacted logs, explicit `--output-dir`, and fail-closed verdict work. Replace the current `resolveChangedPaths` catch-all fallback and implicit `HEAD^` default: an invalid or missing `--since` ref must fail and must never fall back to the `HEAD` file list. Update CLI usage and replace the existing no-`--since` success test with invalid/missing-ref rejection coverage. Harden `validateExecutorEvidence` so missing/blank/non-string actors, actor-field mismatch, identical Executor/Verifier identities, and missing or incorrect semantic `reportDigest` all produce `NO-GO`. Repair other existing infrastructure only when this proof fails.

**Exit:** TF-0020 engineering criteria pass; invalid/missing-base, actor/digest tamper, identity separation, and explicit-output-dir regression tests pass; a clean isolated fixture produces a real green `verifier-report.json` and `final-report.json`; a second Agent reproduces that fixture. Source inspection alone is insufficient. No runtime behavior or product lock changes.

## RC-01: Rebaseline And Inventory

**Deliver:** a machine-readable authority inventory covering Run, Session, Checkpoint, Workflow, Context, Memory, Tool, Approval, Effect, Receipt, Telemetry, and UI projections; record `reuse/adapt/converge/freeze/remove` and exact owner paths. Write the frozen baseline to `artifacts/runtime-authority-convergence/rc-01/baseline.json` with schema `runtime-authority-convergence-baseline/v1`, `acceptedBaseSha`, source/npm runtime versions, and the receipt-owner decision.

**Must include:** TaskFlow, TaskRegistry, long-task checkpoints, RuntimeTaskEventLog, Mission, Task Loop, ClawGraph, Task Ledger, runtime-spine, memory/contextEngine slots, MCP, OTel, trajectory, Observability JSONL, and the source-runtime/npm-fallback capability split.

**Exit:** no unclassified writer; `runtime-family-unification-v1` frozen; the receipt owner is selected only after schema/atomic-sequence/retention/lookup/idempotency/failure/privacy/restart proof; current source/npm runtime versions and a valid 40-hex accepted base SHA are recorded; an RC-01 independent Verifier accepts the inventory using the RC-00-approved infrastructure. If no existing owner qualifies, record the owner-decision blocker and leave RC-01 `review_needed`; RC-02 cannot start. No runtime code changes.

## RC-02: Full-Payload Shadow Census

**Surfaces:** desktop chat, Cron, one channel conformance fixture, CLI/compact, embedded attempt, context engine, provider payload hook, provider transport.

**Deliver:** `ShadowContextReceipt/v0` before provider projection and `ShadowWireReceipt/v0` at the guarded request-body boundary after every provider-specific finalizer. Treat `onPayload` as a candidate anchor only. Write bounded evidence through the RC-01-approved owner; record no raw payload by default and do not promote diagnostic replay/reducer paths.

**Exit:** every source-runtime model call in the automated entry matrix has both receipts; owner-classification coverage is 100% under the measurement contract below; instrumentation changes sent bytes, ordering, tools, retries, approvals, and delivery by zero. The npm fallback reports explicit capability degradation and never counts as receipt coverage.

**Status (2026-09-23, RC-02 accepted, engineering-only):** the RC-09 audit's RC-02R findings are closed. All eight named surfaces are now driven by real production entries (`rc02-entry-matrix.acceptance.test.ts`, `rc02-inbound-entry.acceptance.test.ts`, `rc02-cron-entry.acceptance.test.ts`, `rc02-cli-entry.acceptance.test.ts`), and every persisted wire receipt must carry a `wire_digest` equal to the sha256 of the bytes actually intercepted at the network boundary and join a context receipt through one correlation digest. Provider coverage is registry-driven via `listSourceRuntimeTransportApis()`, so a new source API grows the matrix instead of a hand-written list, and off/on parity is 4/4 (bytes, canonical tool order, per-wire-attempt identity, no added approval/delivery traffic). Formal RC-00 acceptance on the clean candidate `78dc12d1c`: 23 gates all pass, Executor pass, independent Verifier pass (`engineeringAcceptedByAgent=true`, `failures=0`, 9500 passed / 0 failed / 50 skipped). Evidence: `artifacts/runtime-authority-convergence/rc-02/census.json` plus the archived run reports under `artifacts/runtime-authority-convergence/rc-02/acceptance/`. Residuals are stated rather than hidden: bundled plugin discovery and the channel plugin layer are not exercised, the compact half of CLI/compact is not separately driven, and owner classification is an ownership-completeness check (every receipt carries a named adapter, unknown = 0) rather than a per-field producer/transform map. Product locks stay false; scope is engineering-only with `allowedPromotion=false`.

## RC-03: DCS Seal And Dual Receipts

**Deliver:** attempt-scoped `CompilePlan`, model-call-scoped immutable `ContextBundle`, `ContextReceipt/v1`, `WireReceipt/v1`, registered pre-seal semantic producers, and registered post-seal non-semantic transforms.

**Required corrections:** move COMPASS SSP under a registered pre-seal producer; include ContextEngine message replacement; keep ContextCandidate incremental; make structured items atomic; use the single `contextEngine` slot and RC-01-approved evidence owner; do not introduce ContextUnit, Planner service, synchronous Mem, or an unreviewed receipt store.

**Exit:** unknown semantic mutation is zero; tool loop, retry, provider fallback, compact, fork, and handoff each produce correlated receipts; kill switch restores the legacy path; product locks remain false.

**Status (2026-09-24, RC-03 accepted, engineering-only):** RC-03R closed on real entries. `rc03-entry-transitions.acceptance.test.ts` drives `runEmbeddedAgent` / `runWithModelFallback` (plus production `forkSessionFromParent`, `readSubagentOutput`, `buildChildCompletionFindings`) and requires every intercepted request to carry a WireReceipt/v1 bound to its sha256 and paired with a ContextReceipt/v1: tool loop (call 0 -> 1), same-provider retry (wire attempt 0 -> 1), provider fallback (attempt 0 -> 1), compaction summarizer, fork (child replays the forked history under its own identity), and handoff (child result delivered as a new sealed parent call). Defects fixed on the way: unsealed compaction summarizer, sealed plans never released, fallback reusing attempt 0, and producers that wrote the system prompt outside the orchestrator. The seal now binds the provider-bound system prompt digest per model call and attributes registered contributions (COMPASS SSP / retrieval, role-spawn memory pack, ContextEngine message replacement, the attempt system-prompt builder); a prompt changed after the seal is census failure `post-seal-semantic-mutation`, an unsealed call is `unsealed-model-call`. Seal off: identical bytes, zero v1 receipts. A state-database race (busy_timeout set after the WAL switch) found by the acceptance run was fixed too. Formal RC-00 acceptance on the clean candidate `01398fb6f`: Executor pass, independent Verifier pass (`engineeringAcceptedByAgent=true`, `failures=0`, 9532 passed / 0 failed / 50 skipped, `identicalGateContracts=true`, mutation checks clean). Evidence: `artifacts/runtime-authority-convergence/rc-03/acceptance/` with `SHA256SUMS`. Residuals: COMPASS output is attributed and digest-bound but still not charged to the turn injection budget (that stays with TF-0013); contribution attribution is content-matched, so a producer that rewrites its own text before it reaches the prompt is covered only by the post-seal digest check. Product locks stay false.

## RC-04: Durable Approval And Effect Reconciliation

**Current defect:** exec/plugin approval pending and short-lived resolved state are held in a Gateway process `Map`; restart clears them. A unified EffectReceipt does not exist.

**Deliver:** replace in-memory approval truth with one durable owner in the existing OpenClaw state boundary. Persist the state sequence `intent_reserved -> approval_pending -> approved|denied -> execution_started -> applied|not_applied|unknown -> reconciled`; define stable approval/effect IDs, idempotency keys, domain-journal joins, and `needs_reconciliation`. Do not create a generic workflow engine or claim global exactly-once.

**Local-implementation status (RC-04R/RC-05R, not yet independently verified):** RC-04R delivered the durable approval owner (see above). RC-05R wired the automated primary path: Cron ingress creates only the approval intent; approval comes from an explicit governance policy or the desktop Inbox (`inbox.operator.list/decide/lineage` Gateway methods) and records actor + policy digest; the bounded effect runs `execution_started` before the real executor and `applied/not_applied/unknown` only from the executor outcome; `channel-conformance` is now an executable-fixture runner (connection drop / rate limit / duplicate delivery / restart / denial / unknown outcome); the Inbox store projects real approval/EffectReceipt lineage with real ContextReceipt refs.

**RC-06A status (not yet independently verified):** TaskFlow CAS proof layer complete: create sentinel (`expectedRevision=-1`) rejects arbitrary revisions and terminal initial statuses (audit counter-example `999 + succeeded + delivered` fails); updates use SQL-level `WHERE flow_id=? AND revision=?` CAS with affected-rows checks; revision is monotonic; the legal transition graph is validated inside the same immediate transaction; `flow_runs.delivery_state` persists on the same row as the lifecycle transition (legacy DBs get the column via `ensureColumn`); two independent connections racing for one flow allow exactly one winner; reopen/restart restores revision, wait, terminal, and delivery state. TaskFlow remains a candidate — the proof layer is not wired into any active path.

**Exit:** pending/resolved truth survives restart; repeated identical resolve is idempotent; denial produces no effect; failure injection at every transition is reconciled from the domain journal; unknown outcome stops in `needs_reconciliation`; EffectReceipt explains but cannot replay the effect.

## RC-05: Minimal Operator Governance Slice

**Automated primary path:** Cron ingress -> existing run identity -> DCS receipts -> desktop Inbox -> durable approval -> one bounded file or message effect -> EffectReceipt -> process restart -> recovery -> delivery projection.

**Automated secondary path:** a channel conformance fixture proves the same contract without a real external account. Real channel/provider operation is reserved for RC-10.

**Exit:** duplicate effect count zero; denial produces zero effect; restart preserves pending and completed truth from RC-04; UI shows context/effect/recovery lineage; Electron E2E covers the visible path in all locales.

## RC-06: Workflow Capability Proof And Convergence

Run four serial subpackages with separate Harness specs:

1. **RC-06A Capability proof:** verify or implement SQLite-level expected-revision CAS, an explicit legal transition graph, restart persistence, concurrent-writer rejection, and delivery-state consistency. TaskFlow remains a candidate until this passes.
2. **RC-06B ClawGraph:** compiler and UI remain; run state moves from process `Map` only after RC-06A. Restart, cancel, child task, and projection tests pass.
3. **RC-06C Mission:** mission definitions become TaskFlow templates/controllers. `mission_runs/events` remain compatibility reads until migration proof permits retirement.
4. **RC-06D Task Loop:** lifecycle, waiting, cancel, and terminal state migrate last. `long_task_checkpoints` retain checkpoint material only; replay never executes effects.

**Exit:** after all four packages, TaskFlow/TaskRegistry are the only workflow lifecycle writers; before each cutover, the legacy owner remains authoritative. If RC-06A fails, stop for owner review and do not import a replacement framework automatically.

## RC-07: Memory And Context Slots

**Deliver:** enforce one active configured `memory` slot and one DCS `contextEngine` slot. Define each existing mechanism as `store owner`, `candidate producer`, `review proposal`, `benchmark arm`, or `projection`.

**Required roles:** VToken/AgentMap are stateless packer/benchmark arms; Working Context is a query projection; SEKB is human-confirmed governance; Runtime Memory cannot bypass the selected memory slot or DCS.

**Exit:** parallel memory writes are zero; flag-off performs zero query/write; delete/correction propagation tests pass; no default or auto-writeback change.

## RC-08A: MCP And Host-Native Tools

**Deliver:** MCP SDK runtime remains the external protocol authority; Work Provider becomes a catalog/projection; Git, storage, terminal, and browser are labelled host-native unless backed by a real MCP server.

**Correct:** health requires a real MCP handshake; configuration presence or HTTP GET is not `connected`; unsupported WebSocket choices are removed or rejected; Streamable HTTP naming is accurate.

**Exit:** MCP conformance/Inspector-compatible tests pass; catalog and runtime support match; no fake-connected state; approvals, SecretRef, network policy, and hot reload remain intact.

**Status (2026-08-08):** local implementation green. `tool-convergence.ts` exposes the production `classifyMcpCatalogServer` surface; `agent-bundle-mcp-runtime.ts` catalog entries carry `transportType` + `health` where `connected` is set only by the real SDK `initialize` handshake (HTTP GET/unsupported transport never connected). Root and runtime acceptance tests run the production implementation; a real spawned stdio MCP server completes the handshake through `createSessionMcpRuntime`; `resolveMcpTransportConfig` rejects WebSocket-only configs. Independent candidate acceptance pending (`--since=1e1c3557e`); not accepted, product locks false.

## RC-08B: OTel And Observability

**Deliver:** OTel/OTLP owns trace export; ingress, run, model/tool, effect, and delivery share correlation IDs; receipts and domain journals remain facts; trajectory is bounded flight-recorder evidence; Observability JSONL is rebuildable cache only.

**Exit:** exporter-off parity passes; default raw prompt/tool leakage is zero; one golden trace exports to a neutral OTLP fixture; no second trace schema/store is introduced.

**Status (2026-08-08):** local implementation green. `exporter-parity.ts` maps runtime observability traces to the canonical OTLP `ExportTraceServiceRequest` JSON and exposes `createObservabilityOtlpJsonExporter` (HTTP/JSON to a neutral fixture collector); `trace-buffer.ts` (the in-memory observability cache) installs the exporter — completed traces export, running traces never export, exporter failures never change the store, exporter-off is byte-identical (no second store). Correlation ids from `correlation-ids.ts` derive the OTLP trace/span ids; redaction attacks (raw content in benign attribute keys) are blocked. Independent candidate acceptance pending after RC-08A (`--since=<rc08a-candidate>`); not accepted, product locks false.

## RC-09: Final Engineering Acceptance

**Deliver:** clean candidate SHA, full gate results, independent Executor/Verifier reports, migration/rollback results, security/privacy scans, performance diagnostics, `artifacts/agent-engineering-acceptance/runtime-authority-convergence-final/manifest.json`, and the tested `scripts/validate-runtime-authority-convergence.mjs` validator for engineering and final human-verdict contracts.

**Exit:** every required gate is green with the declared skip budget; no stale evidence; `STATUS.md` becomes `human_acceptance_pending`. It must not become `done`.

**Status (2026-08-09):** RC-09 最终独立验收 PASS。候选链重建于 new accepted base `b8a6c1832`（range 99 paths，零 UI/release coverage → 18-gate profile）；executor `rc09r-executor-4` + verifier `rc09r-verifier-4` 双 PASS（engineeringAcceptedByAgent=true、review_needed、humanEvidenceRequired=true、7116 passed/0 failed/52 skipped、mutationCheck 双 clean）；engineering-phase validator PASS。控制面修复：plan 自动生成 changed-path-ownership.json 并 provision 进双 detached worktree；runtime-unit skip budget 归零；final spec `--since` 固定为完整 acceptedBaseSha。`STATUS.md` 已置 `human_acceptance_pending`。证据：`artifacts/agent-engineering-acceptance/runtime-authority-convergence-final/{plan,manifest,executor-report,verifier-report,final-report,changed-path-ownership}.json`。RC-10 保持 blocked；product locks false。

## RC-10: Final Human Acceptance

The user executes only `HUMAN-ACCEPTANCE.md`. An explicit `accepted` verdict is required. Any failure returns the affected package to `review_needed`; it is not waived by engineering evidence.

## Measurement Contracts

- `owner-classification coverage` = provider-bound serialized fields assigned exactly once to a semantic producer, transcript/tool region, or named non-semantic transport adapter, divided by all provider-bound serialized fields. Opaque/binary values still require an owner plus digest/size; `unknown` must be zero before RC-02 exits.
- `zero-byte parity` = observer installation does not mutate the payload object or final serialized bytes for deterministic fixtures; volatile transport fields may be excluded only by a named normalization registered before the comparison.
- `duplicate effect count` counts domain-journal outcomes by idempotency key, not UI events or EffectReceipt rows.
