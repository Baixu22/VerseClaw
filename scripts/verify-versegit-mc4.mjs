#!/usr/bin/env node
// MC4 verifier: revalidate every frozen identity before executing the sidecar, rebuild the
// live adapter differential, and independently re-fire identity, report, capability and
// command-plan negative controls. Stored JSON alone is not evidence.
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
function gitValue(repo, expression) {
  const result = spawnSync('git', ['-C', repo, 'rev-parse', expression], { encoding: 'utf8', windowsHide: true });
  return result.status === 0 ? String(result.stdout ?? '').trim() : null;
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

  const mc0 = JSON.parse(read(MC0_BASELINE_PATH));
  const mc1 = JSON.parse(read(MC1_CONTRACT_PATH));
  const mc2 = JSON.parse(read(MC2_GOLDEN_PATH));
  const mc3 = JSON.parse(read(MC3_PACKAGE_PATH));
  const wp0 = JSON.parse(read(WP0_CONTRACT_PATH));
  const contractDigest = sha256(JSON.stringify(mc1));
  const binaryPath = resolve(String(mc0.binary?.path));
  if (!existsSync(binaryPath)) {
    issues.push('frozen sidecar binary is missing');
  } else {
    const binaryDigest = sha256(readFileSync(binaryPath));
    const sourceHead = gitValue(String(mc0.source?.repo), 'HEAD');
    const sourceTree = gitValue(String(mc0.source?.repo), 'HEAD^{tree}');
    if (binaryDigest !== mc0.binary?.sha256 || binaryDigest !== mc2.identity?.binary_sha256 || binaryDigest !== mc3.identity?.binary_sha256 || binaryDigest !== wp0.binary_identity?.sha256) issues.push('binary identity disagrees across MC0/MC2/MC3/WP0');
    if (sourceHead !== mc0.source?.head || sourceHead !== mc2.identity?.mc0_source_head || sourceHead !== mc3.identity?.effective_source_commit || sourceHead !== wp0.binary_identity?.source_head) issues.push('source head disagrees across MC0/MC2/MC3/WP0');
    if (sourceTree !== mc0.source?.tree || sourceTree !== mc2.identity?.mc0_source_tree || sourceTree !== mc3.identity?.source_tree_digest || sourceTree !== wp0.binary_identity?.source_tree) issues.push('source tree disagrees across MC0/MC2/MC3/WP0');
    if (stored.provenance?.binary_sha256 !== binaryDigest || stored.provenance?.source_commit !== sourceHead || stored.provenance?.source_tree !== sourceTree) issues.push('stored provenance no longer matches the frozen source/binary');
  }
  if (stored.provenance?.contract_digest !== contractDigest || contractDigest !== wp0.binary_identity?.consumer_contract_digest || contractDigest !== mc3.identity?.contract_digest) issues.push('contract digest no longer matches MC1/MC3/WP0');
  if (stored.provenance?.golden_bundle_digest !== mc2.digest || mc2.digest !== wp0.binary_identity?.golden_bundle_digest) issues.push('golden digest no longer matches MC2/WP0');
  if (stored.provenance?.sidecar_package_digest !== mc3.digest || mc3.digest !== wp0.binary_identity?.sidecar_package_digest) issues.push('sidecar digest no longer matches MC3/WP0');

  const providerStatus = (() => {
    const result = spawnSync('git', ['-C', String(mc0.source?.repo), 'status', '--porcelain=v1', '--untracked-files=all'], { encoding: 'utf8', windowsHide: true });
    return result.status === 0 ? String(result.stdout ?? '').replace(/\r/g, '').trim() : null;
  })();
  if (providerStatus === null) issues.push('provider source repository is unavailable');
  if (providerStatus !== null && sha256(providerStatus) !== mc0.source?.status_porcelain_sha256) issues.push('provider working-tree status drifted from MC0');

  if (issues.length > 0) {
    for (const issue of issues) console.error(`[versegit-mc4] FAIL before execution: ${issue}`);
    process.exitCode = 1;
    return;
  }
  const live = await buildMc4Report({ root });
  issues.push(...validateMc4Report(live).issues.map((issue) => `live: ${issue}`));
  if (stored.digest !== live.digest) issues.push('stored report digest differs from the live adapter run');
  if (stored.status !== 'equivalent' || live.status !== 'equivalent') issues.push('both stored and live reports must be equivalent');
  if (stored.identity_preflight?.passed !== true) issues.push('stored identity preflight did not pass');

  const module = await loadAdapter({ root });
  const conformance = validateContractConformance(module, mc1);
  if (!conformance.ok) issues.push(...conformance.issues);
  const source = read(ADAPTER_MODULE_PATH);
  if (sha256(source) !== stored.adapter_source_digest) issues.push('adapter source digest drifted from the stored evidence');
  for (const marker of ['vg_kernel', 'vg_jj', 'vg_battery_', 'crate::', 'clawx://']) {
    if (source.includes(marker)) issues.push(`adapter source contains forbidden internal marker ${marker}`);
  }

  const identity = { repoId: 'repo-verifier', worktreeIds: ['worktree-verifier'], agentSessionIds: ['session-verifier'], vgSessionIds: ['vg-session-verifier'], epoch: 1 };
  const correlation = { runId: 'run-verifier', requestId: 'request-verifier', traceId: 'trace-verifier', epoch: 1 };
  const reportInput = (mode, status) => ({
    mode, component: 'mc4-verifier', trigger: { reason: 'verification' },
    repository: { repoId: identity.repoId }, identity, correlation,
    sessions: [{ agentSessionId: identity.agentSessionIds[0], vgSessionId: identity.vgSessionIds[0], worktreeId: identity.worktreeIds[0], epoch: 1 }],
    facts: { conflicts: [], warnings: [], unknowns: [] },
    coverage: { declared: ['capabilities'], unobserved: ['bash', 'network'] }, result: { status, reasons: status === 'partial' ? ['unknown'] : [] },
  });

  let unauthorizedRunCount = 0;
  const adapter = new module.VerseGitModule({
    binaryPath, contractDigest,
    expectedCapabilitiesDigest: wp0.binary_identity?.capabilities_digest,
    run: () => { unauthorizedRunCount += 1; return { stdout: '{}', stderr: '', code: 0 }; },
  });
  if (adapter.readVersion().status !== 'unavailable' || unauthorizedRunCount !== 0) issues.push('readVersion before attach must be unavailable without spawning');
  let noAttachReportRefused = false;
  try { adapter.buildReport(reportInput('M1', 'partial')); } catch { noAttachReportRefused = true; }
  if (!noAttachReportRefused) issues.push('a promoted report must be refused before attach');
  const m0 = adapter.attach('M0', { mode: 'M0', authorizationId: null });
  if (!m0.ok || m0.status !== 'not_applicable' || adapter.isAttached || unauthorizedRunCount !== 0) issues.push('M0 must not attach or spawn');
  if (adapter.attach('M3', { mode: 'M3', authorizationId: null }).status !== 'rejected_by_policy') issues.push('ungranted M3 promotion must be refused');
  if (adapter.attach('M2', { mode: 'M1', authorizationId: 'g' }).status !== 'rejected_by_policy') issues.push('mismatched grants must be refused');
  if (adapter.attach('M1', { mode: 'M1', authorizationId: 'g' }).status !== 'partial') issues.push('a granted M1 attach must succeed');

  const capabilityDocument = mc0.binary?.capability_document;
  const validAdapter = new module.VerseGitModule({
    binaryPath, contractDigest, expectedCapabilitiesDigest: wp0.binary_identity?.capabilities_digest,
    run: (argv) => ({ stdout: argv[0] === '--version' ? 'vg 0.1.0' : JSON.stringify(capabilityDocument), stderr: '', code: 0 }),
  });
  validAdapter.attach('M1', { mode: 'M1', authorizationId: 'g1' });
  if (validAdapter.readVersion().status !== 'observed' || validAdapter.readCapabilities().status !== 'observed') issues.push('valid identity seams must observe');
  const report = validAdapter.buildReport(reportInput('M1', 'partial'));
  if (!module.validateModuleReport(report).ok) issues.push('the adapter must emit a valid host-owned report');
  if (report.usage?.processes_started !== 2 || report.usage?.state_reads !== 1) issues.push('report usage must record two process calls and one state read');
  const overridden = validAdapter.buildReport({ ...reportInput('M1', 'partial'), digests: { contract: 'f'.repeat(64) } });
  if (overridden.digests?.contract !== contractDigest) issues.push('caller-provided digests must not override the contract digest');

  const reasonAsStatus = module.validateModuleReport({ ...report, result: { status: 'stale', reasons: [] } });
  if (reasonAsStatus.ok || !reasonAsStatus.issues.includes('reason label used as top-level status')) issues.push('a reason label must not be accepted as a top-level status');
  if (module.validateModuleReport({ ...report, admitted: true }).ok) issues.push('an admitted authority claim must be rejected');

  const validPlan = {
    schema: module.VG_COMMAND_PLAN_SCHEMA, runId: 'run-plan', candidateId: 'candidate-plan',
    owner: { agentId: 'agent-plan', sessionId: 'session-plan', worktreeId: 'worktree-plan' },
    commands: [{ argv: ['pnpm', 'test'], effect: 'execute', retry: 'never' }],
  };
  if (!module.validateCommandPlan(validPlan).ok) issues.push('a structured effectful plan with no replay must be accepted');
  const commandNegatives = [
    { ...validPlan, shell: 'pnpm test' },
    { ...validPlan, land: true },
    { ...validPlan, owner: '' },
    { ...validPlan, commands: [{ argv: ['C:\\Program Files\\Git\\cmd\\git.exe', 'push'], effect: 'execute', retry: 'never' }] },
    { ...validPlan, commands: [{ argv: ['powershell.exe', '-Command', 'Write-Host ok'], effect: 'execute', retry: 'never' }] },
    { ...validPlan, commands: [{ argv: ['pnpm', 'test'], effect: 'execute', retry: 'sometimes' }] },
    { ...validPlan, commands: [{ argv: ['pnpm', 'test'], effect: 'execute', retry: 'always' }] },
  ];
  for (const [index, plan] of commandNegatives.entries()) if (module.validateCommandPlan(plan).ok) issues.push(`command-plan negative ${index + 1} was accepted`);

  const capabilityNegatives = [
    'null',
    JSON.stringify({ ...capabilityDocument, verdict: { ...capabilityDocument.verdict, single_green_light: true } }),
    JSON.stringify({ ...capabilityDocument, safety: { ...capabilityDocument.safety, default_enable: true } }),
    JSON.stringify({ ...capabilityDocument, schema: 'versegit.capabilities/v999' }),
    JSON.stringify({ ...capabilityDocument, mcp_tools: [...(capabilityDocument.mcp_tools ?? []), 'unexpected_tool'] }),
  ];
  for (const [index, stdout] of capabilityNegatives.entries()) {
    const candidate = new module.VerseGitModule({
      binaryPath, contractDigest, expectedCapabilitiesDigest: wp0.binary_identity?.capabilities_digest,
      run: () => ({ stdout, stderr: '', code: 0 }),
    });
    candidate.attach('M1', { mode: 'M1', authorizationId: 'negative' });
    if (candidate.readCapabilities().status === 'observed') issues.push(`capability negative ${index + 1} was accepted`);
  }

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
  if (stored.differential?.full_document_compared !== true) issues.push('stored evidence did not compare full documents');
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