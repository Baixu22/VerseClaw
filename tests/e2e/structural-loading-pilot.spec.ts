import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { ElectronApplication, Page } from '@playwright/test';
import type { AgentSummary } from '@shared/types/agent';
import type { Skill } from '@shared/types/skill';
import type { CronJob } from '@shared/types/cron';
import {
  closeElectronApp,
  expect,
  getStableWindow,
  installIpcMocks,
  pinWindowContentSize,
  test,
} from './fixtures/electron';

const artifactDir = join(process.cwd(), 'artifacts', 'structural-loading-agents-v3');

const fixtureAgents: AgentSummary[] = [
  { id: 'main', name: 'Verse Assistant', isDefault: true, modelDisplay: 'DeepSeek V3.2', inheritedModel: true, avatar: { kind: 'brand', source: 'default', revision: 'pilot' } },
  { id: 'research', name: 'Research Studio', isDefault: false, modelDisplay: 'Claude Sonnet 4.5', inheritedModel: false, avatar: { kind: 'dicebear', source: 'config', revision: 'pilot', preset: { style: 'notionists-neutral', seed: 'research', backgroundColor: '#dbeafe' } } },
  { id: 'review', name: 'Code Reviewer', isDefault: false, modelDisplay: 'GPT-5', inheritedModel: false, avatar: { kind: 'dicebear', source: 'config', revision: 'pilot', preset: { style: 'lorelei-neutral', seed: 'reviewer', backgroundColor: '#e5e7eb' } } },
].map((agent) => ({ ...agent, workspace: `D:\\fixture\\${agent.id}`, agentDir: `D:\\fixture\\agents\\${agent.id}`, mainSessionKey: `agent:${agent.id}:main`, channelTypes: ['telegram'] } as AgentSummary));

const fixtureSnapshot = { agents: fixtureAgents, defaultAgentId: 'main', defaultModelRef: 'deepseek/deepseek-chat', configuredChannelTypes: ['telegram', 'discord'], channelOwners: {}, channelAccountOwners: {} };

const fixtureSkills: Skill[] = [
  { id: 'research-kit', name: 'Research Kit', description: 'Collect sources and compare evidence for a research brief.', icon: '🔎', enabled: true, source: 'workspace', version: '1.2.0', baseDir: 'D:\\fixture\\skills\\research-kit' },
  { id: 'review-tools', name: 'Review Tools', description: 'Inspect code changes and prepare a concise review.', icon: '🛠️', enabled: true, source: 'workspace', version: '1.0.0', baseDir: 'D:\\fixture\\skills\\review-tools' },
  { id: 'writing-studio', name: 'Writing Studio', description: 'Draft and refine clear documentation.', icon: '✍️', enabled: true, source: 'workspace', version: '1.1.0', baseDir: 'D:\\fixture\\skills\\writing-studio' },
];
const fixtureChannels = ['telegram', 'discord', 'feishu'].map((channelType) => ({
  channelType, defaultAccountId: 'main', status: 'connected',
  accounts: [{ accountId: 'main', name: 'Studio', configured: true, connected: true, isDefault: true, status: 'connected', agentId: 'main' }],
}));
const fixtureCron: CronJob[] = ['Morning Research', 'Review Digest', 'Weekly Notes'].map((name, index) => ({
  id: `pilot-${index}`, name, message: ['Prepare the daily research brief.', 'Summarize changes for the review queue.', 'Collect weekly notes for the workspace.'][index],
  schedule: { kind: 'cron', expr: '0 9 * * *', tz: 'Asia/Shanghai' },
  enabled: true, agentId: 'main', source: 'gateway',
  createdAt: '2026-10-20T00:00:00Z', updatedAt: '2026-10-20T00:00:00Z', nextRun: `2026-10-${21 + index}T01:00:00Z`,
}));

type LaunchElectronApp = (options?: {
  skipSetup?: boolean;
  settingsSectionDelayMs?: number;
  theme?: 'light' | 'dark' | 'system';
}) => Promise<ElectronApplication>;

async function openSettings(
  launchElectronApp: LaunchElectronApp,
  settingsSectionDelayMs: number,
  theme: 'light' | 'dark' | 'system' = 'light',
) {
  const app = await launchElectronApp({ skipSetup: true, settingsSectionDelayMs, theme });
  const page = await getStableWindow(app);
  page.on('pageerror', (error) => console.error('Agents renderer error:', error.message));
  page.on('console', (message) => { if (message.type() === 'error') console.error('Agents console:', message.text()); });
  await expect(page.getByTestId('main-layout')).toBeVisible();
  await page.getByTestId('sidebar-nav-settings').click();
  await expect(page.getByTestId('settings-back-button')).toBeVisible();
  return { app, page };
}

