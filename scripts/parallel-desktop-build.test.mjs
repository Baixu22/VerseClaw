import assert from 'node:assert/strict';
import { test } from 'node:test';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { build } from 'vite';
import { parallelDesktopBuildPlugin } from './lib/parallel-desktop-build.mjs';

async function buildFixture(prepare, check) {
  const root = mkdtempSync(join(tmpdir(), 'clawx-parallel-build-'));
  mkdirSync(join(root, 'scripts'));
  writeFileSync(join(root, 'package.json'), '{"type":"module"}');
  writeFileSync(join(root, 'index.html'), '<script type="module" src="/renderer.js"></script>');
  writeFileSync(join(root, 'renderer.js'), 'console.log("renderer-ready");');
  writeFileSync(join(root, 'main.js'), 'import { ready } from "./browser.js"; console.log(ready);');
  writeFileSync(join(root, 'scripts/build-versebrowser.mjs'), prepare);
  try {
    const run = (watch = false) => build({
      root, configFile: false, logLevel: 'silent',
      build: watch ? { watch: {} } : {},
      plugins: parallelDesktopBuildPlugin({
        entry: join(root, 'main.js'),
        vite: { logLevel: 'silent', build: { outDir: 'dist-electron', minify: false } },
      }),
    });
    await check({ root, run });
  } finally {
    if (dirname(resolve(root)) !== resolve(tmpdir())) throw new Error('Unexpected temporary root');
    rmSync(root, { recursive: true, force: true });
  }
}

test('waits for embedded browser compilation before completing Electron output', async () => {
  await buildFixture('import fs from "node:fs"; await new Promise(r=>setTimeout(r,40)); fs.writeFileSync("browser.js", "export const ready = \\\"browser-ready\\\";");', async ({root, run}) => {
    await run();
    assert.match(readFileSync(join(root, 'dist-electron/main.js'), 'utf8'), /browser-ready/);
    assert.match(readFileSync(join(root, 'dist/index.html'), 'utf8'), /assets\//);
  });
});

test('fails the complete build when embedded browser preparation fails', async () => {
  await buildFixture('process.exit(7);', async ({run}) => {
    await assert.rejects(run(), /Embedded browser build failed \(7\)/);
  });
});

function watchEvent(watcher, code) {
  return new Promise((resolveEvent, reject) => {
    const timer = setTimeout(() => {
      watcher.off('event', onEvent);
      reject(new Error(`Timed out waiting for ${code}`));
    }, 15_000);
    function onEvent(event) {
      if (event.code !== code) return;
      clearTimeout(timer);
      watcher.off('event', onEvent);
      resolveEvent(event);
    }
    watcher.on('event', onEvent);
  });
}

test('reports browser preparation failure from a watch rebuild', async () => {
  await buildFixture('import fs from "node:fs"; fs.writeFileSync("browser.js", "export const ready = \\\"browser-ready\\\";");', async ({ root, run }) => {
    const watcher = await run(true);
    try {
      await watchEvent(watcher, 'BUNDLE_END');
      assert.match(readFileSync(join(root, 'dist-electron/main.js'), 'utf8'), /browser-ready/);
      const failed = watchEvent(watcher, 'ERROR');
      writeFileSync(join(root, 'scripts/build-versebrowser.mjs'), 'process.exit(7);');
      writeFileSync(join(root, 'renderer.js'), 'console.log("renderer-changed");');
      const event = await failed;
      assert.match(event.error.message, /Embedded browser build failed \(7\)/);
    } finally {
      await watcher.close();
    }
  });
});
