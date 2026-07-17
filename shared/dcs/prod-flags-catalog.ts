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
      'A/B avgReduction still below 5x gate; keep default-off until C1 graduation + product approval.',
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
      'Can block full-file writes that look stale; monitor coding.write.falseBlockRate.',
  },
  {
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
  },
  {
    id: 'worktree-backend',
    wave: 'C4',
    kind: 'config',
    key: 'runtime.coding.worktree.backend',
    defaultDisplay: 'inprocess',
    defaultValue: 'inprocess',
    risk: 'opt-in',
    enable:
      'Set runtime.coding.worktree.backend=git OR createWorktreeService({ backend: "git" }). Requires isolation=worktree on the request/plan.',
    rollback: 'Set backend=inprocess. Isolation request default remains shared.',
    riskNote:
      'C4-H git lifecycle hardened (lock/path/cleanup); backend default remains inprocess. Do not change isolation default. C4-P hardlink install residual.',
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
  },
  {
    id: 'patch-flow',
    wave: 'C5',
    kind: 'api',
    key: 'applyPatchProposalsSerial() / recommendIsolationMode()',
    defaultDisplay: 'api-only (patchFlow.default=false)',
    defaultValue: false,
    risk: 'api-only',
    enable:
      'Call applyPatchProposalsSerial() / recommendIsolationMode({...}). Do NOT set runtime.coding.patchFlow.default=true without C5-H + approval.',
    rollback: 'Stop calling patch-flow APIs; keep patchFlow.default=false.',
    riskNote: 'recommendIsolationMode is advisory only; no auto-switch of production isolation.',
  },
  {
    id: 'context-ladder',
    wave: 'C6',
    kind: 'api',
    key: 'applyContextLadder(...)',
    defaultDisplay: 'opt-in API (assembler not flipped)',
    defaultValue: false,
    risk: 'api-only',
    enable:
      'Import and call applyContextLadder from context-ladder.ts with an explicit tokenBudget. Assembler production path does not auto-ladder.',
    rollback: 'Stop calling applyContextLadder; leave assembler defaults unchanged.',
    riskNote: '64K evidence is synthetic until C6-H live corpus. L4 embedding remains deferred.',
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
  },
  {
    id: 'sekb-experience-shadow',
    wave: 'C7',
    kind: 'config',
    key: 'runtime.coding.sekb.experienceShadow',
    defaultDisplay: 'false',
    defaultValue: false,
    risk: 'shadow-only',
    enable:
      'runtime.coding.sekb.experienceShadow=true OR confirm options.experienceShadow.enabled=true.',
    rollback: 'experienceShadow=false / omit options.',
    riskNote: 'Shadow journal only; experienceHitRate still fixture-level. No default knowledge injection.',
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
    'stale-write-guard',
    'symbol-lease',
    'patch-flow',
    'routing-memo-shadow',
    'sekb-experience-shadow',
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
