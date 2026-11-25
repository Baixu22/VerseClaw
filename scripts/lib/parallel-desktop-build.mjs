import { spawn } from 'node:child_process';
import { resolve } from 'node:path';
import { build } from 'vite-plugin-electron';

function prepareBrowser(root) {
  return new Promise((resolveRun, reject) => {
    const child = spawn(process.execPath, [resolve(root, 'scripts/build-versebrowser.mjs')], {
      cwd: root, stdio: 'inherit', windowsHide: true,
    });
    child.once('error', reject);
    child.once('exit', code => code === 0 ? resolveRun() : reject(new Error(`Embedded browser build failed (${code})`)));
  });
}

/** @returns {import('vite').Plugin[]} */
export function parallelDesktopBuildPlugin(options) {
  const entries = Array.isArray(options) ? options : [options];
  let config, background;
  return [{
    name: 'parallel-desktop-build', apply: 'build',
    configResolved(resolvedConfig) { config = resolvedConfig; },
    buildStart() {
      background = (async () => {
        await prepareBrowser(config.root);
        for (const entry of entries) {
          await build({ ...entry, vite: {
            mode: config.mode, root: config.root, envDir: config.envDir, envPrefix: config.envPrefix,
            ...entry.vite,
          } });
        }
      })();
      // closeBundle propagates background failures after all outputs finish.
      background.catch(() => {});
      // Rollup awaits this hook in watch mode, serializing rebuilds and surfacing errors.
      if (config.build.watch) return background;
    },
    async buildEnd(error) { if (error) await background?.catch(() => {}); },
    async closeBundle() { await background; },
  }];
}
