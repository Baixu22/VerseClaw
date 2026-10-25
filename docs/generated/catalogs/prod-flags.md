# DCS Production Flag Catalog (generated)

<!-- GENERATED FILE — DO NOT EDIT.
Source of truth: shared/dcs/prod-flags-catalog.ts
Regenerate: pnpm catalogs:gen   |   Check freshness: pnpm catalogs:check
Generated at: 2026-10-25T12:38:46.554Z
-->

Machine-readable source of truth for defaults, risk, enable, and rollback.
This file is generated — edit the source of truth instead.

## context-view-tools

- wave: C1
- kind: env
- key: `OPENCLAW_DCS_CONTEXT_VIEW_TOOLS`
- default: false
- defaultDisplay: automatic when healthy (env override off)
- risk: opt-in
- enable: Automatic discovery when workspace, FactService and permission are healthy; no env or Developer toggle is required.
- rollback: Set env OPENCLAW_DCS_CONTEXT_VIEW_TOOLS=0 (or OPENCLAW_DCS_CONTEXT_TOOLS=0) and restart. This explicitly removes the four view tools even when dependencies are healthy.
- executor: wired — `openclaw_runtime/src/agents/tools/context-view-tool-surface.ts:149`

> TF-0495: the standard coding catalog is the discovery surface; the env switch is an explicit rollback/override, not the normal enable path. Automatic discovery occurs only when the workspace, FactService and permission checks are healthy. The removed runtime.coding.factViews leaf is rejected by the strict config schema; remove it before upgrading. Catalog defaultValue remains false as a fail-closed rollback override; this node does not flip the product default.

## context-tools-alias

- wave: C1
- kind: env
- key: `OPENCLAW_DCS_CONTEXT_TOOLS`
- default: false
- defaultDisplay: off (alias override)
- risk: opt-in
- enable: Alias of OPENCLAW_DCS_CONTEXT_VIEW_TOOLS; automatic discovery does not require setting it.
- rollback: Set to 0/false and restart to force the four view tools out even when healthy.
- executor: wired — `openclaw_runtime/src/context-engine/dcs-context-tools-flags.ts:30`

> Alias override only; do not treat as a separate graduation path.

## working-memory

- wave: DCS-S1
- kind: config
- key: `runtime.contextBlock.working-memory.enabled`
- default: true
- defaultDisplay: true
- risk: baseline-on
- enable: On by default through Workspace Context; explicit runtime.contextBlock.working-memory.enabled=false remains a supported rollback.
- rollback: Turn Workspace Context off or set enabled=false, then restart; recent-action injection stops.
- executor: wired — `openclaw_runtime/src/context-engine/assembler.ts:483`

> TF-0494: default-on after a predeclared paired canary; Assembler injects ## Recent Actions once per model-call context. Not long-term knowledge.

## tool-registry

- wave: DCS-S3
- kind: config
- key: `runtime.contextBlock.tool-registry.enabled`
- default: true
- defaultDisplay: true
- risk: baseline-on
- enable: On by default through Workspace Context; explicit runtime.contextBlock.tool-registry.enabled=false remains a supported rollback.
- rollback: Turn Workspace Context off or set enabled=false, then restart; the tool summary stops.
- executor: wired — `openclaw_runtime/src/context-engine/assembler.ts:494`

> TF-0494: default-on after a predeclared paired canary; tool-registry Block and ## Tools summary remain exactly-once per model call.

## stale-write-guard

- wave: C2
- kind: config
- key: `runtime.coding.staleWriteGuard.enabled`
- default: false
- defaultDisplay: false
- risk: opt-in
- enable: Set openclaw config runtime.coding.staleWriteGuard.enabled=true (or override in process).
- rollback: Set enabled=false or remove leaf; process restart if config is file-backed.
- executor: wired — `openclaw_runtime/src/agents/agent-tools.ts:885`

> Can block full-file writes that look stale; monitor coding.write.falseBlockRate. Override: force=true or allowStaleWrite=true on write (TASK-P1-07). Keep default-off until live false-block corpus passes.

## write-journal

