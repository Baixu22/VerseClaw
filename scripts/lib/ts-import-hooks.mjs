// node:module customization hooks that let plain Node execute the repository's
// TypeScript registries.
//
// The registries import their `.ts` neighbours with `./x.js` specifiers (the
// TypeScript convention), which Node's resolver rejects because no `.js` file
// exists on disk. `resolve` falls back to the `.ts` file when and only when the
// `.js` is absent and the `.ts` is present. `load` returns TypeScript sources
// with an explicit `module-typescript` format (so format detection never runs
// on packages without a "type" field) and substitutes in-memory rewrites that
// `initialize` received, which is how negative fixtures reach a gate without
// touching the working tree.
//
// Register from the entrypoint, never at import time:
//   register('./lib/ts-import-hooks.mjs', import.meta.url, { data: { rewrites } })
// where `rewrites` maps file URLs (realpath-based hrefs) to replacement text.
import { existsSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

let rewrites = new Map();

export async function initialize(data = {}) {
  rewrites = new Map(Object.entries(data.rewrites ?? {}));
}

export async function resolve(specifier, context, nextResolve) {
  if (specifier.startsWith('.') && specifier.endsWith('.js') && context.parentURL?.startsWith('file:')) {
    const jsPath = fileURLToPath(new URL(specifier, context.parentURL));
    const tsPath = jsPath.replace(/\.js$/, '.ts');
    if (!existsSync(jsPath) && existsSync(tsPath)) {
      return nextResolve(specifier.replace(/\.js$/, '.ts'), context);
    }
  }
  return nextResolve(specifier, context);
}

export async function load(url, context, nextLoad) {
  if (url.startsWith('file:') && url.endsWith('.ts') && !url.endsWith('.d.ts')) {
    const source = rewrites.has(url) ? rewrites.get(url) : readFileSync(fileURLToPath(url), 'utf8');
    return { format: 'module-typescript', source, shortCircuit: true };
  }
  return nextLoad(url, context);
}
