import { writeFile } from 'node:fs/promises';
import { closeElectronApp, expect, getStableWindow, test } from './fixtures/electron';
import { hostInvoke, startScriptedLlm } from './fixtures/fp-p1-harness';
import { addSessionChainChildren, configureSessionChainProvider, createSessionChainProject, setSessionChainViewport } from './fixtures/session-task-chain';

test('family counters keep a separate visible area from the title at 2, 20 and 100 children', async ({ launchElectronApp }, info) => {
  test.setTimeout(240_000);
  const provider = await startScriptedLlm(() => ({ text: 'Counter layout fixture' }));
  const app = await launchElectronApp({ skipSetup: true, deviceScaleFactor: 1 });
  const evidence: { driven_by: string; actor: string; status: string; error?: string; samples: unknown[] } = {
    driven_by: 'agent', actor: 'playwright-u5-family-counter', status: 'running', samples: [],
  };
  try {
    await configureSessionChainProvider(app, provider.port);
    const project = await createSessionChainProject(app, info.outputPath('workspace'), 'Family counter layout');
    const page = await getStableWindow(app);
    let current = 0;
    for (const count of [2, 20, 100]) {
      await addSessionChainChildren(app, project, current, count); current = count;
      for (const theme of ['light', 'dark'] as const) {
        await hostInvoke(app, 'settings', 'set', { key: 'theme', value: theme }); await page.reload();
        await expect(page.getByTestId('chat-page')).toHaveAttribute('data-session-generation', project.generation);
        for (const width of [1280, 960]) {
          await setSessionChainViewport(app, { width, height: 800 });
          const sidebar = page.getByTestId('sidebar-collapse-toggle');
          if (await sidebar.getAttribute('aria-label') === 'Expand sidebar') await sidebar.click();
          const toggle = page.getByTestId(`session-family-toggle-${project.sessionKey}`);
          await expect(toggle).toHaveAccessibleName(new RegExp(String(count))); await toggle.scrollIntoViewIfNeeded();
          if (await toggle.getAttribute('aria-expanded') === 'true') await toggle.click();
          const familyRow = toggle.locator('..');
          const counter = familyRow.locator(':scope > .session-family__count');
          await expect(counter).toHaveText(String(count));
          const sample = await toggle.evaluate(element => {
            const row = element.closest('.ws-family-row')!;
            const title = row.querySelector('.task-title__clip')!;
            const a = element.getBoundingClientRect(), b = title.getBoundingClientRect();
            const label = row.querySelector('.session-family__count')!.getBoundingClientRect();
            return { toggle: { x: a.x, right: a.right, width: a.width }, title: { x: b.x, right: b.right, width: b.width },
              labelLeft: label.left, labelRight: label.right, rowRight: row.getBoundingClientRect().right, rowHeight: row.getBoundingClientRect().height, overflow: document.documentElement.scrollWidth > innerWidth };
          });
          evidence.samples.push({ count, theme, width, ...sample });
          expect(sample.title.x).toBeGreaterThanOrEqual(sample.toggle.right + 2);
          expect(sample.title.right).toBeLessThanOrEqual(sample.labelLeft);
          expect(sample.labelRight).toBeGreaterThan(sample.toggle.right);
          expect(sample.labelRight).toBeLessThanOrEqual(sample.rowRight - 8);
          expect(sample.rowHeight).toBe(30); expect(sample.overflow).toBe(false);
          await familyRow.locator('.task-select').hover();
          await expect(counter).toHaveCSS('opacity', '0');
          await page.mouse.move(width - 30, 400);
          await expect(counter).toHaveCSS('opacity', '1');
          await toggle.focus(); await expect(toggle).toBeFocused(); await toggle.press('Enter');
          await expect(toggle).toHaveAttribute('aria-expanded', 'true');
          await expect(counter).toHaveCount(0);
          await toggle.press('Enter');
          await expect(toggle).toHaveAttribute('aria-expanded', 'false');
          await page.screenshot({ path: info.outputPath(`counter-${count}-${theme}-${width}.png`) });
        }
      }
    }
    evidence.status = 'passed';
  } catch (error) { evidence.status = 'failed'; evidence.error = String(error); throw error; }
  finally {
    await writeFile(info.outputPath('counter-layout.json'), JSON.stringify(evidence, null, 2));
    await hostInvoke(app, 'gateway', 'stop').catch(() => undefined); await closeElectronApp(app);
    provider.server.closeAllConnections(); await new Promise<void>(resolve => provider.server.close(() => resolve()));
  }
});
