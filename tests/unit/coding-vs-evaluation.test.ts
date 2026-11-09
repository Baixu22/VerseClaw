import { createHash } from 'node:crypto';
import { execFileSync, spawn } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import { startGovernedVerseShellProcess, executeGovernedVerseShellProcessObserved } from '../../openclaw_runtime/src/agents/verseshell/governed-process';
import { VerseShellProcessManager } from '../../openclaw_runtime/src/agents/verseshell/process-manager';
import { createVerseGitCleanupBarrier } from '../../shared/versegit-cleanup-barrier';
import { cleanupBarrierEvidenceFromRecord, completeCandidateVerificationEvidence, FileVerseShellReceiptAuthority, prepareCandidateVerificationEvidence, VG_VERIFICATION_CLEANUP_SCHEMA, type CandidateInputManifest } from '../../electron/services/versegit-receipt-evidence';
import { VerseGitReceiptBridge, createVerificationPlan } from '../../electron/services/versegit-receipt-bridge';

const enabled = process.env.CODING_VS_EVALUATION === '1';
const commandCwd = process.cwd();
const outerCandidate = execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8', windowsHide: true }).trim();
const outerTree = execFileSync('git', ['rev-parse', 'HEAD^{tree}'], { encoding: 'utf8', windowsHide: true }).trim();
const output = process.env.CODING_VS_OUTPUT ? resolve(process.env.CODING_VS_OUTPUT) : null;
const root = 'D:/ClawX-work/coding-vg-sts-jj-20261104';
const aeBinary = join(root, 'resources/bin/win32-x64/ae.exe');
const vgBinary = join(root, 'resources/bin/win32-x64/vg.exe');
const stsSource = 'D:/tmp/coding-relay-01a1b68a-20261107/TF-0776/vg-import-fix';
const stsPython = join(stsSource, '.venv-sts/Scripts/python.exe');
const stsPackage = join(stsSource, 'extensions/sts/src');
const roots: string[] = [];
const commandRecords: Array<Record<string, unknown>> = [];
const sha = (value: string | Uint8Array) => createHash('sha256').update(value).digest('hex');
const stance = (value: unknown): string => value === null || typeof value === 'string' || typeof value === 'boolean'
  ? JSON.stringify(value)
  : typeof value === 'number' ? Number.isFinite(value) ? JSON.stringify(value) : 'null'
  : Array.isArray(value) ? `[${value.map(stance).join(',')}]`
  : value && typeof value === 'object' ? `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${stance((value as Record<string, unknown>)[key])}`).join(',')}}`
  : 'null';

function newManager() {
  return new VerseShellProcessManager({ resolveBinary: () => ({ path: aeBinary, source: 'verified-bundled', verified: true }), shutdownGraceMs: 2000 });
}
function pidAlive(pid: number): boolean {
  const text = execFileSync('tasklist.exe', ['/FI', `PID eq ${pid}`, '/FO', 'CSV', '/NH'], { encoding: 'utf8', windowsHide: true });
  return text.split(/\r?\n/u).some((line) => new RegExp(`(^|,")${pid}(,|")`, 'u').test(line.trim()));
}
function runtimeEnv() {
  return {
    VERSESHELL_RUNTIME_VERSION: '1.0.0',
    VERSESHELL_SERVER_PROTOCOL: 'verseshell.jsonl/v1',
    VERSESHELL_OPERATION_CATALOG_DIGEST: 'sha256:67f78a723d582bf0809aab1f94352772c8a2818367b2f5e9d931722c06e979e8',
    VERSESHELL_OPERATION_CATALOG_COUNT: '32',
    VERSESHELL_AE_SHA256: sha(readFileSync(aeBinary)),
    VERSESHELL_OS_SHELL: 'powershell',
  };
}
function childEnv(extra: Record<string, string> = {}): Record<string, string> {
  const env: Record<string, string> = {};
  for (const name of ['PATH', 'SystemRoot', 'ComSpec', 'PATHEXT', 'TEMP', 'TMP']) {
    const value = process.env[name];
    if (value) env[name] = value;
  }
  return { ...env, TEMP: 'D:/tmp', TMP: 'D:/tmp', ...extra };
}
function writeOutput(label: string, channel: 'stdout' | 'stderr', text: string): string {
  const relative = `outputs/${label}.${channel}.bin`;
  mkdirSync(join(output!, 'outputs'), { recursive: true });
  writeFileSync(join(output!, relative), text);
  return relative;
}
function recordCommand(input: { id: string; argv: string[]; cwd: string; exitCode: number | null; stdout: string; stderr: string; extra?: Record<string, unknown> }) {
  const record = {
    id: input.id, argv: input.argv, cwd: input.cwd, exitCode: input.exitCode, waitedForExit: true,
    stdoutArtifact: writeOutput(input.id, 'stdout', input.stdout), stderrArtifact: writeOutput(input.id, 'stderr', input.stderr),
    stdoutSha256: sha(input.stdout), stderrSha256: sha(input.stderr), ...(input.extra ?? {}),
  };
  commandRecords.push(record);
  return record;
}
async function runProcess(kind: 'exit' | 'cancel' | 'timeout', label = kind) {
  const workspace = mkdtempSync(join('D:/tmp', `tf0777-${kind}-`)); roots.push(workspace);
  const marker = join(workspace, 'child.pid');
  const script = join(workspace, 'probe.cjs');
  writeFileSync(script, kind === 'exit'
    ? "console.log('normal');\n"
    : "const fs=require('fs');const {spawn}=require('child_process');const c=spawn(process.execPath,['-e','setInterval(()=>{},1000)'],{stdio:'ignore'});fs.writeFileSync('child.pid',String(c.pid));setInterval(()=>{},1000);\n");
  const manager = newManager();
  let stdout = '';
  let stderr = '';
  const handle = await startGovernedVerseShellProcess({
    command: `${process.execPath} ${script}`, argv: [process.execPath, script], cwd: workspace,
    processEnv: childEnv(), timeoutMs: kind === 'timeout' ? 750 : 10000, maxOutputBytes: 65536, usePty: false,
    agentId: 'agent-tf0777', sessionId: `session-tf0777-${kind}`, hostPolicyApproved: true,
    runtimeEnv: runtimeEnv(), manager, onStdout: (chunk) => { stdout += chunk; }, onStderr: (chunk) => { stderr += chunk; },
    traceId: `tf0777-${kind}`,
  });
  if (kind !== 'exit') {
    const deadline = Date.now() + 10000;
    while (!existsSync(marker) && Date.now() < deadline) await new Promise((done) => setTimeout(done, 50));
    expect(existsSync(marker)).toBe(true);
  }
  const childPid = kind === 'exit' ? null : Number(readFileSync(marker, 'utf8'));
  if (kind === 'cancel') await handle.kill('agent_abort');
  const exit = await handle.wait();
  await manager.shutdownAll();
  recordCommand({ id: `process-${label}-authority`, argv: [process.execPath, script], cwd: workspace, exitCode: exit.exitCode, stdout, stderr, extra: { aePid: handle.pid, childPid, state: exit.state, timedOut: exit.timedOut, terminationReason: exit.terminationReason ?? null } });
  return { kind, aePid: handle.pid, childPid, exit, aeAlive: pidAlive(handle.pid), childAlive: childPid === null ? null : pidAlive(childPid) };
}
async function restartBoundary() {
  const first = await runProcess('cancel', 'restart-before');
  const manager = newManager();
  const workspace = mkdtempSync(join('D:/tmp', 'tf0777-restart-')); roots.push(workspace);
  const script = join(workspace, 'after-restart.cjs'); writeFileSync(script, "console.log('restart-ok');\n");
  let stdout = ''; let stderr = '';
  const handle = await startGovernedVerseShellProcess({ command: `${process.execPath} ${script}`, argv: [process.execPath, script], cwd: workspace, processEnv: childEnv(), timeoutMs: 10000, maxOutputBytes: 65536, usePty: false, agentId: 'agent-tf0777', sessionId: 'session-tf0777-restart-after', hostPolicyApproved: true, runtimeEnv: runtimeEnv(), manager, onStdout: (c) => { stdout += c; }, onStderr: (c) => { stderr += c; }, traceId: 'tf0777-restart-after' });
  const exit = await handle.wait(); await manager.shutdownAll();
  recordCommand({ id: 'process-restart-after-success', argv: [process.execPath, script], cwd: workspace, exitCode: exit.exitCode, stdout, stderr, extra: { aePid: handle.pid } });
  return { firstAePid: first.aePid, firstChildPid: first.childPid, firstExit: first.exit, firstDead: !first.aeAlive && !first.childAlive, afterAePid: handle.pid, afterExit: exit, afterStdout: stdout, afterDead: !pidAlive(handle.pid) };
}
async function crossTaskCancellation() {
  const runOne = async (id: string) => {
    const workspace = mkdtempSync(join('D:/tmp', `tf0777-${id}-`)); roots.push(workspace);
    const marker = join(workspace, 'child.pid'); const script = join(workspace, 'probe.cjs');
    writeFileSync(script, "const fs=require('fs');const {spawn}=require('child_process');const c=spawn(process.execPath,['-e','setInterval(()=>{},1000)'],{stdio:'ignore'});fs.writeFileSync('child.pid',String(c.pid));setInterval(()=>{},1000);\n");
    const manager = newManager(); let stdout = ''; let stderr = '';
    const handle = await startGovernedVerseShellProcess({ command: `${process.execPath} ${script}`, argv: [process.execPath, script], cwd: workspace, processEnv: childEnv(), timeoutMs: 15000, maxOutputBytes: 65536, usePty: false, agentId: 'agent-tf0777', sessionId: `session-${id}`, hostPolicyApproved: true, runtimeEnv: runtimeEnv(), manager, onStdout: (c) => { stdout += c; }, onStderr: (c) => { stderr += c; }, traceId: id });
    const deadline = Date.now() + 10000; while (!existsSync(marker) && Date.now() < deadline) await new Promise((done) => setTimeout(done, 50));
    expect(existsSync(marker)).toBe(true); return { id, manager, handle, workspace, script, childPid: Number(readFileSync(marker, 'utf8')), stdout, stderr };
  };
  const left = await runOne('cross-left'); const right = await runOne('cross-right');
  await left.handle.kill('agent_abort'); const leftExit = await left.handle.wait(); await left.manager.shutdownAll();
  const rightStillAlive = pidAlive(right.handle.pid) && pidAlive(right.childPid);
  await right.handle.kill('agent_abort'); const rightExit = await right.handle.wait(); await right.manager.shutdownAll();
  recordCommand({ id: 'cross-left', argv: [process.execPath, left.script], cwd: left.workspace, exitCode: leftExit.exitCode, stdout: left.stdout, stderr: left.stderr, extra: { aePid: left.handle.pid, childPid: left.childPid } });
  recordCommand({ id: 'cross-right', argv: [process.execPath, right.script], cwd: right.workspace, exitCode: rightExit.exitCode, stdout: right.stdout, stderr: right.stderr, extra: { aePid: right.handle.pid, childPid: right.childPid } });
  return { leftAePid: left.handle.pid, leftChildPid: left.childPid, rightAePid: right.handle.pid, rightChildPid: right.childPid, rightStillAlive, leftDead: !pidAlive(left.handle.pid) && !pidAlive(left.childPid), rightDead: !pidAlive(right.handle.pid) && !pidAlive(right.childPid) };
}
async function unknownPidSentinel() {
  const sentinel = spawn(process.execPath, ['-e', 'setInterval(()=>{},1000)'], { stdio: 'ignore', windowsHide: true });
  await new Promise((done) => setTimeout(done, 150));
  const manager = newManager(); const workspace = mkdtempSync(join('D:/tmp','tf0777-sentinel-')); roots.push(workspace);
  const script = join(workspace,'probe.cjs'); writeFileSync(script, "console.log('managed');\n"); let stdout = ''; let stderr = '';
  const handle = await startGovernedVerseShellProcess({ command: `${process.execPath} ${script}`, argv: [process.execPath, script], cwd: workspace, processEnv: childEnv(), timeoutMs: 10000, maxOutputBytes: 65536, usePty: false, agentId: 'agent-tf0777', sessionId: 'session-sentinel', hostPolicyApproved: true, runtimeEnv: runtimeEnv(), manager, onStdout: (c) => { stdout += c; }, onStderr: (c) => { stderr += c; }, traceId: 'tf0777-sentinel' });
  const exit = await handle.wait(); await manager.shutdownAll(); const sentinelPid = sentinel.pid!; const unknownPreserved = pidAlive(sentinelPid); sentinel.kill('SIGKILL');
  recordCommand({ id: 'unknown-pid-control', argv: [process.execPath, script], cwd: workspace, exitCode: exit.exitCode, stdout, stderr, extra: { aePid: handle.pid, unknownPid: sentinelPid } });
  return { unknownPid: sentinelPid, unknownPreserved, managedPid: handle.pid, managedDead: !pidAlive(handle.pid) };
}
function initStsRepo(): { repo: string; commit: string; tree: string; refs: string } {
  const repo = mkdtempSync(join('D:/tmp', 'tf0777-sts-')); roots.push(repo);
  mkdirSync(join(repo, 'src'), { recursive: true }); mkdirSync(join(repo, 'tests'), { recursive: true });
  writeFileSync(join(repo, 'src/calc.py'), 'def add(a,b):\n    return a+b\n');
  writeFileSync(join(repo, 'tests/test_add.py'), 'from src.calc import add\n\ndef test_add():\n    assert add(2,3)==5\n');
  writeFileSync(join(repo, 'pyproject.toml'), '[tool.pytest.ini_options]\npythonpath=["."]\n');
  for (const args of [['init','--initial-branch=main'],['config','user.name','Agent'],['config','user.email','agent@example.invalid'],['add','.'],['commit','-m','base']]) execFileSync('git', args, { cwd: repo, encoding: 'utf8', windowsHide: true });
  return { repo, commit: execFileSync('git',['rev-parse','HEAD'],{cwd:repo,encoding:'utf8',windowsHide:true}).trim(), tree: execFileSync('git',['rev-parse','HEAD^{tree}'],{cwd:repo,encoding:'utf8',windowsHide:true}).trim(), refs: execFileSync('git',['for-each-ref','--format=%(refname) %(objectname)'],{cwd:repo,encoding:'utf8',windowsHide:true}).trim() };
}
function cleanupFor(input: { output: string; runId: string; repository: { commit: string; refs: string }; processPid: number; managerKey: string; tempRepo: string }) {
  const barrierRoot = join(input.output, 'cleanup-barrier', input.runId); mkdirSync(barrierRoot, { recursive: true }); const barrier = createVerseGitCleanupBarrier(barrierRoot);
  const identity = { ownerId: 'tf0777', epoch: 1, authorizationId: 'tf0777-auth', baseOid: input.repository.commit, refsDigest: 'sha256:' + sha(input.repository.refs) };
  const sealed = barrier.seal({ runId: input.runId, sessionId: 'tf0777-sts', bindingId: 'tf0777', actor: 'codex-01a1b68a', expected: identity, current: identity, references: [], evidenceDigests: ['sha256:' + sha(input.runId + input.processPid)], inventoryBefore: { observed: true, processes: 1, managers: 1, worktrees: 0, tempRoots: 1, survivors: [] }, resources: [{ kind: 'process', id: String(input.processPid), owned: true, preserve: false }, { kind:'manager', id: input.managerKey, owned:true, preserve:false }, { kind:'temp', id: input.tempRepo, owned:true, preserve:false }], deletedKinds: ['process','manager','temp'], stopAccepting: true, drain: { ok: true, issues: [] } });
  if (!sealed.record) throw new Error(sealed.issues.join(',')); barrier.markDetached({ runId: input.runId, sealId: sealed.sealId!, current: identity, vgDetached: true }); const completed = barrier.complete({ runId: input.runId, sealId: sealed.sealId!, inventoryAfter: { observed:true, processes:0, managers:0, worktrees:0, tempRoots:0, survivors:[] } }); if (!completed.record) throw new Error(completed.issues.join(','));
  return { barrierRoot, cleanup: { schema: VG_VERIFICATION_CLEANUP_SCHEMA, status:'clean', processesDeleted:true, processSurvivors:0, survivorPids:[], managerProcessSurvivors:0, managedAfterShutdown:[], worktreesDeleted:0, worktreeSurvivors:0, candidateWorktreeSurvivors:0, verificationRootRemoved:true, baseRootPreserved:true, tempRootRemoved:true, hostWorktreesDeleted:0, deletionErrors:[], processInventory:{ baselinePids:[], duringPids:[input.processPid], afterPids:[], newProcessPids:[input.processPid], managedPids:[input.processPid], managedAfterShutdown:[], survivorPids:[], ownedPidChecks:[{ok:true,pid:input.processPid,exists:false}] }, cleanupBarrier: cleanupBarrierEvidenceFromRecord(completed.record) } };
}
async function livePlan(input: { runId: string; argv: string[]; repo: ReturnType<typeof initStsRepo>; checkId: string }) {
  const manifest: CandidateInputManifest = { schema:'clawx.versegit.candidate-input/v2', sourceCandidateId: outerCandidate, baseOid: input.repo.commit, candidateCommitOid: input.repo.commit, candidateTreeOid: input.repo.tree, verificationCwdRole:'host-disposable-candidate', allowedRuntimeIgnorePaths:[], files:[{path:'src/calc.py',sha256:sha(readFileSync(join(input.repo.repo,'src/calc.py'))),bytes:readFileSync(join(input.repo.repo,'src/calc.py')).length},{path:'tests/test_add.py',sha256:sha(readFileSync(join(input.repo.repo,'tests/test_add.py'))),bytes:readFileSync(join(input.repo.repo,'tests/test_add.py')).length}], inputDigest:sha('candidate-input:'+outerCandidate) };
  const candidateId = sha(stance(manifest)); const authorization = { schema:'clawx.versegit.verification-authorization/v1' as const, authorizationId:'tf0777-auth', runId:input.runId, ownerId:'tf0777', candidateId, checkId:input.checkId, epoch:1, requiredScope:'full' as const, status:'active' as const, issuedAt:new Date(Date.now()-1000).toISOString(), expiresAt:new Date(Date.now()+3600000).toISOString() };
  const plan = createVerificationPlan({ runId:input.runId, candidateId, candidateInputDigest:manifest.inputDigest, checkId:input.checkId, owner:'tf0777', epoch:1, authorizationId:'tf0777-auth', authorizationDigest:sha(stance(authorization)+'\n'), evidenceVersion:2, deadlineAt:Date.now()+60000, requiredChecks:[input.checkId], commands:[{argv:input.argv,cwd:'.',env:{PYTHONPATH:stsPackage},effect:'execute',retry:'never',expectedArtifacts:['stdout','stderr','exit'],timeoutMs:30000,maxOutputBytes:65536}], requiredScope:'full' }).plan!;
  const authority = new FileVerseShellReceiptAuthority(join(output!, 'authority')); if (!existsSync(authority.root)) authority.reset(); const bridge = new VerseGitReceiptBridge(authority); const prepared = prepareCandidateVerificationEvidence({ authority, bridge, plan, authorization, candidateManifest: manifest });
  const manager = newManager(); const execution = await executeGovernedVerseShellProcessObserved({ command:input.argv.join(' '), argv:input.argv, cwd:input.repo.repo, processEnv:childEnv({PYTHONPATH:stsPackage}), timeoutMs:30000, deadlineAt:plan.deadlineAt, maxOutputBytes:65536, usePty:false, agentId:'agent-tf0777', sessionId:'session-'+input.runId, hostPolicyApproved:true, runtimeEnv:runtimeEnv(), manager, traceId:input.runId });
  await manager.shutdownAll(); const cleanup = cleanupFor({ output:output!, runId:input.runId, repository:{commit:input.repo.commit,refs:input.repo.refs}, processPid:execution.processPid, managerKey:execution.managerKey, tempRepo:input.repo.repo });
  const completed = completeCandidateVerificationEvidence({ authority, bridge, prepared, execution:{observation:execution.observation,stdout:execution.stdout,stderr:execution.stderr,processKey:execution.processKey,processPid:execution.processPid,managerKey:execution.managerKey,approvalRequired:execution.approvalRequired,approvedByHost:execution.approvedByHost}, cleanup:cleanup.cleanup, cleanupBarrierRoot:cleanup.barrierRoot, receiptId:'receipt-'+input.runId });
  recordCommand({id:input.runId,argv:input.argv,cwd:input.repo.repo,exitCode:execution.exitCode,stdout:execution.stdout,stderr:execution.stderr,extra:{processPid:execution.processPid,observationId:execution.observation.id,receiptStatus:completed.receiptResult.status,verdict:completed.verdict.status}});
  return { authority, bridge, plan, execution, completed, cleanup:cleanup.cleanup, candidateManifest: manifest };
}
describe.runIf(enabled)('TF-0777 VerseShell coding evaluation', () => {
  afterAll(async () => { for (const path of roots.splice(0)) rmSync(path, { recursive: true, force: true, maxRetries: 8, retryDelay: 50 }); });
  it('binds real VG/STS execution, rejects forged observations and proves owned cleanup', async () => {
    if (!output || existsSync(output)) throw new Error('CODING_VS_OUTPUT must name a new directory'); mkdirSync(output, { recursive: true });
    const processes = [await runProcess('exit'), await runProcess('cancel'), await runProcess('timeout')];
    const restart = await restartBoundary();
    const crossTask = await crossTaskCancellation();
    const sentinel = await unknownPidSentinel();
    const repo = initStsRepo();
    const passed = await livePlan({ runId:'tf0777-sts-pass', argv:[stsPython,'-m','pytest','-q'], repo, checkId:'tests/test_add.py::test_add' });
    const failed = await livePlan({ runId:'tf0777-sts-fail', argv:[stsPython,'-c','raise SystemExit(7)'], repo, checkId:'intentional-fail' });
    const storedReceipt = structuredClone(passed.completed.receipt);
    const wrongCandidate = passed.bridge.receive(passed.plan.runId, { ...storedReceipt, receiptId:'wrong-candidate', candidateId:'old-candidate' });
    const wrongDigest = passed.bridge.receive(passed.plan.runId, { ...storedReceipt, receiptId:'wrong-digest', observationDigest:'f'.repeat(64) });
    const noAuthority = new VerseGitReceiptBridge(); noAuthority.registerPlan(passed.plan); const forgedLive = noAuthority.receive(passed.plan.runId, { ...storedReceipt, receiptId:'forged-live' });
    const failedReceipt = failed.completed.receipt; const fakeExitZero = failed.authority.verifyReceipt({ plan:failed.plan, receipt:{...failedReceipt, exitCode:0} });
    const artifactRelative = 'artifacts/'+passed.completed.observationRef.observationDigest; const artifactAbsolute = join(passed.authority.root, artifactRelative); const originalArtifact = readFileSync(artifactAbsolute); writeFileSync(artifactAbsolute, Buffer.concat([originalArtifact, Buffer.from('tamper')])); const artifactMismatch = passed.authority.verifyReceipt({ plan:passed.plan, receipt:passed.completed.receipt }); writeFileSync(artifactAbsolute, originalArtifact);
    const lateDuplicate = passed.bridge.receive(passed.plan.runId, passed.completed.receipt); const verdictAfterLate = passed.bridge.verdict(passed.plan.runId);
    const authorityManifest = passed.authority.manifest();
    mkdirSync(join(output, 'receipt'), { recursive: true });
    const retainedReceiptPath = join(output, 'receipt', 'receipt.json');
    const retainedReceiptBytes = readFileSync(join(passed.authority.root, passed.completed.receiptRef.path));
    writeFileSync(retainedReceiptPath, retainedReceiptBytes);
    const nativeMarker = join(output, 'native-fallback-marker.txt');
    const missingBinaryManager = new VerseShellProcessManager({ resolveBinary: () => ({ path: join(root, 'resources/bin/win32-x64/missing-ae.exe'), source: 'verified-bundled', verified: true }), shutdownGraceMs: 2000 });
    let nativeFallbackRejected = false;
    try {
      await executeGovernedVerseShellProcessObserved({ command:`node -e "require('fs').writeFileSync('native-fallback-marker.txt','ran')"`, cwd:output, processEnv:childEnv(), timeoutMs:5000, maxOutputBytes:65536, usePty:false, agentId:'agent-tf0777', sessionId:'session-native-fallback', hostPolicyApproved:true, runtimeEnv:runtimeEnv(), manager:missingBinaryManager, traceId:'tf0777-native-fallback' });
    } catch (error) {
      nativeFallbackRejected = Boolean(error);
    }
    await missingBinaryManager.shutdownAll();
    const nativeMarkerAbsent = !existsSync(nativeMarker);
    const cases = [
      ['process-normal', processes[0].exit.state==='exited' && processes[0].exit.exitCode===0 && !processes[0].aeAlive],
      ['process-timeout', processes[2].exit.timedOut===true && processes[2].exit.terminationReason==='timeout' && !processes[2].aeAlive && !processes[2].childAlive],
      ['process-cancel', processes[1].exit.terminationReason==='agent_abort' && !processes[1].aeAlive && !processes[1].childAlive],
      ['gateway-restart-boundary', restart.firstDead && restart.afterExit.exitCode===0 && restart.afterDead],
      ['cross-task-cancel-isolated', crossTask.rightStillAlive && crossTask.leftDead && crossTask.rightDead],
      ['unknown-pid-preserved', sentinel.unknownPreserved && sentinel.managedDead],
      ['sts-pytest-exit0', passed.execution.exitCode===0 && passed.execution.stdout.includes('1 passed')],
      ['sts-failed-exit7', failed.execution.exitCode===7],
      ['live-receipt-accepted', passed.completed.receiptResult.status==='accepted' && passed.completed.verdict.status==='observed' && passed.completed.receipt.realVerseshell===true],
      ['cleanup-zero', passed.cleanup.processSurvivors===0 && passed.cleanup.managerProcessSurvivors===0],
      ['negative-old-candidate', wrongCandidate.status==='rejected_by_policy'],
      ['negative-observation-digest', wrongDigest.status==='rejected_by_policy'],
      ['negative-forged-live-without-authority', forgedLive.status==='rejected_by_policy' && forgedLive.reason==='host_evidence_authority_missing'],
      ['negative-fake-exit0', fakeExitZero.ok===false],
      ['negative-artifact-summary', artifactMismatch.ok===false],
      ['negative-late-frame', lateDuplicate.status==='duplicate' && verdictAfterLate.status==='observed' && verdictAfterLate.receiptId===passed.completed.receiptId],
      ['negative-no-native-fallback', nativeFallbackRejected && nativeMarkerAbsent && passed.execution.observation.op==='process.start'],
    ].map(([id, passedValue]) => ({ id, passed: Boolean(passedValue) }));
    const sourceDirty=execFileSync('git',['status','--porcelain=v1','--untracked-files=all'],{encoding:'utf8',windowsHide:true}).trim().length>0;
    const report = { schema:'CodingVsExecution/v1', driven_by:'agent', actor:'codex-01a1b68a', realHumanEvidence:false, candidate:outerCandidate, sources:{clawx:{commit:outerCandidate,tree:outerTree,dirty:sourceDirty,inputs:{'tests/unit/coding-vs-evaluation.test.ts':sha(readFileSync(join(commandCwd,'tests/unit/coding-vs-evaluation.test.ts'))), 'harness/specs/tasks/coding-vs-execution-evaluation.md':sha(readFileSync(join(commandCwd,'harness/specs/tasks/coding-vs-execution-evaluation.md'))), 'scripts/coding-evaluation/verify-vs.py':sha(readFileSync(join(commandCwd,'scripts/coding-evaluation/verify-vs.py'))), 'scripts/coding-evaluation/test_vs_evidence.py':sha(readFileSync(join(commandCwd,'scripts/coding-evaluation/test_vs_evidence.py')))}}, sts:{commit:'d9c38a8659274c24ea776b56480a260831b4537f',tree:'0d2d50c1175dca6d245d77fe53416771737f5791',interpreterSha256:sha(readFileSync(stsPython)),packageRoot:stsPackage,moduleSha256:sha(readFileSync(join(stsPackage,'smart_sorter/__init__.py')))}}, binaries:{verseshell:{path:'resources/bin/win32-x64/ae.exe',sha256:sha(readFileSync(aeBinary)),bytes:readFileSync(aeBinary).length},vg:{path:'resources/bin/win32-x64/vg.exe',sha256:sha(readFileSync(vgBinary)),bytes:readFileSync(vgBinary).length}}, fixtures:{stsRepository:{commit:repo.commit,tree:repo.tree,refsDigest:sha(repo.refs)}}, processes, restart, crossTask, sentinel, cases, commands:commandRecords, receipt:{receiptId:passed.completed.receiptId,digest:sha(stance(passed.completed.receipt)),planDigest:passed.plan.planDigest,observationDigest:passed.completed.receipt.observationDigest,cleanupDigest:passed.completed.receipt.cleanupEvidenceDigest,artifactDigests:passed.completed.receipt.artifactDigests,authorityManifest:{path:authorityManifest.path,digest:authorityManifest.digest,aggregateDigest:authorityManifest.aggregateDigest},receiptFile:'receipt/receipt.json',receiptFileSha256:sha(retainedReceiptBytes),receiptFileDigest:sha(stance(JSON.parse(retainedReceiptBytes.toString())))}, failedReceipt:{receiptId:failed.completed.receiptId,exitCode:failed.completed.receipt.exitCode,digest:sha(stance(failed.completed.receipt))}, cleanup:passed.cleanup, remaining:[], finishedAt:new Date().toISOString() };
    const canonical=JSON.stringify(report); const reportDigest=sha(canonical); const reportText=JSON.stringify(report,null,2)+'\n'; writeFileSync(join(output,'report.json'),reportText); writeFileSync(join(output,'report-binding.json'),JSON.stringify({candidate:outerCandidate,reportDigest,reportFileSha256:sha(reportText)},null,2)+'\n');
    expect(cases.every((entry)=>entry.passed)).toBe(true);
    expect(report.commands.every((entry:any)=>entry.waitedForExit===true)).toBe(true);
  }, 180000);
});
