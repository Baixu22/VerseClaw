import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { realpathSync } from 'node:fs';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { ElectronApplication, Page } from '@playwright/test';
import { closeElectronApp, expect, getStableWindow, hoverUntilVisible, test } from './fixtures/electron';
import { hostInvoke, startScriptedLlm } from './fixtures/fp-p1-harness';
import { addSessionChainChildren, configureSessionChainProvider, createSessionChainProject, createSessionChainTask,
  instrumentSessionChainHost, readSessionChainHostCalls } from './fixtures/session-task-chain';

const metrics = ['identity_selection', 'page_transition', 'repeat_confirmation', 'goal_restatement', 'repeat_reminder'] as const;
type Metric = typeof metrics[number];
type Entry = { id: string; at: string; action: string; target: string; operation: string; success: boolean;
  source: 'scripted_ui' | 'rendered_ui'; metrics: Metric[]; repeat_of: string | null; rule: string;
  before?: string; after?: string; value_sha256?: string; error?: string; caused_by?: string };
type Meaning = { identity?: boolean; confirmation?: string; goalField?: string; value?: string };
type Counts = Record<Metric, number>;
type BuildManifest = { schema_version: 1; driven_by: 'agent'; side: 'baseline' | 'candidate'; source_head: string;
  built_at: string; main_sha256: string; renderer_sha256: string; runtime_entry_sha256: string };
class Unsupported extends Error {}
const sha = (value: string | Buffer) => createHash('sha256').update(value).digest('hex');
const requiredEnv = (name: string): string => { const value = process.env[name]?.trim(); if (!value) throw new Error('缺少必需环境变量 ' + name); return value; };
const fileIdentity = (pathname: string) => {
  const actual = realpathSync.native(pathname);
  const canonical = actual.replace(/^\\\\\?\\UNC\\/u, '\\\\').replace(/^\\\\\?\\/u, '').replace(/\\/g, '/');
  return { old: pathname, actual, canonical: process.platform === 'win32' ? canonical.toLowerCase() : canonical };
};
const sameFile = (left: string, right: string): boolean => {
  try { return fileIdentity(left).canonical === fileIdentity(right).canonical; } catch { return false; }
};
const readBuildManifest = async (side: 'baseline' | 'candidate', head: string) => {
  const input = requiredEnv('CLAWX_U6_BUILD_MANIFEST');
  const raw = await readFile(input);
  const manifest = JSON.parse(raw.toString('utf8')) as BuildManifest;
  expect(manifest.schema_version).toBe(1);
  expect(manifest.driven_by).toBe('agent');
  expect(manifest.side).toBe(side);
  expect(manifest.source_head).toBe(head);
  expect(Number.isFinite(Date.parse(manifest.built_at))).toBe(true);
  expect(/^[a-f0-9]{64}$/.test(manifest.main_sha256)).toBe(true);
  expect(/^[a-f0-9]{64}$/.test(manifest.renderer_sha256)).toBe(true);
  expect(/^[a-f0-9]{64}$/.test(manifest.runtime_entry_sha256)).toBe(true);
  const actual = { main_sha256: sha(await readFile('dist-electron/main/index.js')),
    renderer_sha256: sha(await readFile('dist/index.html')),
    runtime_entry_sha256: sha(await readFile('openclaw_runtime/dist/entry.js')) };
  expect(actual).toEqual({ main_sha256: manifest.main_sha256, renderer_sha256: manifest.renderer_sha256,
    runtime_entry_sha256: manifest.runtime_entry_sha256 });
  return { ...actual, manifest_sha256: sha(raw), manifest_path: input, side: manifest.side, source_head: manifest.source_head };
};
const helperNames = ['electron.ts', 'fp-p1-harness.ts', 'session-task-chain.ts', 'electron-process-cleanup.ts', 'windows-process.ts'] as const;
const countMetrics = (events: Entry[]): Counts => Object.fromEntries(metrics.map(metric => [metric,
  events.filter(entry => entry.success && entry.metrics.includes(metric)).length])) as Counts;
const objective = 'Retain the approved U6 artifact';
const content = 'approved U6 artifact\n';
const journeys = ['new-task', 'continue', 'cross-tree-migration', 'crash-recovery', 'archive-restore', 'handoff'] as const;

