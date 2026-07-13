#!/usr/bin/env node

import { createRequire } from 'module';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { rmSync, mkdirSync, existsSync, readFileSync, readdirSync, statSync } from 'fs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '..');
const RUNTIME_ROOT = join(ROOT, 'openclaw_runtime');
const DIST = join(RUNTIME_ROOT, 'dist');

const esbuildRequire = createRequire(join(RUNTIME_ROOT, 'node_modules', 'esbuild', 'package.json'));
const esbuild = esbuildRequire('esbuild');

function loadTsconfigPaths() {
  const tsconfigPath = join(RUNTIME_ROOT, 'tsconfig.json');
  const tsconfig = JSON.parse(readFileSync(tsconfigPath, 'utf8'));
  const paths = tsconfig.compilerOptions?.paths ?? {};

  const exact = new Map();
  const wildcards = [];

  for (const [alias, targets] of Object.entries(paths)) {
    if (alias.endsWith('/*')) {
      const prefix = alias.slice(0, -2);
      wildcards.push({ prefix, target: targets[0] });
    } else {
      exact.set(alias, targets[0]);
    }
  }

  return { exact, wildcards };
}

function resolveTsAlias(importPath, { exact, wildcards }) {
  if (exact.has(importPath)) {
    return join(RUNTIME_ROOT, exact.get(importPath));
  }

  for (const { prefix, target } of wildcards) {
    if (importPath === prefix) {
      return join(RUNTIME_ROOT, target.replace(/\*/g, 'index'));
    }
    if (importPath.startsWith(prefix + '/')) {
      const rest = importPath.slice(prefix.length + 1);
      return join(RUNTIME_ROOT, target.replace(/\*/g, rest));
    }
  }

  return null;
}

function resolveFile(targetPath) {
  if (existsSync(targetPath)) {
    try {
      if (statSync(targetPath).isDirectory()) {
        const indexPath = join(targetPath, 'index.ts');
        if (existsSync(indexPath)) return indexPath;
        return null;
      }
    } catch { /* fall through */ }
    return targetPath;
  }
  const withTs = targetPath + '.ts';
  if (existsSync(withTs)) return withTs;
  const withIndex = join(targetPath, 'index.ts');
  if (existsSync(withIndex)) return withIndex;
  return null;
}

const tsPaths = loadTsconfigPaths();

const runtimeEntryPoints = {
  entry: join(RUNTIME_ROOT, 'src', 'entry.ts'),
  'agents/code-mode.worker': join(RUNTIME_ROOT, 'src', 'agents', 'code-mode.worker.ts'),
  'agents/compaction-planning.worker': join(RUNTIME_ROOT, 'src', 'agents', 'compaction-planning.worker.ts'),
  'agents/model-provider-auth.worker': join(RUNTIME_ROOT, 'src', 'agents', 'model-provider-auth.worker.ts'),
  'runtime-core/memory-operator-inspection': join(
    RUNTIME_ROOT,
    'src',
    'runtime-core',
    'memory-operator-inspection.ts',
  ),
  'runtime-core/event-log-operator-inspection': join(
    RUNTIME_ROOT,
    'src',
    'runtime-core',
    'event-log-operator-inspection.ts',
  ),
};
const memoryReadHydrationShadowEntry = join(
  RUNTIME_ROOT,
  'src',
  'runtime-core',
  'memory-read-hydration-shadow.ts',
);

function selectRuntimeEntryPoints() {
  if (process.argv.includes('--memory-operator-inspection-only')) {
    return {
      'runtime-core/memory-operator-inspection':
        runtimeEntryPoints['runtime-core/memory-operator-inspection'],
    };
  }
  if (process.argv.includes('--event-log-operator-inspection-only')) {
    return {
      'runtime-core/event-log-operator-inspection':
        runtimeEntryPoints['runtime-core/event-log-operator-inspection'],
    };
  }
  if (process.argv.includes('--memory-read-hydration-shadow-only')) {
    return {
      'runtime-core/memory-read-hydration-shadow': memoryReadHydrationShadowEntry,
    };
  }
  return runtimeEntryPoints;
}

const selectedRuntimeEntryPoints = selectRuntimeEntryPoints();

