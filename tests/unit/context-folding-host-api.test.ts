// @vitest-environment jsdom
/**
 * context-folding-rlm / TF-0692: host-api surface for the folding status and the
 * parent projection.
 *
 * The facade half drives the real `src/lib/host-api.ts` with a stubbed
 * `hostInvoke`; the Main half calls the real `createSessionsApi` service with the
 * `OPENCLAW_CONFIG_DIR` override pointed at a temp directory, so the flag is read
 * from a real openclaw.json instead of a mocked helper.
 *
 * driven_by: agent; actor: claude-fable-5.1/context-folding-rlm
 */
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const hostInvoke = vi.fn();

beforeEach(() => {
  hostInvoke.mockReset();
  vi.resetModules();
  vi.stubGlobal('window', { verseClaw: { hostInvoke } });
});

describe('hostApi.sessions context folding facade', () => {
  it('routes contextFoldingStatus and contextFoldProjection through the typed sessions module', async () => {
    hostInvoke
      .mockResolvedValueOnce({
        id: 'req-1',
        ok: true,
        data: {
          success: true,
          status: {
            enabled: false,
            source: 'default',
            flagPath: 'runtime.contextBlock.contextFolding.enabled',
            env: 'VERSE_CONTEXT_FOLDING',
            rollback: 'disable-only',
            limits: {},
          },
        },
      })
      .mockResolvedValueOnce({
        id: 'req-2',
        ok: true,
        data: {
          success: true,
          ok: false,
          diagnostics: [{ code: 'raw_transcript_rejected', message: 'foldResult.transcript would inject a child transcript' }],
        },
      });
    const { hostApi } = await import('@/lib/host-api');

    const status = await hostApi.sessions.contextFoldingStatus();
    expect(status).toMatchObject({ success: true, status: { enabled: false, source: 'default', rollback: 'disable-only' } });
    expect(hostInvoke).toHaveBeenNthCalledWith(1, expect.objectContaining({
      module: 'sessions',
      action: 'contextFoldingStatus',
    }));

    const projection = await hostApi.sessions.contextFoldProjection({ result: { transcript: 'raw child transcript' } });
    expect(projection).toMatchObject({ success: true, ok: false });
    expect(projection.diagnostics[0]?.code).toBe('raw_transcript_rejected');
    expect(hostInvoke).toHaveBeenNthCalledWith(2, expect.objectContaining({
      module: 'sessions',
      action: 'contextFoldProjection',
      payload: { result: { transcript: 'raw child transcript' } },
    }));
  });
});

const CONFIG_DIR_ENV = 'OPENCLAW_CONFIG_DIR';
const savedConfigDir = process.env[CONFIG_DIR_ENV];
const dirs: string[] = [];

function tmpDir(): string {
  const dir = mkdtempSync(path.join(os.tmpdir(), 'cf-host-api-'));
  dirs.push(dir);
  return dir;
}

function writeConfig(dir: string, config: unknown): void {
  mkdirSync(dir, { recursive: true });
  writeFileSync(path.join(dir, 'openclaw.json'), JSON.stringify(config), 'utf8');
}

function foldResultPayload(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    schemaVersion: 'ContextFoldResult/v1',
    foldId: `cff_${'a'.repeat(32)}`,
    childSessionKey: 'agent:main:subagent:child-1',
    childRunId: 'run-child-1',
    status: 'completed',
    summary: 'revision is bumped unconditionally in complete_task',
    structuredOutput: { defectLocation: 'src/taskboard.py:L30' },
    evidenceRefs: [{
      handleId: `cfh_${'b'.repeat(32)}`,
      resourceId: 'src/taskboard.py',
      selector: 'L26-L36',
      checksum: `sha256:${'c'.repeat(64)}`,
      kind: 'excerpt',
    }],
    unresolvedClaims: [],
    blockers: [],
    failedAttempts: [],
    inputRefs: [`cfh_${'b'.repeat(32)}`],
    usage: { totalTokens: 1500, latencyMs: 2200 },
    diagnostics: [],
    rawChildTranscriptChars: 0,
    recursionDepth: 1,
    deliveryId: 'delivery-1',
    drivenBy: 'agent',
    actor: 'child-worker',
    ...overrides,
  };
}

describe('Main sessions service: context folding actions', () => {
  it('reads the flag from a real config file and reports a disable-only rollback', async () => {
    const dir = tmpDir();
    process.env[CONFIG_DIR_ENV] = dir;
    const { createSessionsApi } = await import('@electron/services/sessions-api');
    const api = createSessionsApi({});

    const off = await api.contextFoldingStatus({});
    expect(off.success).toBe(true);
    expect(off.status).toMatchObject({ enabled: false, source: 'default', rollback: 'disable-only' });
    expect(off.status.limits.expandMaxChars).toBe(20_000);

    writeConfig(dir, { runtime: { contextBlock: { contextFolding: { enabled: true } } } });
    const on = await api.contextFoldingStatus({});
    expect(on.status).toMatchObject({ enabled: true, source: 'config' });

    writeConfig(dir, 'not-an-object');
    const invalid = await api.contextFoldingStatus({});
    expect(invalid.success).toBe(false);
    expect(invalid.status.enabled).toBe(false);
  });

  it('projects a valid fold result for the parent and refuses transcript-shaped content', async () => {
    const dir = tmpDir();
    process.env[CONFIG_DIR_ENV] = dir;
    const { createSessionsApi } = await import('@electron/services/sessions-api');
    const api = createSessionsApi({});

    const accepted = await api.contextFoldProjection({ result: foldResultPayload() });
    expect(accepted.success).toBe(true);
    expect(accepted.ok).toBe(true);
    expect(accepted.projection?.rawChildTranscriptChars).toBe(0);
    expect(accepted.projection?.childRunId).toBe('run-child-1');
    expect(accepted.chars).toBe(accepted.projection?.outputChars);

    for (const forbidden of [{ transcript: 'raw' }, { messages: [] }, { structuredOutput: { toolLog: 'x' } }]) {
      const refused = await api.contextFoldProjection({ result: foldResultPayload(forbidden) });
      expect(refused.success).toBe(true);
      expect(refused.ok).toBe(false);
      expect(refused.diagnostics[0]?.code).toBe('raw_transcript_rejected');
    }

    // Within the result contract (8000) but over the caller's parent budget.
    const clamped = await api.contextFoldProjection({ result: foldResultPayload({ summary: 'x'.repeat(2_000), structuredOutput: { blob: 'y'.repeat(3_000) } }), maxChars: 500 });
    expect(clamped.ok).toBe(true);
    expect(clamped.truncated).toBe(true);
    expect(clamped.chars).toBeLessThanOrEqual(500);
    // Over the result contract itself: refused, never silently shrunk into passing.
    const overContract = await api.contextFoldProjection({ result: foldResultPayload({ summary: 'x'.repeat(4_000), structuredOutput: { blob: 'y'.repeat(6_000) } }) });
    expect(overContract.ok).toBe(false);
    expect(overContract.diagnostics[0]?.code).toBe('limit_exceeded');

    const missingIdentity = await api.contextFoldProjection({ result: foldResultPayload({ childRunId: '' }) });
    expect(missingIdentity.ok).toBe(false);
    expect(missingIdentity.diagnostics[0]?.code).toBe('child_identity_mismatch');
  });

  afterEach(() => {
    if (savedConfigDir === undefined) delete process.env[CONFIG_DIR_ENV];
    else process.env[CONFIG_DIR_ENV] = savedConfigDir;
    for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
  });
});