- wave: C2
- kind: info
- key: `runtime.coding.writeJournal.enabled`
- default: true
- defaultDisplay: true (baseline)
- risk: baseline-on
- enable: Already on by default for undo_write snapshots. Leave enabled unless diagnosing journal I/O.
- rollback: Set runtime.coding.writeJournal.enabled=false only as temporary kill-switch (loses undo snapshots).
- executor: wired — `openclaw_runtime/src/agents/agent-tools.ts:876`

> Read-only ops note in P0 packaging; not an enhancement to flip for demos.

## worktree-backend

- wave: C4
- kind: api
- key: `createWorktreeService(baseRoot, { backend })`
- default: "inprocess"
- defaultDisplay: api-only (config leaf wired via orchestrator)
- risk: api-only
- enable: Call createWorktreeService(baseRoot, { backend: "git" }) with isolation=worktree on the request/plan.
- rollback: Stop calling the API with backend=git. Isolation request default remains shared.
- executor: wired — `openclaw_runtime/src/agents/orchestrator-run-observed.ts:435`

> C4-H git lifecycle hardened (lock/path/cleanup). The runtime.coding.worktree.backend config leaf is wired: when plan nodes request worktree isolation, orchestrator-run-observed resolves the backend via resolveWorktreeBackend, so the leaf drives inprocess vs git. API opt-in (isolation=worktree on request/plan) remains the activation gate.

## isolation-request

- wave: C4
- kind: request
- key: `request.isolation | plan.isolation`
- default: "shared"
- defaultDisplay: shared
- risk: request-only
- enable: Pass isolation: "worktree" on orchestrator request/plan (or worker) when multi-worker writes need isolation.
- rollback: Omit isolation or set "shared". Unknown values normalize to shared.
- executor: wired — `openclaw_runtime/src/agents/orchestrator.ts:207`

> normalizeIsolationMode defaults shared; C4-H landed but production default stays shared until product approval.

## symbol-lease

- wave: C5
- kind: config
- key: `runtime.coding.symbolLease.enabled`
- default: false
- defaultDisplay: false
- risk: opt-in
- enable: runtime.coding.symbolLease.enabled=true; optional mode=memory|wal (default memory).
- rollback: enabled=false. Shared write path is unperturbed when off.
- executor: wired — `openclaw_runtime/src/agents/agent-tools.ts:867`

> C5-H multi-process WAL hardened (opt-in mode=wal). Prefer mode=memory default; keep enabled=false until product approval.

## symbol-lease-mode

- wave: C5
- kind: config
- key: `runtime.coding.symbolLease.mode`
- default: "memory"
- defaultDisplay: memory
- risk: opt-in
- enable: runtime.coding.symbolLease.mode=wal only after multi-process WAL acceptance.
- rollback: mode=memory.
- executor: wired — `openclaw_runtime/src/agents/agent-tools.ts:871`

> wal multi-process hardened (C5-H); still opt-in; default mode remains memory.

## patch-flow

- wave: C5
- kind: api
- key: `applyPatchProposalsSerial() / recommendIsolationMode()`
- default: false
- defaultDisplay: advisory + explicit execution opt-in (patchFlow.default=false)
- risk: api-only
- enable: Pass patchFlowExecution=true with durationMinutes and overlapping worker writeSets through orchestrator.run or team_orchestrate. Workers emit fenced apply_patch proposals; deferred orchestration completion calls applyPatchProposalsSerial. Do NOT set runtime.coding.patchFlow.default=true without C5-H + approval.
- rollback: Omit patchFlowExecution or set it false. The advisory remains display-only, workers keep their ordinary tool surface, and patchFlow.default stays false.
- executor: wired — `openclaw_runtime/src/agents/orchestrator.ts:547`, `openclaw_runtime/src/agents/orchestrator.ts:557`, `openclaw_runtime/src/agents/orchestrator-run-observed.ts:736`, `openclaw_runtime/src/agents/subagent-registry.ts:612`

> TF-0459 wires advisory visibility in every production orchestrator plan; TF-0460 adds the explicit execution opt-in and proposal-only worker boundary. Neither switches isolation automatically, and serial-apply failure is recorded without blocking verifier startup.

## context-ladder