async function launchDelayedAgents(
  launchElectronApp: LaunchElectronApp,
  theme: 'light' | 'dark',
  delayMs: number,
  options: { reducedMotion?: boolean; width?: number; captureClock?: boolean } = {},
) {
  const app = await launchElectronApp({ skipSetup: true, theme });
  await installIpcMocks(app, {
    gatewayStatus: { state: 'stopped' },
    hostApi: {
      '["agents","list",null]': {
        __delayMs: delayMs,
        result: fixtureSnapshot,
      },
      '["channels","accounts",null]': {
        success: true,
        channels: ['telegram', 'discord'].map((channelType) => ({
          channelType, defaultAccountId: 'main', status: 'connected',
          accounts: fixtureAgents.slice(0, channelType === 'telegram' ? 3 : 1).map((agent) => ({ accountId: agent.id, name: channelType === 'telegram' ? 'Assistant' : 'Workspace', configured: true, connected: true, isDefault: agent.isDefault, status: 'connected', agentId: agent.id })),
        })),
      },
      '["providers","snapshot",null]': { success: true, accounts: [], statuses: [], vendors: [], defaultAccountId: '' },
      '["memory","proposeFactsList",null]': { success: true, enabled: false, candidates: [] },
      '["agents","getBootstrap",null]': { success: true, agentId: 'main', soulMd: '', defaultSkillIds: [], defaultMcpServerIds: [] },
      '["capabilities","publications",null]': { success: true, source: 'gateway', generatedAt: '2026-10-20T00:00:00Z', diagnostics: [], publications: [] },
    },
  });
  const page = await getStableWindow(app);
  page.on('pageerror', (error) => console.error('Agents renderer error:', error.message));
  page.on('console', (message) => { if (message.type() === 'error') console.error('Agents console:', message.text()); });
  await pinWindowContentSize(app, { width: options.width ?? 1280, height: 900 });
  if (options.reducedMotion) await page.emulateMedia({ reducedMotion: 'reduce' });
  if (options.captureClock) await page.clock.install();
  await page.reload();
  await expect(page.getByTestId('main-layout')).toBeVisible();
  await page.getByTestId('sidebar-nav-settings').click();
  await page.getByTestId('settings-nav-agents').click();
  return { app, page };
}

async function chromeBounds(page: Page) {
  return page.evaluate(() => ['.codex-settings-page__intro', '[data-testid="settings-sidebar"]', '[data-testid="agents-add-button"]'].map((selector) => {
    const box = document.querySelector(selector)!.getBoundingClientRect();
    return { selector, x: box.x, y: box.y, width: box.width, height: box.height };
  }));
}

async function noOverflow(page: Page) {
  expect(await page.evaluate(() => Array.from(document.querySelectorAll<HTMLElement>('[data-structural-surface="agents"], .codex-settings-page__scroll')).every((element) => element.scrollWidth <= element.clientWidth + 1))).toBe(true);
}

async function launchDataList(launchElectronApp: LaunchElectronApp, surfaceId: 'skills' | 'channels' | 'cron', theme: 'light' | 'dark') {
  const app = await launchElectronApp({ skipSetup: true, theme });
  await installIpcMocks(app, {
    gatewayStatus: { state: 'running', gatewayReady: true, port: 18789 },
    hostApi: {
      '["agents","list",null]': { success: true, ...fixtureSnapshot },
      '["providers","snapshot",null]': { success: true, accounts: [], statuses: [], vendors: [], defaultAccountId: '' },
      '["skills","local",null]': { __delayMs: surfaceId === 'skills' ? 2_200 : 0, result: { success: true, skills: fixtureSkills } },
      '["openclaw","getSkillsDir",null]': 'D:\\fixture\\skills',
      '["channels","accounts",null]': { __delayMs: surfaceId === 'channels' ? 2_200 : 0, result: { success: true, channels: fixtureChannels } },
      '["cron","list",null]': { __delayMs: surfaceId === 'cron' ? 2_200 : 0, result: fixtureCron },
      '["cron","deliveryTargets",null]': { success: true, channels: [] },
      '["agentBrowser","tasks",null]': { success: true, tasks: [] },
      '["skills","clawhubCapability",null]': { success: true, capability: {} },
    },
  });
  const page = await getStableWindow(app);
  await pinWindowContentSize(app, { width: 1280, height: 900 });
  await page.clock.install();
  await page.reload();
  await expect(page.getByTestId('main-layout')).toBeVisible();
  if (surfaceId === 'cron') {
    await page.getByTestId('sidebar-nav-cron').click();
  } else {
    await page.getByTestId('sidebar-nav-settings').click();
    await page.getByTestId(`settings-nav-${surfaceId}`).click();
  }
  return { app, page };
}

