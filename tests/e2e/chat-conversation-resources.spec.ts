import { writeFile } from 'node:fs/promises';
import type { Locator, Page } from '@playwright/test';
import { closeElectronApp, expect, getStableWindow, installIpcMocks, test } from './fixtures/electron';
import {
  buildResourceHistory,
  REMOTE_HOST,
  SESSION_KEY,
  writeLateAudio,
  writeResourceFixtures,
  type ResourcePaths,
} from './fixtures/conversation-resource-fixtures';

function stableStringify(value: unknown): string {
  if (value == null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map((item) => stableStringify(item)).join(',')}]`;
  return `{${Object.entries(value as Record<string, unknown>)
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([key, entryValue]) => `${JSON.stringify(key)}:${stableStringify(entryValue)}`)
    .join(',')}}`;
}

function audioCard(page: Page, name: string): Locator {
  return page.getByTestId('chat-resource-audio').filter({ hasText: name });
}

function videoCard(page: Page, name: string): Locator {
  return page.getByTestId('chat-resource-video').filter({ hasText: name });
}

function chart(page: Page, title: string): Locator {
  return page.getByTestId('chat-tool-ui-card').filter({ hasText: title }).getByTestId('chat-tool-ui-chart');
}

async function expectPlayable(card: Locator): Promise<void> {
  await expect(card).toHaveAttribute('data-status', 'ready', { timeout: 20_000 });
  const player = card.getByTestId('chat-resource-player');
  await expect(player).toHaveAttribute('controls', '');
  // A Blob from the Main file boundary, never a file:// or Gateway source.
  await expect.poll(() => player.evaluate((element: HTMLMediaElement) => element.currentSrc || element.src)).toMatch(/^blob:/);
  await expect.poll(() => player.evaluate((element: HTMLMediaElement) => element.readyState), { timeout: 15_000 }).toBeGreaterThanOrEqual(1);
  await expect.poll(() => player.evaluate((element: HTMLMediaElement) => element.duration), { timeout: 15_000 }).toBeGreaterThan(0);
}

async function expectAllResources(page: Page): Promise<void> {
  // Audio from the Gateway's own block, once, though the tool result names it too.
  await expect(audioCard(page, 'tts-reply.wav')).toHaveCount(1, { timeout: 30_000 });
  await expectPlayable(audioCard(page, 'tts-reply.wav'));
  await expect(audioCard(page, 'tts-reply.wav')).toContainText('Voice note');

  // A resource-only message in a folded run.
  await expectPlayable(audioCard(page, 'theme.wav'));

  // Media beside reply text in a folded run.
  await expectPlayable(videoCard(page, 'clip.webm'));
  await expect(page.getByText('Your video is ready.')).toBeVisible();
  await expect(videoCard(page, 'clip.webm').getByTestId('chat-resource-player').evaluate((element) => element.tagName)).resolves.toBe('VIDEO');

  // Artifacts from a tool the runtime knows nothing about.
  await expectPlayable(audioCard(page, 'speech-output.wav'));
  await expect(audioCard(page, 'archive-old.wav')).toHaveCount(0);
  await expectPlayable(audioCard(page, 'narration.wav'));
  await expect(audioCard(page, 'never-written.wav')).toHaveCount(0);
  await expect(page.getByText('out/never-written.wav')).toBeVisible();

  // Failure states say what happened.
  await expect(videoCard(page, 'broken.mp4')).toHaveAttribute('data-status', 'unsupported', { timeout: 20_000 });
  await expect(videoCard(page, 'broken.mp4')).toContainText('cannot be played here');
  await expect(videoCard(page, 'remote.mp4')).toHaveAttribute('data-status', 'remote');
  await expect(videoCard(page, 'remote.mp4').getByTestId('chat-resource-player')).toHaveCount(0);
  await expect(audioCard(page, 'Voice memo')).toHaveAttribute('data-status', 'unavailable');

  // Images.
  await expect(page.getByAltText('Generated poster')).toHaveAttribute('src', /^data:image\//, { timeout: 20_000 });
  await expect(page.getByAltText('local-render.png')).toHaveAttribute('src', /^data:image\//, { timeout: 20_000 });
  const remoteImage = page.getByTestId('chat-resource-image').filter({ hasText: 'Tracking pixel' });
  await expect(remoteImage).toHaveAttribute('data-status', 'remote');
  await expect(remoteImage).toContainText(REMOTE_HOST);
  await expect(remoteImage).not.toContainText('SECRET-TOKEN');

  const gallery = page.getByTestId('chat-tool-ui-image-gallery');
  await expect(gallery.getByTestId('chat-resource-image').and(page.locator('[data-status="ready"]'))).toHaveCount(3, { timeout: 20_000 });
  await expect(gallery.locator('[data-status="remote"]')).toHaveCount(1);
  await expect(gallery.locator('[data-status="unavailable"]')).toHaveCount(1);
  for (const image of await gallery.locator('img').all()) {
    await expect(image).toHaveAttribute('src', /^data:image\//);
  }

  // Charts draw what they declare.
  await expect(chart(page, 'Latency line')).toHaveAttribute('data-chart-type', 'line');
  await expect(chart(page, 'Latency line').locator('[data-chart-mark="line"]')).toHaveCount(2);
  await expect(chart(page, 'Latency line').locator('[data-chart-mark="bar"]')).toHaveCount(0);
  await expect(chart(page, 'Revenue bars')).toHaveAttribute('data-chart-type', 'bar');
  await expect(chart(page, 'Revenue bars').locator('[data-chart-mark="bar"]')).toHaveCount(6);
  await expect(chart(page, 'Traffic area')).toHaveAttribute('data-chart-type', 'area');
  await expect(chart(page, 'Traffic area').locator('[data-chart-mark="area"]')).toHaveCount(1);
  await expect(chart(page, 'Share pie')).toHaveAttribute('data-chart-type', 'pie');
  await expect(chart(page, 'Share pie').locator('[data-chart-mark="slice"]')).toHaveCount(3);
  await expect(chart(page, 'Unsupported scatter').getByTestId('chat-chart-notice')).toContainText('scatter');
  await expect(chart(page, 'Unsupported scatter').getByTestId('chat-chart-table')).toBeVisible();
  await expect(chart(page, 'Unsupported scatter').getByTestId('chat-chart-plot')).toHaveCount(0);

  await expect(page.getByTestId('chat-tool-ui-table')).toContainText('North');
  await expect(page.getByTestId('chat-tool-ui-weather')).toContainText('Seattle');
  const search = page.getByTestId('chat-tool-ui-web-search');
  const searchToggle = search.getByTestId('chat-web-search-trigger');
  await searchToggle.click();
  await expect(search).toContainText('Search source');
  await searchToggle.click();

  // Files, links, and the unknown.
  await expect(page.getByTestId('assistant-attachment-card').filter({ hasText: 'report.pdf' })).toHaveCount(1, { timeout: 20_000 });
  const link = page.getByTestId('chat-resource-website-link').filter({ hasText: 'Project docs' });
  await expect(link.getByRole('link', { name: 'Project docs' })).toHaveAttribute('href', `https://${REMOTE_HOST}/docs`);
  await expect(page.getByRole('link', { name: 'inline link' })).toHaveCount(1);
  await expect(page.locator('main iframe[src*="example.invalid"], iframe[src*="example.invalid"]')).toHaveCount(0);

  const flow = page.getByTestId('chat-resource-unknown').filter({ hasText: 'Flow diagram' });
  await expect(flow).toHaveAttribute('data-resource-type', 'sankey');
  await expect(flow).toContainText('Traffic between stages');
  await expect(flow).not.toContainText('SECRET-KEY');
  const board = page.getByTestId('chat-resource-unknown').filter({ hasText: 'Live dashboard' });
  await expect(board).toHaveAttribute('data-resource-type', 'canvas');
  await expect(board).not.toContainText('SECRET-TOKEN');
  await expect(page.getByText('"type":"sankey"')).toHaveCount(0);
}

