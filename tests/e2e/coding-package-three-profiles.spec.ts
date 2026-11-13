/* eslint-disable @typescript-eslint/no-explicit-any -- E2E evidence preserves host/runtime JSON payloads verbatim. */
import { execFile, execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { mkdir, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { promisify } from 'node:util';
import { DatabaseSync } from 'node:sqlite';
import type { ElectronApplication } from '@playwright/test';
import { closeElectronApp, expect, getStableWindow, test } from './fixtures/electron';
import {
  buildMockProviderConfig,
  hostInvoke,
  startGateway,
  startScriptedLlm,
  type LlmRequestLog,
} from './fixtures/fp-p1-harness';

const execFileAsync = promisify(execFile);
const repoRoot = resolve(process.cwd());
const rawRoot = resolve(
  process.env.CLAWX_PACKAGE_RAW_ROOT
    ?? mkdtempSync(join(process.platform === 'win32' ? 'D:/tmp' : tmpdir(), 'clawx-tf0781-raw-')),
);
mkdirSync(rawRoot, { recursive: true });

const profiles = ['profile-a', 'profile-b', 'profile-c'] as const;
const fixedMath = [
  'function add(a, b) {',
  '  return a + b;',
  '}',
  'module.exports = { add };',
  '',
].join('\n');
const buggyMath = fixedMath.replace('a + b', 'a - b');

type CommandRecord = {
  id: string;
  executable: string;
  argv: string[];
  cwd: string;
  exitCode: number;
  expectedExitCode: 0;
  waitedForExit: true;
  stdout: string;
  stderr: string;
  stdoutSha256: string;
  stderrSha256: string;
  wallMs: number;
};

function digest(value: string | Buffer): string {
  return createHash('sha256').update(value).digest('hex');
}

function fileDigest(path: string): string {
  return digest(readFileSync(path));
}

function readSubagentRun(profileDir: string, runId: string): Record<string, any> | undefined {
  const databasePath = [
    join(profileDir, 'openclaw-source-state', 'state', 'openclaw.sqlite'),
    join(profileDir, 'openclaw-state', 'state', 'openclaw.sqlite'),
    join(profileDir, 'openclaw.sqlite'),
  ].find(existsSync);
  if (!databasePath) return undefined;
  let database: DatabaseSync | undefined;
  try {
    database = new DatabaseSync(databasePath, { readOnly: true });
    const row = database.prepare('SELECT payload_json FROM subagent_runs WHERE run_id = ?').get(runId) as
      { payload_json?: unknown } | undefined;
    return typeof row?.payload_json === 'string' ? JSON.parse(row.payload_json) as Record<string, any> : undefined;
  } catch {
    return undefined;
  } finally {
    database?.close();
  }
}

function normalizedCallId(value: string): string {
  return value.replace(/[^a-zA-Z0-9]/gu, '');
}

function resultFor(results: Record<string, string>, callId: string): string {
  const wanted = normalizedCallId(callId);
  for (const [key, value] of Object.entries(results)) {
    if (key === wanted || new RegExp(`^${wanted}\\d+$`, 'u').test(key)) return value;
  }
  return '';
}

function toolResultFor(log: LlmRequestLog[], callId: string): string {
  for (const entry of log) {
    const found = resultFor(entry.toolResults, callId);
    if (found) return found;
  }
  return '';
}

async function runCommand(input: {
  commands: CommandRecord[];
  id: string;
  executable: string;
  args: string[];
  cwd: string;
  env?: NodeJS.ProcessEnv;
}): Promise<CommandRecord> {
  const started = Date.now();
  try {
    const result = await execFileAsync(input.executable, input.args, {
      cwd: input.cwd,
      env: { ...process.env, TEMP: 'D:/tmp', TMP: 'D:/tmp', ...input.env },
      encoding: 'utf8',
      windowsHide: true,
      timeout: 240_000,
      maxBuffer: 32 * 1024 * 1024,
    });
    const record: CommandRecord = {
      id: input.id, executable: input.executable, argv: input.args, cwd: input.cwd,
      exitCode: 0, expectedExitCode: 0, waitedForExit: true, stdout: String(result.stdout), stderr: String(result.stderr),
      stdoutSha256: digest(String(result.stdout)), stderrSha256: digest(String(result.stderr)),
      wallMs: Date.now() - started,
    };
    input.commands.push(record);
    return record;
  } catch (error) {
    const failure = error as Error & { code?: number | string; stdout?: string; stderr?: string };
    input.commands.push({
      id: input.id, executable: input.executable, argv: input.args, cwd: input.cwd,
      exitCode: typeof failure.code === 'number' ? failure.code : 1, expectedExitCode: 0, waitedForExit: true,
      stdout: String(failure.stdout ?? ''), stderr: String(failure.stderr ?? failure.message),
      stdoutSha256: digest(String(failure.stdout ?? '')), stderrSha256: digest(String(failure.stderr ?? failure.message)),
      wallMs: Date.now() - started,
    });
    throw error;
  }
}

async function runJsonCommand(input: Parameters<typeof runCommand>[0]): Promise<{ record: CommandRecord; json: Record<string, any> }> {
  const record = await runCommand(input);
  return { record, json: JSON.parse(record.stdout) as Record<string, any> };
}

function activeMarker(value: string, markers: readonly string[]): string | null {
  let winner: string | null = null;
  let winnerAt = -1;
  for (const marker of markers) {
    const at = value.lastIndexOf(marker);
    if (at > winnerAt) {
      winner = marker;
      winnerAt = at;
    }
  }
  return winnerAt >= 0 ? winner : null;
}

function packagePaths(): {
  executable: string;
  resourcesRoot: string;
  vg: string;
  ae: string;
  node: string;
  versegitManifest: string;
  verseshellManifest: string;
  stsContracts: string;
} | null {
  const configured = process.env.CLAWX_PACKAGED_EXE?.trim();
  if (!configured) return null;
  const executable = resolve(configured);
  const resourcesRoot = join(dirname(executable), 'resources');
  return {
    executable,
    resourcesRoot,
    vg: join(resourcesRoot, 'bin', 'vg.exe'),
    ae: join(resourcesRoot, 'bin', 'ae.exe'),
    node: join(resourcesRoot, 'bin', 'node.exe'),
    versegitManifest: join(resourcesRoot, 'resources', 'versegit', 'manifest.json'),
    verseshellManifest: join(resourcesRoot, 'resources', 'verseshell', 'manifest.json'),
    stsContracts: resolve(process.env.CLAWX_STS_CONTRACTS
      ?? join(repoRoot, 'harness/specs/fixtures/coding-evaluation/TF-0781/inputs/vg-sts')),
  };
}

async function writeScriptedConfig(input: {
  profileHome: string;
  profileState: string;
  profileDir: string;
  workspace: string;
  llmPort: number;
}): Promise<void> {
  const config = buildMockProviderConfig(input.llmPort, input.workspace, {
    coding: { staleWriteGuard: { enabled: true }, worktree: { backend: 'git' } },
  });
  config.tools = { profile: 'coding', exec: { host: 'gateway', security: 'full', ask: 'off' } };
  const profileOpenClawDir = join(input.profileHome, '.openclaw');
  const sourceStateDir = join(input.profileDir, 'openclaw-source-state');
  await Promise.all([
    mkdir(profileOpenClawDir, { recursive: true }),
    mkdir(input.profileState, { recursive: true }),
    mkdir(sourceStateDir, { recursive: true }),
  ]);
  const serialized = `${JSON.stringify(config, null, 2)}\n`;
  await Promise.all([
    writeFile(join(profileOpenClawDir, 'openclaw.json'), serialized, 'utf8'),
    writeFile(join(input.profileState, 'openclaw.json'), serialized, 'utf8'),
    writeFile(join(sourceStateDir, 'openclaw.json'), serialized, 'utf8'),
  ]);
}

async function runProfile(input: {
  profileId: string;
  homeDir: string;
  userDataDir: string;
  launchElectronApp: (options?: {
    skipSetup?: boolean;
    packaged?: boolean;
    executablePath?: string;
    profileDir?: string;
    env?: Record<string, string>;
  }) => Promise<ElectronApplication>;
}): Promise<void> {
  const paths = packagePaths();
  test.skip(!paths, 'CLAWX_PACKAGED_EXE is required');
  if (!paths) throw new Error('unreachable');
  for (const required of [paths.executable, paths.vg, paths.ae, paths.node, paths.versegitManifest, paths.verseshellManifest]) {
    expect(existsSync(required), `missing packaged input: ${required}`).toBe(true);
  }
  expect(existsSync(paths.stsContracts), `missing STS contract fixture: ${paths.stsContracts}`).toBe(true);
  const versegitManifest = JSON.parse(readFileSync(paths.versegitManifest, 'utf8')) as {
    artifact?: { sha256?: unknown };
    source?: { commit?: unknown };
  };
  const verseshellManifest = JSON.parse(readFileSync(paths.verseshellManifest, 'utf8')) as {
    artifacts?: { 'win32-x64'?: { sha256?: unknown } };
    provenance?: { commit?: unknown };
  };
  expect(fileDigest(paths.vg)).toBe(versegitManifest.artifact?.sha256);
  expect(fileDigest(paths.ae)).toBe(verseshellManifest.artifacts?.['win32-x64']?.sha256);

  const profileRoot = join(rawRoot, input.profileId);
  const profileDir = join(input.userDataDir, `${input.profileId}-user-data`);
  const profileHome = join(input.homeDir, input.profileId);
  const profileState = join(profileDir, 'openclaw-state');
  const workspace = join(profileRoot, 'workspace');
  const vgWorkspace = join(profileRoot, 'vg-workspace');
  const commands: CommandRecord[] = [];
  await Promise.all([
    mkdir(workspace, { recursive: true }),
    mkdir(vgWorkspace, { recursive: true }),
  ]);
  writeFileSync(join(workspace, 'math.js'), buggyMath, 'utf8');
  writeFileSync(join(workspace, 'verify.cjs'), [
    "const { readFileSync } = require('node:fs');",
    "const source = readFileSync('math.js', 'utf8');",
    "if (!source.includes('return a + b;')) process.exit(7);",
    "console.log('PACKAGED_VERIFY_PASS');",
    '',
  ].join('\n'), 'utf8');
  for (const [name, content] of [
    ['AGENTS.md', '# Workspace instructions\n'],
    ['HEARTBEAT.md', '# Heartbeat\n'],
    ['IDENTITY.md', '# Agent identity\n'],
    ['SOUL.md', '# Agent guidance\n'],
    ['TOOLS.md', '# Tool notes\n'],
    ['USER.md', '# User profile\n'],
  ]) writeFileSync(join(workspace, name), content, 'utf8');
  writeFileSync(join(workspace, '.jj-config.toml'), '[user]\nname="Package Eval"\nemail="package@example.invalid"\n', 'utf8');
  execFileSync('git', ['init', '-q', '-b', 'main'], { cwd: workspace, windowsHide: true });
  execFileSync('git', ['config', 'user.name', 'package-eval'], { cwd: workspace, windowsHide: true });
  execFileSync('git', ['config', 'user.email', 'package@example.invalid'], { cwd: workspace, windowsHide: true });
  execFileSync('git', ['config', 'core.autocrlf', 'false'], { cwd: workspace, windowsHide: true });
  execFileSync('git', ['add', '-A'], { cwd: workspace, windowsHide: true });
  execFileSync('git', ['commit', '-qm', 'baseline'], { cwd: workspace, windowsHide: true });
  writeFileSync(join(vgWorkspace, 'a.txt'), 'before\n', 'utf8');
  writeFileSync(join(vgWorkspace, '.jj-config.toml'), '[user]\nname="Package Eval"\nemail="package@example.invalid"\n', 'utf8');
  execFileSync('git', ['init', '-q', '-b', 'main'], { cwd: vgWorkspace, windowsHide: true });
  execFileSync('git', ['config', 'user.name', 'package-eval'], { cwd: vgWorkspace, windowsHide: true });
  execFileSync('git', ['config', 'user.email', 'package@example.invalid'], { cwd: vgWorkspace, windowsHide: true });
  execFileSync('git', ['config', 'core.autocrlf', 'false'], { cwd: vgWorkspace, windowsHide: true });
  execFileSync('git', ['add', '-A'], { cwd: vgWorkspace, windowsHide: true });
  execFileSync('git', ['commit', '-qm', 'baseline'], { cwd: vgWorkspace, windowsHide: true });

  const marker = `PACKAGE_${input.profileId.replace(/[^a-z0-9]/giu, '_').toUpperCase()}`;
  const workerMarker = `${marker}_WORKER`;
  const undoMarker = `${marker}_UNDO`;
  const workerDone = `PKG_WORKER_DONE_${input.profileId.replace(/[^a-z0-9]/giu, '_').toUpperCase()}`;
  const undoDone = `PKG_UNDO_DONE_${input.profileId.replace(/[^a-z0-9]/giu, '_').toUpperCase()}`;
  const llm = await startScriptedLlm((text, results) => {
    const selected = activeMarker(text, [workerMarker, undoMarker]);
    if (selected === workerMarker) {
      if (!resultFor(results, 'pkgwrite')) {
        return { toolCall: { id: 'pkgwrite', name: 'write', args: { path: 'math.js', content: fixedMath } } };
      }
      if (!resultFor(results, 'pkgverify')) {
        return { toolCall: { id: 'pkgverify', name: 'exec', args: { command: 'node verify.cjs' } } };
      }
      return { text: workerDone };
    }
    if (selected === undoMarker) {
      if (!resultFor(results, 'pkgscratch')) {
        return { toolCall: { id: 'pkgscratch', name: 'write', args: { path: 'scratch.txt', content: 'temporary\n' } } };
      }
      if (!resultFor(results, 'pkgundo')) {
        return { toolCall: { id: 'pkgundo', name: 'undo_write', args: { steps: 1 } } };
      }
      return { text: undoDone };
    }
    return { text: 'package observer idle' };
  });
  await writeScriptedConfig({ profileHome, profileState, profileDir, workspace, llmPort: llm.port });

  const evidence: Record<string, any> = {
    schema: 'CodingPackageProfile/v1', taskId: 'TF-0781', profileId: input.profileId,
    driven_by: 'agent', actor: 'codex-coding-package-evaluator', realHumanEvidence: false,
    package: {
      executable: paths.executable,
      resourcesRoot: paths.resourcesRoot,
      vgSha256: fileDigest(paths.vg),
      aeSha256: fileDigest(paths.ae),
      nodeSha256: fileDigest(paths.node),
      versegitManifestSha256: fileDigest(paths.versegitManifest),
      verseshellManifestSha256: fileDigest(paths.verseshellManifest),
      versegitSourceCommit: versegitManifest.source?.commit,
      verseshellSourceCommit: verseshellManifest.provenance?.commit,
      detachedFromSource: !(paths.executable.startsWith(repoRoot + '\\') || paths.executable.startsWith(repoRoot + '/')),
    },
    defaults: {
      bundledPythonPresent: existsSync(join(paths.resourcesRoot, 'bin', 'python.exe')),
      standaloneJjPresent: existsSync(join(paths.resourcesRoot, 'bin', 'jj.exe')),
      managedModeMustBeExplicit: true,
    },
    workspace,
    profileDir,
    profileHome,
    profileState,
    commands,
  };

  let app: ElectronApplication | undefined;
  try {
    app = await input.launchElectronApp({
      skipSetup: true,
      packaged: true,
      executablePath: paths.executable,
      profileDir,
      env: {
        VERSE_CLAW_OPENCLAW_RUNTIME: 'source',
        TEMP: 'D:/tmp',
        TMP: 'D:/tmp',
        OPENCLAW_HOME: profileHome,
        OPENCLAW_STATE_DIR: profileState,
        OPENCLAW_CONFIG_PATH: join(profileState, 'openclaw.json'),
        CLAWX_E2E_RUN_ROOT: profileRoot,
        CLAWX_VERSGIT_DIAGNOSTICS: '1',
        CLAWX_VERSGIT_APP_PATH: dirname(paths.executable),
        CLAWX_VERSGIT_RESOURCES_PATH: paths.resourcesRoot,
        CLAWX_VERSGIT_PROVIDER_ROOT: workspace,
        CLAWX_VERSGIT_REPO_ID: `${input.profileId}-repo`,
        CLAWX_VERSGIT_ALLOWED_WORKSPACE_ID: `${input.profileId}-workspace`,
        CLAWX_VERSGIT_ALLOWED_SESSION_ID: `${input.profileId}-session`,
        CLAWX_VERSGIT_ALLOWED_WORKTREE_ID: `${input.profileId}-worktree`,
        CLAWX_VERSGIT_OWNER_ID: 'agent:codex',
        CLAWX_VERSGIT_EPOCH: '1',
        CLAWX_VERSGIT_AUTHORIZATION_ID: `${input.profileId}-grant`,
        CLAWX_VERSGIT_GRANT_EXPIRES_AT: '2099-01-01T00:00:00.000Z',
        CLAWX_VERSGIT_WORKTREE_COUNT: '2',
        CLAWX_VERSGIT_ACTIVE_SESSION_COUNT: '2',
      },
    });
    const appInfo = await app.evaluate(({ app: electronApp }) => ({
      isPackaged: electronApp.isPackaged,
      appPath: electronApp.getAppPath(),
      resourcesPath: process.resourcesPath,
      version: electronApp.getVersion(),
    }));
    evidence.app = appInfo;
    expect(appInfo.isPackaged).toBe(true);
    expect(resolve(appInfo.resourcesPath)).toBe(paths.resourcesRoot);

    const page = await getStableWindow(app);
    await expect(page.getByTestId('main-layout')).toBeVisible({ timeout: 60_000 });
    const version = await hostInvoke<string>(app, 'app', 'version');
    evidence.appVersion = version;
    const binding = {
      workspaceId: `${input.profileId}-workspace`,
      sessionId: `${input.profileId}-session`,
      worktreeId: `${input.profileId}-worktree`,
      ownerId: 'agent:codex',
      epoch: 1,
      mode: 'M1',
    };
    const versegitStatus = await hostInvoke<Record<string, any>>(app, 'versegit', 'status', binding);
    evidence.versegitStatus = versegitStatus;
    console.log('[tf0781-versegit-status]', JSON.stringify(versegitStatus));
    expect(versegitStatus).toMatchObject({ status: 'observed', identity: { binarySha256: evidence.package.vgSha256 } });

    await hostInvoke<Record<string, unknown>>(app, 'workspaces', 'create', {
      name: input.profileId, rootPath: workspace, permissionMode: 'fullAccess',
    });
    await startGateway(app);
    const rpc = <T,>(method: string, params: Record<string, unknown>) => (
      hostInvoke<T>(app!, 'gateway', 'rpc', { method, params, timeoutMs: 120_000 })
    );
    const parent = await rpc<{ key: string; entry: { sessionId: string } }>('sessions.create', {
      agentId: 'main', label: `${input.profileId} parent`,
    });
    const run = await rpc<Record<string, any>>('orchestrator.run', {
      task: `${workerMarker}: replace math.js with the correct addition and run the verification command.`,
      sessionKey: parent.key,
      agentId: 'main',
      isolation: 'worktree',
      includeVerifier: false,
      expectedSessionGeneration: parent.entry.sessionId,
      workers: [{
        roleName: 'implementer',
        task: `${workerMarker}: replace math.js with the correct addition and run the verification command.`,
        writeSet: ['math.js'],
      }],
      delegationAdmission: {
        receiptId: `${input.profileId}-receipt`,
        idempotencyKey: `${input.profileId}-worker`,
        taskRef: { kind: 'task-ledger', nodeId: input.profileId },
        coordinator: {
          workspaceId: input.profileId,
          agentId: 'main',
          sessionKey: parent.key,
          sessionId: parent.entry.sessionId,
          bindingRevision: 1,
        },
      },
    });
    evidence.run = run;
    expect(run.status).toBe('accepted');
    const child = run.delegationReceipt.children[0] as {
      childRunId: string; childSessionKey: string;
      isolation: { mode: string; backend: string; canonicalRoot: string; verifiedCheckout: boolean };
    };
    expect(child.isolation).toMatchObject({ mode: 'worktree', backend: 'git-worktree', verifiedCheckout: true });
    expect(resolve(child.isolation.canonicalRoot)).not.toBe(resolve(workspace));

    let terminal: Record<string, any> | undefined;
    for (let attempt = 0; attempt < 12; attempt += 1) {
      terminal = await rpc<Record<string, any>>('agent.wait', { runId: child.childRunId, timeoutMs: 15_000 });
      if (terminal.status !== 'timeout') break;
    }
    evidence.workerTerminal = terminal;
    expect(terminal?.status).toBe('ok');
    await expect.poll(() => readSubagentRun(profileDir, child.childRunId)?.orchestration?.worktreeMergeProcessedAt, {
      timeout: 120_000,
    }).not.toBeUndefined();
    evidence.persistedWorker = readSubagentRun(profileDir, child.childRunId);
    console.log('[tf0781-worker-merge]', JSON.stringify(evidence.persistedWorker?.orchestration));
    expect(evidence.persistedWorker?.orchestration?.worktreeMergeStatus).toBe('merged');
    await expect.poll(() => readFileSync(join(workspace, 'math.js'), 'utf8'), { timeout: 60_000 })
      .toContain('return a + b;');
    evidence.workerToolResults = {
      write: toolResultFor(llm.log, 'pkgwrite'),
      verify: toolResultFor(llm.log, 'pkgverify'),
    };
    expect(evidence.workerToolResults.verify).toContain('PACKAGED_VERIFY_PASS');

    const undoSession = await rpc<{ key: string; entry: { sessionId: string } }>('sessions.create', {
      agentId: 'main', label: `${input.profileId} undo`,
    });
    await hostInvoke<Record<string, unknown>>(app, 'chat', 'sendWithMedia', {
      sessionKey: undoSession.key,
      message: `${undoMarker}: create a temporary file then undo it.`,
      idempotencyKey: `${input.profileId}-undo-${Date.now()}`,
    });
    await expect.poll(() => llm.log.some((entry) => entry.issued?.includes(undoDone.slice(0, 18))), {
      timeout: 180_000,
    }).toBe(true);
    evidence.undoToolResults = {
      write: toolResultFor(llm.log, 'pkgscratch'),
      undo: toolResultFor(llm.log, 'pkgundo'),
    };
    console.log('[tf0781-llm-tail]', JSON.stringify(llm.log.slice(-8)));
    expect(existsSync(join(workspace, 'scratch.txt'))).toBe(false);
    expect(evidence.undoToolResults.write).not.toBe('');
    expect(evidence.undoToolResults.undo).not.toBe('');
  } finally {
    if (app) {
      const launcherPid = app.process().pid;
      await closeElectronApp(app);
      if (process.platform === 'win32' && launcherPid) {
        try {
          execFileSync('taskkill.exe', ['/PID', String(launcherPid), '/T', '/F'], {
            windowsHide: true, stdio: 'ignore',
          });
        } catch {
          // The owned launcher already exited.
        }
      }
    }
    llm.server.closeAllConnections();
    llm.server.closeIdleConnections();
    await Promise.race([
      new Promise<void>((resolveClose) => llm.server.close(() => resolveClose())),
      new Promise<void>((resolveClose) => setTimeout(resolveClose, 2_000)),
    ]);
  }

  evidence.coding = {
    workspace,
    mathSha256: fileDigest(join(workspace, 'math.js')),
    scratchRemoved: !existsSync(join(workspace, 'scratch.txt')),
    providerRequests: llm.log.length,
    providerAnomalies: llm.anomalies,
    providerLog: llm.log,
  };
  expect(llm.anomalies).toEqual([]);

  const vgEnv = { ...process.env, TEMP: 'D:/tmp', TMP: 'D:/tmp', JJ_CONFIG: join(vgWorkspace, '.jj-config.toml') };
  const capabilities = await runJsonCommand({
    commands, id: 'vg-capabilities', executable: paths.vg, args: ['capabilities', '--json'], cwd: vgWorkspace, env: vgEnv,
  });
  expect(capabilities.json).toMatchObject({ schema: 'versegit.capabilities/v1', safety: { default_enable: false, managed_opt_in: true } });
  const imported = await runJsonCommand({
    commands, id: 'vg-workspace-import', executable: paths.vg,
    args: ['workspace', 'import', '--root', vgWorkspace, '--json'], cwd: vgWorkspace, env: vgEnv,
  });
  expect(imported.json).toMatchObject({ schema: 'versegit.vg-json/v1', colocated: true });
  const change = await runJsonCommand({
    commands, id: 'vg-change-new', executable: paths.vg,
    args: ['change', 'new', '--root', vgWorkspace, '--description', input.profileId, '--run-key', `${input.profileId}-change`, '--json'],
    cwd: vgWorkspace, env: vgEnv,
  });
  writeFileSync(join(vgWorkspace, 'package-marker.txt'), `${input.profileId}\n`, 'utf8');
  const snapshot = await runJsonCommand({
    commands, id: 'vg-change-snapshot', executable: paths.vg,
    args: ['change', 'snapshot', '--root', vgWorkspace, '--description', `${input.profileId} snapshot`, '--run-key', `${input.profileId}-snapshot`, '--json'],
    cwd: vgWorkspace, env: vgEnv,
  });
  const sts11 = await runJsonCommand({
    commands, id: 'sts-contract-1.1', executable: paths.vg,
    args: ['--json', 'sts', 'contract', '--dir', join(paths.stsContracts, 'v1')], cwd: vgWorkspace, env: vgEnv,
  });
  const sts20 = await runJsonCommand({
    commands, id: 'sts-contract-2.0', executable: paths.vg,
    args: ['--json', 'sts', 'contract', '--dir', join(paths.stsContracts, 'v2')], cwd: vgWorkspace, env: vgEnv,
  });
  expect(sts11.json).toMatchObject({ ok: true, protocol_version: '1.1' });
  expect(sts20.json).toMatchObject({ ok: true, protocol_version: '2.0', contract_status: 'authoritative' });
  evidence.vg = {
    capabilities: capabilities.json,
    import: imported.json,
    change: change.json,
    snapshot: snapshot.json,
    sts11: {
      ok: sts11.json.ok, protocol: sts11.json.protocol_version,
      digests: sts11.json.digests, parse: sts11.json.vg_side_parse,
    },
    sts20: {
      ok: sts20.json.ok, protocol: sts20.json.protocol_version,
      digests: sts20.json.digests, parse: sts20.json.vg_side_parse,
    },
  };
  evidence.status = 'pass';
  evidence.recordedAt = new Date().toISOString();
  writeFileSync(join(rawRoot, `${input.profileId}.json`), `${JSON.stringify(evidence, null, 2)}\n`, 'utf8');
}

test.describe('TF-0781 packaged coding and VG/STS/JJ profiles', () => {
  for (const profileId of profiles) {
    test(`${profileId} runs packaged coding, worktree, verification, undo, VG, STS and JJ`, async ({
      homeDir,
      userDataDir,
      launchElectronApp,
    }) => {
      test.setTimeout(1_800_000);
      await runProfile({ profileId, homeDir, userDataDir, launchElectronApp });
    });
  }
});