- wave: C6
- kind: api
- key: `applyContextLadder(...)`
- default: false
- defaultDisplay: explicit assembler opt-in (defaults unchanged)
- risk: api-only
- enable: Pass AssembleRequest contextLadder={ enabled: true, tokenBudget, mode?, heatThreshold? }. The assembler queries session blocks, calls applyContextLadder with the explicit tokenBudget, and uses only active blocks for DCS injections.
- rollback: Omit request.contextLadder or leave enabled unset/false; ordinary per-channel BlockStore queries and defaults resume unchanged.
- executor: wired — `openclaw_runtime/src/context-engine/assembler.ts:384`, `openclaw_runtime/src/context-engine/assembler.ts:393`

> Internal API only: the Context Orchestrator/Assembler may pass the ladder request explicitly; no user product toggle or default flip exists. Evidence remains harness/specs/fixtures/context-ladder-live-corpus/evidence.json (104,607 raw chars, driven_by=agent); L4 embedding remains deferred.

## routing-memo-shadow

- wave: C7
- kind: config
- key: `runtime.coding.routingMemo.shadow`
- default: false
- defaultDisplay: false
- risk: shadow-only
- enable: runtime.coding.routingMemo.shadow=true OR recordRoutingMemoShadow({ enabled: true }). Dual-write only; no prompt injection cutover.
- rollback: shadow=false. Does not alter default COMPASS/role-memory/routing injection.
- executor: wired — `openclaw_runtime/src/agents/agent-tools.before-tool-call.ts:1349`

> cutoverAllowed stays false until C7-H + written product approval.

## sekb-experience-shadow

- wave: C7
- kind: api
- key: `DistillationTool.confirm_and_save(suggestion, edits, options)`
- default: false
- defaultDisplay: api-only (host confirm explicit opt-in)
- risk: api-only
- enable: Call the host knowledge.sekbConfirmPrinciple API with payload { sessionId, experienceShadow: { enabled: true } }; the host resolves workspaceRoot and passes both to DistillationTool.confirm_and_save.
- rollback: Omit payload.experienceShadow or set experienceShadow.enabled=false.
- executor: wired — `electron/services/knowledge-api.ts:5483`, `electron/services/knowledge-api.ts:5496`

> Shadow journal only. The runtime.coding.sekb.experienceShadow config leaf remains observability-only; the production host confirm route wires the explicit API opt-in without changing defaults.

## sekb-retrieval-shadow

- wave: KE-P1
- kind: config
- key: `runtime.coding.sekb.retrievalShadow`
- default: false
- defaultDisplay: false
- risk: shadow-only
- enable: runtime.coding.sekb.retrievalShadow=true.
- rollback: runtime.coding.sekb.retrievalShadow=false (default).
- executor: wired — `openclaw_runtime/src/knowledge/sekb/retrieval-engine.ts:97`

> KE-P1-2: would_retrieve shadow -> shadow_context receipt. Zero prompt injection; no default retrieval.

## runtime-memory-persist

- wave: R3
- kind: config
- key: `runtime.memory.persist`
- default: false
- defaultDisplay: false
- risk: opt-in
- enable: runtime.memory.persist=true.
- rollback: runtime.memory.persist=false (default).
- executor: wired — `openclaw_runtime/src/runtime-core/memory-persistence.ts:518`

> R3-1 E-1: persist=true 只有在 runtime-memory 被选为 plugins.slots.memory owner 时才合法；Settings 默认关闭。

## runtime-memory-inject-pilot

- wave: R3
- kind: config
- key: `runtime.memory.injectPilot.enabled`
- default: false
- defaultDisplay: false
- risk: opt-in
- enable: runtime.memory.injectPilot.enabled=true.
- rollback: runtime.memory.injectPilot.enabled=false (default).
- executor: wired — `openclaw_runtime/src/agents/embedded-agent-runner/run/attempt.ts:2144`, `openclaw_runtime/src/agents/embedded-agent-runner/run/attempt.ts:2160`

> R3-1: injectPilot 通过 Context Orchestrator 接入 role-memory/runtime-memory provider；runtime-memory 仅在 E-1 合法面（plugins.slots.memory=runtime-memory + persist=true + provider=true）下读真实持久库，默认关闭。