for (const journey of journeys) test(`U6 interaction metrics: ${journey}`, async ({ launchElectronApp, homeDir, userDataDir }, info) => {
  test.skip(!process.env.CLAWX_U6_SIDE, '仅由配对验收显式启用');
  test.setTimeout(300_000);
  const side = process.env.CLAWX_U6_SIDE!;
  const taskControlCallId = `u6${journey.replace(/-/g, "")}taskcontrol`;
  const requiresTaskCall = journey === 'continue' || journey === 'crash-recovery';
  expect(['baseline', 'candidate']).toContain(side);
  const head = execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8', windowsHide: true }).trim();
  const inputChanges = execFileSync('git', ['status', '--porcelain=v1', '--untracked-files=all', '--', 'src', 'shared', 'electron', 'openclaw_runtime', 'tests/e2e/fixtures'],
    { encoding: 'utf8', windowsHide: true }).trim();
  const allowedBaselineHelperChanges = new Set(helperNames.map(name => `M tests/e2e/fixtures/${name}`));
  const unexpectedInputChanges = inputChanges.split(/\r?\n/).map(line => line.trim()).filter(Boolean)
    .filter(line => !(side === 'baseline' && allowedBaselineHelperChanges.has(line)));
  expect(unexpectedInputChanges, '产品或公共 helper 有未冻结差异，先固定候选').toEqual([]);
  const expectedHead = side === 'baseline' ? '5ffcdfe89f6bed36dd6ebc2f366990c1a05d3976' : requiredEnv('CLAWX_U6_EXPECTED_HEAD');
  expect(expectedHead).toMatch(/^[a-f0-9]{40}$/);
  expect(head).toBe(expectedHead);
  const events: Entry[] = [], seen = new Map<string, string>();
  const unsupportedProof = JSON.parse(process.env.CLAWX_U6_UNSUPPORTED_PROOF ?? '{}') as Record<string, string>;
  let operation = `${journey}:goal-v1`, lastAction = '', recording = false;
  let status: 'running' | 'passed' | 'failed' | 'unsupported' = 'running', reason: string | null = null;
  let cleanupFailure: Error | undefined;
  const evidence: Record<string, unknown> = { schema_version: 2, driven_by: 'agent', actor: 'playwright-u6',
    requestmodel: 'ccs-workbuddy/deepseek-v4.1-flash', requested_route: 'ccs-workbuddy/deepseek-v4.1-flash',
    author_backend: null, provider: 'local-scripted', side, journey, status, source_head: head, homeDir, profileDir: userDataDir,
    fixture: { id: 'u6-goal-v1', objective, target: 'artifact.txt', content_sha256: sha(content), locale: 'en', viewport: '1280x800' }, unsupportedProof,
    task_control_call_id: taskControlCallId,
    setup: [], owner: {}, fault: null, events, tracked_product_and_helper_diff_empty: inputChanges.length === 0 };
  const add = (entry: Omit<Entry, 'id' | 'at'>) => {
    const result = { id: `e${events.length + 1}`, at: new Date().toISOString(), ...entry }; events.push(result); return result;
  };
  // 夹具已保存的目标是重述判定锚点，setup 本身没有用户操作计数。
  if (journey !== 'new-task') seen.set('goal:objective', 'fixture:goal-v1');
  let llm: Awaited<ReturnType<typeof startScriptedLlm>> | undefined;
  let app!: ElectronApplication, page!: Page;
  const id = (name: string) => page.getByTestId(name);
  const rpc = <T,>(method: string, params: Record<string, unknown>) => hostInvoke<T>(app, 'gateway', 'rpc', { method, params });
  const ui = async (action: string, target: string, run: () => Promise<unknown>, meaning: Meaning = {}) => {
    const entry = add({ action, target, operation, success: false, source: 'scripted_ui', metrics: [], repeat_of: null,
      rule: '首次动作；未匹配重复规则', before: page.url(), value_sha256: meaning.value === undefined ? undefined : sha(meaning.value) });
    lastAction = entry.id;
    try {
      await run(); entry.success = true; entry.after = page.url();
      if (meaning.identity) { entry.metrics.push('identity_selection'); entry.rule = '显式选择项目/会话/任务/检出身份'; }
      const key = meaning.confirmation ? `${operation}:confirm:${meaning.confirmation}:${entry.value_sha256 ?? ''}`
        : meaning.goalField ? `goal:${meaning.goalField}` : null;
      if (key) {
        const prior = seen.get(key); entry.repeat_of = prior ?? null;
        if (prior) { entry.metrics.push(meaning.confirmation ? 'repeat_confirmation' : 'goal_restatement');
          entry.rule = meaning.confirmation ? '同 operation、同决定、同 payload 再次确认' : '同 goal-v1 已提供字段再次手工填写'; }
        seen.set(key, entry.id);
      }
    } catch (error) { entry.error = String(error); throw error; }
  };
  const click = (name: string, meaning: Meaning = {}) => ui('click', `testid:${name}`, () => id(name).click(), meaning);
  const need = async (name: string) => {
    try { await expect(id(name)).toBeVisible(); } catch (error) {
      const proof = unsupportedProof[`${side}:${journey}:${name}`];
      if (await id(name).count() === 0 && proof) throw new Unsupported(`入口缺失 testid:${name}；只读能力核对：${proof}`);
      throw error; // 单纯 locator 超时不能证明产品不支持。
    }
  };
  try {
    evidence.build = await readBuildManifest(side as 'baseline' | 'candidate', head);
    const driverSha = sha(await readFile(info.file));
    expect(requiredEnv('CLAWX_U6_DRIVER_SHA256'), '必须固定两边的 driver SHA256').toBe(driverSha);
    evidence.driver_sha256 = driverSha;
    const expectedHelpers = JSON.parse(requiredEnv('CLAWX_U6_HELPER_HASHES')) as Record<string, string>;
    evidence.helpers = Object.fromEntries(await Promise.all(helperNames.map(async name =>
      [name, sha(await readFile(join('tests/e2e/fixtures', name)))])));
    expect(expectedHelpers, 'baseline/candidate 的 helper 输入必须相同').toEqual(evidence.helpers);
    llm = await startScriptedLlm((_text, toolResults) => requiresTaskCall && !(taskControlCallId in toolResults)
      ? { toolCall: { id: taskControlCallId, name: 'task_control', args: { action: 'current' } } }
      : { text: 'U6-ACK' });
    app = await launchElectronApp({ skipSetup: true, deviceScaleFactor: 1 });
    page = await getStableWindow(app);
    await hostInvoke(app, 'settings', 'set', { key: 'language', value: 'en' });
    const sourceRoot = info.outputPath('fixture', 'source'), targetRoot = info.outputPath('fixture', 'target');
    await mkdir(sourceRoot, { recursive: true });
    const git = (...args: string[]) => execFileSync('git', args, { cwd: sourceRoot, windowsHide: true, stdio: 'pipe' });
    git('init', '-b', 'u6-fixture');
    git('-c', 'user.name=Agent fixture', '-c', 'user.email=agent@example.invalid', 'commit', '--allow-empty', '-m', 'U6 fixture');
    await writeFile(join(sourceRoot, 'artifact.txt'), content);
    await configureSessionChainProvider(app, llm.port);
    const project = await createSessionChainProject(app, sourceRoot, 'U6 project');
    const contract = { objective, target: 'artifact.txt', constraints: ['Retain prior progress'],
      acceptance: [{ id: 'file', description: 'Artifact contains the approved output',
        verification: { kind: 'file-sha256' as const, path: 'artifact.txt', sha256: sha(content) } }] };
    const task = journey === 'new-task' ? null : await createSessionChainTask(app, project.workspaceId, 'u6-create', contract);
    if (task) await hostInvoke(app, 'taskLedger', 'linkSession', { workspaceId: project.workspaceId,
      sessionKey: project.sessionKey, sessionGeneration: project.generation, nodeId: task.contract.taskNodeId });
    await rpc('chat.inject', { sessionKey: project.sessionKey, message: task ? `Recorded objective: ${objective}` : 'U6 project ready', label: 'agent fixture' });
    const child = journey === 'continue' ? (await addSessionChainChildren(app, project, 0, 1))[0] : null;
    if (child) {
      await rpc('chat.inject', { sessionKey: child, message: `Recorded objective: ${objective}`, label: 'agent fixture' });
      await hostInvoke(app, 'taskLedger', 'linkSession', { workspaceId: project.workspaceId, sessionKey: child, nodeId: task!.contract.taskNodeId });
      await hostInvoke(app, 'workspaces', 'switch', { id: project.workspaceId });
      await hostInvoke(app, 'workspaces', 'update', { id: project.workspaceId, agentId: 'main', activeSessionKey: child, sessionKey: child });
      const childBinding = await hostInvoke<{ success: boolean; binding: { activeTaskNodeId?: string; sessionKey: string; sessionGeneration: string } }>(app,
        'workspaces', 'bindCoordinator', { workspaceId: project.workspaceId, sessionKey: child, agentId: 'main', expectedRevision: 0,
          taskLedgerNodeIds: [task!.contract.taskNodeId], environment: { kind: 'local', rootPath: sourceRoot }, archiveRestorePolicy: 'restore' });
      expect(childBinding).toMatchObject({ success: true, binding: { activeTaskNodeId: task!.contract.taskNodeId, sessionKey: child } });
      const childGeneration = await rpc<{ session: { sessionId: string } }>('sessions.describe', { key: child });
      expect(childBinding.binding.sessionGeneration).toBe(childGeneration.session.sessionId);
      const childClaim = await hostInvoke<{ result: { claim: { taskNodeId: string; sessionKey: string; generation: string } } }>(app,
        'taskLedger', 'command', { workspaceId: project.workspaceId, command: { action: 'claim', taskNodeId: task!.contract.taskNodeId,
          sessionKey: child, requestId: 'u6-continue-claim' } });
      expect(childClaim.result.claim).toMatchObject({ taskNodeId: task!.contract.taskNodeId, sessionKey: child,
        generation: childGeneration.session.sessionId });
      const childOwner = await hostInvoke<{ task: { contract: { taskNodeId: string }; claim?: { sessionKey: string; generation: string } } | null }>(app,
        'taskLedger', 'sessionTask', { workspaceId: project.workspaceId, sessionKey: child });
      expect(childOwner.task).toMatchObject({ contract: { taskNodeId: task!.contract.taskNodeId },
        claim: { sessionKey: child, generation: childGeneration.session.sessionId } });
      evidence.persistent_task_owner = { binding: childBinding, sessionTask: childOwner };
      await hostInvoke(app, 'workspaces', 'update', { id: project.workspaceId, agentId: 'main',
        activeSessionKey: project.sessionKey, sessionKey: project.sessionKey });
    }
    if (journey === 'crash-recovery') {
      const projectBinding = await hostInvoke<{ success: boolean; binding: { activeTaskNodeId?: string; sessionKey: string; sessionGeneration: string } }>(app,
        'workspaces', 'bindCoordinator', { workspaceId: project.workspaceId, sessionKey: project.sessionKey, agentId: 'main', expectedRevision: 0,
          taskLedgerNodeIds: [task!.contract.taskNodeId], environment: { kind: 'local', rootPath: sourceRoot }, archiveRestorePolicy: 'restore' });
      expect(projectBinding).toMatchObject({ success: true, binding: { activeTaskNodeId: task!.contract.taskNodeId,
        sessionKey: project.sessionKey, sessionGeneration: project.generation } });
      const projectClaim = await hostInvoke<{ result: { claim: { taskNodeId: string; sessionKey: string; generation: string } } }>(app,
        'taskLedger', 'command', { workspaceId: project.workspaceId, command: { action: 'claim', taskNodeId: task!.contract.taskNodeId,
          sessionKey: project.sessionKey, requestId: 'u6-crash-claim' } });
      expect(projectClaim.result.claim).toMatchObject({ taskNodeId: task!.contract.taskNodeId, sessionKey: project.sessionKey,
        generation: project.generation });
      const projectOwner = await hostInvoke<{ task: { contract: { taskNodeId: string }; claim?: { sessionKey: string; generation: string } } | null }>(app,
        'taskLedger', 'sessionTask', { workspaceId: project.workspaceId, sessionKey: project.sessionKey });
      expect(projectOwner.task).toMatchObject({ contract: { taskNodeId: task!.contract.taskNodeId },
        claim: { sessionKey: project.sessionKey, generation: project.generation } });
      evidence.persistent_task_owner = { binding: projectBinding, sessionTask: projectOwner };
    }
    let targetWorkspaceId: string | null = null;
    if (journey === 'cross-tree-migration') {
      git('worktree', 'add', '--detach', targetRoot, 'HEAD');
      await hostInvoke(app, 'workspaces', 'bindCoordinator', { workspaceId: project.workspaceId, sessionKey: project.sessionKey,
        agentId: 'main', expectedRevision: 0, taskLedgerNodeIds: [task!.contract.taskNodeId],
        environment: { kind: 'local', rootPath: sourceRoot }, archiveRestorePolicy: 'restore' });
      const claimed = await hostInvoke<{ result: { claim: unknown } }>(app, 'taskLedger', 'command', {
        workspaceId: project.workspaceId, command: { action: 'claim', taskNodeId: task!.contract.taskNodeId,
          sessionKey: project.sessionKey, requestId: 'u6-claim' } });
      await hostInvoke(app, 'taskLedger', 'command', { workspaceId: project.workspaceId, command: { action: 'checkpoint',
        credential: claimed.result.claim, checkpoint: { completed: ['Prior output retained'], nextAction: 'Continue in target',
          unresolved: [], artifacts: [{ path: join(sourceRoot, 'artifact.txt'), sha256: sha(content) }] } } });
      const checkpointSeed = await hostInvoke<{ task: { contract: { taskNodeId: string }; checkpoint?: { completed: string[]; nextAction: string;
        artifacts: Array<{ path: string; sha256: string }> } } }>(app, 'taskLedger', 'sessionTask',
        { workspaceId: project.workspaceId, sessionKey: project.sessionKey });
      expect(checkpointSeed.task.contract.taskNodeId).toBe(task!.contract.taskNodeId);
      expect(checkpointSeed.task.checkpoint).toMatchObject({ completed: ['Prior output retained'], nextAction: 'Continue in target' });
      const seedArtifact = checkpointSeed.task.checkpoint?.artifacts[0], expectedArtifact = join(sourceRoot, 'artifact.txt');
      expect(seedArtifact).toBeDefined(); expect(sameFile(seedArtifact!.path, expectedArtifact)).toBe(true);
      expect(seedArtifact!.sha256).toBe(sha(content)); expect(sha(await readFile(seedArtifact!.path))).toBe(sha(content));
      evidence.checkpoint_seed = { ...checkpointSeed, artifact_identity: { ...fileIdentity(seedArtifact!.path), expected: expectedArtifact } };
      await hostInvoke(app, 'chat', 'sendWithMedia', { workspaceId: project.workspaceId, sessionKey: project.sessionKey,
        message: 'U6-MIGRATION-INITIAL', idempotencyKey: 'u6-migration-initial' });
      await expect.poll(async () => JSON.stringify(await rpc('chat.history', { sessionKey: project.sessionKey, limit: 30 }))
        .includes('U6-ACK'), { timeout: 60_000 }).toBe(true);
      await expect.poll(async () => (await rpc<{ session: { hasActiveRun: boolean } }>('sessions.describe',
        { key: project.sessionKey })).session.hasActiveRun, { timeout: 30_000 }).toBe(false);
      evidence.migration_source_chat = { completed: true, sessionKey: project.sessionKey, expectedSessionGeneration: project.generation,
        send: 'U6-MIGRATION-INITIAL', reply: 'U6-ACK' };
      const target = await hostInvoke<{ activeWorkspace: { id: string } }>(app, 'workspaces', 'create', {
        name: 'U6 target', rootPath: targetRoot, agentId: 'main', activeSessionKey: 'agent:main:u6-target', permissionMode: 'fullAccess' });
      targetWorkspaceId = target.activeWorkspace.id;
      await hostInvoke(app, 'workspaces', 'switch', { id: project.workspaceId });
    }
    evidence.setup = ['isolated profile and Git fixture', 'scripted provider', 'project/session/history',
      ...(task ? ['persistent task contract', 'task/reference'] : []),
      ...(child || journey === 'crash-recovery' ? ['persistent task owner claim/readback'] : []),
      ...(child ? ['child/draft'] : []),
      ...(targetWorkspaceId ? ['linked checkout/claim/checkpoint', 'completed chat run binds source root'] : [])];
    evidence.identities = { project, child, taskNodeId: task?.contract.taskNodeId ?? null, targetWorkspaceId };
    await page.reload(); await expect(id('main-layout')).toBeVisible({ timeout: 30_000 });
    await expect(page.locator('html')).toHaveAttribute('lang', 'en');
    await expect(id('chat-composer-input')).toBeVisible();
    await expect(page.getByText(task ? `Recorded objective: ${objective}` : 'U6 project ready', { exact: true })).toBeVisible({ timeout: 30_000 });
    if (journey === 'crash-recovery') {
      const beforeCrash = { described: await rpc<{ session: { sessionId: string } }>('sessions.describe', { key: project.sessionKey }),
        history: await hostInvoke(app, 'sessions', 'history', { sessionKey: project.sessionKey, limit: 50 }) };
      expect(beforeCrash.described.session.sessionId).toBe(project.generation);
      expect(JSON.stringify(beforeCrash.history)).toContain(`Recorded objective: ${objective}`);
      const owned = app.process();
      expect(owned.kill('SIGKILL')).toBe(true);
      await expect.poll(() => owned.exitCode !== null || owned.signalCode !== null, { timeout: 15_000 }).toBe(true);
      const cleanup = await closeElectronApp(app); expect(cleanup.launcherExited).toBe(true);
      app = await launchElectronApp({ skipSetup: true, skipSeed: true, profileDir: userDataDir });
      const restartStartedAt = Date.now();
      await configureSessionChainProvider(app, llm.port);
      const gatewayStart = await hostInvoke<{ success: boolean }>(app, 'gateway', 'start')
        .then(result => ({ result, timeout: null as string | null }))
        .catch(error => {
          const timeout = String(error);
          if (!timeout.includes('[TIMEOUT] Host action gateway.start timed out after 60s')) throw error;
          return { result: null, timeout };
        });
      await expect.poll(async () => (await hostInvoke<{ state: string }>(app, 'gateway', 'status')).state,
        { timeout: 120_000 }).toBe('running');
      const gatewayReadyAfterMs = Date.now() - restartStartedAt;
      page = await getStableWindow(app); await expect(id('main-layout')).toBeVisible({ timeout: 30_000 });
      const afterCrash = { described: await rpc<{ session: { sessionId: string } }>('sessions.describe', { key: project.sessionKey }),
        history: await hostInvoke(app, 'sessions', 'history', { sessionKey: project.sessionKey, limit: 50 }) };
      expect(afterCrash.described.session.sessionId).toBe(project.generation);
      expect(JSON.stringify(afterCrash.history)).toContain(`Recorded objective: ${objective}`);
      evidence.fault = { kind: 'main-process-kill-after-persisted-task-history', pid: owned.pid, observed_exit: true,
        launcher_exited: cleanup.launcherExited, explicit_relaunch: true, gateway_start: gatewayStart,
        gateway_ready_after_ms: gatewayReadyAfterMs, same_session_generation: true, before: beforeCrash, after: afterCrash, user_steps: false };
    }
    await page.exposeFunction('u6Reminder', (text: string) => {
      if (!recording) return;
      const key = `${operation}:reminder:${text}`, prior = seen.get(key);
      const entry = add({ action: 'display', target: text, operation, success: true, source: 'rendered_ui',
        metrics: prior ? ['repeat_reminder'] : [], repeat_of: prior ?? null, caused_by: lastAction,
        rule: prior ? '同 operation 的相同提醒再次出现或新增一个可见副本' : '首次提醒显示' });
      seen.set(key, entry.id);
    });
    await page.evaluate(() => {
      let active = new Map<string, number>(), scheduled = false;
      const pending: Promise<void>[] = [];
      const scan = (emit = true) => {
        scheduled = false;
        const current = new Map<string, number>();
        for (const node of document.querySelectorAll<HTMLElement>('[role="alert"], [data-sonner-toast]')) {
          if (!node.getClientRects().length || getComputedStyle(node).visibility === 'hidden' || getComputedStyle(node).opacity === '0'
            || node.parentElement?.closest('[role="alert"], [data-sonner-toast]')) continue;
          const text = node.innerText.replace(/\s+/g, ' ').trim(); if (text) current.set(text, (current.get(text) ?? 0) + 1);
        }
        if (emit) for (const [text, count] of current) for (let i = active.get(text) ?? 0; i < count; i++)
          pending.push((window as unknown as { u6Reminder: (text: string) => Promise<void> }).u6Reminder(text));
        active = current;
      };
      new MutationObserver(() => { if (!scheduled) { scheduled = true; requestAnimationFrame(() => scan()); } })
        .observe(document.body, { childList: true, subtree: true, attributes: true, characterData: true });
      scan(false); const timer = setInterval(scan, 100);
      (window as unknown as { u6FinishReminders: () => Promise<void> }).u6FinishReminders = async () => { clearInterval(timer); scan(); await Promise.all(pending); };
    });
    let route = new URL(page.url()).hash.split('?')[0];
    page.on('framenavigated', frame => {
      if (!recording || !lastAction || frame !== page.mainFrame()) return;
      const next = new URL(frame.url()).hash.split('?')[0];
      if (next !== route) add({ action: 'navigate', target: next, before: route, after: next, operation, success: true,
        source: 'rendered_ui', metrics: ['page_transition'], repeat_of: null, caused_by: lastAction, rule: '主页面路由改变一次' });
      route = next;
    });
    recording = true;
    await page.screenshot({ path: info.outputPath('start.png') });
    if (journey === 'new-task') {
      await need('sidebar-footer-menu-trigger'); await click('sidebar-footer-menu-trigger');
      await need('sidebar-more-task-ledger'); await click('sidebar-more-task-ledger');
      await ui('click', 'tab:Persistent tasks', () => page.getByRole('tab', { name: 'Persistent tasks', exact: true }).click());
      await expect(id('managed-tasks')).toBeVisible();
      const create = page.getByRole('button', { name: 'Create persistent task', exact: true });
      await ui('click', 'button:Create persistent task/open', () => create.click());
      for (const [label, value, goalField] of [['Objective', objective, 'objective'], ['Artifact path relative to the worktree', 'artifact.txt', 'target'],
        ['Acceptance criterion', contract.acceptance[0].description, 'acceptance'], ['Constraints (optional)', 'Retain prior progress', 'constraints']]) {
        await ui('fill', `label:${label}`, () => page.getByLabel(label, { exact: true }).fill(value), { value, goalField });
      }
      await ui('click', 'label:Verification method', () => page.getByLabel('Verification method', { exact: true }).click());
      await ui('click', 'option:file-sha256', () => page.getByRole('option', { name: 'Artifact matches the approved content hash', exact: true }).click());
      await ui('fill', 'label:Expected artifact SHA-256', () => page.getByLabel('Expected artifact SHA-256', { exact: true }).fill(sha(content)));
      await ui('click', 'button:Create persistent task/submit', () => create.click(), { confirmation: 'create-task', value: JSON.stringify(contract) });
      await expect(id('managed-task')).toHaveCount(1); await expect(id('managed-task')).toContainText(objective);
      const created = await hostInvoke<{ tasks: Array<{ contract: { taskNodeId: string; objective: string } }> }>(app, 'taskLedger', 'queryTasks', { workspaceId: project.workspaceId });
      expect(created.tasks).toHaveLength(1); expect(created.tasks[0].contract.objective).toBe(objective); evidence.owner = created;
    } else if (journey === 'cross-tree-migration') {
      await need('execution-migration-open'); await click('execution-migration-open');
      await expect(id('execution-migration-dialog')).toBeVisible();
      if (await id('execution-migration-target').inputValue() !== targetWorkspaceId) await ui('selectOption', 'checkout:target',
        () => id('execution-migration-target').selectOption(targetWorkspaceId!), { identity: true, value: targetWorkspaceId! });
      await click('execution-migration-start', { confirmation: 'migrate', value: targetWorkspaceId! });
      await expect(id('execution-migration-dialog')).toHaveCount(0, { timeout: 60_000 });
      const moved = await hostInvoke<{ operation: { id: string; phase: string; sessionKey: string; targetGeneration: string } }>(app,
        'workspaces', 'executionMigration', { workspaceId: project.workspaceId, sessionKey: project.sessionKey });
      expect(moved.operation.phase).toBe('confirmed'); expect(moved.operation.sessionKey).toBe(project.sessionKey);
      expect(moved.operation.targetGeneration).not.toBe(project.generation); evidence.owner = moved;
      const read = await hostInvoke<{ task: { contract: { taskNodeId: string }; checkpoint?: { artifacts: Array<{ path: string; sha256: string }> } } }>(app,
        'taskLedger', 'sessionTask', { workspaceId: targetWorkspaceId, sessionKey: project.sessionKey });
      expect(read.task.contract.taskNodeId).toBe(task!.contract.taskNodeId);
      const movedArtifact = read.task.checkpoint?.artifacts[0]; expect(movedArtifact).toBeDefined();
      expect(sameFile(movedArtifact!.path, join(sourceRoot, 'artifact.txt'))).toBe(true); expect(movedArtifact!.sha256).toBe(sha(content));
      evidence.task_readback = { ...read, artifact_identity: { ...fileIdentity(movedArtifact!.path), expected: join(sourceRoot, 'artifact.txt') } };
    } else if (journey === 'archive-restore') {
      operation = 'archive:goal-v1';
      const sourceRow = id(`sidebar-session-${project.sessionKey}`), sourceMore = id(`sidebar-session-more-${project.sessionKey}`);
      await ui('hover', 'session:source', () => sourceRow.hover());
      await need(`sidebar-session-more-${project.sessionKey}`);
      await ui('click', 'session:more', async () => { await hoverUntilVisible(sourceRow, sourceMore); await sourceMore.click(); });
      await need('sidebar-session-context-delete');
      await click('sidebar-session-context-delete'); await expect(id('session-delete-dialog')).toBeVisible();
      await click('session-delete-dialog-archive', { confirmation: 'archive' });
      await expect(id(`sidebar-session-${project.sessionKey}`)).toHaveCount(0);
      await expect.poll(async () => (await hostInvoke<{ entries: Array<{ sessionKey: string }> }>(app, 'sessions', 'listArchived',
        { agentId: 'main' })).entries.some(entry => entry.sessionKey === project.sessionKey)).toBe(true);
      const archivedList = await hostInvoke<{ entries: Array<{ sessionKey: string }> }>(app, 'sessions', 'listArchived', { agentId: 'main' });
      operation = 'restore:goal-v1';
      await click('sidebar-footer-menu-trigger'); await need('sidebar-archive'); await click('sidebar-archive');
      await expect(id(`settings-archived-item-${project.sessionKey}`)).toBeVisible();
      await click(`settings-archived-restore-${project.sessionKey}`, { identity: true, confirmation: 'restore' });
      await expect(id(`settings-archived-item-${project.sessionKey}`)).toHaveCount(0);
      const restored = await rpc<{ session: { sessionId: string } }>('sessions.describe', { key: project.sessionKey });
      expect(restored.session.sessionId).not.toBe(project.generation); evidence.owner = restored;
      await expect.poll(async () => (await hostInvoke<{ entries: Array<{ sessionKey: string }> }>(app, 'sessions', 'listArchived',
        { agentId: 'main' })).entries.some(entry => entry.sessionKey === project.sessionKey)).toBe(false);
      const restoredList = await hostInvoke<{ entries: Array<{ sessionKey: string }> }>(app, 'sessions', 'listArchived', { agentId: 'main' });
      const restoredHistory = await hostInvoke(app, 'sessions', 'history', { sessionKey: project.sessionKey, limit: 50 });
      expect(JSON.stringify(restoredHistory)).toContain(`Recorded objective: ${objective}`);
      const retained = await hostInvoke<{ tasks: Array<{ contract: { taskNodeId: string } }> }>(app, 'taskLedger', 'queryTasks', { workspaceId: project.workspaceId });
      expect(retained.tasks.some(item => item.contract.taskNodeId === task!.contract.taskNodeId)).toBe(true);
      evidence.task_readback = retained; evidence.archive = { before: archivedList, restored, after: restoredList, history: restoredHistory };
      await need('settings-back-button'); await click('settings-back-button');
      if (!await page.getByText(`Recorded objective: ${objective}`, { exact: true }).isVisible())
        await click(`sidebar-session-${project.sessionKey}`, { identity: true });
      await expect(page.getByText(`Recorded objective: ${objective}`, { exact: true })).toBeVisible();
    } else if (journey === 'handoff') {
      await instrumentSessionChainHost(app);
      await page.evaluate(() => {
        const target = document.querySelector('[data-testid="chat-page"]')!;
        const state = window as unknown as { u6HandoffScopes: unknown[] };
        state.u6HandoffScopes = [];
        const capture = () => state.u6HandoffScopes.push({ at: Date.now(), generation: target.getAttribute('data-session-generation'), workspace: target.getAttribute('data-project-workspace') });
        capture(); new MutationObserver(capture).observe(target, { attributes: true, attributeFilter: ['data-session-generation', 'data-project-workspace'] });
      });
      await app.evaluate(() => {
        const { ipcMain } = process.mainModule!.require('electron') as typeof import('electron');
        const state = globalThis as unknown as { u6HandoffResults: unknown[] };
        state.u6HandoffResults = [];
        const original = (ipcMain as unknown as { _invokeHandlers: Map<string, (event: unknown, request: unknown) => Promise<unknown>> })._invokeHandlers.get('host:invoke')!;
        ipcMain.removeHandler('host:invoke');
        ipcMain.handle('host:invoke', async (event, request: { module?: string; action?: string }) => {
          const at = Date.now(); const response = await original(event, request);
          if (request.module === 'sessions' && request.action === 'prepareHandoff') state.u6HandoffResults.push({ at, receivedAt: Date.now(), response });
          return response;
        });
      });
      await ui('click', 'chat-header:options', () => id('chat-header-session-name').click());
      await need('chat-session-handoff');
      await expect(id('chat-session-handoff')).toBeEnabled();
      await ui('press', 'testid:chat-session-handoff:Enter', async () => {
        await id('chat-session-handoff').focus(); await id('chat-session-handoff').press('Enter');
      });
      await expect(id('chat-handoff-dialog')).toBeVisible();
      let draft = await id('chat-handoff-draft').inputValue(); expect(draft.trim()).not.toBe('');
      if (!draft.includes(objective)) {
        draft += `\nObjective: ${objective}`;
        await ui('fill', 'testid:chat-handoff-draft', () => id('chat-handoff-draft').fill(draft), { goalField: 'objective', value: objective });
      }
      await click('chat-handoff-create', { confirmation: 'create-and-send', value: draft });
      await expect(page.getByText('U6-ACK', { exact: true })).toBeVisible({ timeout: 60_000 });
      const handoff = await hostInvoke<{ operation: { id: string; phase: string; sessionKey: string } }>(app,
        'sessions', 'handoffOperation', { workspaceId: project.workspaceId, sessionKey: project.sessionKey, reconcile: true });
      expect(handoff.operation.phase).toBe('sent'); evidence.owner = handoff;
      const childRead = await rpc<{ session: { parentSessionKey: string } }>('sessions.describe', { key: handoff.operation.sessionKey });
      expect(childRead.session.parentSessionKey).toBe(project.sessionKey); evidence.child_readback = childRead;
    } else {
      const currentKey = child ?? project.sessionKey;
      if (child) { await need('session-family-children'); await ui('selectOption', 'session:child',
        () => id('session-family-children').selectOption(child), { identity: true, value: child }); }
      if (!child && !await page.getByText(`Recorded objective: ${objective}`, { exact: true }).isVisible())
        await click(`sidebar-session-${currentKey}`, { identity: true });
      await expect(page.getByText(`Recorded objective: ${objective}`, { exact: true })).toBeVisible({ timeout: 30_000 });
      await ui('fill', 'composer:continue', () => id('chat-composer-input').fill('Continue from the recorded objective.'));
      await click('chat-composer-send', { confirmation: 'continue', value: currentKey });
      await expect(page.getByText('U6-ACK', { exact: true })).toBeVisible({ timeout: 60_000 });
      const history = await hostInvoke(app, 'sessions', 'history', { sessionKey: currentKey, limit: 50 });
      expect(JSON.stringify(history)).toContain('U6-ACK'); evidence.owner = { sessionKey: currentKey, history };
      const linked = await hostInvoke<{ task: { contract: { taskNodeId: string } } | null }>(app, 'taskLedger', 'sessionTask',
        { workspaceId: project.workspaceId, sessionKey: currentKey });
      expect(linked.task?.contract.taskNodeId).toBe(task!.contract.taskNodeId); evidence.task_readback = linked;
      if (requiresTaskCall) {
        const issued = llm.log.find(entry => entry.issued === taskControlCallId);
        const withResult = llm.log.find(entry => taskControlCallId in entry.toolResults);
        expect(issued, `provider 未发出 ${taskControlCallId}`).toBeDefined();
        expect(withResult, `provider 未收到 ${taskControlCallId} 的工具结果`).toBeDefined();
        expect(withResult!.toolResults[taskControlCallId]).toContain(task!.contract.taskNodeId);
        evidence.task_control = { call_id: taskControlCallId, result: withResult!.toolResults[taskControlCallId] };
      }
    }
    expect(llm.anomalies).toEqual([]);
    expect(await readFile(join(sourceRoot, 'artifact.txt'), 'utf8')).toBe(content);
    await expect(page.getByRole('dialog')).toHaveCount(0);
    await page.evaluate(() => (window as unknown as { u6FinishReminders: () => Promise<void> }).u6FinishReminders());
    await page.screenshot({ path: info.outputPath('end.png') }); status = 'passed';
  } catch (error) {
    status = error instanceof Unsupported ? 'unsupported' : 'failed'; reason = String(error);
    if (status === 'unsupported') test.skip(true, reason); else throw error;
  } finally {
    recording = false;
    evidence.provider_log = llm?.log ?? [];
    if (page) await page.screenshot({ path: info.outputPath('final-state.png') }).catch(() => undefined);
    if (page && journey === 'handoff') evidence.handoff_scope_samples = await page.evaluate(() => (window as unknown as { u6HandoffScopes?: unknown[] }).u6HandoffScopes).catch(error => ({ error: String(error) }));
    const cleanupErrors: string[] = [];
    if (app) {
      if (journey === 'handoff') evidence.handoff_host_calls = await readSessionChainHostCalls(app).catch(error => ({ error: String(error) }));
      if (journey === 'handoff') evidence.handoff_host_results = await app.evaluate(() => (globalThis as unknown as { u6HandoffResults?: unknown[] }).u6HandoffResults).catch(error => ({ error: String(error) }));
      await hostInvoke(app, 'gateway', 'stop').catch(error => { evidence.gateway_stop_error = String(error); });
      try { await closeElectronApp(app); } catch (error) { cleanupErrors.push(String(error)); }
    }
    if (llm) {
      try { const server = llm.server; server.closeAllConnections(); await new Promise<void>(resolve => server.close(() => resolve())); }
      catch (error) { cleanupErrors.push(String(error)); }
    }
    const bodyPassed = status === 'passed';
    if (cleanupErrors.length) {
      evidence.first_body_status = status; evidence.first_body_reason = reason;
      evidence.cleanup_errors = cleanupErrors; status = 'failed'; reason ??= cleanupErrors[0];
    }
    evidence.status = status; evidence.reason = reason;
    evidence.counts_source = status === 'passed' ? 'successful_events' : null;
    evidence.counts = status === 'passed' ? countMetrics(events)
      : Object.fromEntries(metrics.map(metric => [metric, null]));
    await writeFile(info.outputPath('interaction-metrics.json'), JSON.stringify(evidence, null, 2));
    if (bodyPassed && cleanupErrors.length) cleanupFailure = new Error('U6 cleanup failed: ' + cleanupErrors.join('; '));
  }
  if (cleanupFailure) throw cleanupFailure;
});
