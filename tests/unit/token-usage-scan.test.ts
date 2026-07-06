import { mkdir, rm, writeFile } from 'fs/promises';
import { join } from 'path';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const { testHome, testUserData } = vi.hoisted(() => {
  const suffix = Math.random().toString(36).slice(2);
  const root = process.env.CLAWX_TEST_TMPDIR ?? `${process.cwd()}/.tmp/vitest`;
  return {
    testHome: `${root}/clawx-token-usage-${suffix}`,
    testUserData: `${root}/clawx-token-usage-user-data-${suffix}`,
  };
});

vi.mock('os', async () => {
  const actual = await vi.importActual<typeof import('os')>('os');
  const mocked = {
    ...actual,
    homedir: () => testHome,
  };
  return {
    ...mocked,
    default: mocked,
  };
});

vi.mock('electron', () => ({
  app: {
    isPackaged: false,
    getPath: () => testUserData,
    getVersion: () => '0.0.0-test',
  },
}));

describe('token usage session scan', () => {
  beforeEach(async () => {
    vi.resetModules();
    vi.restoreAllMocks();
    process.env.VERSE_CLAW_USER_DATA_DIR = testUserData;
    await rm(testHome, { recursive: true, force: true });
    await rm(testUserData, { recursive: true, force: true });
  });

  it('includes transcripts from agent directories that exist on disk but are not configured', async () => {
    const openclawDir = join(testHome, '.openclaw');
    await mkdir(openclawDir, { recursive: true });
    await writeFile(join(openclawDir, 'openclaw.json'), JSON.stringify({
      agents: {
        list: [
          { id: 'main', name: 'Main', default: true },
        ],
      },
    }, null, 2), 'utf8');

    const diskOnlySessionsDir = join(openclawDir, 'agents', 'custom-custom25', 'sessions');
    await mkdir(diskOnlySessionsDir, { recursive: true });
    await writeFile(
      join(diskOnlySessionsDir, 'f8e66f77-0125-4e2f-b750-9c4de01e8f5a.jsonl'),
      [
        JSON.stringify({
          type: 'message',
          timestamp: '2026-03-12T12:19:00.000Z',
          message: {
            role: 'assistant',
            model: 'gpt-5.2-2025-12-11',
            provider: 'openai',
            usage: {
              input: 17649,
              output: 107,
              total: 17756,
            },
          },
        }),
      ].join('\n'),
      'utf8',
    );

    const { getRecentTokenUsageHistory } = await import('@electron/utils/token-usage');
    const entries = await getRecentTokenUsageHistory();

    expect(entries).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          agentId: 'custom-custom25',
          sessionId: 'f8e66f77-0125-4e2f-b750-9c4de01e8f5a',
          model: 'gpt-5.2-2025-12-11',
          totalTokens: 17756,
        }),
      ]),
    );
  });

  it('summarizes live usage for the requested session key transcript', async () => {
    const openclawDir = join(testHome, '.openclaw');
    const sessionsDir = join(openclawDir, 'agents', 'main', 'sessions');
    await mkdir(sessionsDir, { recursive: true });
    await writeFile(
      join(sessionsDir, 'session-live.jsonl'),
      [
        JSON.stringify({
          type: 'message',
          timestamp: '2026-03-12T12:19:00.000Z',
          message: {
            role: 'assistant',
            usage: { input: 100, output: 25, cacheRead: 10, total: 135 },
          },
        }),
        JSON.stringify({
          type: 'message',
          timestamp: '2026-03-12T12:20:00.000Z',
          message: {
            role: 'assistant',
            usage: { input_tokens: 50, output_tokens: 15 },
          },
        }),
      ].join('\n'),
      'utf8',
    );

    const { getSessionTokenUsageSummary } = await import('@electron/utils/token-usage');
    await expect(getSessionTokenUsageSummary('agent:main:session-live')).resolves.toMatchObject({
      agentId: 'main',
      sessionId: 'session-live',
      usageStatus: 'available',
      inputTokens: 150,
      outputTokens: 40,
      cacheReadTokens: 10,
      totalTokens: 200,
    });
  });

  it('normalizes DeepSeek cache hit and miss tokens and derives warm-turn hit rate', async () => {
    const openclawDir = join(testHome, '.openclaw');
    const sessionsDir = join(openclawDir, 'agents', 'main', 'sessions');
    await mkdir(sessionsDir, { recursive: true });
    await writeFile(
      join(sessionsDir, 'deepseek-cache.jsonl'),
      [
        JSON.stringify({
          type: 'message',
          timestamp: '2026-07-03T18:10:00.000Z',
          message: {
            role: 'assistant',
            usage: {
              prompt_tokens: 20_000,
              completion_tokens: 8,
              prompt_cache_hit_tokens: 3_000,
              prompt_cache_miss_tokens: 17_000,
              total_tokens: 20_008,
            },
          },
        }),
        JSON.stringify({
          type: 'message',
          timestamp: '2026-07-03T18:11:00.000Z',
          message: {
            role: 'assistant',
            usage: {
              prompt_tokens: 20_100,
              completion_tokens: 7,
              prompt_cache_hit_tokens: 19_900,
              prompt_cache_miss_tokens: 200,
              total_tokens: 20_107,
            },
          },
        }),
      ].join('\n'),
      'utf8',
    );

    const { getSessionTokenUsageSummary } = await import('@electron/utils/token-usage');
    await expect(getSessionTokenUsageSummary('agent:main:deepseek-cache')).resolves.toMatchObject({
      inputTokens: 17_200,
      outputTokens: 15,
      cacheReadTokens: 22_900,
      totalTokens: 40_115,
      lastTurnCacheReadTokens: 19_900,
      lastTurnCacheMissTokens: 200,
      lastTurnHitRate: 19_900 / 20_100,
      warmTurnHitRate: 19_900 / 20_100,
    });
  });

  it('subtracts nested OpenAI-compatible cached tokens from prompt totals', async () => {
    const openclawDir = join(testHome, '.openclaw');
    const sessionsDir = join(openclawDir, 'agents', 'main', 'sessions');
    await mkdir(sessionsDir, { recursive: true });
    await writeFile(
      join(sessionsDir, 'nested-cache.jsonl'),
      [
        JSON.stringify({
          type: 'message',
          timestamp: '2026-07-03T18:12:00.000Z',
          message: {
            role: 'assistant',
            usage: {
              prompt_tokens: 10_000,
              completion_tokens: 5,
              prompt_tokens_details: { cached_tokens: 8_000 },
              total_tokens: 10_005,
            },
          },
        }),
      ].join('\n'),
      'utf8',
    );

    const { getSessionTokenUsageSummary } = await import('@electron/utils/token-usage');
    await expect(getSessionTokenUsageSummary('agent:main:nested-cache')).resolves.toMatchObject({
      inputTokens: 2_000,
      outputTokens: 5,
      cacheReadTokens: 8_000,
      totalTokens: 10_005,
      lastTurnHitRate: 0.8,
    });
  });

  it('resolves live usage through sessions.json when a logical session key maps to a UUID transcript', async () => {
    const openclawDir = join(testHome, '.openclaw');
    const sessionsDir = join(openclawDir, 'agents', 'main', 'sessions');
    await mkdir(sessionsDir, { recursive: true });
    await writeFile(
      join(sessionsDir, 'sessions.json'),
      JSON.stringify({
        'agent:main:main': {
          sessionId: '70816339-5333-4822-a31a-9a0a133640cc',
          sessionFile: join(sessionsDir, '70816339-5333-4822-a31a-9a0a133640cc.jsonl'),
        },
      }, null, 2),
      'utf8',
    );
    await writeFile(
      join(sessionsDir, '70816339-5333-4822-a31a-9a0a133640cc.jsonl'),
      [
        JSON.stringify({
          type: 'message',
          timestamp: '2026-07-03T18:19:15.424Z',
          message: {
            role: 'assistant',
            model: 'deepseek-v4-flash',
            provider: 'deepseek',
            usage: {
              input: 20361,
              output: 8,
              cacheRead: 0,
              cacheWrite: 0,
              totalTokens: 20369,
            },
          },
        }),
      ].join('\n'),
      'utf8',
    );

    const { getSessionTokenUsageSummary } = await import('@electron/utils/token-usage');
    await expect(getSessionTokenUsageSummary('agent:main:main')).resolves.toMatchObject({
      agentId: 'main',
      sessionId: 'main',
      usageStatus: 'available',
      inputTokens: 20361,
      outputTokens: 8,
      totalTokens: 20369,
    });
  });

  it('prefers source-runtime state transcripts for live usage when present', async () => {
    const globalOpenclawDir = join(testHome, '.openclaw');
    const globalSessionsDir = join(globalOpenclawDir, 'agents', 'main', 'sessions');
    await mkdir(globalSessionsDir, { recursive: true });
    await writeFile(
      join(globalSessionsDir, 'main.jsonl'),
      [
        JSON.stringify({
          type: 'message',
          timestamp: '2026-07-03T18:00:00.000Z',
          message: {
            role: 'assistant',
            usage: { input: 1, output: 1, total: 2 },
          },
        }),
      ].join('\n'),
      'utf8',
    );

    const sourceRuntimeState = join(testUserData, 'openclaw-source-state');
    const sourceSessionsDir = join(sourceRuntimeState, 'agents', 'main', 'sessions');
    const sourceTranscript = join(sourceSessionsDir, 'source-session.jsonl');
    await mkdir(sourceSessionsDir, { recursive: true });
    await writeFile(
      sourceTranscript,
      [
        JSON.stringify({
          type: 'message',
          timestamp: '2026-07-04T04:43:01.000Z',
          message: {
            role: 'assistant',
            model: 'deepseek-v4-flash',
            provider: 'deepseek',
            usage: {
              prompt_tokens: 23_483,
              completion_tokens: 42,
              prompt_cache_hit_tokens: 23_424,
              prompt_cache_miss_tokens: 59,
              total_tokens: 23_525,
            },
          },
        }),
      ].join('\n'),
      'utf8',
    );

    const { getSessionTokenUsageSummary } = await import('@electron/utils/token-usage');
    await expect(getSessionTokenUsageSummary('agent:main:main')).resolves.toMatchObject({
      agentId: 'main',
      sessionId: 'main',
      usageStatus: 'available',
      inputTokens: 59,
      outputTokens: 42,
      cacheReadTokens: 23_424,
      totalTokens: 23_525,
      lastTurnHitRate: 23_424 / 23_483,
    });
  });
});
