#!/usr/bin/env node
// MC4 verifier: rebuild the adapter differential from the frozen MC0/MC1/MC2/MC3/WP0
// artifacts, compare it with the stored evidence, and independently re-fire every
// authority, default-off and command-plan refusal. Stored JSON alone is not evidence.
import { createHash } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
import { isMainEntrypoint } from './lib/entrypoint.mjs';
import {
  ADAPTER_MODULE_PATH, MC3_PACKAGE_PATH, WP0_CONTRACT_PATH, buildMc4Report,
  loadAdapter, validateContractConformance, validateMc4Report,
} from './versegit-mc4-adapter.mjs';
import { MC0_BASELINE_PATH, MC1_CONTRACT_PATH, MC2_GOLDEN_PATH, sha256 } from './versegit-mc5-differential.mjs';

const root = process.env.VERSEGIT_MC4_ROOT ? resolve(process.env.VERSEGIT_MC4_ROOT) : resolve(process.cwd());
function at(flag) { const i = process.argv.indexOf(flag); return i >= 0 ? resolve(process.argv[i + 1]) : undefined; }
function read(relative) {
  const path = resolve(root, relative);
  if (!existsSync(path)) throw new Error(`missing artifact: ${relative}`);
  return readFileSync(path, 'utf8');
}

