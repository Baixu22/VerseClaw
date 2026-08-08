import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import electron from 'vite-plugin-electron';
import renderer from 'vite-plugin-electron-renderer';
import { resolve } from 'path';
import { existsSync, readFileSync } from 'fs';

function getExtensionPackages(): Set<string> {
  try {
    const manifestPath = resolve(__dirname, 'verse-claw-extensions.json');
    if (!existsSync(manifestPath)) return new Set();
    const manifest = JSON.parse(readFileSync(manifestPath, 'utf-8'));
    const allIds: string[] = [
      ...(manifest.extensions?.main ?? []),
      ...(manifest.extensions?.renderer ?? []),
    ];
    const pkgs = new Set<string>();
    for (const id of allIds) {
      if (id.startsWith('builtin/')) continue;
      const parts = id.split('/');
      pkgs.add(parts[0].startsWith('@') ? parts.slice(0, 2).join('/') : parts[0]);
    }
    return pkgs;
  } catch {
    return new Set();
  }
}

const extensionPackages = getExtensionPackages();
export const localOpenClawRuntimeAliases = {
  '@openclaw/normalization-core': resolve(__dirname, 'openclaw_runtime/packages/normalization-core/src'),
  '@openclaw/acp-core': resolve(__dirname, 'openclaw_runtime/packages/acp-core/src'),
  '@openclaw/runtime-redaction': resolve(__dirname, 'openclaw_runtime/src/logging/redact.ts'),
};
// Dependencies of openclaw_runtime source that the main process bundle inlines
// via localOpenClawRuntimeAliases. These must be bundled (not externalized):
// the app root node_modules does not hoist them, so a runtime require() from
// dist-electron/main would fail at startup with "Cannot find module".
// @openclaw/fs-safe is imported via subpaths (config/advanced), hence prefix match.
const bundledMainRuntimeDependencies = new Set([
  '@pierre/diffs',
  'json5',
  'shiki',
  'kysely',
  'tslog',
  '@openclaw/fs-safe',
]);
const alias = {
  '@': resolve(__dirname, 'src'),
  '@electron': resolve(__dirname, 'electron'),
  '@shared': resolve(__dirname, 'shared'),
  ...localOpenClawRuntimeAliases,
};

function packageNameFromModuleId(id: string): string | null {
  const normalized = id.replace(/\\/g, '/');
  const marker = '/node_modules/';
  const index = normalized.lastIndexOf(marker);
  if (index < 0) return null;
  const parts = normalized.slice(index + marker.length).split('/');
  if (parts[0]?.startsWith('@')) {
    return parts[0] && parts[1] ? `${parts[0]}/${parts[1]}` : null;
  }
  return parts[0] || null;
}

function rendererManualChunks(id: string): string | undefined {
  const normalized = id.replace(/\\/g, '/');
  const packageName = packageNameFromModuleId(normalized);

  if (
    normalized.includes('vite/preload-helper')
    || normalized.includes('vite/modulepreload-polyfill')
  ) {
    return 'vite-runtime';
  }
  if (normalized.endsWith('/src/pages/Chat/index.tsx')) return 'chat-core';
  if (normalized.endsWith('/src/pages/Settings/SettingsRoute.tsx')) return 'settings-overview';
  if (normalized.endsWith('/src/pages/Settings/index.tsx')) return 'settings-detail';
  if (normalized.includes('/src/lib/monaco/')) return 'editor';
  if (!packageName) return undefined;
  if (packageName === 'monaco-editor' || packageName === '@monaco-editor/react') return 'editor';
  if (packageName === 'xlsx' || packageName === 'pdfjs-dist') return 'document-viewers';
  if (packageName === 'katex') return 'math-rendering';
  if (packageName === 'react' || packageName === 'react-dom' || packageName === 'scheduler') return 'react-vendor';
  if (
    packageName === 'react-markdown'
    || packageName.startsWith('remark-')
    || packageName.startsWith('rehype-')
    || packageName.startsWith('micromark')
    || packageName.startsWith('mdast-')
    || packageName.startsWith('hast-')
    || packageName.startsWith('unist-')
    || packageName === 'unified'
    || packageName === 'vfile'
  ) {
    return 'markdown-rendering';
  }
  if (
    packageName.startsWith('@radix-ui/')
    || packageName === 'lucide-react'
    || packageName === 'class-variance-authority'
    || packageName === 'clsx'
    || packageName === 'tailwind-merge'
    || packageName === 'sonner'
  ) {
    return 'ui-vendor';
  }
  return undefined;
}

function isLocalOpenClawRuntimeImport(id: string): boolean {
  return Object.keys(localOpenClawRuntimeAliases).some((pkg) => id === pkg || id.startsWith(pkg + '/'));
}

export function isMainProcessExternal(id: string): boolean {
  if (!id || id.startsWith('\0')) return false;
  if (id.startsWith('.') || id.startsWith('/') || /^[A-Za-z]:[\\/]/.test(id)) return false;
  if (id.startsWith('@/') || id.startsWith('@electron/') || id.startsWith('@shared/')) return false;
  if (isLocalOpenClawRuntimeImport(id)) return false;
  if (bundledMainRuntimeDependencies.has(id)) return false;
  for (const pkg of bundledMainRuntimeDependencies) {
    if (id.startsWith(pkg + '/')) return false;
  }
  for (const pkg of extensionPackages) {
    if (id === pkg || id.startsWith(pkg + '/')) return false;
  }
  return true;
}

// https://vitejs.dev/config/
export default defineConfig({
  // Required for Electron: all asset URLs must be relative because the renderer
  // loads via file:// in production. vite-plugin-electron-renderer sets this
  // automatically, but we declare it explicitly so the intent is clear and the
  // build remains correct even if plugin order ever changes.
  base: './',
  plugins: [
    react(),
    electron([
      {
        // Main process entry file
        entry: 'electron/main/index.ts',
        onstart(options) {
          options.startup();
        },
        vite: {
          resolve: { alias },
          build: {
            outDir: 'dist-electron/main',
            reportCompressedSize: false,
            rollupOptions: {
              external: isMainProcessExternal,
            },
          },
        },
      },
      {
        // Preload scripts entry file
        entry: 'electron/preload/index.ts',
        onstart(options) {
          options.reload();
        },
        vite: {
          resolve: { alias },
          build: {
            outDir: 'dist-electron/preload',
            reportCompressedSize: false,
            rollupOptions: {
              external: ['electron'],
            },
          },
        },
      },
    ]),
    renderer(),
  ],
  resolve: {
    alias,
    dedupe: ['react', 'react-dom', 'react-i18next', 'zustand', 'sonner', 'lucide-react'],
  },
  server: {
    port: 5173,
  },
  build: {
    outDir: 'dist',
    emptyOutDir: true,
    manifest: true,
    reportCompressedSize: false,
    rollupOptions: {
      output: {
        manualChunks: rendererManualChunks,
      },
    },
  },
});
