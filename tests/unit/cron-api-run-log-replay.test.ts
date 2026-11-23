// @vitest-environment node
// R7-1 T2: every message synthesized by the cron session-history fallback
// chain is marked as a run-log replay, so the renderer can tell it apart from
// the real session transcript. Copy/label layer only — no RPC/replay logic
// changes.

import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createRequire } from 'node:module';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { CronRunsParamsSchema } from '../../openclaw_runtime/packages/gateway-protocol/src/schema/cron';

const runtimeRequire = createRequire(join(process.cwd(), 'openclaw_runtime/package.json'));
const Ajv = runtimeRequire('ajv');
const validateRunsParams = new Ajv({ allErrors: true, strict: false }).compile(CronRunsParamsSchema);

const pathsMock = vi.hoisted(() => ({
  configDir: '',
}));

vi.mock('@electron/utils/paths', () => ({
  getOpenClawConfigDir: () => pathsMock.configDir,
}));

describe('cron session history run-log replay annotation (R7-1 T2)', () => {
  let root: string;

  beforeEach(async () => {
    root = await mkdtemp(join(tmpdir(), 'cron-run-log-replay-'));
    pathsMock.configDir = root;
  });

  afterEach(async () => {
    await rm(root, { recursive: true, force: true });
  });

  it('pages within the bundled schema cap and retains the newest runs and later-page run details', async () => {
    const all = Array.from({ length: 650 }, (_, index) => ({
      jobId: 'paged-job', action: 'finished', status: 'ok', sessionId: `session-${index}`,
      summary: `execution ${index}`, ts: 1_800_000_000_000 + index * 1000,
    })).reverse();
    const rpc = vi.fn(async (method: string, payload: { offset?: number; limit?: number; sortDir?: string }) => {
      if (method === 'cron.list') return { jobs: [] };
      expect(method).toBe('cron.runs');
      if (!validateRunsParams(payload)) throw Error(JSON.stringify(validateRunsParams.errors));
      expect(payload.sortDir).toBe('desc');
      const offset = payload.offset ?? 0;
      const entries = all.slice(offset, offset + payload.limit!);
      const nextOffset = offset + entries.length;
      return { entries, hasMore: nextOffset < all.length, nextOffset };
    });
    const { createCronApi } = await import('@electron/services/cron-api');
    const api = createCronApi({ gatewayManager: { rpc } as never });
    const result = await api.sessionHistory({ sessionKey: 'agent:main:cron:paged-job', limit: 20 });
    expect(result.messages?.at(-1)?.content).toContain('execution 649');
    expect(result.messages).toHaveLength(20);
    expect(rpc.mock.calls.filter(([method]) => method === 'cron.runs').map(([, payload]) => [payload.offset, payload.limit])).toEqual([[0, 200], [200, 200], [400, 100]]);
    const older = await api.sessionHistory({ sessionKey: 'agent:main:cron:paged-job:run:session-300', limit: 20 });
    expect(older.messages).toHaveLength(1);
    expect(older.messages?.[0].content).toContain('execution 300');
  });

  it('keeps successful pages when a later history page fails', async () => {
    const rpc = vi.fn(async (method: string, payload: { offset?: number }) => {
      if (method === 'cron.list') return { jobs: [] };
      if (payload.offset) throw Error('gateway disconnected');
      return { entries: [{ jobId: 'partial', summary: 'retained recent run', ts: 1_800_000_000_000 }], hasMore: true, nextOffset: 1 };
    });
    const { createCronApi } = await import('@electron/services/cron-api');
    const result = await createCronApi({ gatewayManager: { rpc } as never }).sessionHistory({ sessionKey: 'agent:main:cron:partial' });
    expect(result.messages?.[0].content).toContain('retained recent run');
  });

  it('marks every synthesized fallback message as a run-log replay', async () => {
    const { createCronApi } = await import('@electron/services/cron-api');
    await mkdir(join(root, 'cron', 'runs'), { recursive: true });
    await writeFile(
      join(root, 'cron', 'runs', 'job-1.jsonl'),
      `${JSON.stringify({
        jobId: 'job-1',
        action: 'finished',
        status: 'ok',
        summary: 'Scheduled task finished.',
        ts: 1_800_000_000_000,
      })}\n`,
      'utf8',
    );

    const rpc = vi.fn(async (method: string) => {
      if (method === 'cron.list') {
        return {
          jobs: [{
            id: 'job-1',
            name: 'Job one',
            enabled: true,
            createdAtMs: 1_799_000_000_000,
            updatedAtMs: 1_799_000_000_000,
            schedule: { kind: 'cron', expr: '0 9 * * *' },
            payload: { kind: 'agentTurn', message: 'Do the thing' },
            delivery: { mode: 'none' },
            state: {},
          }],
        };
      }
      if (method === 'cron.runs') {
        // Simulate an unreachable gateway so the legacy JSONL read kicks in —
        // the replay source must be annotated regardless of which read wins.
        throw new Error('gateway down');
      }
      return {};
    });
    const api = createCronApi({ gatewayManager: { rpc } as never });

    const result = await api.sessionHistory({ sessionKey: 'agent:main:cron:job-1', limit: 10 });

    expect(Array.isArray(result.messages)).toBe(true);
    const messages = result.messages ?? [];
    expect(messages.length).toBeGreaterThan(0);
    // Pre-fix red proof: the synthesized messages carry no source marker, so
    // the renderer cannot distinguish run-log replay from session transcript.
    for (const message of messages) {
      expect(message.isRunLogReplay, `message ${String(message.id)} must be marked`).toBe(true);
    }
    // Copy must stay honest: the synthesized content itself is unchanged.
    expect(messages.map((message) => message.content).join('\n')).toContain('Scheduled task: Job one');
    expect(messages.map((message) => message.content).join('\n')).toContain('Scheduled task finished.');
  });

  it('keeps the run-log replay marker on messages produced by the cron.runs RPC path', async () => {
    const { createCronApi } = await import('@electron/services/cron-api');

    const rpc = vi.fn(async (method: string) => {
      if (method === 'cron.list') {
        return {
          jobs: [{
            id: 'job-2',
            name: 'Job two',
            enabled: true,
            createdAtMs: 1_799_000_000_000,
            updatedAtMs: 1_799_000_000_000,
            schedule: { kind: 'cron', expr: '0 9 * * *' },
            payload: { kind: 'agentTurn', message: 'Run it' },
            delivery: { mode: 'none' },
            state: {},
          }],
        };
      }
      if (method === 'cron.runs') {
        return {
          entries: [{
            jobId: 'job-2',
            action: 'finished',
            status: 'ok',
            summary: 'RPC path finished.',
            ts: 1_800_000_000_000,
          }],
        };
      }
      return {};
    });
    const api = createCronApi({ gatewayManager: { rpc } as never });

    const result = await api.sessionHistory({ sessionKey: 'agent:main:cron:job-2', limit: 10 });

    const messages = result.messages ?? [];
    expect(messages.length).toBeGreaterThan(0);
    for (const message of messages) {
      expect(message.isRunLogReplay).toBe(true);
    }
  });
});
