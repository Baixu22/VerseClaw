import { defineConfig } from 'vite';
import { packagedMainDependencyBanner } from './scripts/copy-runtime-package.mjs';
import react from '@vitejs/plugin-react';
import electron from 'vite-plugin-electron';
import renderer from 'vite-plugin-electron-renderer';
import { resolve } from 'path';
import { existsSync, readFileSync } from 'fs';
import { RENDERER_CSP, RENDERER_DEV_CSP } from './shared/security/url-policy';

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
  '@openclaw/media-core': resolve(__dirname, 'openclaw_runtime/packages/media-core/src'),
  '@openclaw/acp-core': resolve(__dirname, 'openclaw_runtime/packages/acp-core/src'),
  '@openclaw/media-core': resolve(__dirname, 'openclaw_runtime/packages/media-core/src'),
  '@openclaw/net-policy': resolve(__dirname, 'openclaw_runtime/packages/net-policy/src'),
  '@openclaw/runtime-redaction': resolve(__dirname, 'openclaw_runtime/src/logging/redact.ts'),
  '@openclaw/provider-request-auth': resolve(__dirname, 'openclaw_runtime/src/agents/provider-request-auth.ts'),
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
  'ipaddr.js',
  '@openclaw/fs-safe',
  '@openclaw/media-core',
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
  // Shared Markdown and the file icon namespace both consume Lucide. Keep its
  // eagerly initialized icon exports together so lazy chunks cannot form a TDZ.
  if (packageName === 'lucide-react') return 'lucide-icons';
  // assistant-ui registers resources against symbols initialized by its core.
  // Keep registrations and core in one chunk when Markdown gains a second host.
  if (packageName.startsWith('@assistant-ui/') || packageName === 'assistant-stream' || packageName === 'assistant-cloud') return 'assistant-ui-runtime';
  // Identifier factories are used during runtime module initialization. Keep
  // them out of lazy Markdown hosts that import the runtime in turn.
  if (packageName === 'nanoid') return 'id-runtime';
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
  // Let Rollup split UI primitives by their actual importers. A single forced
  // UI chunk pulls dependencies shared with App into the bootstrap graph.
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

function rendererCspPlugin(command: 'build' | 'serve') {
  return {
    name: 'clawx-renderer-csp',
    transformIndexHtml(html: string) {
      const csp = command === 'serve' ? RENDERER_DEV_CSP : RENDERER_CSP;
      return html.replace(
        /<meta http-equiv="Content-Security-Policy"[^>]*\/>/,
        `<meta http-equiv="Content-Security-Policy" content="${csp}" />`,
      );
    },
  };
}

// https://vitejs.dev/config/
export default defineConfig(({ command }) => ({
  // Required for Electron: all asset URLs must be relative because the renderer
  // loads via file:// in production. vite-plugin-electron-renderer sets this
  // automatically, but we declare it explicitly so the intent is clear and the
  // build remains correct even if plugin order ever changes.
  base: './',
  plugins: [
    rendererCspPlugin(command),
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
            emptyOutDir: true,
            reportCompressedSize: false,
            rollupOptions: {
              external: isMainProcessExternal,
              output: { banner: packagedMainDependencyBanner },
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
            emptyOutDir: true,
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
        // Shared bootstrap dependencies must not be absorbed into lazy page
        // chunks, which would make the entry eagerly import Chat and math.
        onlyExplicitManualChunks: true,
      },
    },
  },
}));
