import { link, mkdir, readFile, stat, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { WorkspaceSnapshot } from '../../shared/types/workspace';
import type { WorkspacePreflightResult } from '../../electron/services/workspace-preflight';
import { closeElectronApp, expect, getStableWindow, test } from './fixtures/electron';
import { hostInvoke } from './fixtures/fp-p1-harness';

test('Coding Host expands workspace paths and binds approved external content', async ({ homeDir, userDataDir, launchElectronApp }, testInfo) => {
  test.setTimeout(180_000);
  const workspaceRoot = join(homeDir, 'coding-save-workspace');
  const outsideRoot = join(userDataDir, 'coding-save-outside');
  await mkdir(workspaceRoot, { recursive: true });
  await mkdir(outsideRoot, { recursive: true });
  const original = join(outsideRoot, 'linked.txt');
  const alias = join(workspaceRoot, 'linked.txt');
  const ordinary = join(workspaceRoot, 'ordinary.txt');
  const external = join(outsideRoot, 'approved.txt');
  const literalDir = join(workspaceRoot, '~');
  const literal = join(literalDir, 'literal.txt');
  const literalShadow = join(workspaceRoot, 'literal.txt');
  await mkdir(literalDir);
  await writeFile(original, 'retained outside');
  await link(original, alias);
  await writeFile(ordinary, 'old ordinary');
  await writeFile(external, 'old external');
  await writeFile(literal, 'old literal');
  await writeFile(literalShadow, 'retained literal shadow');
  const ordinaryInode = (await stat(ordinary, { bigint: true })).ino;
  const externalInode = (await stat(external, { bigint: true })).ino;
  const app = await launchElectronApp({ skipSetup: true });
  try {
    const page = await getStableWindow(app);
    await expect(page.getByTestId('main-layout')).toBeVisible();
    const rootPath = '~/coding-save-workspace';
    const preflight = await hostInvoke<WorkspacePreflightResult>(app, 'workspaces', 'preflight', { rootPath });
    expect(preflight).toMatchObject({ ok: true, rootPath, resolvedPath: workspaceRoot });
    const homePreflight = await hostInvoke<WorkspacePreflightResult>(app, 'workspaces', 'preflight', { rootPath: '~' });
    expect(homePreflight.ok).toBe(false);
    expect(homePreflight.checks).toContainEqual({ id: 'sensitivePath', status: 'fail', detail: 'homeRoot' });
    const workspace = await hostInvoke<WorkspaceSnapshot>(app, 'workspaces', 'create', {
      name: 'Coding save boundary', rootPath, agentId: 'main', permissionMode: 'acceptEdits',
    });
    expect(workspace.activeWorkspace?.rootPath).toBe(workspaceRoot);
    type SaveResult = { ok: boolean; error?: string; approvalRequired?: boolean; approval?: { id: string } };
    const denied = await hostInvoke<SaveResult>(app, 'files', 'writeText', { path: alias, content: 'must not escape' });
    expect(denied).toMatchObject({ ok: false, error: 'unsafePath' });
    expect(await readFile(original, 'utf8')).toBe('retained outside');
    expect(await readFile(alias, 'utf8')).toBe('retained outside');
    const saved = await hostInvoke<SaveResult>(app, 'files', 'writeText', { path: ordinary, content: 'new ordinary' });
    expect(saved.ok).toBe(true);
    expect(await readFile(ordinary, 'utf8')).toBe('new ordinary');
    expect((await stat(ordinary, { bigint: true })).ino).toBe(ordinaryInode);
    const literalSaved = await hostInvoke<SaveResult>(app, 'files', 'writeText', { path: literal, content: 'new literal' });
    expect(literalSaved.ok).toBe(true);
    expect(await readFile(literal, 'utf8')).toBe('new literal');
    expect(await readFile(literalShadow, 'utf8')).toBe('retained literal shadow');
    const pending = await hostInvoke<SaveResult>(app, 'files', 'writeText', { path: external, content: 'new external' });
    expect(pending.approvalRequired).toBe(true);
    await hostInvoke(app, 'permissions', 'decideApproval', { id: pending.approval!.id, decision: 'approved' });
    const changedContent = await hostInvoke<SaveResult>(app, 'files', 'writeText', {
      path: external, content: 'bad external', approvalId: pending.approval!.id,
    });
    expect(changedContent).toMatchObject({ ok: false, error: 'approvalRequired' });
    expect(await readFile(external, 'utf8')).toBe('old external');
    const approved = await hostInvoke<SaveResult>(app, 'files', 'writeText', {
      path: external, content: 'new external', approvalId: pending.approval!.id,
    });
    expect(approved.ok).toBe(true);
    expect(await readFile(external, 'utf8')).toBe('new external');
    expect((await stat(external, { bigint: true })).ino).toBe(externalInode);
    const reused = await hostInvoke<SaveResult>(app, 'files', 'writeText', {
      path: external, content: 'new external', approvalId: pending.approval!.id,
    });
    expect(reused).toMatchObject({ ok: false, error: 'approvalRequired' });
    await writeFile(testInfo.outputPath('coding-save-boundary.json'), JSON.stringify({
      driven_by: 'agent', actor: 'coding-path-approval-issues-274-276', denied, saved, pending, changedContent, approved, reused, literalSaved,
      preflight, homePreflight,
      outsideRetained: await readFile(original, 'utf8'), ordinary: await readFile(ordinary, 'utf8'),
      external: await readFile(external, 'utf8'),
      literal: await readFile(literal, 'utf8'), literalShadow: await readFile(literalShadow, 'utf8'),
    }, null, 2));
  } finally { await closeElectronApp(app); }
});
