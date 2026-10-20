/**
 * DCS production opt-in flag catalog (P0 packaging surface).
 * Machine-readable source of truth for defaults, risk, enable, and rollback.
 * Must stay aligned with openclaw_runtime coding-runtime-flags / dcs-context-tools-flags.
 * Does NOT flip any production defaults.
 */
export type DcsProdFlagRisk =
  | 'baseline-on'
  | 'opt-in'
  | 'shadow-only'
  | 'api-only'
  | 'request-only'
  | 'read-only';

export type DcsProdFlagKind = 'env' | 'config' | 'api' | 'request' | 'info';

export type DcsProdFlagExecutor =
  | { status: 'wired'; sites: readonly string[] }
  | { status: 'pending-wiring'; reason: string };

export type DcsProdFlagEntry = {
  id: string;
  wave: string;
  kind: DcsProdFlagKind;
  key: string;
  defaultDisplay: string;
  defaultValue: boolean | string;
  risk: DcsProdFlagRisk;
  enable: string;
  rollback: string;
  riskNote: string;
  executor?: DcsProdFlagExecutor;
};

export const DCS_PROD_FLAGS: readonly DcsProdFlagEntry[] = [
  {
    id: 'context-view-tools',
    wave: 'C1',
    kind: 'env',
    key: 'OPENCLAW_DCS_CONTEXT_VIEW_TOOLS',
    defaultDisplay: 'off (shadow)',
    defaultValue: false,
    risk: 'opt-in',
    enable:
      'Set env OPENCLAW_DCS_CONTEXT_VIEW_TOOLS=1 (or OPENCLAW_DCS_CONTEXT_TOOLS=1) and restart gateway/runtime.',
    rollback: 'Unset env or set to 0/false and restart. View tools leave the default catalog.',
    riskNote:
      'Single source of truth: env OPENCLAW_DCS_CONTEXT_VIEW_TOOLS (or Settings switch). The removed runtime.coding.factViews leaf is rejected by the strict config schema; remove it before upgrading. Keep default-off until C1 graduation + product approval.',
    executor: {
      status: 'wired',
      sites: [
        'openclaw_runtime/src/agents/tools/context-agent-tools.ts:267',
      ],
    },
  },
  {
    id: 'context-tools-alias',
    wave: 'C1',
    kind: 'env',
    key: 'OPENCLAW_DCS_CONTEXT_TOOLS',
    defaultDisplay: 'off (alias)',
    defaultValue: false,
    risk: 'opt-in',
    enable:
      'Alias of OPENCLAW_DCS_CONTEXT_VIEW_TOOLS; set =1 only when intentionally enabling view tools.',
    rollback: 'Unset or set to 0/false and restart.',
    riskNote: 'Alias only; do not treat as a separate graduation path.',
    executor: {
      status: 'wired',
      sites: [
        'openclaw_runtime/src/context-engine/dcs-context-tools-flags.ts:30',
      ],
    },
  },
  {
    id: 'working-memory',
    wave: 'DCS-S1',
    kind: 'config',
    key: 'runtime.contextBlock.working-memory.enabled',
    defaultDisplay: 'false',
    defaultValue: false,
    risk: 'opt-in',
    enable:
      'Settings switch or openclaw config runtime.contextBlock.working-memory.enabled=true; restart gateway/runtime so config-sync applies.',
    rollback: 'Set enabled=false or Settings off; restart if needed. Injection stops; producers may still emit envelopes unused.',
    riskNote:
      'TASK-P1-02: when on, Assembler injects ## Recent Actions once per context (exactly-once). Default remains off until product soak.',
    executor: {
      status: 'wired',
      sites: [
        'openclaw_runtime/src/context-engine/assembler.ts:424',
      ],
    },
  },
  {
    id: 'tool-registry',
    wave: 'DCS-S3',
    kind: 'config',
    key: 'runtime.contextBlock.tool-registry.enabled',
    defaultDisplay: 'false',
    defaultValue: false,
    risk: 'opt-in',
    enable:
      'Settings switch or openclaw config runtime.contextBlock.tool-registry.enabled=true; restart gateway/runtime.',
    rollback: 'Set enabled=false or Settings off; restart if needed. Tool summary injection stops.',
    riskNote:
      'TASK-P1-03: when on, before_agent_start writes tool_registry Block and Assembler injects ## Tools summary (exactly-once). Aligns with C1 on_demand schema mode.',
    executor: {
      status: 'wired',
      sites: [
        'openclaw_runtime/src/context-engine/assembler.ts:434',
      ],
    },
  },
  {
    id: 'stale-write-guard',
    wave: 'C2',
    kind: 'config',
    key: 'runtime.coding.staleWriteGuard.enabled',
    defaultDisplay: 'false',
    defaultValue: false,
    risk: 'opt-in',
    enable: 'Set openclaw config runtime.coding.staleWriteGuard.enabled=true (or override in process).',
    rollback: 'Set enabled=false or remove leaf; process restart if config is file-backed.',
    riskNote:
      'Can block full-file writes that look stale; monitor coding.write.falseBlockRate. Override: force=true or allowStaleWrite=true on write (TASK-P1-07). Keep default-off until live false-block corpus passes.',
    executor: {
      status: 'wired',
      sites: [
        'openclaw_runtime/src/agents/agent-tools.ts:885',
      ],
    },
  },  {
    id: 'write-journal',
    wave: 'C2',
    kind: 'info',
    key: 'runtime.coding.writeJournal.enabled',
    defaultDisplay: 'true (baseline)',
    defaultValue: true,
    risk: 'baseline-on',
    enable: 'Already on by default for undo_write snapshots. Leave enabled unless diagnosing journal I/O.',
    rollback:
      'Set runtime.coding.writeJournal.enabled=false only as temporary kill-switch (loses undo snapshots).',
    riskNote: 'Read-only ops note in P0 packaging; not an enhancement to flip for demos.',
    executor: {
      status: 'wired',
      sites: [
        'openclaw_runtime/src/agents/agent-tools.ts:876',
      ],
    },
  },
  {
    id: 'worktree-backend',
    wave: 'C4',
    kind: 'api',
    key: 'createWorktreeService(baseRoot, { backend })',
    defaultDisplay: 'api-only (config leaf wired via orchestrator)',
    defaultValue: 'inprocess',
    risk: 'api-only',
    enable:
      'Call createWorktreeService(baseRoot, { backend: "git" }) with isolation=worktree on the request/plan.',
    rollback: 'Stop calling the API with backend=git. Isolation request default remains shared.',
    riskNote:
      'C4-H git lifecycle hardened (lock/path/cleanup). The runtime.coding.worktree.backend config leaf is wired: when plan nodes request worktree isolation, orchestrator-run-observed resolves the backend via resolveWorktreeBackend, so the leaf drives inprocess vs git. API opt-in (isolation=worktree on request/plan) remains the activation gate.',
    executor: {
      status: 'wired',
      sites: [
        'openclaw_runtime/src/agents/orchestrator-run-observed.ts:428',
      ],
    },
  },
  {
    id: 'isolation-request',
    wave: 'C4',
    kind: 'request',
    key: 'request.isolation | plan.isolation',
    defaultDisplay: 'shared',
    defaultValue: 'shared',
    risk: 'request-only',
    enable:
      'Pass isolation: "worktree" on orchestrator request/plan (or worker) when multi-worker writes need isolation.',
    rollback: 'Omit isolation or set "shared". Unknown values normalize to shared.',
    riskNote:
      'normalizeIsolationMode defaults shared; C4-H landed but production default stays shared until product approval.',
    executor: {
      status: 'wired',
      sites: [
        'openclaw_runtime/src/agents/orchestrator.ts:199',
      ],
    },
  },
  {
    id: 'symbol-lease',
    wave: 'C5',
    kind: 'config',
    key: 'runtime.coding.symbolLease.enabled',
    defaultDisplay: 'false',
    defaultValue: false,
    risk: 'opt-in',
    enable: 'runtime.coding.symbolLease.enabled=true; optional mode=memory|wal (default memory).',
    rollback: 'enabled=false. Shared write path is unperturbed when off.',
    riskNote:
      'C5-H multi-process WAL hardened (opt-in mode=wal). Prefer mode=memory default; keep enabled=false until product approval.',
    executor: {
      status: 'wired',
      sites: [
        'openclaw_runtime/src/agents/agent-tools.ts:867',
      ],
    },
  },
  {
    id: 'symbol-lease-mode',
    wave: 'C5',
    kind: 'config',
    key: 'runtime.coding.symbolLease.mode',
    defaultDisplay: 'memory',
    defaultValue: 'memory',
    risk: 'opt-in',
    enable: 'runtime.coding.symbolLease.mode=wal only after multi-process WAL acceptance.',
    rollback: 'mode=memory.',
    riskNote: 'wal multi-process hardened (C5-H); still opt-in; default mode remains memory.',
    executor: {
      status: 'wired',
      sites: [
        'openclaw_runtime/src/agents/agent-tools.ts:871',
      ],
    },
  },
  {
    id: 'patch-flow',
    wave: 'C5',
    kind: 'api',
    key: 'applyPatchProposalsSerial() / recommendIsolationMode()',
    defaultDisplay: 'advisory + explicit execution opt-in (patchFlow.default=false)',
    defaultValue: false,
    risk: 'api-only',
    enable:
      'Pass patchFlowExecution=true with durationMinutes and overlapping worker writeSets through orchestrator.run or team_orchestrate. Workers emit fenced apply_patch proposals; deferred orchestration completion calls applyPatchProposalsSerial. Do NOT set runtime.coding.patchFlow.default=true without C5-H + approval.',
    rollback: 'Omit patchFlowExecution or set it false. The advisory remains display-only, workers keep their ordinary tool surface, and patchFlow.default stays false.',
    riskNote: 'TF-0459 wires advisory visibility in every production orchestrator plan; TF-0460 adds the explicit execution opt-in and proposal-only worker boundary. Neither switches isolation automatically, and serial-apply failure is recorded without blocking verifier startup.',
    executor: {
      status: 'wired',
      sites: [
        'openclaw_runtime/src/agents/orchestrator.ts:547',
        'openclaw_runtime/src/agents/orchestrator.ts:557',
        'openclaw_runtime/src/agents/orchestrator-run-observed.ts:736',
        'openclaw_runtime/src/agents/subagent-registry.ts:612',
      ],
    },
  },
  {
    id: 'context-ladder',
    wave: 'C6',
    kind: 'api',
    key: 'applyContextLadder(...)',
    defaultDisplay: 'explicit assembler opt-in (defaults unchanged)',
    defaultValue: false,
    risk: 'api-only',
    enable:
      'Pass AssembleRequest contextLadder={ enabled: true, tokenBudget, mode?, heatThreshold? }. The assembler queries session blocks, calls applyContextLadder with the explicit tokenBudget, and uses only active blocks for DCS injections.',
    rollback: 'Omit request.contextLadder or leave enabled unset/false; ordinary per-channel BlockStore queries and defaults resume unchanged.',
    riskNote: 'C6-H agent-driven live corpus evidence is harness/specs/fixtures/context-ladder-live-corpus/evidence.json (104,607 raw chars, driven_by=agent). L4 embedding remains deferred; no assembler default is flipped.',
    executor: {
      status: 'wired',
      sites: [
        'openclaw_runtime/src/context-engine/assembler.ts:384',
        'openclaw_runtime/src/context-engine/assembler.ts:393',
      ],
    },
  },
  {
    id: 'routing-memo-shadow',
    wave: 'C7',
    kind: 'config',
    key: 'runtime.coding.routingMemo.shadow',
    defaultDisplay: 'false',
    defaultValue: false,
    risk: 'shadow-only',
    enable:
      'runtime.coding.routingMemo.shadow=true OR recordRoutingMemoShadow({ enabled: true }). Dual-write only; no prompt injection cutover.',
    rollback: 'shadow=false. Does not alter default COMPASS/role-memory/routing injection.',
    riskNote: 'cutoverAllowed stays false until C7-H + written product approval.',
    executor: {
      status: 'wired',
      sites: [
        'openclaw_runtime/src/agents/agent-tools.before-tool-call.ts:1349',
      ],
    },
  },
  {
    id: 'sekb-experience-shadow',
    wave: 'C7',
    kind: 'api',
    key: 'DistillationTool.confirm_and_save(suggestion, edits, options)',
    defaultDisplay: 'api-only (host confirm explicit opt-in)',
    defaultValue: false,
    risk: 'api-only',
    enable:
      'Call the host knowledge.sekbConfirmPrinciple API with payload { experienceShadow: { enabled: true } }; the host resolves workspaceRoot and passes it to DistillationTool.confirm_and_save.',
    rollback: 'Omit payload.experienceShadow or set experienceShadow.enabled=false.',
    riskNote: 'Shadow journal only. The runtime.coding.sekb.experienceShadow config leaf remains observability-only; the production host confirm route wires the explicit API opt-in without changing defaults.',
    executor: {
      status: 'wired',
      sites: [
        'electron/services/knowledge-api.ts:5296',
        'electron/services/knowledge-api.ts:5309',
      ],
    },
  },
  {
    id: 'sekb-retrieval-shadow',
    wave: 'KE-P1',
    kind: 'config',
    key: 'runtime.coding.sekb.retrievalShadow',
    defaultDisplay: 'false',
    defaultValue: false,
    risk: 'shadow-only',
    enable: 'runtime.coding.sekb.retrievalShadow=true.',
    rollback: 'runtime.coding.sekb.retrievalShadow=false (default).',
    riskNote: 'KE-P1-2: would_retrieve shadow -> shadow_context receipt. Zero prompt injection; no default retrieval.',
    executor: {
      status: 'wired',
      sites: [
        'openclaw_runtime/src/knowledge/sekb/retrieval-engine.ts:97',
      ],
    },
  },
  {
    id: 'runtime-memory-persist',
    wave: 'R3',
    kind: 'config',
    key: 'runtime.memory.persist',
    defaultDisplay: 'false',
    defaultValue: false,
    risk: 'opt-in',
    enable: 'runtime.memory.persist=true.',
    rollback: 'runtime.memory.persist=false (default).',
    riskNote: 'R3-1 E-1: persist=true 只有在 runtime-memory 被选为 plugins.slots.memory owner 时才合法；Settings 默认关闭。',
    executor: {
      status: 'wired',
      sites: [
        'openclaw_runtime/src/runtime-core/memory-persistence.ts:518',
      ],
    },
  },
  {
    id: 'runtime-memory-inject-pilot',
    wave: 'R3',
    kind: 'config',
    key: 'runtime.memory.injectPilot.enabled',
    defaultDisplay: 'false',
    defaultValue: false,
    risk: 'opt-in',
    enable: 'runtime.memory.injectPilot.enabled=true.',
    rollback: 'runtime.memory.injectPilot.enabled=false (default).',
    riskNote: 'R3-1: injectPilot 通过 Context Orchestrator 接入 role-memory/runtime-memory provider；runtime-memory 仅在 E-1 合法面（plugins.slots.memory=runtime-memory + persist=true + provider=true）下读真实持久库，默认关闭。',
    executor: {
      status: 'wired',
      sites: [
        'openclaw_runtime/src/agents/embedded-agent-runner/run/attempt.ts:2144',
        'openclaw_runtime/src/agents/embedded-agent-runner/run/attempt.ts:2160',
      ],
    },
  },
  {
    id: 'runtime-memory-candidate-generation',
    wave: 'KE-P1',
    kind: 'config',
    key: 'runtime.memory.candidateGeneration',
    defaultDisplay: 'false',
    defaultValue: false,
    risk: 'opt-in',
    enable: 'runtime.memory.candidateGeneration=true.',
    rollback: 'runtime.memory.candidateGeneration=false (default).',
    riskNote: 'KE-P1-1: task-terminal candidate generation (failure-guard -> Review Queue). Queue-visible only; never auto-persisted.',
    executor: {
      status: 'wired',
      sites: [
        'openclaw_runtime/src/runtime-core/ke-candidate-generation.ts:254',
      ],
    },
  },
  {
    id: 'compass-context-block',
    wave: 'R3',
    kind: 'config',
    key: 'runtime.contextBlock.compass.enabled',
    defaultDisplay: 'false',
    defaultValue: false,
    risk: 'read-only',
    enable: 'runtime.contextBlock.compass.enabled=true.',
    rollback: 'runtime.contextBlock.compass.enabled=false (default).',
    riskNote: 'R3-1: Assembler compass handler 接收生产检索输入；默认关闭。',
    executor: {
      status: 'wired',
      sites: [
        'openclaw_runtime/src/context-engine/assembler.ts:680',
      ],
    },
  },
  {
    id: 'role-memory',
    wave: 'R3',
    kind: 'config',
    key: 'runtime.contextBlock.role-memory.enabled',
    defaultDisplay: 'false',
    defaultValue: false,
    risk: 'read-only',
    enable: 'runtime.contextBlock.role-memory.enabled=true.',
    rollback: 'runtime.contextBlock.role-memory.enabled=false (default).',
    riskNote: 'R3-1: role-memory projection 接收真实 role/task 输入且不移除其他 provider；默认关闭。',
    executor: {
      status: 'wired',
      sites: [
        'openclaw_runtime/src/context-engine/assembler.ts:684',
      ],
    },
  },
  {
    id: 'verseshell-patch-preview',
    wave: 'VS-P3',
    kind: 'config',
    key: 'runtime.verseShellFoundation.patchPreview',
    defaultDisplay: 'false',
    defaultValue: false,
    risk: 'read-only',
    enable:
      'preview_patch 只在六个旗标同时为真且 kill switch 未生效时物化，缺一即不出现：runtime.verseShellFoundation 下的 verifiedRuntime / typedAci / facade / governedExec / artifactResults / patchPreview 全部 =true，且 killSwitch 未置（env VERSE_VERSESHELL_FOUNDATION_KILL_SWITCH 亦未置）。每个旗标也可用 env VERSE_VERSESHELL_FOUNDATION_<NAME> 覆盖。',
    rollback:
      'runtime.verseShellFoundation.patchPreview=false（默认）或移除该叶；preview_patch 从工具面消失，apply_patch 与其 write journal 完全不变。任一前置旗标关闭或 kill switch 生效有同样效果。',
    riskNote:
      'VS-P3-01：只读桥。clawx-patch-preview-v1 profile 只列 file.diff / file.hash / file.read_range，14 个写入与 tx.* operation 在请求发出前被机械拒绝；commit / undo / stale-write guard / recovery 仍只属 runtime.coding.writeJournal（见本表 write-journal 条）。已知登记缺口：同族另外 10 个 verseShellFoundation 旗标（VS-P0/P1/P2 交付物）尚未单独入本目录，故本条的 enable 串是目前唯一记录整条前置链的落盘处。',
    executor: {
      status: 'wired',
      sites: [
        'openclaw_runtime/src/agents/agent-tools.ts:1224',
        'openclaw_runtime/src/agents/agent-tools.ts:1354',
      ],
    },
  },
  {
    id: 'rc03-seal',
    wave: 'RC-03',
    kind: 'config',
    key: 'runtime.rc03.seal',
    defaultDisplay: 'off (opt-in)',
    defaultValue: false,
    risk: 'opt-in',
    enable:
      'Set env OPENCLAW_RC03_SEAL=1 (or runtime.rc03.seal = true) and restart gateway/runtime. Enabling turns on RC-03 message-replacement sealing plus the correlated runtime/wire receipts; it does not change returned summaries.',
    rollback:
      'Unset OPENCLAW_RC03_SEAL or set runtime.rc03.seal = false and restart. With the flag off no seal, runtime receipt, or wire receipt is written.',
    riskNote:
      'Opt-in observation only. Before this entry existed, the "RC-03 is opt-in" intent had no referencable record, so a reviewer could not cite it as proven design intent (deviation TFD-lane2-rc03-seal-default-zero-2026-08-27). Keep default-off; do not flip it inside an implementation task.',
    executor: {
      status: 'wired',
      sites: [
        'openclaw_runtime/src/context-engine/context-orchestrator.ts:376',
      ],
    },
  },
] as const;

