import { strict as assert } from 'node:assert';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdirSync, mkdtempSync, readFileSync, renameSync, unlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  VerseGitFactAdapter, type VerseGitFactGrant, type VerseGitFactIdentity, type VerseGitFactMode,
} from '../../electron/services/versegit-fact-adapter';
import { contractDigestOf } from '../../electron/services/versegit-module';
import { VerseGitObservationBridge, type ObservationBinding } from '../../electron/services/versegit-observation';
import { resolveVerseGitRepoIdentity } from '../../electron/gateway/versegit-bridge';
import { createReadToolDefinition } from '../../openclaw_runtime/src/agents/sessions/tools/read';
import { createWriteToolDefinition } from '../../openclaw_runtime/src/agents/sessions/tools/write';
import type { ExtensionContext } from '../../openclaw_runtime/src/agents/sessions/extensions/types';
import { deriveVerseGitToolObservationRequest } from '../../openclaw_runtime/src/agents/harness/versegit-tool-observation';
import type { VerseGitBindingRecord } from '../../shared/versegit-runtime-contract';
import { verifyVerseGitEvaluation } from './verify-versegit.mjs';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const output = process.env.CODING_VG_EVALUATION_OUT;
if (!output) throw new Error('CODING_VG_EVALUATION_OUT is required');
const out = resolve(output);
mkdirSync(out, { recursive: true });
const workspace = mkdtempSync(join(tmpdir(), 'coding-vg-evaluation-'));
const binary = join(root, 'resources/bin/win32-x64/vg.exe');
const manifest = JSON.parse(readFileSync(join(root, 'resources/versegit/manifest.json'), 'utf8'));
const hash = (data: string | Uint8Array) => createHash('sha256').update(data).digest('hex');
const commands: Array<{ id: string; argv: string[]; cwd: string; exitCode: number; stdout: string; outputSha256: string }> = [];
const cases: Array<{ id: string; passed: boolean; actual: unknown }> = [];
const command = (id: string, executable: string, args: string[], cwd = workspace) => {
  let stdout = ''; let exitCode = 0;
  try { stdout = execFileSync(executable, args, { cwd, encoding: 'utf8', windowsHide: true, timeout: 30_000, maxBuffer: 8 * 1024 * 1024 }); }
  catch (error) { const failure = error as { status?: number; stdout?: string }; stdout = String(failure.stdout ?? ''); exitCode = failure.status ?? -1; }
  commands.push({ id, argv: [executable, ...args], cwd, exitCode, stdout, outputSha256: hash(stdout) });
  return { exitCode, stdout };
};
function record(id: string, actual: unknown, passed: boolean) {
  cases.push({ id, actual, passed });
  writeFileSync(join(out, 'development-cases.json'), JSON.stringify({ cases, commands }, null, 2));
  assert(passed, id);
}
for (const args of [['init', '--initial-branch=main'], ['config', 'user.name', 'Coding evaluation'], ['config', 'user.email', 'fixture@example.invalid']]) {
  assert.equal(command(`git-${args[0]}`, 'git', args).exitCode, 0);
}
mkdirSync(join(workspace, 'src'));
const baseline = 'export const api = (value: string) => value;\n';
writeFileSync(join(workspace, 'src/api.ts'), baseline);
writeFileSync(join(workspace, 'src/consumer.ts'), "import { api } from './api'; export const result = api('one');\n");
assert.equal(command('git-add', 'git', ['add', '.']).exitCode, 0);
assert.equal(command('git-commit', 'git', ['commit', '-m', 'fixture']).exitCode, 0);
const version = command('version', binary, ['--version']);
const capabilities = command('capabilities', binary, ['capabilities', '--json']);
assert.equal(version.exitCode, 0); assert.equal(capabilities.exitCode, 0);
assert.equal(hash(readFileSync(binary)), manifest.artifact.sha256);
assert.equal(hash(capabilities.stdout), manifest.provider.capabilitiesSha256);
const identity = resolveVerseGitRepoIdentity(workspace);
assert.equal(command('workspace-init', binary, ['init', '--json']).exitCode, 0);
const session = command('session-start', binary, ['session', 'start', '--actor', 'agent:codex', '--worktree', workspace, '--client', 'codex-cli', '--json']);
assert.equal(session.exitCode, 0);
const sessionData = JSON.parse(session.stdout);
const vgSessionId = sessionData.session_id ?? sessionData.sessionId ?? sessionData.id;
assert.equal(typeof vgSessionId, 'string');
const factIdentity: VerseGitFactIdentity = { repoId: identity.repoId, worktreeId: identity.worktreeId,
  ownerId: 'agent:codex', epoch: 5, sessionId: 'coding-vg-session', vgSessionId };