async function main() {
  const artifact = at('--artifact') ?? resolve(root, 'harness/specs/fixtures/versegit-planning-correction/mc4-evidence/adapter-report.json');
  if (!existsSync(artifact)) {
    console.error(`[versegit-mc4] FAIL: artifact missing: ${artifact}`);
    process.exitCode = 1;
    return;
  }
  const stored = JSON.parse(readFileSync(artifact, 'utf8'));
  const issues = [];
  issues.push(...validateMc4Report(stored).issues.map((issue) => `stored: ${issue}`));

  const live = await buildMc4Report({ root });
  issues.push(...validateMc4Report(live).issues.map((issue) => `live: ${issue}`));
  if (stored.digest !== live.digest) issues.push('stored report digest differs from the live adapter run');
  if (stored.status !== 'equivalent' || live.status !== 'equivalent') issues.push('both stored and live reports must be equivalent');

  const mc0 = JSON.parse(read(MC0_BASELINE_PATH));
  const mc1 = JSON.parse(read(MC1_CONTRACT_PATH));
  const mc2 = JSON.parse(read(MC2_GOLDEN_PATH));
  const mc3 = JSON.parse(read(MC3_PACKAGE_PATH));
  const wp0 = JSON.parse(read(WP0_CONTRACT_PATH));
  const contractDigest = sha256(JSON.stringify(mc1));
  if (stored.provenance?.source_commit !== mc0.source?.head) issues.push('stored source commit no longer matches MC0');
  if (stored.provenance?.binary_sha256 !== mc0.binary?.sha256) issues.push('stored binary digest no longer matches MC0');
  if (stored.provenance?.contract_digest !== contractDigest || contractDigest !== wp0.binary_identity?.consumer_contract_digest) issues.push('contract digest no longer matches MC1/WP0');
  if (stored.provenance?.golden_bundle_digest !== mc2.digest || mc2.digest !== wp0.binary_identity?.golden_bundle_digest) issues.push('golden digest no longer matches MC2/WP0');
  if (stored.provenance?.sidecar_package_digest !== mc3.digest || mc3.digest !== wp0.binary_identity?.sidecar_package_digest) issues.push('sidecar digest no longer matches MC3/WP0');

  const binaryPath = resolve(String(mc0.binary?.path));
  if (!existsSync(binaryPath)) {
    issues.push('frozen sidecar binary is missing');
  } else {
    const binaryDigest = createHash('sha256').update(readFileSync(binaryPath)).digest('hex');
    if (binaryDigest !== stored.provenance?.binary_sha256) issues.push('the frozen sidecar binary no longer matches MC0');
  }
  const providerStatus = (() => {
    const result = spawnSync('git', ['-C', String(mc0.source?.repo), 'status', '--porcelain=v1', '--untracked-files=all'], { encoding: 'utf8', windowsHide: true });
    return result.status === 0 ? String(result.stdout ?? '').replace(/\r/g, '').trim() : null;
  })();
  if (providerStatus === null) issues.push('provider source repository is unavailable');
  if (providerStatus !== null && sha256(providerStatus) !== mc0.source?.status_porcelain_sha256) issues.push('provider working-tree status drifted from MC0');

  const module = await loadAdapter({ root });
  const conformance = validateContractConformance(module, mc1);
  if (!conformance.ok) issues.push(...conformance.issues);
  const source = read(ADAPTER_MODULE_PATH);
  if (sha256(source) !== stored.adapter_source_digest) issues.push('adapter source digest drifted from the stored evidence');
  for (const marker of ['vg_kernel', 'vg_jj', 'vg_battery_', 'crate::', 'clawx://']) {
    if (source.includes(marker)) issues.push(`adapter source contains forbidden internal marker ${marker}`);
  }

  let unauthorizedRunCount = 0;
  const adapter = new module.VerseGitModule({
    binaryPath,
    contractDigest,
    run: () => { unauthorizedRunCount += 1; return { stdout: '{}', stderr: '', code: 0 }; },
  });
  if (adapter.readVersion().status !== 'unavailable' || unauthorizedRunCount !== 0) issues.push('readVersion before attach must be unavailable without spawning');
  const m0 = adapter.attach('M0', { mode: 'M0', authorizationId: null });
  if (!m0.ok || m0.status !== 'not_applicable' || adapter.isAttached || unauthorizedRunCount !== 0) issues.push('M0 must not attach or spawn');
  if (adapter.attach('M3', { mode: 'M3', authorizationId: null }).status !== 'rejected_by_policy') issues.push('ungranted M3 promotion must be refused');
  if (adapter.attach('M2', { mode: 'M1', authorizationId: 'g' }).status !== 'rejected_by_policy') issues.push('mismatched grants must be refused');
  if (adapter.attach('M1', { mode: 'M1', authorizationId: 'g' }).status !== 'partial') issues.push('a granted M1 attach must succeed');
  const report = adapter.buildReport({
    mode: 'M1', component: 'mc4-verifier', trigger: { reason: 'verification' }, repository: {},
    coverage: { declared: ['capabilities'], unobserved: ['bash', 'network'] }, result: { status: 'partial', reasons: ['unknown'] },
  });
  if (!module.validateModuleReport(report).ok) issues.push('the adapter must emit a valid host-owned report');

  const reasonAsStatus = module.validateModuleReport({ ...report, result: { status: 'stale', reasons: [] } });
  if (reasonAsStatus.ok || !reasonAsStatus.issues.includes('reason label used as top-level status')) issues.push('a reason label must not be accepted as a top-level status');
  if (module.validateModuleReport({ ...report, admitted: true }).ok) issues.push('an admitted authority claim must be rejected');
  const validPlan = {
    schema: module.VG_COMMAND_PLAN_SCHEMA, runId: 'r', candidateId: 'c', owner: 'o',
    commands: [{ argv: ['pnpm', 'test'], effect: 'execute', retry: 'never' }],
  };
  if (!module.validateCommandPlan(validPlan).ok) issues.push('a structured effectful plan with no replay must be accepted');
  if (module.validateCommandPlan({ ...validPlan, shell: 'pnpm test' }).ok) issues.push('a shell string plan must be rejected');
  if (module.validateCommandPlan({ ...validPlan, commands: [{ argv: ['pnpm', 'test'], effect: 'execute', retry: 'always' }] }).ok) issues.push('an effectful auto-replay must be rejected');
  if (module.validateCommandPlan({ ...validPlan, commands: [{ argv: ['land', 'candidate'], effect: 'execute' }] }).ok) issues.push('a forbidden argv head must be rejected');

  const grant = { mode: 'M2', authorizationId: 'g2' };
  if (module.authorizeCommand('M2', ['capabilities', '--json'], grant) !== null) issues.push('capabilities must be the one verified read-only command');
  for (const command of ['land', 'admit', 'declare_intent', 'git', 'gerrit', 'export']) {
    const refused = module.authorizeCommand('M3', [command], { mode: 'M3', authorizationId: 'g3' });
    if (refused?.status !== 'rejected_by_policy' || refused?.host_verdict !== 'unchanged') issues.push(`${command} must be refused without changing the host verdict`);
  }
  for (const command of module.VerseGitModule.deferredCommands) {
    const refused = module.authorizeCommand('M2', [command], grant);
    if (refused?.status !== 'rejected_by_policy' || refused?.host_verdict !== 'unchanged') issues.push(`deferred command ${command} must be refused`);
  }
  if (module.authorizeCommand('M0', ['capabilities'], { mode: 'M0', authorizationId: null })?.status !== 'rejected_by_policy') issues.push('M0 commands must be refused');
  if (module.authorizeCommand('M2', ['capabilities'], { mode: 'M2', authorizationId: null })?.host_verdict !== 'unchanged') issues.push('missing grants must leave the host verdict unchanged');

  if (stored.differential?.adapter_run_count !== stored.differential?.seam_count) issues.push('every seam must call the shipped adapter exactly once');
  if (stored.read_only_command_surface?.join(',') !== 'capabilities') issues.push('stored evidence widened the verified read-only surface');
  if (issues.length > 0) {
    for (const issue of issues) console.error(`[versegit-mc4] FAIL: ${issue}`);
    process.exitCode = 1;
    return;
  }
  console.log(`[versegit-mc4] OK status=${stored.status} seams=${stored.differential.seam_count} adapter_calls=${stored.differential.adapter_run_count} digest=${stored.digest.slice(0, 12)}`);
}

if (isMainEntrypoint(import.meta.url)) {
  main().catch((error) => { console.error(`[versegit-mc4] FAIL: ${String(error?.stack ?? error)}`); process.exitCode = 1; });
}