export const DCS_PROD_METRIC_EXPORT = {
  writeSide: [
    'coding.write.parseOnWriteHits',
    'coding.write.staleBlocks',
    'coding.write.falseBlockRate',
    'coding.write.journalLatencyMs',
    'coding.write.undoCount',
    'coding.write.syntaxCheckHits',
    'coding.write.verifyHitRate',
    'coding.write.diagHitRate',
    'coding.write.approvalPromptRate',
  ],
  waveSide: [
    'coding.concurrent.waveConflictRate',
    'coding.concurrent.writeSetPredAccuracy',
    'coding.concurrent.writeSetCoverageRate',
    'coding.concurrent.tokenBudgetAborts',
    'coding.concurrent.mergeReworkRate',
  ],
  shadowSide: [
    'dcs.injection.duplicateSuppressions',
    'dcs.contextLadder.actionHits',
    'coding.context.compactionLayerDist',
    'coding.read.factToolCalls',
    'coding.read.taskPassRate',
    'coding.read.toolRoutingAccuracy',
  ],
  sources: [
    'openclaw_runtime/src/context-engine/coding-observability.ts',
    'openclaw_runtime/src/context-engine/dcs-observability.ts',
  ],
} as const;

export function listEnhancementFlagsDefaultOff(): DcsProdFlagEntry[] {
  return DCS_PROD_FLAGS.filter(
    (f) =>
      f.risk === 'opt-in' ||
      f.risk === 'shadow-only' ||
      f.risk === 'api-only' ||
      f.risk === 'request-only',
  );
}