test.describe('Conversation resources', () => {
  test('renders every resource type, degrades explicitly, and survives history reload', async ({ launchElectronApp, homeDir }, testInfo) => {
    test.setTimeout(300_000);
    const paths: ResourcePaths = await writeResourceFixtures(homeDir);
    const history = buildResourceHistory(paths);
    const app = await launchElectronApp({ skipSetup: true, visualMode: true });

    try {
      await installIpcMocks(app, {
        gatewayStatus: { state: 'running', port: 18789, pid: 12345 },
        gatewayRpc: {
          [stableStringify(['sessions.list', {}])]: {
            success: true,
            result: { sessions: [{ key: SESSION_KEY, displayName: 'main' }] },
          },
          [stableStringify(['chat.history', { sessionKey: SESSION_KEY, limit: 200, maxChars: 500000 }])]: {
            success: true,
            result: { messages: history },
          },
          [stableStringify(['chat.history', { sessionKey: SESSION_KEY, limit: 1000, maxChars: 500000 }])]: {
            success: true,
            result: { messages: history },
          },
        },
        hostApi: {
          [stableStringify(['media', 'linkPreview', null])]: null,
          [stableStringify(['/api/gateway/status', 'GET'])]: {
            ok: true,
            data: { status: 200, ok: true, json: { state: 'running', port: 18789, pid: 12345 } },
          },
          [stableStringify(['/api/agents', 'GET'])]: {
            ok: true,
            data: { status: 200, ok: true, json: { success: true, agents: [{ id: 'main', name: 'main', workspace: paths.workspace }] } },
          },
          // Never launch a real browser from a test; the call itself is what is asserted.
          [stableStringify(['shell', 'openExternal', null])]: { ok: true, data: { status: 200, ok: true, json: {} } },
        },
      });

      const page = await getStableWindow(app);
      const remoteRequests: string[] = [];
      const fileRequests: string[] = [];
      const cspViolations: string[] = [];
      page.on('request', (request) => {
        if (request.url().includes(REMOTE_HOST)) remoteRequests.push(request.url());
        if (/\.(?:wav|webm|mp4)(?:$|\?)/i.test(request.url()) && request.url().startsWith('file:')) fileRequests.push(request.url());
      });
      page.on('console', (message) => {
        if (/Content Security Policy/i.test(message.text())) cspViolations.push(message.text());
      });

      await page.reload().catch((error) => {
        if (!String(error).includes('ERR_FILE_NOT_FOUND')) throw error;
      });

      await expectAllResources(page);

      // A missing file reports it; once the file exists, Retry reaches the player.
      const late = audioCard(page, 'later.wav');
      await expect(late).toHaveAttribute('data-status', 'notFound', { timeout: 20_000 });
      await expect(late).toContainText('File not found');
      await expect(late.getByRole('alert')).toBeVisible();
      await writeLateAudio(paths);
      await late.getByTestId('chat-resource-retry').click();
      await expectPlayable(late);

      // The players actually play; muted so the test needs no audio device.
      for (const card of [audioCard(page, 'theme.wav'), videoCard(page, 'clip.webm')]) {
        await card.scrollIntoViewIfNeeded();
        const player = card.getByTestId('chat-resource-player');
        await player.evaluate((element: HTMLMediaElement) => {
          element.muted = true;
          return element.play();
        });
        await expect.poll(() => player.evaluate((element: HTMLMediaElement) => element.currentTime), { timeout: 10_000 }).toBeGreaterThan(0);
        await player.evaluate((element: HTMLMediaElement) => element.pause());
      }

      // Shared lightbox from a gallery tile.
      const tile = page.getByTestId('chat-tool-ui-image-gallery').locator('[data-status="ready"]').first();
      await tile.scrollIntoViewIfNeeded();
      await tile.click();
      await expect(page.getByTestId('chat-image-lightbox')).toBeVisible();
      await page.keyboard.press('Escape');
      await expect(page.getByTestId('chat-image-lightbox')).toHaveCount(0);

      // Keyboard reaches a chart's values; the table holds them all.
      const lineChart = chart(page, 'Latency line');
      await lineChart.scrollIntoViewIfNeeded();
      await lineChart.getByTestId('chat-chart-plot').focus();
      await page.keyboard.press('ArrowRight');
      await expect(lineChart.getByTestId('chat-chart-tooltip')).toContainText('Tue');
      await expect(lineChart.getByTestId('chat-chart-tooltip')).toContainText('282');
      await lineChart.getByTestId('chat-chart-table-toggle').click();
      await expect(lineChart.getByTestId('chat-chart-table')).toContainText('Fri');
      await lineChart.getByTestId('chat-chart-table-toggle').click();

      // Copy carries only what the card shows.
      const flow = page.getByTestId('chat-resource-unknown').filter({ hasText: 'Flow diagram' });
      await flow.scrollIntoViewIfNeeded();
      await flow.getByTestId('chat-resource-copy').click();
      await expect.poll(() => app.evaluate(async ({ clipboard }) => clipboard.readText())).toContain('Flow diagram');
      expect(await app.evaluate(async ({ clipboard }) => clipboard.readText())).not.toContain('SECRET-KEY');

      // Opening a link goes through Main's host API, not the renderer's network.
      const link = page.getByTestId('chat-resource-website-link').filter({ hasText: 'Project docs' });
      await link.scrollIntoViewIfNeeded();
      await link.getByTestId('chat-resource-open-external').click();
      await expect.poll(() => app.evaluate(() => {
        const calls = (globalThis as unknown as { __verseClawE2eHostCalls?: Array<{ module?: string; action?: string; payload?: { url?: string } }> }).__verseClawE2eHostCalls ?? [];
        return calls.filter((call) => call.module === 'shell' && call.action === 'openExternal').map((call) => call.payload?.url);
      })).toEqual([`https://${REMOTE_HOST}/docs`]);

      // History reload rebuilds every resource, once each.
      await page.reload().catch((error) => {
        if (!String(error).includes('ERR_FILE_NOT_FOUND')) throw error;
      });
      await expectAllResources(page);
      await expectPlayable(audioCard(page, 'later.wav'));
      for (const name of ['tts-reply.wav', 'theme.wav', 'speech-output.wav', 'narration.wav']) {
        await expect(audioCard(page, name)).toHaveCount(1);
      }
      await expect(videoCard(page, 'clip.webm')).toHaveCount(1);

      // Agent-driven screenshots in both themes; never evidence of human review.
      const shots: string[] = [];
      const capture = async (theme: 'light' | 'dark') => {
        await page.evaluate((next) => {
          document.documentElement.classList.remove('light', 'dark');
          document.documentElement.classList.add(next);
        }, theme);
        await page.setViewportSize({ width: 1280, height: 1100 });
        const anchors: Array<[string, Locator]> = [
          ['audio', audioCard(page, 'tts-reply.wav')],
          ['video', videoCard(page, 'clip.webm')],
          ['external-artifacts', audioCard(page, 'speech-output.wav')],
          ['failures', videoCard(page, 'broken.mp4')],
          ['images', page.getByTestId('chat-tool-ui-image-gallery')],
          ['charts', chart(page, 'Latency line')],
          ['pie-and-table', chart(page, 'Share pie')],
          ['weather-search', page.getByTestId('chat-tool-ui-weather')],
          ['documents-links-unknown', page.getByTestId('chat-resource-website-link').first()],
        ];
        for (const [name, anchor] of anchors) {
          await anchor.scrollIntoViewIfNeeded();
          const path = testInfo.outputPath(`${theme}-${name}.png`);
          await page.screenshot({ path });
          shots.push(path);
        }
      };
      await capture('light');
      await capture('dark');

      // The video opens larger in the side panel, even though it is outside the workspace tree.
      const video = videoCard(page, 'clip.webm');
      await video.scrollIntoViewIfNeeded();
      await video.getByTestId('chat-resource-open-panel').click();
      const panelMedia = page.getByTestId('file-preview-media');
      await expect(panelMedia).toBeVisible({ timeout: 20_000 });
      await expect(panelMedia.getByTestId('chat-resource-video')).toHaveAttribute('data-status', 'ready', { timeout: 20_000 });
      const panelShot = testInfo.outputPath('dark-side-panel-video.png');
      await page.screenshot({ path: panelShot });
      shots.push(panelShot);

      expect(remoteRequests, 'remote resources must not be fetched').toEqual([]);
      expect(fileRequests, 'media must not load through file://').toEqual([]);
      expect(cspViolations, 'nothing should trip the renderer CSP').toEqual([]);

      await writeFile(testInfo.outputPath('evidence.json'), JSON.stringify({
        scenario: 'conversation-resource-rendering',
        driven_by: 'agent',
        actor: 'claude-code',
        real_human: false,
        fixtures: 'local files under an isolated home, served by the real Main file boundary; chat.history mocked',
        does_not_establish: ['live-model quality', 'human review', 'product acceptance'],
        screenshots: shots,
      }, null, 2));
    } finally {
      await closeElectronApp(app);
    }
  });
});
