import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { resolveMemoryWikiConfig } from '../../openclaw_runtime/extensions/memory-wiki/src/config';

describe('memory-wiki agent apply gate', () => {
  it('keeps wiki_apply off for ordinary agents by default', () => {
    const config = resolveMemoryWikiConfig(undefined);
    expect(config.tools.allowAgentApply).toBe(false);
  });

  it('allows an explicit operator opt-in', () => {
    const config = resolveMemoryWikiConfig({ tools: { allowAgentApply: true } });
    expect(config.tools.allowAgentApply).toBe(true);
  });

  it('registers wiki_apply only inside the explicit operator gate', () => {
    const pluginSource = readFileSync(resolve(process.cwd(), 'openclaw_runtime/extensions/memory-wiki/index.ts'), 'utf8');
    expect(pluginSource).toContain('if (config.tools.allowAgentApply) {');
    expect(pluginSource).toContain('api.registerTool(createWikiApplyTool(config, api.config), { name: "wiki_apply" });');
  });

  it('documents the operator gate in the plugin contract', () => {
    const manifest = JSON.parse(readFileSync(resolve(process.cwd(), 'openclaw_runtime/extensions/memory-wiki/openclaw.plugin.json'), 'utf8')) as {
      uiHints?: Record<string, { help?: string }>;
    };
    expect(manifest.uiHints?.['tools.allowAgentApply']?.help).toContain('ordinary agents');
  });
});