export function assertCatalogDefaultHonesty(): { ok: true } {
  const mustStayOff = [
    'context-view-tools',
    'working-memory',
    'tool-registry',
    'stale-write-guard',
    'symbol-lease',
    'patch-flow',
    'routing-memo-shadow',
    'sekb-experience-shadow',
    'sekb-retrieval-shadow',
    'runtime-memory-persist',
    'runtime-memory-inject-pilot',
    'runtime-memory-candidate-generation',
    'compass-context-block',
    'role-memory',
    'verseshell-patch-preview',
  ];
  for (const id of mustStayOff) {
    const entry = DCS_PROD_FLAGS.find((f) => f.id === id);
    if (!entry) throw new Error(`missing catalog entry ${id}`);
    if (entry.defaultValue !== false) {
      throw new Error(`catalog default honesty failed for ${id}: expected false`);
    }
  }
  const backend = DCS_PROD_FLAGS.find((f) => f.id === 'worktree-backend');
  if (backend?.defaultValue !== 'inprocess') {
    throw new Error('worktree backend catalog default must be inprocess');
  }
  const isolation = DCS_PROD_FLAGS.find((f) => f.id === 'isolation-request');
  if (isolation?.defaultValue !== 'shared') {
    throw new Error('isolation catalog default must be shared');
  }
  return { ok: true };
}
