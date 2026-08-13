/**
 * Web-only Vite config for browser UI debugging (`?mock=1`).
 *
 * The default `vite.config.ts` registers vite-plugin-electron, whose `onstart`
 * spawns Electron. When another Verse Claw instance already holds the
 * single-instance lock (electron/main/single-instance-lock.ts), that child
 * exits immediately and takes the Vite dev server down with it.
 *
 * This config drops the electron + electron-renderer plugins so the renderer
 * can be served as a plain web app. No renderer source imports `electron`
 * directly (verified), and mock mode installs its own host bridge, so the UI
 * runs standalone.
 */
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { resolve } from 'path';

const alias = {
  '@': resolve(__dirname, 'src'),
  '@electron': resolve(__dirname, 'electron'),
  '@shared': resolve(__dirname, 'shared'),
  '@openclaw/normalization-core': resolve(__dirname, 'openclaw_runtime/packages/normalization-core/src'),
  '@openclaw/acp-core': resolve(__dirname, 'openclaw_runtime/packages/acp-core/src'),
  '@openclaw/runtime-redaction': resolve(__dirname, 'openclaw_runtime/src/logging/redact.ts'),
};

export default defineConfig({
  base: './',
  plugins: [react()],
  resolve: {
    alias,
    dedupe: ['react', 'react-dom', 'react-i18next', 'zustand', 'sonner', 'lucide-react'],
  },
  server: {
    port: 5273,
    strictPort: true,
  },
});