const trigger = { enabled: true, reason: 'coding-evaluation-two-sessions', worktreeCount: 1, activeSessionCount: 2 };
const contract = JSON.parse(readFileSync(join(root, 'harness/specs/fixtures/versegit-planning-correction/mc1-evidence/contract.json'), 'utf8'));
const adapter = (expectedBinarySha256 = manifest.artifact.sha256) => new VerseGitFactAdapter({ binaryPath: binary,
  workspacePath: workspace, expectedBinarySha256, expectedVersion: version.stdout.trim(), expectedCapabilitiesDigest: hash(capabilities.stdout), contractDigest: contractDigestOf(contract) });
const grant = (mode: VerseGitFactMode, patch: Partial<VerseGitFactGrant> = {}): VerseGitFactGrant => ({ mode,
  authorizationId: 'fixture-grant', ownerId: factIdentity.ownerId, epoch: factIdentity.epoch, repoId: identity.repoId,
  worktreeId: identity.worktreeId, capabilityDigest: hash(capabilities.stdout), expiresAt: '2099-01-01T00:00:00Z', revoked: false, ...patch });
const facts = adapter();
const m0 = await facts.execute('version', factIdentity, grant('M0'), { ...trigger, enabled: false });
record('m0-inert', m0, !m0.observation.process_started);
const m1 = await facts.execute('capabilities', factIdentity, grant('M1'), trigger);
record('m1-capabilities', m1, m1.status === 'observed' && !m1.observation.effects.domainStateWrite);
for (const mode of ['M2','M3'] as const) {
  const result = await facts.execute('observeRead', factIdentity, grant(mode), trigger, { path: 'src/api.ts', vgSessionId, lineStart: 1, lineEnd: 1 });
  record(mode === 'M2' ? 'm2-read' : 'm3-bounded-read', result, result.status === 'observed' && !result.observation.effects.workspaceWrite && !result.observation.effects.execute);
}
for (const [id, g, a] of [
  ['owner-rejected', grant('M1', { ownerId: 'foreign' }), facts],
  ['epoch-rejected', grant('M1', { epoch: 4 }), facts],
  ['binary-rejected', grant('M1'), adapter('0'.repeat(64))],
  ['m4-rejected', { ...grant('M3'), mode: 'M4' } as unknown as VerseGitFactGrant, facts],
] as const) {
  const result = await a.execute('version', factIdentity, g, trigger);
  record(id, result, result.status === 'rejected_by_policy' && !result.observation.process_started);
}
const green = { candidate: { identity: 'fixture-candidate', current_identity: 'fixture-candidate' },
  execution: { scope: 'full', validity: 'valid', completeness: 'complete', result: 'passed' },
  evidence: { observed: true, source: 'current', candidate_identity: 'fixture-candidate' }, freshness: { observed: true, state: 'fresh' },
  risk: { conflicts: 0, unresolved_risks: [] }, trial: { recommendation: 'keep-selection-disabled', default_enabled: false, approved: false } };
for (const id of ['six-dimensions', 'selected-rejected', 'stale-rejected', 'candidate-rejected']) {
  const input = structuredClone(green);
  if (id === 'selected-rejected') input.execution.scope = 'selected';
  if (id === 'stale-rejected') input.freshness.state = 'stale';
  if (id === 'candidate-rejected') input.candidate.current_identity = 'other';
  const file = join(out, `${id}-facts.json`); writeFileSync(file, JSON.stringify(input));
  const result = command(id, binary, ['verdict', '--facts', file, '--json']); assert.equal(result.exitCode, 0);
  const actual = JSON.parse(result.stdout);
  record(id, actual, actual.single_green_light === false && Object.keys(actual.dimensions).length === 6 && actual.admitted === (id === 'six-dimensions'));
}

const bridge = new VerseGitObservationBridge();
const binding = (runId: string): ObservationBinding => ({ runId, sessionKey: `session-${runId}`, traceId: `trace-${runId}`,
  requestId: `request-${runId}`, repoId: identity.repoId, worktreeId: identity.worktreeId, agentSessionId: runId,
  vgSessionId: runId, ownerId: 'agent:codex', actor: 'agent:codex', epoch: 5, bindingId: runId, worktreePath: workspace });
