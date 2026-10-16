#!/usr/bin/env node
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { mkdtemp, mkdir, readFile, rm, writeFile, copyFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';
import { isMainEntrypoint } from './lib/entrypoint.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const PACKAGE_ROOT = 'packages/versebrowser';
const SOURCE_ROOT = 'D:/versebrowser';

function hash(bytes) { return createHash('sha256').update(bytes).digest('hex'); }
function issue(kind, detail) { return { kind, ...detail }; }

async function verifyPatchEntries(hostRoot, sourceRoot) {
  const issues = [];
  const patchManifestPath = path.join(hostRoot, PACKAGE_ROOT, 'integration-patches.json');
  const manifest = JSON.parse(await readFile(patchManifestPath, 'utf8'));
  const checked = [];
  for (const entry of manifest.entries ?? []) {
    const source = await readFile(path.join(sourceRoot, entry.sourcePath));
    const target = await readFile(path.join(hostRoot, entry.targetPath));
    const patch = await readFile(path.join(hostRoot, entry.patchPath));
    const sourceHash = hash(source);
    const sourceLfHash = hash(Buffer.from(source.toString('latin1').replaceAll('\r\n', '\n'), 'latin1'));
    const targetHash = hash(target);
    const patchHash = hash(patch);
    const ok = sourceHash === entry.originalRawSha256 && sourceLfHash === entry.originalLfSha256 && targetHash === entry.patchedSha256 && patchHash === entry.patchSha256;
    if (sourceHash !== entry.originalRawSha256 || sourceLfHash !== entry.originalLfSha256) issues.push(issue('patch_source_hash_mismatch', { id: entry.id, expectedRaw: entry.originalRawSha256, actualRaw: sourceHash, expectedLf: entry.originalLfSha256, actualLf: sourceLfHash }));
    if (targetHash !== entry.patchedSha256) issues.push(issue('patch_target_hash_mismatch', { id: entry.id, expected: entry.patchedSha256, actual: targetHash }));
    if (patchHash !== entry.patchSha256) issues.push(issue('patch_file_hash_mismatch', { id: entry.id, expected: entry.patchSha256, actual: patchHash }));
    checked.push({ id: entry.id, sourcePath: entry.sourcePath, targetPath: entry.targetPath, patchPath: entry.patchPath, ok });
  }
  return { status: issues.length ? 'fail' : 'pass', count: checked.length, entries: checked, issues };
}

async function verifyPatchesApply(hostRoot, sourceRoot) {
  const issues = [];
  const manifest = JSON.parse(await readFile(path.join(hostRoot, PACKAGE_ROOT, 'integration-patches.json'), 'utf8'));
  const work = await mkdtemp(path.join(tmpdir(), 'versebrowser-patch-check-'));
  try {
    execFileSync('git', ['init', '-q'], { cwd: work, windowsHide: true });
    for (const entry of manifest.entries ?? []) {
      const fixture = path.join(work, entry.sourcePath);
      await mkdir(path.dirname(fixture), { recursive: true });
      const sourceText = await readFile(path.join(sourceRoot, entry.sourcePath), 'utf8');
      await writeFile(fixture, sourceText.replaceAll('\r\n', '\n'), 'utf8');
      try {
        execFileSync('git', ['apply', '--check', path.join(hostRoot, entry.patchPath)], { cwd: work, stdio: 'pipe', windowsHide: true });
      } catch (error) {
        issues.push(issue('patch_does_not_apply_to_original', { id: entry.id, message: String(error.stderr || error.message) }));
      }
    }
  } finally {
    await rm(work, { recursive: true, force: true });
  }
  return { status: issues.length ? 'fail' : 'pass', issues };
}

async function verifyWiring(hostRoot) {
  const api = await readFile(path.join(hostRoot, 'electron/services/agent-browser-api.ts'), 'utf8');
  const bridge = await readFile(path.join(hostRoot, 'electron/gateway/agent-browser-bridge.ts'), 'utf8');
  // The bundled CLI belongs to the standalone/MCP surface, which builds its own service.
  const packageApi = await readFile(path.join(hostRoot, PACKAGE_ROOT, 'src', 'engine', 'api.ts'), 'utf8');
  const required = {
    module_entry: api.includes('createModuleAgentBrowserApi'),
    // N8 F1: the desktop host must keep the bundled CLI out of the session engine. With a
    // CLI runner injected the package picks agent-browser-cli for every managed open(), and
    // takeSnapshot/clickByUid/fillByUid/pressKey stop working in the packaged app while the
    // capability snapshot still advertises them.
    desktop_service_cli_free: !api.includes('cliRunner:') && api.includes('new HostAgentBrowserService()'),
    desktop_capabilities_cli_less: api.includes('cliAvailable: false'),
    standalone_cli_runner: packageApi.includes('cliRunner: createDefaultAgentBrowserCliRunner()'),
    permission_recorder: api.includes('setPermissionDecisionRecorder(recordPermissionDecisionEvent'),
    workspace_provider: api.includes('setActiveWorkspaceProfileProvider(getActiveWorkspaceProfile'),
    sensitive_capture_host_owned: api.includes("assertSensitiveCaptureAllowed('desktopAutomation'"),
    data_dir_provider: api.includes('setDataDirProvider(getHostDataDir)'),
    workspace_root_refresh: api.includes('setWorkspaceRoot(profile?.rootPath)'),
    typed_sandbox_denial: api.includes('new SandboxDenialError'),
    resource_owner_hook: api.includes('recordResourceEnvelopeEntry') && api.includes('removeResourceEnvelopeEntry'),
    gateway_gate: bridge.includes('await assertBrowserAllowedUnderSandbox(request.action)'),
  };
  const issues = Object.entries(required).filter(([, ok]) => !ok).map(([name]) => issue('host_wiring_missing', { name }));
  return { status: issues.length ? 'fail' : 'pass', checks: required, issues };
}

export async function verifyHostIntegration({ hostRoot = ROOT, sourceRoot = SOURCE_ROOT } = {}) {
  const [entries, apply, wiring] = await Promise.all([
    verifyPatchEntries(hostRoot, sourceRoot),
    verifyPatchesApply(hostRoot, sourceRoot),
    verifyWiring(hostRoot),
  ]);
  const issues = [entries, apply, wiring].flatMap((section) => section.issues ?? []);
  return { schemaVersion: 1, driven_by: 'agent', actor: 'codex', status: issues.length ? 'fail' : 'pass', patches: entries, patchApply: apply, wiring, issues };
}

async function main() {
  const { values } = parseArgs({ options: { 'host-root': { type: 'string' }, 'source-root': { type: 'string' }, output: { type: 'string' } }, allowPositionals: false });
  const report = await verifyHostIntegration({ hostRoot: values['host-root'], sourceRoot: values['source-root'] });
  const text = JSON.stringify(report, null, 2) + '\n';
  if (values.output) await writeFile(path.resolve(values.output), text, 'utf8');
  process.stdout.write(text);
  process.exitCode = report.status === 'fail' ? 1 : 0;
}

if (isMainEntrypoint(import.meta.url)) main().catch((error) => { process.stderr.write(String(error?.stack ?? error) + '\n'); process.exitCode = 1; });
