import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { OPENROUTER_ATTRIBUTION } from '../../shared/openrouter-attribution';

const read = (path: string) => readFileSync(path, 'utf8');

describe('P1 repository identity and workflow boundaries (#77 #84 #85 #88)', () => {
  it('uses a consistent public OpenRouter attribution identity', () => {
    const registry = read('electron/shared/providers/registry.ts');
    const preload = read('electron/utils/openrouter-headers-preload.cjs');
    expect(registry).toContain('OPENROUTER_ATTRIBUTION.referer');
    expect(registry).toContain('OPENROUTER_ATTRIBUTION.title');
    expect(preload).toContain(OPENROUTER_ATTRIBUTION.referer);
    expect(preload).toContain(OPENROUTER_ATTRIBUTION.title);
    expect(registry).not.toContain('claw-x.com');
    expect(preload).not.toContain('claw-x.com');

    // The launcher writes its own inline copy of the fetch preload at runtime;
    // that copy (not the checked-in .cjs) is what the Gateway actually loads.
    const launcher = read('electron/gateway/process-launcher.ts');
    expect(launcher).not.toContain('claw-x.com');
    expect(launcher).toContain('https://verseclaw.dev');
  });

  it('does not publish internal Feishu tenant wiki links as channel help', () => {
    for (const locale of ['en', 'zh', 'ja', 'ru']) {
      const text = read(`shared/i18n/locales/${locale}/channels.json`);
      expect(text).not.toContain('icnnp7d0dymg.feishu.cn');
      expect(text).toContain('https://docs.openclaw.ai/');
    }
  });

  it('keeps codex/* pushes covered by automated workflows', () => {
    for (const workflow of [
      'check.yml',
      'comms-regression.yml',
      'harness.yml',
      'system-maturity-security.yml',
      'electron-e2e.yml',
    ]) {
      const text = read(`.github/workflows/${workflow}`);
      expect(text, workflow).toMatch(/push:[\s\S]*?codex\/\*\*/);
    }
  });

  it('removes exact stale ClawX product literals from active surfaces', () => {
    for (const file of [
      'electron/utils/whatsapp-login.ts',
      'electron/utils/openrouter-headers-preload.cjs',
      'electron/utils/control-ui-device-pairing.ts',
      'electron/shared/providers/registry.ts',
      'src/pages/Settings/index.tsx',
    ]) {
      expect(read(file), file).not.toContain("'ClawX'");
      expect(read(file), file).not.toContain('"ClawX"');
    }
  });
});
