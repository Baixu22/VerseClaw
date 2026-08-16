# DCS Production Flag Catalog (generated)

<!-- GENERATED FILE — DO NOT EDIT.
Source of truth: shared/dcs/prod-flags-catalog.ts
Regenerate: pnpm catalogs:gen   |   Check freshness: pnpm catalogs:check
Generated at: 2026-08-15T17:56:49.354Z
-->

Machine-readable source of truth for defaults, risk, enable, and rollback.
This file is generated — edit the source of truth instead.

## context-view-tools

- wave: C1
- kind: env
- key: `OPENCLAW_DCS_CONTEXT_VIEW_TOOLS`
- default: false
- defaultDisplay: off (shadow)
- risk: opt-in
- enable: Set env OPENCLAW_DCS_CONTEXT_VIEW_TOOLS=1 (or OPENCLAW_DCS_CONTEXT_TOOLS=1) and restart gateway/runtime.
- rollback: Unset env or set to 0/false and restart. View tools leave the default catalog.

> Single source of truth: env OPENCLAW_DCS_CONTEXT_VIEW_TOOLS (or Settings switch). runtime.coding.factViews is deprecated/ignored (TASK-P0-02). Keep default-off until C1 graduation + product approval.

## context-tools-alias

- wave: C1
- kind: env
- key: `OPENCLAW_DCS_CONTEXT_TOOLS`
- default: false
- defaultDisplay: off (alias)
- risk: opt-in
- enable: Alias of OPENCLAW_DCS_CONTEXT_VIEW_TOOLS; set =1 only when intentionally enabling view tools.
- rollback: Unset or set to 0/false and restart.

> Alias only; do not treat as a separate graduation path.

## working-memory

- wave: DCS-S1
- kind: config
- key: `runtime.contextBlock.working-memory.enabled`
- default: false
- defaultDisplay: false
- risk: opt-in
- enable: Settings switch or openclaw config runtime.contextBlock.working-memory.enabled=true; restart gateway/runtime so config-sync applies.
- rollback: Set enabled=false or Settings off; restart if needed. Injection stops; producers may still emit envelopes unused.

> TASK-P1-02: when on, Assembler injects ## Recent Actions once per context (exactly-once). Default remains off until product soak.

## tool-registry

- wave: DCS-S3
- kind: config
- key: `runtime.contextBlock.tool-registry.enabled`
- default: false
- defaultDisplay: false
- risk: opt-in
- enable: Settings switch or openclaw config runtime.contextBlock.tool-registry.enabled=true; restart gateway/runtime.
- rollback: Set enabled=false or Settings off; restart if needed. Tool summary injection stops.

> TASK-P1-03: when on, before_agent_start writes tool_registry Block and Assembler injects ## Tools summary (exactly-once). Aligns with C1 on_demand schema mode.

## stale-write-guard

- wave: C2
- kind: config
- key: `runtime.coding.staleWriteGuard.enabled`
- default: false
- defaultDisplay: false
- risk: opt-in
- enable: Set openclaw config runtime.coding.staleWriteGuard.enabled=true (or override in process).
- rollback: Set enabled=false or remove leaf; process restart if config is file-backed.

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

> Read-only ops note in P0 packaging; not an enhancement to flip for demos.

## worktree-backend

- wave: C4
- kind: config
- key: `runtime.coding.worktree.backend`
- default: "inprocess"
- defaultDisplay: inprocess
- risk: opt-in
- enable: Set runtime.coding.worktree.backend=git OR createWorktreeService({ backend: "git" }). Requires isolation=worktree on the request/plan.
- rollback: Set backend=inprocess. Isolation request default remains shared.

> C4-H git lifecycle hardened (lock/path/cleanup); backend default remains inprocess. Do not change isolation default. C4-P hardlink install residual.

## isolation-request

- wave: C4
- kind: request
- key: `request.isolation | plan.isolation`
- default: "shared"
- defaultDisplay: shared
- risk: request-only
- enable: Pass isolation: "worktree" on orchestrator request/plan (or worker) when multi-worker writes need isolation.
- rollback: Omit isolation or set "shared". Unknown values normalize to shared.

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

> wal multi-process hardened (C5-H); still opt-in; default mode remains memory.

## patch-flow

- wave: C5
- kind: api
- key: `applyPatchProposalsSerial() / recommendIsolationMode()`
- default: false
- defaultDisplay: api-only (patchFlow.default=false)
- risk: api-only
- enable: Call applyPatchProposalsSerial() / recommendIsolationMode({...}). Do NOT set runtime.coding.patchFlow.default=true without C5-H + approval.
- rollback: Stop calling patch-flow APIs; keep patchFlow.default=false.

> recommendIsolationMode is advisory only; no auto-switch of production isolation.

## context-ladder

- wave: C6
- kind: api
- key: `applyContextLadder(...)`
- default: false
- defaultDisplay: opt-in API (assembler not flipped)
- risk: api-only
- enable: Import and call applyContextLadder from context-ladder.ts with an explicit tokenBudget. Assembler production path does not auto-ladder.
- rollback: Stop calling applyContextLadder; leave assembler defaults unchanged.

> 64K evidence is synthetic until C6-H live corpus. L4 embedding remains deferred.

## routing-memo-shadow

- wave: C7
- kind: config
- key: `runtime.coding.routingMemo.shadow`
- default: false
- defaultDisplay: false
- risk: shadow-only
- enable: runtime.coding.routingMemo.shadow=true OR recordRoutingMemoShadow({ enabled: true }). Dual-write only; no prompt injection cutover.
- rollback: shadow=false. Does not alter default COMPASS/role-memory/routing injection.

> cutoverAllowed stays false until C7-H + written product approval.

## sekb-experience-shadow

- wave: C7
- kind: config
- key: `runtime.coding.sekb.experienceShadow`
- default: false
- defaultDisplay: false
- risk: shadow-only
- enable: runtime.coding.sekb.experienceShadow=true OR confirm options.experienceShadow.enabled=true.
- rollback: experienceShadow=false / omit options.

> Shadow journal only; experienceHitRate still fixture-level. No default knowledge injection.

## sekb-retrieval-shadow

- wave: KE-P1
- kind: config
- key: `runtime.coding.sekb.retrievalShadow`
- default: false
- defaultDisplay: false
- risk: shadow-only
- enable: runtime.coding.sekb.retrievalShadow=true.
- rollback: runtime.coding.sekb.retrievalShadow=false (default).

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

> R3-1: role-memory projection 接收真实 role/task 输入且不移除其他 provider；默认关闭。