const reader = binding('reader'); const writer = binding('writer'); bridge.bind(reader); bridge.bind(writer);
const bindingRecord = (value: ObservationBinding): VerseGitBindingRecord => ({ schema: 'clawx.versegit.runtime-binding/v1',
  ...value, bindingId: value.bindingId!, authorizationId: value.bindingId!, worktreePath: workspace, requestId: value.requestId!,
  baseOid: identity.baseOid, refsDigest: identity.refsDigest, mode: 'M1', phase: 'attached', createdAt: new Date().toISOString(),
  childSessionKey: value.sessionKey!, childRunId: value.runId });
const read = await createReadToolDefinition(workspace).execute('read-api', { path: 'src/api.ts' }, undefined, undefined, {} as ExtensionContext);
const readRequest = deriveVerseGitToolObservationRequest({ cwd: workspace, binding: bindingRecord(reader),
  event: { cwd: workspace, toolCallId: 'read-api', toolName: 'read', args: { path: 'src/api.ts' }, result: read, isError: false } });
assert.equal(bridge.ingestToolObservation(readRequest, { epoch: 5, ownerId: 'agent:codex' }).status, 'observed');
await new Promise((resolve) => setTimeout(resolve, 5));
const write = await createWriteToolDefinition(workspace).execute('write-api', { path: 'src/api.ts', content: 'export const api = () => 1;\n' }, undefined, undefined, {} as ExtensionContext);
const writeRequest = deriveVerseGitToolObservationRequest({ cwd: workspace, binding: bindingRecord(writer),
  event: { cwd: workspace, toolCallId: 'write-api', toolName: 'write', args: { path: 'src/api.ts' }, result: write, isError: false } });
assert.equal(bridge.ingestToolObservation(writeRequest, { epoch: 5, ownerId: 'agent:codex' }).status, 'observed');
record('observed-write-risk', bridge.staleReadFindings(), bridge.staleReadFindings().length === 1);
const missing = bridge.ingestToolObservation({ ...writeRequest, toolCallId: 'missing-basis', basis: undefined }, { epoch: 5, ownerId: 'agent:codex' });
record('missing-basis-partial', missing, missing.status === 'partial');
renameSync(join(workspace, 'src/api.ts'), join(workspace, 'src/api-renamed.ts'));
record('rename-unobserved', bridge.snapshot(reader.runId), bridge.snapshot(reader.runId)?.values.directFs === 'unobserved');
unlinkSync(join(workspace, 'src/api-renamed.ts'));
record('delete-unobserved', bridge.snapshot(writer.runId), bridge.snapshot(writer.runId)?.values.directFs === 'unobserved');
const events = facts.observations;
const report = { schema: 'CodingVgEvaluation/v1', driven_by: 'agent', actor: 'codex-01a1b68a', realHumanEvidence: false,
  candidate: execFileSync('git', ['rev-parse','HEAD'], { cwd: root, encoding: 'utf8' }).trim(),
  binary: { sha256: hash(readFileSync(binary)), version: version.stdout.trim(), capabilitiesSha256: hash(capabilities.stdout) },
  manifest: { binarySha256: manifest.artifact.sha256, capabilitiesSha256: manifest.provider.capabilitiesSha256, sourceCommit: manifest.source.commit },
  cases, commands, observations: events, workspace,
  scope: { verdictInputs: 'deterministic six-dimension mechanism fixtures', unobserved: ['bash','direct-fs','other-mcp','network'], hostVerdict: 'unchanged', m4Authorized: false },
  cleanup: { ownedProcessSurvivors: events.filter((event) => event.pid_alive_after).length, hostWorktreesDeleted: 0 },
};
const verdict = verifyVerseGitEvaluation(report, { binarySha256: manifest.artifact.sha256,
  capabilitiesSha256: manifest.provider.capabilitiesSha256, sourceCommit: manifest.source.commit });
writeFileSync(join(out, 'report.json'), JSON.stringify(report, null, 2));
writeFileSync(join(out, 'verification.json'), JSON.stringify(verdict, null, 2));
assert(verdict.ok, verdict.issues.join('; '));
console.log(JSON.stringify({ output: out, cases: cases.length, verified: verdict.ok }));
