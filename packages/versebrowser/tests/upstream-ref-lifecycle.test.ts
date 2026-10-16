import { it, expect } from 'vitest';
import { chromium } from 'playwright';
import { createServer } from 'node:http';
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createUpstreamPageControl } from '../src/engine/upstream-control.ts';

it('invalidates references on same-document navigation and frame detach without replay', async () => {
  const server = createServer((_req, res) => { res.setHeader('content-type', 'text/html'); res.end('<button onclick="document.body.dataset.writes=String(+(document.body.dataset.writes||0)+1)">Save</button><iframe src="about:blank"></iframe>'); });
  await new Promise<void>(done => server.listen(0, '127.0.0.1', done));
  const url = `http://127.0.0.1:${(server.address() as {port:number}).port}`;
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage({ serviceWorkers: 'block', acceptDownloads: false });
  const control = await createUpstreamPageControl(page, url, await mkdtemp(join(tmpdir(), 'vb-ref-lifecycle-')));
  const ref = async () => `[data-vb-ref="${(await control.snapshot()).find(item => item.role === 'button')!.ref}"]`;
  try {
    await control.navigate(url, 'load');
    const old = await ref();
    await page.evaluate(() => history.pushState({}, '', '/next'));
    await expect(control.click(old)).rejects.toThrow('E_STALE_REF');
    expect(await page.getAttribute('body', 'data-writes')).toBeNull();
    const fresh = await ref();
    await control.click(fresh);
    expect(await page.getAttribute('body', 'data-writes')).toBe('1');
    const beforeDetach = await ref();
    await page.locator('iframe').evaluate(frame => frame.remove());
    await expect(control.wait(beforeDetach)).rejects.toThrow('E_STALE_REF');
    expect(await page.getAttribute('body', 'data-writes')).toBe('1');
    const beforeOverflow = await ref();
    await page.evaluate(() => { for (let i = 0; i < 81; i++) document.body.append(document.createElement('button')); });
    await expect(control.snapshot()).rejects.toThrow('too many targets');
    const unpublished = beforeOverflow.replace(/-(\d+)-/, (_, revision) => `-${Number(revision) + 1}-`);
    await expect(control.click(unpublished)).rejects.toThrow('E_STALE_REF');
    expect(await page.getAttribute('body', 'data-writes')).toBe('1');
  } finally { await control.close(); await browser.close(); server.closeAllConnections(); await new Promise<void>(done => server.close(() => done())); }
}, 30_000);

it('keeps element identity through insertion and reordering, rejects replacement and ambiguous selectors', async () => {
  const server = createServer((_req, res) => { res.setHeader('content-type', 'text/html'); res.end('<button id="a" onclick="document.body.dataset.writes=\'a\'">Save</button><button id="b" onclick="document.body.dataset.writes=\'b\'">Save</button>'); });
  await new Promise<void>(done => server.listen(0, '127.0.0.1', done));
  const url = `http://127.0.0.1:${(server.address() as {port:number}).port}`;
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage({ serviceWorkers: 'block', acceptDownloads: false });
  const control = await createUpstreamPageControl(page, url, await mkdtemp(join(tmpdir(), 'vb-ref-replace-')));
  try {
    await control.navigate(url, 'load');
    const items = await control.snapshot();
    const first = items.filter(item => item.role === 'button')[0]!;
    await page.evaluate(() => { document.body.prepend(document.querySelector('#b')!); document.body.insertAdjacentHTML('afterbegin', '<span>new</span>'); });
    await control.click(`[data-vb-ref="${first.ref}"]`);
    expect(await page.getAttribute('body', 'data-writes')).toBe('a');
    const next = (await control.snapshot()).find(item => item.role === 'button')!;
    await page.locator('#b').evaluate(button => { button.outerHTML = '<button id="b" onclick="document.body.dataset.writes=\'replacement\'">Save</button>'; });
    await expect(control.click(`[data-vb-ref="${next.ref}"]`, 500)).rejects.toThrow();
    await expect(control.click('button', 500)).rejects.toThrow();
    expect(await page.getAttribute('body', 'data-writes')).toBe('a');
  } finally { await control.close(); await browser.close(); server.closeAllConnections(); await new Promise<void>(done => server.close(() => done())); }
}, 30_000);