function canResolveLocally(importPath) {
  if (importPath.startsWith('.')) return true;
  if (importPath.startsWith('@openclaw/') || importPath.startsWith('openclaw/')) {
    return resolveTsAlias(importPath, tsPaths) !== null;
  }
  return false;
}

function collectNodeModulesPackages() {
  const nmDir = join(RUNTIME_ROOT, 'node_modules');
  const result = [];
  if (!existsSync(nmDir)) return result;

  for (const entry of readdirSync(nmDir)) {
    if (entry === '.bin' || entry === '.pnpm' || entry.startsWith('.')) continue;
    if (!entry.startsWith('@')) {
      result.push(entry);
      continue;
    }
    const scopedDir = join(nmDir, entry);
    try {
      for (const pkg of readdirSync(scopedDir)) {
        const packageDir = join(scopedDir, pkg);
        if (existsSync(join(packageDir, 'package.json'))) {
          result.push(`${entry}/${pkg}`);
        }
      }
    } catch {
      // Ignore incomplete scoped package folders.
    }
  }

  return result;
}

function createPathAliasPlugin() {
  return {
    name: 'openclaw-path-aliases',
    setup(build) {
      build.onResolve({ filter: /^@openclaw\// }, (args) => {
        const resolved = resolveTsAlias(args.path, tsPaths);
        if (resolved) {
          const file = resolveFile(resolved);
          if (file) return { path: file };
        }
        return { path: args.path, external: true };
      });

      build.onResolve({ filter: /^openclaw\// }, (args) => {
        const resolved = resolveTsAlias(args.path, tsPaths);
        if (resolved) {
          const file = resolveFile(resolved);
          if (file) return { path: file };
        }
        return { path: args.path, external: true };
      });

      build.onResolve({ filter: /\.ts$/ }, (args) => {
        if (args.path.startsWith('.')) {
          const resolved = resolveFile(join(args.resolveDir, args.path));
          if (resolved) return { path: resolved };
          const withoutExt = args.path.replace(/\.ts$/, '');
          const alt = resolveFile(join(args.resolveDir, withoutExt + '.ts'));
          if (alt) return { path: alt };
        }
        return undefined;
      });
    },
  };
}

console.log('Building openclaw_runtime with esbuild...');
console.log(`  Source: ${join(RUNTIME_ROOT, 'src')}`);
console.log(`  Output: ${DIST}`);

// Full builds start from a clean dist. Targeted only-mode builds must not wipe
// sibling entry outputs: unit tests run concurrent only-mode builds that each
// need their own dist artifact to remain available for package-script checks.
const isTargetedOnlyBuild =
  process.argv.includes('--memory-operator-inspection-only') ||
  process.argv.includes('--event-log-operator-inspection-only') ||
  process.argv.includes('--memory-read-hydration-shadow-only');

mkdirSync(DIST, { recursive: true });
if (isTargetedOnlyBuild) {
  for (const entryName of Object.keys(selectedRuntimeEntryPoints)) {
    const outFile = join(DIST, `${entryName}.js`);
    if (existsSync(outFile)) {
      rmSync(outFile, { force: true });
    }
  }
} else {
  rmSync(DIST, { recursive: true, force: true });
  mkdirSync(DIST, { recursive: true });
}

const nodeModulesPackages = collectNodeModulesPackages();
console.log(`  Found ${nodeModulesPackages.length} npm packages (will keep external)`);

// Build external list: node builtins + all npm packages
const externalList = ['node:*', 'electron'];
for (const pkg of nodeModulesPackages) {
  if (pkg === 'openclaw' || canResolveLocally(pkg)) {
    continue;
  }
  externalList.push(pkg);
}

const start = Date.now();

await esbuild.build({
  entryPoints: selectedRuntimeEntryPoints,
  bundle: true,
  outdir: DIST,
  format: 'esm',
  platform: 'node',
  target: 'node22',
  splitting: true,
  charset: 'utf8',
  banner: {
    js: `import { createRequire as __cr } from 'node:module';var require=__cr(import.meta.url);`,
  },
  external: externalList,
  plugins: [createPathAliasPlugin()],
  logLevel: 'info',
});

const elapsed = Date.now() - start;
console.log(`  Done in ${(elapsed / 1000).toFixed(1)}s`);
