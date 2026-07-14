import { describe, expect, it } from 'vitest';

describe('buildSourceRuntimeIsolationEnv plugin-tool policy', () => {
  it('does not force-disable plugin tools by default', async () => {
    const previousE2E = process.env.VERSE_CLAW_E2E;
    delete process.env.VERSE_CLAW_E2E;
    try {
      const { buildSourceRuntimeIsolationEnv } = await import('@electron/gateway/config-sync');
      const env = buildSourceRuntimeIsolationEnv({
        stateDir: 'C:/tmp/openclaw-source-state',
        homeDir: 'C:/tmp/openclaw-source-home',
        configPath: 'C:/tmp/openclaw-source-state/openclaw.json',
      });

      expect(env.OPENCLAW_STATE_DIR).toBe('C:/tmp/openclaw-source-state');
      expect(env.OPENCLAW_CONFIG_PATH).toBe('C:/tmp/openclaw-source-state/openclaw.json');
      expect(env.OPENCLAW_HOME).toBe('C:/tmp/openclaw-source-home');
      expect(env.OPENCLAW_SKIP_LEGACY_STATE_MIGRATION).toBe('1');
      expect(env.OPENCLAW_DEFER_STARTUP_SIDECARS).toBe('1');
      expect(env.OPENCLAW_DEFERRED_SIDECAR_START_DELAY_MS).toBe('600000');
      expect(env).not.toHaveProperty('OPENCLAW_SKIP_AGENT_PLUGIN_TOOLS');
    } finally {
      if (previousE2E === undefined) delete process.env.VERSE_CLAW_E2E;
      else process.env.VERSE_CLAW_E2E = previousE2E;
    }
  });

  it('still honors an explicit external skip env when process.env is set', async () => {
    const previous = process.env.OPENCLAW_SKIP_AGENT_PLUGIN_TOOLS;
    process.env.OPENCLAW_SKIP_AGENT_PLUGIN_TOOLS = '1';
    try {
      const { buildSourceRuntimeIsolationEnv } = await import('@electron/gateway/config-sync');
      const isolationEnv = buildSourceRuntimeIsolationEnv({
        stateDir: 'C:/tmp/openclaw-source-state',
        homeDir: 'C:/tmp/openclaw-source-home',
        configPath: 'C:/tmp/openclaw-source-state/openclaw.json',
      });
      // Isolation env itself must not force the flag; host process env remains the opt-out path.
      expect(isolationEnv).not.toHaveProperty('OPENCLAW_SKIP_AGENT_PLUGIN_TOOLS');
      expect(process.env.OPENCLAW_SKIP_AGENT_PLUGIN_TOOLS).toBe('1');
    } finally {
      if (previous === undefined) {
        delete process.env.OPENCLAW_SKIP_AGENT_PLUGIN_TOOLS;
      } else {
        process.env.OPENCLAW_SKIP_AGENT_PLUGIN_TOOLS = previous;
      }
    }
  });

  it('skips deferred sidecars under VERSE_CLAW_E2E so startup-gated RPCs complete on the ready path', async () => {
    const previousE2E = process.env.VERSE_CLAW_E2E;
    process.env.VERSE_CLAW_E2E = '1';
    try {
      const { buildSourceRuntimeIsolationEnv } = await import('@electron/gateway/config-sync');
      const env = buildSourceRuntimeIsolationEnv({
        stateDir: 'C:/tmp/openclaw-source-state',
        homeDir: 'C:/tmp/openclaw-source-home',
        configPath: 'C:/tmp/openclaw-source-state/openclaw.json',
      });
      expect(env).not.toHaveProperty('OPENCLAW_DEFER_STARTUP_SIDECARS');
      expect(env).not.toHaveProperty('OPENCLAW_DEFERRED_SIDECAR_START_DELAY_MS');
      expect(env).not.toHaveProperty('OPENCLAW_SKIP_AGENT_PLUGIN_TOOLS');
      expect(env.OPENCLAW_STATE_DIR).toBe('C:/tmp/openclaw-source-state');
    } finally {
      if (previousE2E === undefined) delete process.env.VERSE_CLAW_E2E;
      else process.env.VERSE_CLAW_E2E = previousE2E;
    }
  });
});
