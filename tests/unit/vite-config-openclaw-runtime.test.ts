// @vitest-environment node

import { existsSync } from 'fs';
import { describe, expect, it } from 'vitest';

describe('vite Electron OpenClaw runtime aliases', () => {
  it('keeps local OpenClaw workspace packages bundled in Electron main', async () => {
    const viteConfig = await import('../../vite.config') as {
      isMainProcessExternal?: (id: string) => boolean;
    };

    expect(viteConfig.isMainProcessExternal).toBeTypeOf('function');
    expect(viteConfig.isMainProcessExternal!('@openclaw/normalization-core')).toBe(false);
    expect(viteConfig.isMainProcessExternal!('@openclaw/normalization-core/record-coerce')).toBe(false);
    expect(viteConfig.isMainProcessExternal!('@openclaw/acp-core')).toBe(false);
    expect(viteConfig.isMainProcessExternal!('@openclaw/acp-core/runtime/session-identifiers')).toBe(false);
    expect(viteConfig.isMainProcessExternal!('@openclaw/media-core')).toBe(false);
    expect(viteConfig.isMainProcessExternal!('@openclaw/media-core/media-source-url')).toBe(false);
    expect(viteConfig.isMainProcessExternal!('@openclaw/media-core-extra')).toBe(true);
    expect(viteConfig.isMainProcessExternal!('json5')).toBe(false);
    expect(viteConfig.isMainProcessExternal!('@pierre/diffs')).toBe(false);
    expect(viteConfig.isMainProcessExternal!('shiki')).toBe(false);
    expect(viteConfig.isMainProcessExternal!('@openclaw/media-core/media-source-url')).toBe(false);
  });

  it('maps local OpenClaw package imports to checked-in runtime sources', async () => {
    const viteConfig = await import('../../vite.config') as {
      localOpenClawRuntimeAliases?: Record<string, string>;
    };

    expect(viteConfig.localOpenClawRuntimeAliases).toBeDefined();
    expect(viteConfig.localOpenClawRuntimeAliases!['@openclaw/normalization-core'].replace(/\\/g, '/'))
      .toMatch(/openclaw_runtime\/packages\/normalization-core\/src$/);
    expect(viteConfig.localOpenClawRuntimeAliases!['@openclaw/acp-core'].replace(/\\/g, '/'))
      .toMatch(/openclaw_runtime\/packages\/acp-core\/src$/);
    expect(existsSync(viteConfig.localOpenClawRuntimeAliases!['@openclaw/normalization-core'])).toBe(true);
    expect(existsSync(viteConfig.localOpenClawRuntimeAliases!['@openclaw/acp-core'])).toBe(true);
    const mediaCore = viteConfig.localOpenClawRuntimeAliases!['@openclaw/media-core'];
    expect(mediaCore).toBeDefined();
    expect(mediaCore.replace(/\\/g, '/')).toMatch(/openclaw_runtime\/packages\/media-core\/src$/);
    expect(existsSync(`${mediaCore}/index.ts`)).toBe(true);
    expect(existsSync(`${mediaCore}/media-source-url.ts`)).toBe(true);
  });
});
