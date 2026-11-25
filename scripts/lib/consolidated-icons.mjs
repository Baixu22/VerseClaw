import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

export const consolidatedIconsModuleId = '\0verse-claw-consolidated-icons';
const root = fileURLToPath(new URL('../..', import.meta.url));
const require = createRequire(new URL('../../package.json', import.meta.url));

/** @returns {import('vite').Plugin} */
export function consolidatedIconsPlugin() {
  let code;
  return {
    name: 'consolidate-lucide-build', enforce: 'pre', apply: 'build',
    async buildStart() {
      // Use Vite's pinned compiler to collapse file discovery while retaining ESM exports.
      const esbuild = createRequire(require.resolve('vite/package.json'))('esbuild');
      const result = await esbuild.build({
        stdin: { contents: "export * from 'lucide-react';", resolveDir: root, sourcefile: 'lucide-build-entry.js' },
        bundle: true, format: 'esm', platform: 'browser', external: ['react'], write: false,
      });
      code = result.outputFiles[0].text;
    },
    resolveId(id) { return id === 'lucide-react' ? consolidatedIconsModuleId : null; },
    load(id) { return id === consolidatedIconsModuleId ? code : null; },
  };
}
