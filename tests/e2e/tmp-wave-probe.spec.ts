import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { AgentSummary } from '@shared/types/agent';
import { closeElectronApp, expect, getStableWindow, installIpcMocks, pinWindowContentSize, test } from './fixtures/electron';

const outDir = 'D:\\tmp\\wave-probe';

const agents: AgentSummary[] = [
  { id: 'main', name: 'Verse Assistant', isDefault: true, modelDisplay: 'DeepSeek V3.2', inheritedModel: true },
  { id: 'research', name: 'Research Studio', isDefault: false, modelDisplay: 'Claude Sonnet 4.5', inheritedModel: false },
  { id: 'review', name: 'Code Reviewer', isDefault: false, modelDisplay: 'GPT-5', inheritedModel: false },
].map((agent) => ({ ...agent, avatar: { kind: 'brand', source: 'default', revision: 'p' }, workspace: `D:\\fixture\\${agent.id}`, agentDir: `D:\\fixture\\agents\\${agent.id}`, mainSessionKey: `agent:${agent.id}:main`, channelTypes: ['telegram'] } as AgentSummary));

test('probe wave order', async ({ launchElectronApp }) => {
  await mkdir(outDir, { recursive: true });
  const app = await launchElectronApp({ skipSetup: true, theme: 'light' });
  await installIpcMocks(app, {
    gatewayStatus: { state: 'stopped' },
    hostApi: {
      '["agents","list",null]': { __delayMs: 30_000, result: { agents, defaultAgentId: 'main', defaultModelRef: 'deepseek/deepseek-chat', configuredChannelTypes: ['telegram'], channelOwners: {}, channelAccountOwners: {} } },
      '["channels","accounts",null]': { success: true, channels: [] },
      '["providers","snapshot",null]': { success: true, accounts: [], statuses: [], vendors: [], defaultAccountId: '' },
      '["memory","proposeFactsList",null]': { success: true, enabled: false, candidates: [] },
      '["agents","getBootstrap",null]': { success: true, agentId: 'main', soulMd: '', defaultSkillIds: [], defaultMcpServerIds: [] },
      '["capabilities","publications",null]': { success: true, source: 'gateway', generatedAt: '2026-10-20T00:00:00Z', diagnostics: [], publications: [] },
    },
  });
  const page = await getStableWindow(app);
  await pinWindowContentSize(app, { width: 1280, height: 900 });
  await page.reload();
  await expect(page.getByTestId('main-layout')).toBeVisible();
  await page.getByTestId('sidebar-nav-settings').click();
  await page.getByTestId('settings-nav-agents').click();
  const surface = page.locator('[data-structural-surface="agents"]');
  await expect(surface).toHaveAttribute('data-state', 'visible', { timeout: 5_000 });
  const box = await surface.boundingBox();
  await page.addStyleTag({ content: '*{animation-play-state:paused !important}' });
  const samples: unknown[] = [];
  for (const time of [0, 150, 300, 450, 700]) {
    samples.push(await page.evaluate((t) => {
      document.getAnimations().forEach((animation) => {
        animation.pause();
        animation.currentTime = t;
      });
      const canvas = document.querySelector('[data-structural-surface="agents"] svg.component-construction');
      if (!canvas) return { t, missing: true };
      const read = (selector: string) => {
        const node = canvas.querySelector(selector);
        const style = node ? getComputedStyle(node) : null;
        return node && style ? { delay: style.animationDelay, offset: Number.parseFloat(style.strokeDashoffset) } : null;
      };
      return {
        t,
        frame: read('.component-construction-frame'),
        icon: read('[data-build-part="icon"] .component-construction-trace'),
        title: read('[data-build-part="title"] .component-construction-trace'),
        chips: Array.from(canvas.querySelectorAll('[data-build-part="meta"] .component-construction-trace')).map((node) => ({ delay: getComputedStyle(node).animationDelay, offset: Number.parseFloat(getComputedStyle(node).strokeDashoffset) })),
        actions: Array.from(canvas.querySelectorAll('[data-build-part="actions"] .component-construction-trace')).map((node) => ({ delay: getComputedStyle(node).animationDelay, offset: Number.parseFloat(getComputedStyle(node).strokeDashoffset) })),
      };
    }, time));
    await page.screenshot({ path: join(outDir, `agents-${time}.png`), clip: box ?? undefined });
  }
  await writeFile(join(outDir, 'samples.json'), JSON.stringify(samples, null, 2));
  await closeElectronApp(app);
});