## runtime-memory-candidate-generation

- wave: KE-P1
- kind: config
- key: `runtime.memory.candidateGeneration`
- default: false
- defaultDisplay: false
- risk: opt-in
- enable: runtime.memory.candidateGeneration=true.
- rollback: runtime.memory.candidateGeneration=false (default).
- executor: wired — `openclaw_runtime/src/runtime-core/ke-candidate-generation.ts:254`

> KE-P1-1: task-terminal candidate generation (failure-guard -> Review Queue). Queue-visible only; never auto-persisted.

## compass-context-block

- wave: R3
- kind: config
- key: `runtime.contextBlock.compass.enabled`
- default: false
- defaultDisplay: false
- risk: read-only
- enable: runtime.contextBlock.compass.enabled=true.
- rollback: runtime.contextBlock.compass.enabled=false (default).
- executor: wired — `openclaw_runtime/src/context-engine/assembler.ts:755`

> R3-1: Assembler compass handler 接收生产检索输入；默认关闭。

## role-memory

- wave: R3
- kind: config
- key: `runtime.contextBlock.role-memory.enabled`
- default: false
- defaultDisplay: false
- risk: read-only
- enable: runtime.contextBlock.role-memory.enabled=true.
- rollback: runtime.contextBlock.role-memory.enabled=false (default).
- executor: wired — `openclaw_runtime/src/context-engine/assembler.ts:758`

> R3-1: role-memory projection 接收真实 role/task 输入且不移除其他 provider；默认关闭。

## verseshell-patch-preview

- wave: VS-P3
- kind: config
- key: `runtime.verseShellFoundation.patchPreview`
- default: false
- defaultDisplay: false
- risk: read-only
- enable: preview_patch 只在六个旗标同时为真且 kill switch 未生效时物化，缺一即不出现：runtime.verseShellFoundation 下的 verifiedRuntime / typedAci / facade / governedExec / artifactResults / patchPreview 全部 =true，且 killSwitch 未置（env VERSE_VERSESHELL_FOUNDATION_KILL_SWITCH 亦未置）。每个旗标也可用 env VERSE_VERSESHELL_FOUNDATION_<NAME> 覆盖。
- rollback: runtime.verseShellFoundation.patchPreview=false（默认）或移除该叶；preview_patch 从工具面消失，apply_patch 与其 write journal 完全不变。任一前置旗标关闭或 kill switch 生效有同样效果。
- executor: wired — `openclaw_runtime/src/agents/agent-tools.ts:1224`, `openclaw_runtime/src/agents/agent-tools.ts:1354`

> VS-P3-01：只读桥。clawx-patch-preview-v1 profile 只列 file.diff / file.hash / file.read_range，14 个写入与 tx.* operation 在请求发出前被机械拒绝；commit / undo / stale-write guard / recovery 仍只属 runtime.coding.writeJournal（见本表 write-journal 条）。已知登记缺口：同族另外 10 个 verseShellFoundation 旗标（VS-P0/P1/P2 交付物）尚未单独入本目录，故本条的 enable 串是目前唯一记录整条前置链的落盘处。

## rc03-seal

- wave: RC-03
- kind: config
- key: `runtime.rc03.seal`
- default: false
- defaultDisplay: off (opt-in)
- risk: opt-in
- enable: Set env OPENCLAW_RC03_SEAL=1 (or runtime.rc03.seal = true) and restart gateway/runtime. Enabling turns on RC-03 message-replacement sealing plus the correlated runtime/wire receipts; it does not change returned summaries.
- rollback: Unset OPENCLAW_RC03_SEAL or set runtime.rc03.seal = false and restart. With the flag off no seal, runtime receipt, or wire receipt is written.
- executor: wired — `openclaw_runtime/src/context-engine/context-orchestrator.ts:376`

> Opt-in observation only. Before this entry existed, the "RC-03 is opt-in" intent had no referencable record, so a reviewer could not cite it as proven design intent (deviation TFD-lane2-rc03-seal-default-zero-2026-08-27). Keep default-off; do not flip it inside an implementation task.