async function pauseClockNow(page: Page): Promise<void> {
  for (let attempt = 0; attempt < 6; attempt += 1) {
    const target = await page.evaluate(() => Date.now() + 5);
    try {
      await page.clock.pauseAt(target);
      return;
    } catch {
      // The fake clock advanced past the target between the two calls; retry.
    }
  }
  throw new Error('could not pause the fake clock before the reveal group advanced');
}

test.describe('progressive loading surfaces', () => {
  test.beforeAll(async () => {
    await mkdir(artifactDir, { recursive: true });
  });

  test('fast settings navigation never renders a structural surface', async ({ launchElectronApp }) => {
    const { app, page } = await openSettings(launchElectronApp, 0);
    try {
      await page.getByTestId('settings-nav-archived').click();
      await expect(page.getByTestId('settings-archived-section')).toBeVisible({ timeout: 5_000 });
      await expect(page.locator('[data-structural-surface]')).toHaveCount(0);
      await page.screenshot({ path: join(artifactDir, 'fast-archived.png'), fullPage: true });
      await writeFile(join(artifactDir, 'fast-archived.json'), JSON.stringify({
        driven_by: 'agent',
        actor: 'playwright-electron',
        surface: 'settings-archived',
        mode: 'fast',
        structuralSurfaces: 0,
      }, null, 2));
    } finally {
      await closeElectronApp(app);
    }
  });

  test('slow archived navigation uses only the quiet skeleton', async ({ launchElectronApp }) => {
    const { app, page } = await openSettings(launchElectronApp, 1_300);
    try {
      await page.getByTestId('settings-nav-archived').click();
      const loading = page.getByTestId('settings-section-loading');
      await expect(loading).toHaveAttribute('data-state', 'visible', { timeout: 3_000 });
      await expect(loading).toHaveAttribute('data-variant', 'archived');
      await expect(page.locator('[data-structural-surface]')).toHaveCount(0);
      await page.screenshot({ path: join(artifactDir, 'archived-quiet.png'), fullPage: true });
      await expect(page.getByTestId('settings-archived-section')).toBeVisible({ timeout: 5_000 });
      await expect(loading).toHaveCount(0);
    } finally {
      await closeElectronApp(app);
    }
  });

  for (const theme of ['light', 'dark'] as const) {
    test(`agents hands measured wireframes to three real groups in ${theme}`, async ({ launchElectronApp }) => {
      const { app, page } = await launchDelayedAgents(launchElectronApp, theme, 2_200, { captureClock: true });
      try {
        const surface = page.locator('[data-structural-surface="agents"]');
        await expect(surface).toHaveAttribute('data-state', 'visible', { timeout: 4_000 });
        await expect(surface.locator('[data-structural-canvas]')).toHaveCount(3);
        await expect(surface.locator('.component-construction-active')).toHaveCount(1);
        const chrome = await chromeBounds(page);
        const structureRows = await surface.locator('[data-build-state]').evaluateAll((elements) => elements.map((element) => ({ width: element.getBoundingClientRect().width, height: element.getBoundingClientRect().height })));
        await noOverflow(page);
        await page.screenshot({ path: join(artifactDir, `agents-structure-${theme}.png`) });

        // Observe the live handoff, then pause its visual clock solely for a reproducible capture.
        await page.waitForFunction(() => document.querySelector('[data-structural-surface="agents"]')?.getAttribute('data-reveal-group') === '2', null, { timeout: 5_000, polling: 50 });
        await pauseClockNow(page);
        expect(await chromeBounds(page)).toEqual(chrome);
        await expect(surface.locator('[data-build-state="complete"]')).toHaveCount(1);
        await expect(surface.locator('[data-build-state="pending"]')).toHaveCount(1);
        await expect(page.getByTestId('agent-card-main')).toContainText('DeepSeek V3.2');
        await expect(page.getByTestId('agent-card-main').locator('[data-build-chip]')).toHaveCount(2);
        await page.screenshot({ path: join(artifactDir, `agents-partial-${theme}.png`) });
        await page.clock.resume();

        await expect(surface).toHaveAttribute('data-state', 'idle');
        await expect(surface.locator('[data-structural-canvas]')).toHaveCount(0);
        await expect(surface.locator('[inert]')).toHaveCount(0);
        await expect(surface.locator('[data-build-state="complete"]')).toHaveCount(3);
        expect(await chromeBounds(page)).toEqual(chrome);
        const completeRows = await surface.locator('[data-build-state]').evaluateAll((elements) => elements.map((element) => ({ width: element.getBoundingClientRect().width, height: element.getBoundingClientRect().height })));
        expect(completeRows).toEqual(structureRows);
        await noOverflow(page);
        await page.screenshot({ path: join(artifactDir, `agents-complete-${theme}.png`) });
        await page.getByTestId('agent-settings-main').click();
        await expect(page.getByRole('dialog').first()).toBeVisible();
        await page.keyboard.press('Escape');
        await writeFile(join(artifactDir, `agents-${theme}.json`), JSON.stringify({ driven_by: 'agent', actor: 'playwright-electron', surface: 'agents', theme, data_source: 'synthetic-host-api-fixture', fixture: fixtureAgents.map(({ id, name, modelDisplay }) => ({ id, name, modelDisplay })), structureRows, completeRows, chrome, partial_capture: 'live group 2 observed, clock paused for screenshot only', constructionArtifactsAtComplete: 0, horizontalOverflow: false, settingsAction: 'opened real dialog', visual_verdict: 'requires image inspection' }, null, 2));
      } finally {
        await closeElectronApp(app);
      }
    });
  }

  test('agents reduced motion is static and content is immediate', async ({ launchElectronApp }) => {
    const { app, page } = await launchDelayedAgents(launchElectronApp, 'light', 5_000, { reducedMotion: true });
    try {
      const surface = page.locator('[data-structural-surface="agents"]');
      await expect(surface).toHaveAttribute('data-state', 'visible');
      await expect(surface.locator('[data-structural-canvas]')).toHaveCount(3);
      expect(await surface.locator('[data-structural-canvas]').evaluateAll((elements) => elements.flatMap((element) => Array.from(element.querySelectorAll('*')).filter((child) => getComputedStyle(child).animationName !== 'none')))).toEqual([]);
      await expect(surface).toHaveAttribute('data-state', 'idle');
      await expect(surface.locator('[data-build-state="complete"]')).toHaveCount(3);
      await expect(surface.locator('[data-structural-canvas]')).toHaveCount(0);
    } finally { await closeElectronApp(app); }
  });

  test('agents fast load and stable refresh keep real cards available', async ({ launchElectronApp }) => {
    const { app, page } = await launchDelayedAgents(launchElectronApp, 'light', 0);
    try {
      const surface = page.locator('[data-structural-surface="agents"]');
      await expect(page.getByTestId('agent-card-main')).toBeVisible();
      await expect(surface.locator('[data-structural-canvas]')).toHaveCount(0);
      await installIpcMocks(app, { hostApi: { '["agents","list",null]': { __delayMs: 1_200, result: fixtureSnapshot } } });
      await page.getByRole('button', { name: 'Refresh', exact: true }).first().click();
      await expect(page.getByTestId('agent-card-main')).toBeVisible();
      await expect(surface.locator('[data-structural-canvas]')).toHaveCount(0);
      await expect(page.getByTestId('agent-settings-main')).toBeEnabled();
    } finally { await closeElectronApp(app); }
  });

  test('agents construction stays clipped in a narrow window', async ({ launchElectronApp }) => {
    const { app, page } = await launchDelayedAgents(launchElectronApp, 'light', 1_600, { width: 800 });
    try {
      const surface = page.locator('[data-structural-surface="agents"]');
      await expect(surface).toHaveAttribute('data-state', 'visible');
      await noOverflow(page);
      await page.screenshot({ path: join(artifactDir, 'agents-narrow-structure.png') });
      await expect(surface).toHaveAttribute('data-state', 'idle');
      await noOverflow(page);
      await page.screenshot({ path: join(artifactDir, 'agents-narrow-complete.png') });
    } finally { await closeElectronApp(app); }
  });

  test('construction strokes travel along every outline before content is revealed', async ({ launchElectronApp }) => {
    const { app, page } = await launchDelayedAgents(launchElectronApp, 'light', 9_000);
    try {
      const surface = page.locator('[data-structural-surface="agents"]');
      await expect(surface).toHaveAttribute('data-state', 'visible', { timeout: 5_000 });
      const canvas = surface.locator('[data-structural-canvas]').first();
      await expect(canvas).toBeVisible();
      const bounds = await surface.boundingBox();
      // A pen stroke must start at zero length and finish later; freeze the CSS
      // timeline so the sampled offsets do not depend on machine speed.
      await page.addStyleTag({ content: '*{animation-play-state:paused !important}' });
      const read = (time: number) => canvas.evaluate((element, at) => {
        document.getAnimations().forEach((animation) => {
          animation.pause();
          animation.currentTime = at;
        });
        const offset = (selector: string) => {
          const target = element.querySelector(selector);
          return target ? Number.parseFloat(getComputedStyle(target).strokeDashoffset) : null;
        };
        const partOffsets = (name: string) => Array.from(element.querySelectorAll(`[data-build-part="${name}"] .component-construction-trace`))
          .map((target) => Number.parseFloat(getComputedStyle(target).strokeDashoffset));
        return {
          frame: offset('.component-construction-frame'),
          icon: partOffsets('icon'),
          title: partOffsets('title'),
          detail: partOffsets('detail'),
          meta: partOffsets('meta'),
          actions: partOffsets('actions'),
          dotsOpacity: Number.parseFloat(getComputedStyle(element.querySelector('.component-construction-dots')!).opacity),
        };
      }, time);
      const samples: Record<string, unknown>[] = [];
      for (const time of [0, 120, 240, 450, 1_100]) {
        samples.push({ timeMs: time, ...(await read(time)) });
        await page.screenshot({ path: join(artifactDir, `agents-drawing-${time}.png`), clip: bounds ?? undefined });
      }
      const at = (index: number) => samples[index] as {
        timeMs: number; frame: number; icon: number[]; title: number[]; detail: number[];
        meta: number[]; actions: number[]; dotsOpacity: number;
      };

      // The wavefront starts at the card's top-left corner: the icon leads, then
      // the title, chips and finally the actions at the far right.
      const delays = await canvas.evaluate((element) => {
        const milliseconds = (selector: string) => {
          const target = element.querySelector(selector);
          return target ? Number.parseFloat(getComputedStyle(target).animationDelay) * 1_000 : null;
        };
        return {
          frame: milliseconds('.component-construction-frame'),
          icon: milliseconds('[data-build-part="icon"] .component-construction-trace'),
          title: milliseconds('[data-build-part="title"] .component-construction-trace'),
          chip: milliseconds('[data-build-part="meta"] .component-construction-trace'),
          action: milliseconds('[data-build-part="actions"] .component-construction-trace'),
        };
      });
      expect(delays.frame).toBe(0);
      expect(delays.icon).not.toBeNull();
      expect(delays.icon!).toBeGreaterThan(0);
      expect(delays.title!).toBeGreaterThan(delays.icon!);
      expect(delays.chip!).toBeGreaterThan(delays.title!);
      expect(delays.action!).toBeGreaterThan(delays.chip!);

      // Nothing exists before the first stroke, so the build cannot read as "lines appear".
      expect(at(0).frame).toBe(1);
      expect([...at(0).icon, ...at(0).title, ...at(0).detail, ...at(0).meta, ...at(0).actions].every((value) => value === 1)).toBe(true);
      expect(at(0).dotsOpacity).toBe(0);

      // The boundary and the leading corner are drawing while the right side waits.
      expect(at(1).frame).toBeGreaterThan(0);
      expect(at(1).frame).toBeLessThan(1);
      expect(at(1).icon[0]).toBeGreaterThan(0);
      expect(at(1).icon[0]).toBeLessThan(1);
      expect(at(1).actions.every((value) => value === 1)).toBe(true);

      // The chips follow their corner while the actions are still untouched.
      expect(at(2).meta.some((value) => value > 0 && value < 1)).toBe(true);
      expect(at(2).actions.every((value) => value === 1)).toBe(true);

      // The far-right actions draw last, after the leading icon has arrived.
      expect(at(3).actions.some((value) => value > 0 && value < 1)).toBe(true);
      expect(at(3).icon[0]).toBe(0);

      // Everything resolves only after the last stroke arrives, before any content shows.
      expect([...at(4).icon, ...at(4).title, ...at(4).detail, ...at(4).meta, ...at(4).actions].every((value) => value === 0)).toBe(true);
      expect(at(4).frame).toBe(0);
      expect(at(4).dotsOpacity).toBe(1);

      await writeFile(join(artifactDir, 'agents-line-drawing.json'), JSON.stringify({
        driven_by: 'agent', actor: 'playwright-electron', samples,
        capture: 'CSS animations frozen at fixed elapsed times in Electron; normalized stroke length is measured',
      }, null, 2));
    } finally { await closeElectronApp(app); }
  });

  for (const surfaceId of ['skills', 'channels', 'cron'] as const) {
    for (const theme of ['light', 'dark'] as const) {
      test(`${surfaceId} constructs its own rows and reveals real groups in ${theme}`, async ({ launchElectronApp }) => {
        const { app, page } = await launchDataList(launchElectronApp, surfaceId, theme);
        try {
          const surface = page.locator(`[data-structural-surface="${surfaceId}"]`);
          await expect(surface).toHaveAttribute('data-state', 'visible', { timeout: 4_000 });
          await expect(surface.locator('[data-structural-canvas]')).toHaveCount(3);
          await expect(surface.locator('.component-construction-active')).toHaveCount(1);
          const bounds = await surface.boundingBox();
          await page.screenshot({ path: join(artifactDir, `${surfaceId}-structure-${theme}.png`) });

          await page.waitForFunction((id) => document.querySelector(`[data-structural-surface="${id}"]`)?.getAttribute('data-reveal-group') === '2', surfaceId, { timeout: 5_000, polling: 10 });
          await pauseClockNow(page);
          await expect(surface.locator('[data-build-state="complete"]')).toHaveCount(1);
          await expect(surface.locator('[data-build-state="pending"]')).toHaveCount(1);
          await expect(surface.locator('[data-build-state="complete"] [data-build-root]')).not.toBeEmpty();
          await page.screenshot({ path: join(artifactDir, `${surfaceId}-partial-${theme}.png`) });
          await page.clock.resume();

          await expect(surface).toHaveAttribute('data-state', 'idle');
          await expect(surface.locator('[data-structural-canvas]')).toHaveCount(0);
          await expect(surface.locator('[inert]')).toHaveCount(0);
          await expect(surface.locator('[data-build-state="complete"]')).toHaveCount(3);
          const completedBounds = await surface.boundingBox();
          expect(completedBounds?.x).toBe(bounds?.x);
          expect(completedBounds?.width).toBe(bounds?.width);
          expect(await surface.evaluate((element) => element.scrollWidth <= element.clientWidth + 1)).toBe(true);
          await page.screenshot({ path: join(artifactDir, `${surfaceId}-complete-${theme}.png`) });
          if (surfaceId === 'skills') {
            await page.getByTestId('skill-row-research-kit').click();
            await expect(page.getByRole('dialog').first()).toBeVisible();
            await page.keyboard.press('Escape');
          } else if (surfaceId === 'channels') {
            await expect(page.getByTestId('channel-add-telegram')).toBeEnabled();
            await page.getByTestId('channel-add-telegram').click();
            const modal = page.locator('.fixed.inset-0.z-50').filter({ has: page.getByRole('heading', { name: 'Configure Telegram' }) });
            await expect(modal).toBeVisible();
            await modal.locator('button').first().click();
            await expect(modal).toHaveCount(0);
          } else {
            await page.getByTestId('cron-job-card-pilot-0').click();
            await expect(page.getByTestId('cron-detail-panel')).toBeVisible();
          }
          await writeFile(join(artifactDir, `${surfaceId}-${theme}.json`), JSON.stringify({
            driven_by: 'agent', actor: 'playwright-electron', data_source: 'synthetic-host-api-fixture', surface: surfaceId, theme,
            realRows: 3, constructionArtifactsAtComplete: 0, horizontalOverflow: false,
            partial_capture: 'live group 2 observed, clock paused for screenshot only', bounds, completedBounds,
            visual_verdict: 'requires image inspection',
          }, null, 2));
        } finally { await closeElectronApp(app); }
      });
    }
  }
});
