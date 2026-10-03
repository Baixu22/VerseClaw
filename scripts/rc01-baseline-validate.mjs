#!/usr/bin/env node
// RC-01 baseline validation: checks that baseline.json satisfies the RC-01 Exit
// criteria — schema, acceptedBaseSha, source/npm versions, no unclassified
// writer, every required module present, runtime-family frozen, receipt-owner
// decision evidence, and product locks unchanged.
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { isDeepStrictEqual } from 'node:util';
import { RECEIPT_HARD_CONSTRAINTS, RECEIPT_OWNER } from './lib/rc01-receipt-contract.mjs';

const repoRoot = fileURLToPath(new URL('..', import.meta.url));
const baselinePath = join(repoRoot, 'artifacts', 'runtime-authority-convergence', 'rc-01', 'baseline.json');

const errors = [];
const warnings = [];

function git(args) {
  return spawnSync('git', args, { cwd: repoRoot, encoding: 'utf8', shell: false, maxBuffer: 64 * 1024 * 1024 });
}

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
const trackedBaseline = git(['ls-files', '--error-unmatch', 'artifacts/runtime-authority-convergence/rc-01/baseline.json']);
if (trackedBaseline.status !== 0 || trackedBaseline.stdout.trim() !== 'artifacts/runtime-authority-convergence/rc-01/baseline.json') {
  errors.push('baseline.json must be tracked by git');
}
const acceptedBaseAncestor = git(['merge-base', '--is-ancestor', String(baseline.acceptedBaseSha ?? ''), 'HEAD']);
if (acceptedBaseAncestor.status !== 0) errors.push('acceptedBaseSha must be an ancestor of the candidate HEAD');
if (acceptedBaseAncestor.status === 0) {
  const timestamp = git(['show', '-s', '--format=%ct', baseline.acceptedBaseSha]);
  const epoch = Number(timestamp.stdout?.trim());
  if (timestamp.status !== 0 || !Number.isSafeInteger(epoch) || baseline.generatedAt !== new Date(epoch * 1000).toISOString()) {
    errors.push('generatedAt must match the accepted base commit timestamp');
  }
}
const sourcePackage = JSON.parse(readFileSync(join(repoRoot, 'openclaw_runtime/package.json'), 'utf8'));
if (typeof sourcePackage.name !== 'string' || !sourcePackage.name.trim()
  || typeof sourcePackage.version !== 'string' || !sourcePackage.version.trim()
  || baseline.sourceRuntimeVersion?.name !== sourcePackage.name
  || baseline.sourceRuntimeVersion?.version !== sourcePackage.version) {
  errors.push('sourceRuntimeVersion must match openclaw_runtime/package.json');
}
const rootPackage = JSON.parse(readFileSync(join(repoRoot, 'package.json'), 'utf8'));
const npmSpec = rootPackage.dependencies?.openclaw ?? rootPackage.devDependencies?.openclaw ?? rootPackage.optionalDependencies?.openclaw;
if (typeof npmSpec !== 'string' || !npmSpec.trim()
  || baseline.npmRuntimeVersion?.name !== 'openclaw' || baseline.npmRuntimeVersion?.spec !== npmSpec
  || baseline.npmRuntimeVersion?.runtimeMode !== 'npm') {
  errors.push('npmRuntimeVersion must match the OpenClaw dependency in package.json');
}
if (baseline.sourceRuntimeVersion?.runtimeMode !== 'source') errors.push('source runtime must declare runtimeMode=source');
if (baseline.npmRuntimeVersion?.satisfiesReceiptReadiness !== false) errors.push('npm fallback must not satisfy receipt readiness');
if (!baseline.capabilitySplit?.sourceIsSoleImplementationPath) errors.push('source must be the sole implementation path');
if (baseline.capabilitySplit?.npmFallbackReportsDegraded !== true) errors.push('npm fallback must report degraded');

// 2. No unclassified writer.
let classified = 0;
let unclassified = 0;
const classifications = new Set(['reuse', 'adapt', 'converge', 'freeze', 'remove']);
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
const trackedResult = git(['ls-files', '-z']);
if (trackedResult.status !== 0) errors.push('candidate tracked owner paths could not be read');
const trackedFiles = String(trackedResult.stdout ?? '').split('\0').filter(Boolean);
const trackedSet = new Set(trackedFiles);

function checkWriter(writer) {
  if (!writer || typeof writer !== 'object') return;
  if (!classifications.has(writer.classification)) {
    errors.push(`invalid writer classification: ${writer.path ?? JSON.stringify(writer).slice(0, 80)}`);
    unclassified += 1;
    return;
  }
  if (typeof writer.path !== 'string' || !writer.path.trim()) {
    errors.push('classified writer must declare an owner path');
    return;
  }
  classified += 1;
  const prefix = writer.path.endsWith('/**') ? writer.path.slice(0, -2) : writer.path.endsWith('/') ? writer.path : null;
  const exists = prefix === null
    ? trackedSet.has(writer.path) && existsSync(join(repoRoot, writer.path))
    : trackedFiles.some((file) => file.startsWith(prefix) && existsSync(join(repoRoot, file)));
  if (!exists) errors.push(`owner path missing or untracked in candidate: ${writer.path}`);
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
const receiptAuthority = baseline.authorities?.receipt;
if (!receipt) errors.push('receiptOwnerDecision missing');
if (receipt?.status !== 'accepted') errors.push(`receiptOwnerDecision.status must be accepted, got ${receipt?.status ?? 'missing'}`);
if (receipt?.blocker != null) errors.push('receiptOwnerDecision blocker must be null when accepted');
for (const [scope, declaration] of [['receiptOwnerDecision', receipt], ['authorities.receipt', receiptAuthority]]) {
  for (const [field, expected] of Object.entries(RECEIPT_OWNER)) {
    if (declaration?.[field] !== expected) errors.push(`${scope}.${field} must be ${expected}`);
  }
}

// 5b. Receipt authority entry must carry the decision, table, and seven hard constraints.
if (!receiptAuthority) errors.push('authorities.receipt missing');
if (receiptAuthority?.decision !== 'accepted') errors.push('authorities.receipt.decision must be accepted');
if (receiptAuthority?.tableIsNewTypedAppendOnly !== true) errors.push('runtime_receipts must be declared as a new typed append-only table');
if (!isDeepStrictEqual(receiptAuthority?.hardConstraints, RECEIPT_HARD_CONSTRAINTS)) {
  errors.push('receipt authority must preserve all 7 approved hard constraints exactly');
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
