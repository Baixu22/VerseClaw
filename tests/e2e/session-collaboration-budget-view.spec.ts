import { closeElectronApp, expect, getStableWindow, test } from './fixtures/electron';
import { hostInvoke, startGateway, startScriptedLlm } from './fixtures/fp-p1-harness';
import { configureSessionChainProvider, setSessionChainViewport } from './fixtures/session-task-chain';
import { createCollaborationProject } from './fixtures/session-collaboration';
import type { SessionCollaborationResources } from '../../shared/types/session-collaboration-resources';

const headings = { en: ['Host', 'Project', 'Session'], zh: ['宿主', '项目', '会话'],
  ja: ['ホスト', 'プロジェクト', 'セッション'], ru: ['Хост', 'Проект', 'Сессия'] } as const;

test('opens independent provider budgets from the keyboard in four locales and two widths', async ({ launchElectronApp }, info) => {
  test.setTimeout(360_000);
  const provider = await startScriptedLlm(() => ({ text: 'Budget fixture ready.' }));
  const app = await launchElectronApp({ skipSetup: true });
  try {
    await configureSessionChainProvider(app, provider.port);
    const project = await createCollaborationProject(app, info.outputPath('budget-workspace'), 'Budget workspace');
    const config = await hostInvoke<{ hash: string }>(app, 'gateway', 'rpc', { method: 'config.get', params: {} });
    const limits = { maxTokens: 500_000 };
    await hostInvoke(app, 'gateway', 'rpc', { method: 'config.patch', params: { baseHash: config.hash,
      raw: JSON.stringify({ runtime: { providerBudget: { host: limits, project: limits, session: limits } } }),
      note: 'Agent-driven collaboration budget fixture' } });
    await hostInvoke(app, 'gateway', 'stop');
    await startGateway(app);
    const turn = await hostInvoke<{ runId: string }>(app, 'gateway', 'rpc', { method: 'sessions.send', params: {
      key: project.sessionKey, expectedSessionId: project.generation, workspaceId: project.workspaceId, workspaceDir: project.rootPath,
      message: 'Fixture model request with an observed budget', idempotencyKey: 'collaboration-budget-provider-turn',
    } });
    const terminal = await hostInvoke<{ status: string }>(app, 'gateway', 'rpc', {
      method: 'agent.wait', params: { runId: turn.runId, timeoutMs: 60_000 }, timeoutMs: 65_000,
    });
    expect(terminal.status).toBe('ok');
    const observed = await hostInvoke<{ resources: SessionCollaborationResources }>(app, 'sessionActivity', 'resources',
      { requester: project.scope, target: project.scope });
    const spend = observed.resources.inventory?.owners.find(owner => owner.kind === 'provider')?.spend ?? [];
    expect(spend.map(row => row.scope)).toEqual(['host', 'project', 'session']);
    expect(spend.find(row => row.scope === 'session')?.spentTokens).toBeGreaterThan(0);

    const page = await getStableWindow(app);
    for (const [locale, expected] of Object.entries(headings)) {
      await hostInvoke(app, 'settings', 'set', { key: 'language', value: locale });
      await setSessionChainViewport(app, { width: locale === 'zh' || locale === 'ja' ? 1000 : 1360, height: 820 });
      await page.reload();
      await page.getByTestId('sidebar-nav-system').click();
      await page.getByTestId(`collaboration-row-${encodeURIComponent(project.sessionKey)}`).click();
      const resources = page.getByTestId('collaboration-resources');
      const toggle = resources.locator('summary').first();
      await toggle.focus();
      await toggle.press('Enter');
      for (const [index, scope] of (['host', 'project', 'session'] as const).entries()) {
        await expect(resources.getByTestId(`collaboration-budget-${scope}`).getByRole('heading')).toHaveText(expected[index]);
      }
      await expect(toggle).toBeFocused();
      expect(await resources.evaluate(element => element.scrollWidth <= element.clientWidth + 1)).toBe(true);
    }
  } finally { await closeElectronApp(app); await provider.close(); }
});
