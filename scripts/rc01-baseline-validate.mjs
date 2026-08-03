#!/usr/bin/env node
// RC-01 baseline validation: checks that baseline.json satisfies the RC-01 Exit
// criteria — schema, acceptedBaseSha, source/npm versions, no unclassified
// writer, every required module present, runtime-family frozen, receipt-owner
// decision evidence, and product locks unchanged.
import { readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';

const repoRoot = resolve(new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1').split('/scripts/')[0]);
const baselinePath = join(repoRoot, 'artifacts', 'runtime-authority-convergence', 'rc-01', 'baseline.json');

const errors = [];
const warnings = [];

let baseline;
try {
  baseline = JSON.parse(readFileSync(baselinePath, 'utf8'));
} catch (error) {
  console.error(`baseline.json unreadable: ${error.message}`);
  process.exitCode = 1;
  process.exit(1);
}

// 1. Schema and identity.
if (baseline.schema !== 'runtime-authority-convergence-baseline/v1') errors.push('schema mismatch');
if (!/^[a-f0-9]{40}$/.test(String(baseline.acceptedBaseSha ?? ''))) errors.push('acceptedBaseSha must be a valid 40-hex SHA');
if (baseline.sourceRuntimeVersion?.runtimeMode !== 'source') errors.push('source runtime must declare runtimeMode=source');
if (baseline.npmRuntimeVersion?.satisfiesReceiptReadiness !== false) errors.push('npm fallback must not satisfy receipt readiness');
if (!baseline.capabilitySplit?.sourceIsSoleImplementationPath) errors.push('source must be the sole implementation path');
if (baseline.capabilitySplit?.npmFallbackReportsDegraded !== true) errors.push('npm fallback must report degraded');

// 2. No unclassified writer.
let classified = 0;
let unclassified = 0;
const requiredModules = {
  taskFlow: /task-flow-registry/,
  taskRegistry: /task-registry/,
  longTaskCheckpoints: /long-task-control\/store|long_task_checkpoints/,
  runtimeTaskEventLog: /event-log-persistence|runtime_task_event_log_records/,
  mission: /mission-control\/store|mission_runs/,
  taskLoop: /task-loop-controller/,
  clawgraph: /clawgraph\/runtime/,
  taskLedger: /task-ledger/,
  runtimeSpine: /runtime-spine/,
  memorySlot: /memory\/memory-store|plugins\/slots/,
  contextEngineSlot: /context-engine\/assembler|context_blocks/,
  mcp: /mcp\//,
  otel: /diagnostics-otel/,
  trajectory: /trajectory\/runtime|sekb\/trajectory/,
  observabilityJsonl: /observability/,
  approval: /exec-approval-manager/,
};
const foundModules = new Set();

function checkWriter(writer) {
  if (!writer || typeof writer !== 'object') return;
  if (!writer.classification) {
    errors.push(`unclassified writer: ${writer.path ?? JSON.stringify(writer).slice(0, 80)}`);
    unclassified += 1;
    return;
  }
  classified += 1;
  for (const [name, pattern] of Object.entries(requiredModules)) {
    if (pattern.test(writer.path ?? '')) foundModules.add(name);
  }
}

for (const authority of Object.values(baseline.authorities ?? {})) {
  for (const list of ['writers', 'nonOwners', 'legacyWriters', 'candidates']) {
    for (const writer of authority[list] ?? []) checkWriter(writer);
  }
}
if (unclassified > 0) errors.push(`${unclassified} unclassified writer(s)`);
if (classified === 0) errors.push('inventory has no classified writers');

// 3. Every required module present.
for (const name of Object.keys(requiredModules)) {
  if (!foundModules.has(name)) errors.push(`required module missing from inventory: ${name}`);
}

// 4. runtime-family frozen.
if (baseline.authorities?.runtimeFamily?.frozen !== true) errors.push('runtime-family must be frozen');
if (baseline.authorities?.runtimeSpine?.frozen !== true) errors.push('runtime-spine must be frozen');

// 5. Receipt-owner decision.
const receipt = baseline.receiptOwnerDecision;
if (!receipt) errors.push('receiptOwnerDecision missing');
if (receipt?.status !== 'accepted') errors.push(`receiptOwnerDecision.status must be accepted, got ${receipt?.status ?? 'missing'}`);
if (receipt?.blocker != null) errors.push('receiptOwnerDecision blocker must be null when accepted');
if (receipt?.selectedOwner !== 'OpenClaw shared state SQLite / runtime_receipts via ReceiptStore') {
  errors.push(`receiptOwnerDecision.selectedOwner mismatch: ${receipt?.selectedOwner ?? 'missing'}`);
}
if (receipt?.tableName !== 'runtime_receipts') errors.push(`receiptOwnerDecision.tableName must be runtime_receipts, got ${receipt?.tableName ?? 'missing'}`);
if (receipt?.logicalOwner !== 'narrow ReceiptStore interface') errors.push('receiptOwnerDecision.logicalOwner must be the narrow ReceiptStore interface');
if (receipt?.physicalOwner !== 'existing openclaw-state SQLite') errors.push('receiptOwnerDecision.physicalOwner must be the existing openclaw-state SQLite');

// 5b. Receipt authority entry must carry the decision, table, and seven hard constraints.
const receiptAuthority = baseline.authorities?.receipt;
if (!receiptAuthority) errors.push('authorities.receipt missing');
if (receiptAuthority?.decision !== 'accepted') errors.push('authorities.receipt.decision must be accepted');
if (receiptAuthority?.tableIsNewTypedAppendOnly !== true) errors.push('runtime_receipts must be declared as a new typed append-only table');
if (!Array.isArray(receiptAuthority?.hardConstraints) || receiptAuthority.hardConstraints.length < 7) {
  errors.push(`receipt authority must declare all 7 hard constraints, got ${receiptAuthority?.hardConstraints?.length ?? 0}`);
}
// Hard constraint 5 must bind shadow-write failure to RC-02 acceptance without changing send behavior.
const constraint5 = (receiptAuthority?.hardConstraints ?? []).find((c) => /shadow write failure/i.test(c));
if (!constraint5 || !/fail RC-02/i.test(constraint5) || !/must not change send behavior/i.test(constraint5)) {
  errors.push('hard constraint 5 (shadow-write failure fails RC-02, never changes send behavior) missing or malformed');
}
// Hard constraint 2 must demand content-sensitive idempotency (identical content idempotent, different content conflict).
const constraint2 = (receiptAuthority?.hardConstraints ?? []).find((c) => /idempotency_key/i.test(c));
if (!constraint2 || !/identical content/i.test(constraint2) || !/conflict/i.test(constraint2)) {
  errors.push('hard constraint 2 (content-sensitive idempotency) missing or malformed');
}
// Rejected owners must include the rejected candidates.
for (const key of ['long_task_checkpoints', 'RuntimeTaskEventLog', 'flow_runs', 'mission_events', 'channels/message/receipt.ts']) {
  if (!receiptAuthority?.rejectedOwners?.[key]) errors.push(`receipt rejectedOwners missing entry: ${key}`);
}
// RuntimeTaskEventLog must remain diagnostic, not promoted.
const runtimeEventLog = (receiptAuthority?.candidates ?? []).find((c) => c.path.includes('event-log-persistence'));
if (!runtimeEventLog || runtimeEventLog.role !== 'rejected') errors.push('RuntimeTaskEventLog must be recorded as a rejected receipt owner');
if (runtimeEventLog?.defaultOff !== true || runtimeEventLog?.prunable !== true || runtimeEventLog?.hasReceiptEffectKind !== false) {
  errors.push('RuntimeTaskEventLog rejection evidence (default-off, prunable, no receipt/effect kind) missing');
}

// 6. Product locks unchanged.
if (baseline.productLocks?.liveReady !== false || baseline.productLocks?.productApproved !== false || baseline.productLocks?.defaultOn !== false) {
  errors.push('product locks must remain false');
}

if (errors.length > 0) {
  console.error('RC-01 baseline validation FAILED:');
  for (const error of errors) console.error(`  - ${error}`);
  for (const warning of warnings) console.log(`  (warn) ${warning}`);
  process.exitCode = 1;
} else {
  console.log(`RC-01 baseline validation PASSED: schema=${baseline.schema} sha=${String(baseline.acceptedBaseSha).slice(0, 12)} source=${baseline.sourceRuntimeVersion?.name}@${baseline.sourceRuntimeVersion?.version} npm=${baseline.npmRuntimeVersion?.name}@${baseline.npmRuntimeVersion?.spec} classified=${classified} modules=${foundModules.size}/${Object.keys(requiredModules).length}`);
  for (const warning of warnings) console.log(`  (warn) ${warning}`);
}
