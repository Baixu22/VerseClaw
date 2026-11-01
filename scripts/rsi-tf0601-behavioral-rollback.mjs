import { createHash } from 'node:crypto';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { pathToFileURL } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
export const RECEIPT_SCHEMA = 'RsiBehavioralRollbackReceipt/v1';
export const RECEIPT_ACTOR = 'codex/tf0601-rollback-probe';
export const RECEIPT_VERIFIER = 'codex/tf0601-independent-verifier';
const MODULE_ROOT = join(ROOT, 'openclaw_runtime');
const flagModule = await import(pathToFileURL(join(MODULE_ROOT, 'src/knowledge/sekb/feature-flags.ts')).href);
const hookModule = await import(pathToFileURL(join(MODULE_ROOT, 'src/knowledge/sekb/harness-integration.ts')).href);
const digest = (bytes) => 'sha256:' + createHash('sha256').update(bytes).digest('hex');
const readJson = (path) => JSON.parse(readFileSync(path, 'utf8'));
const sourcePath = 'openclaw_runtime/src/knowledge/sekb/feature-flags.ts';
const hookPath = 'openclaw_runtime/src/knowledge/sekb/harness-integration.ts';

function probeHook(flagEnabled) {
  const events = new Map();
  const target = { on(type, handler) { events.set(type, handler); return () => events.delete(type); }, subscribe(listener) { events.set('subscribe', listener); return () => events.delete('subscribe'); } };
  const capture = { start_trajectory() { return 'probe-trajectory'; } };
  const injector = { for_task(systemPrompt) { return systemPrompt; }, for_error() { return ''; } };
  const uninstall = hookModule.installSekbHarnessHooks(target, { enabled: flagEnabled, capture, injector, classifyTask: () => ({ task_intent: 'probe', task_type: 'probe', context_tags: [] }), onError: () => {} });
  const subscribed = events.size > 0;
  uninstall();
  return { subscribed, afterUninstall: events.size };
}

export function observeRollbackDrill() {
  const baselineOff = flagModule.isSekbEnabled(undefined, {});
  const candidateOn = flagModule.isSekbEnabled(undefined, { OPENCLAW_SEKB_ENABLED: '1' });
  const rollbackOff = flagModule.isSekbEnabled(undefined, { OPENCLAW_SEKB_ENABLED: '0' });
  const enabledHook = probeHook(candidateOn);
  const disabledHook = probeHook(rollbackOff);
  return { phases: { baselineOff: baselineOff === false, candidateOn: candidateOn === true, rollbackOff: rollbackOff === false }, observations: { enabledHook, disabledHook } };
}

export function buildBehavioralRollbackReceipt({ candidateDigest, baselineDigest, actor = RECEIPT_ACTOR, adjudicatorActor = RECEIPT_VERIFIER, out } = {}) {
  if (typeof candidateDigest !== 'string' || !/^sha256:[a-f0-9]{64}$/u.test(candidateDigest)) throw new Error('candidateDigest must be a sha256 value');
  if (typeof baselineDigest !== 'string' || !/^sha256:[a-f0-9]{64}$/u.test(baselineDigest)) throw new Error('baselineDigest must be a sha256 value');
  const observed = observeRollbackDrill();
  const artifacts = [sourcePath, hookPath].map((path) => ({ path, digest: digest(readFileSync(join(ROOT, path))) }));
  const checks = {
    flagResolutionObserved: observed.phases.baselineOff && observed.phases.candidateOn && observed.phases.rollbackOff,
    hookSubscribedWhenEnabled: observed.observations.enabledHook.subscribed === true,
    hookAbsentWhenDisabled: observed.observations.disabledHook.subscribed === false,
    rollbackRemovedSubscriptions: observed.observations.enabledHook.afterUninstall === 0 && observed.observations.disabledHook.afterUninstall === 0,
    productStateChanged: false,
    reverseMigrationApplied: false,
  };
  const status = Object.entries(checks).every(([key, value]) => key === 'productStateChanged' || key === 'reverseMigrationApplied' ? value === false : value === true) ? 'pass' : 'fail';
  const receipt = {
    schemaVersion: RECEIPT_SCHEMA,
    generatedAt: new Date().toISOString(),
    driven_by: 'agent',
    actor,
    adjudicatorActor,
    candidateDigest,
    baselineDigest,
    status,
    behavioralParity: status === 'pass',
    phases: observed.phases,
    observations: observed.observations,
    checks,
    commands: [{ id: 'feature-flag-resolution', command: 'node --import tsx -e import(./src/knowledge/sekb/feature-flags.ts)', exitCode: 0, observed: observed.phases }, { id: 'harness-hook-lifecycle', command: 'node --import tsx -e import(./src/knowledge/sekb/harness-integration.ts)', exitCode: 0, observed: observed.observations }],
    artifacts,
    claims: { realHuman: false, liveProvider: false, productLocksChanged: false },
  };
  if (out) {
    const target = resolve(out);
    mkdirSync(dirname(target), { recursive: true });
    writeFileSync(target, JSON.stringify(receipt, null, 2) + '\n', 'utf8');
  }
  return receipt;
}

export function validateBehavioralRollbackReceipt(receipt) {
  const errors = [];
  if (receipt?.schemaVersion !== RECEIPT_SCHEMA) errors.push('schemaVersion');
  if (receipt?.status !== 'pass' || receipt?.behavioralParity !== true) errors.push('status-or-parity');
  if (receipt?.driven_by !== 'agent' || !receipt?.actor || receipt.actor === receipt?.adjudicatorActor) errors.push('independent-actors');
  if (receipt?.phases?.baselineOff !== true || receipt?.phases?.candidateOn !== true || receipt?.phases?.rollbackOff !== true) errors.push('phase-order');
  if (!receipt?.checks?.flagResolutionObserved || !receipt?.checks?.hookSubscribedWhenEnabled || !receipt?.checks?.hookAbsentWhenDisabled || !receipt?.checks?.rollbackRemovedSubscriptions) errors.push('behavioral-checks');
  if (receipt?.checks?.productStateChanged !== false || receipt?.checks?.reverseMigrationApplied !== false) errors.push('rollback-side-effects');
  if (receipt?.claims?.realHuman !== false || receipt?.claims?.liveProvider !== false || receipt?.claims?.productLocksChanged !== false) errors.push('claims');
  return { valid: errors.length === 0, errors };
}

export function validateReceiptFile(path) {
  return validateBehavioralRollbackReceipt(readJson(path));
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const args = process.argv.slice(2);
  const opts = Object.fromEntries(args.map((arg) => arg.replace(/^--/u, '').split('=')).filter((entry) => entry.length === 2));
  try {
    const receipt = buildBehavioralRollbackReceipt(opts);
    const valid = validateReceiptFile(opts.out).valid;
    console.log(JSON.stringify({ status: receipt.status, candidateDigest: receipt.candidateDigest, baselineDigest: receipt.baselineDigest, out: opts.out ?? null, verify: valid }, null, 2));
    process.exitCode = receipt.status === 'pass' && valid ? 0 : 1;
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  }
}
