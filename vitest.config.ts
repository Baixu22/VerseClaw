import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';
import { resolve, join } from 'path';
import { cpus } from 'os';
import { readFileSync, existsSync, statSync } from 'fs';
import type { Plugin } from 'vite';

const RUNTIME_ROOT = resolve(__dirname, 'openclaw_runtime');

/**
 * Resolve a tsconfig path-mapping target against RUNTIME_ROOT, mirroring the
 * esbuild build script's resolveFile (handles .ts extension + dir->index).
 */
function resolveAliasFile(targetRel: string): string | null {
  const target = join(RUNTIME_ROOT, targetRel);
  if (existsSync(target)) {
    try {
      if (statSync(target).isDirectory()) {
        const indexTs = join(target, 'index.ts');
        return existsSync(indexTs) ? indexTs : null;
      }
    } catch {
      /* fall through */
    }
    return target;
  }
  const withTs = target + '.ts';
  if (existsSync(withTs)) return withTs;
  const withIndex = join(target, 'index.ts');
  if (existsSync(withIndex)) return withIndex;
  return null;
}

/**
 * Load `compilerOptions.paths` from openclaw_runtime/tsconfig.json and expose
 * them as a Vite plugin that resolves @openclaw/* and openclaw/* package
 * aliases the SAME way esbuild does (scripts/build-openclaw-runtime.mjs).
 *
 * A custom resolveId hook is used (rather than resolve.alias) because Vite's
 * alias substring matching mis-orders overlapping exact + wildcard entries
 * (e.g. "@openclaw/x" exact vs "@openclaw/x/*" wildcard). The hook walks the
 * tsconfig entries in declaration order, exact-first per prefix, which matches
 * the build's resolveTsAlias exactly.
 *
 * Without this, importing runtime modules that pull in @openclaw/* deps fails
 * with "Failed to resolve import @openclaw/...".
 */
function runtimePathAliasPlugin(): Plugin {
  const tsconfigPath = join(RUNTIME_ROOT, 'tsconfig.json');
  const exact = new Map<string, string>();
  const wildcards: Array<{ prefix: string; target: string }> = [];
  try {
    const tsconfig = JSON.parse(readFileSync(tsconfigPath, 'utf8'));
    const paths: Record<string, string[]> = tsconfig.compilerOptions?.paths ?? {};
    for (const [aliasKey, targets] of Object.entries(paths)) {
      const target = targets?.[0];
      if (!target) continue;
      if (aliasKey.endsWith('/*')) {
        wildcards.push({ prefix: aliasKey.slice(0, -2), target });
      } else {
        exact.set(aliasKey, target);
      }
    }
  } catch {
    // Runtime tsconfig missing - plugin is a no-op.
  }

  function resolveImport(importPath: string, _importer: string | undefined): string | null {
    // Only rewrite @openclaw/* and openclaw/* bare specifiers.
    if (!importPath.startsWith('@openclaw/') && !importPath.startsWith('openclaw/')) {
      return null;
    }
    // Exact match first.
    if (exact.has(importPath)) {
      return resolveAliasFile(exact.get(importPath)!);
    }
    // Wildcard match (longest-prefix-first to avoid premature matches).
    for (const { prefix, target } of wildcards) {
      if (importPath === prefix) {
        const file = resolveAliasFile(target.replace(/\*/g, 'index'));
        if (file) return file;
      } else if (importPath.startsWith(prefix + '/')) {
        const rest = importPath.slice(prefix.length + 1);
        const file = resolveAliasFile(target.replace(/\*/g, rest));
        if (file) return file;
      }
    }
    return null;
  }

  return {
    name: 'openclaw-runtime-path-aliases',
    enforce: 'pre',
    resolveId(source, importer) {
      const resolved = resolveImport(source, importer);
      if (resolved) return resolved;
      // Vite needs relative import paths (./foo.js) inside the runtime tree to
      // resolve normally - return null to defer to the default resolver.
      return null;
    },
  };
}

/** Strip #! shebangs so SSR evaluation of CLI .mjs scripts does not throw SyntaxError. */
function stripShebangPlugin(): Plugin {
  return {
    name: 'strip-shebang-for-ssr',
    enforce: 'pre',
    transform(code, id) {
      if (!code.startsWith('#!')) return null;
      if (!id.includes('scripts') && !id.endsWith('.mjs') && !id.endsWith('.js')) return null;
      return {
        code: code.replace(/^#![^\r\n]*(?:\r?\n)?/, ''),
        map: null,
      };
    },
  };
}

// Full suite on Windows can thrash under high fan-out (transform/import dominate).
// Cap workers and raise timeouts so real work finishes without load-induced flakes.
const cpuCount = cpus()?.length ?? 4;
const maxWorkers = process.env.VITEST_MAX_WORKERS
  ? Number(process.env.VITEST_MAX_WORKERS)
  : Math.max(1, Math.min(4, Math.floor(cpuCount / 2)));

export default defineConfig({
  plugins: [react(), runtimePathAliasPlugin(), stripShebangPlugin()],
  test: {
    passWithNoTests: false,
    globals: true,
    environment: 'jsdom',
    setupFiles: ['./tests/setup.ts'],
    include: ['tests/unit/**/*.{test,spec}.{ts,tsx}', 'tests/integration/**/*.{test,spec}.{ts,tsx}'],
    testTimeout: 30_000,
    hookTimeout: 30_000,
    maxWorkers,
    coverage: {
      reporter: ['text', 'json', 'html'],
      exclude: ['node_modules/', 'tests/'],
    },
  },
  resolve: {
    alias: {
      '@': resolve(__dirname, 'src'),
      '@electron': resolve(__dirname, 'electron'),
      '@shared': resolve(__dirname, 'shared'),
      '@openclaw/runtime-redaction': resolve(__dirname, 'openclaw_runtime/src/logging/redact.ts'),
      '@openclaw/provider-request-auth': resolve(__dirname, 'openclaw_runtime/src/agents/provider-request-auth.ts'),
      rastermill: resolve(__dirname, 'tests/fixtures/rastermill.ts'),
    },
  },
});
