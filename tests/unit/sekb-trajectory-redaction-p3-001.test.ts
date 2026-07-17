import { randomUUID } from 'node:crypto';
import { mkdtempSync, rmSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';

import { closeOpenClawStateDatabaseForTest } from '../../openclaw_runtime/src/state/openclaw-state-db';
import { KnowledgeStore } from '../../openclaw_runtime/src/knowledge/sekb/knowledge-store';
import { TrajectoryCapture } from '../../openclaw_runtime/src/knowledge/sekb/trajectory-capture';
import {
  classifySekbPayload,
  isSekbQuarantinedPayload,
  sanitizeTrajectoryForPersistence,
  trajectoryContainsPlaintext,
} from '../../openclaw_runtime/src/knowledge/sekb/trajectory-redaction';
import { redactSensitiveText, redactSecrets } from '../../openclaw_runtime/src/logging/redact';
import { findSensitiveContentBoundary } from '../../shared/sensitive-content-boundary';

const tempRoots: string[] = [];

afterEach(() => {
  closeOpenClawStateDatabaseForTest();
  for (const root of tempRoots.splice(0)) {
    rmSync(root, { recursive: true, force: true });
  }
});

function createStore(): KnowledgeStore {
  const root = mkdtempSync(path.join(os.tmpdir(), 'sekb-p3-001-'));
  tempRoots.push(root);
  return new KnowledgeStore({
    database: { path: path.join(root, 'state.sqlite') },
  });
}

function fixedClock(start = Date.parse('2026-07-17T08:00:00.000Z')) {
  let t = start;
  return () => {
    const d = new Date(t);
    t += 1_000;
    return d;
  };
}

const CANARY_API_KEY = 'sk-canary-p3-001-SECRET-do-not-store';
const CANARY_ENV = 'OPENAI_API_KEY=sk-canary-p3-001-env-VALUE99999';
const CANARY_BEARER = 'Bearer sk-canary-p3-001-bearer-token-ABCDEFGH';

describe('P3-001 SEKB raw capture quarantine + unified redaction', () => {
  it('A1: canary secrets do not appear in SEKB raw store after capture', () => {
    const store = createStore();
    const capture = new TrajectoryCapture({ store, now: fixedClock() });
    const id = capture.start_trajectory(`task with ${CANARY_API_KEY}`, 'config/db', ['postgresql']);
    capture.log_step(
      id,
      'tool.call',
      { apiKey: CANARY_API_KEY, env: CANARY_ENV, path: '/home/user/.aws/credentials' },
      { toolName: 'bash', toolCallId: 'tc-1' },
    );
    capture.log_step(
      id,
      'tool.result',
      { apiKey: CANARY_API_KEY },
      {
        toolName: 'bash',
        toolCallId: 'tc-1',
        isError: false,
        content: `export ${CANARY_ENV}\n${CANARY_BEARER}`,
        details: { stdout: CANARY_API_KEY },
      },
    );

    const finished = capture.finish_trajectory(id, 'success');
    const stored = store.get_trajectory(id);
    const finishedJson = JSON.stringify(finished);
    const storedJson = JSON.stringify(stored);

    for (const canary of [CANARY_API_KEY, 'sk-canary-p3-001-env-VALUE99999', 'sk-canary-p3-001-bearer-token-ABCDEFGH']) {
      expect(trajectoryContainsPlaintext(finished, canary), `finished contains ${canary}`).toBe(false);
      expect(trajectoryContainsPlaintext(stored, canary), `stored contains ${canary}`).toBe(false);
      expect(finishedJson).not.toContain(canary);
      expect(storedJson).not.toContain(canary);
    }

    // steps_json projection must quarantine tool payloads
    expect(finished.steps.length).toBeGreaterThan(0);
    for (const step of stored.steps) {
      if (!String(step.action).startsWith('tool.')) continue;
      expect(isSekbQuarantinedPayload(step.input)).toBe(true);
      const output = step.output as Record<string, unknown>;
      expect(output.toolName).toBe('bash');
      expect(isSekbQuarantinedPayload(output.raw)).toBe(true);
    }
  });

  it('A2: SEKB redaction policy is shared with logging redaction', () => {
    const sample = `header ${CANARY_BEARER} and ${CANARY_ENV}`;
    const logRedacted = redactSensitiveText(sample);
    const sekb = sanitizeTrajectoryForPersistence({
      trajectory_id: randomUUID(),
      created_at: '2026-07-17T08:00:00.000Z',
      task_intent: sample,
      task_type: 'test',
      context_fingerprint: [sample],
      steps: [
        {
          action: 'inspect',
          input: { note: sample },
          output: { ok: true },
          timestamp: '2026-07-17T08:00:01.000Z',
        },
      ],
      outcome: 'success',
      error_signature: null,
      cost: { tokens: 0, duration_seconds: 0, retries: 0 },
      distilled: false,
      distilled_into: [],
      expires_at: null,
      metadata: { source: sample },
    });

    expect(logRedacted).not.toContain('sk-canary-p3-001-bearer-token-ABCDEFGH');
    expect(sekb.task_intent).toBe(logRedacted);
    expect(JSON.stringify(sekb)).not.toContain(CANARY_API_KEY);
    expect(JSON.stringify(sekb.metadata)).not.toContain('sk-canary-p3-001-bearer-token-ABCDEFGH');

    // Same structured path as logging redactSecrets
    const structured = { token: CANARY_API_KEY, nested: { password: 'hunter2-super-secret-value' } };
    expect(JSON.stringify(redactSecrets(structured))).not.toContain(CANARY_API_KEY);
    const structuredTrajectory = sanitizeTrajectoryForPersistence({
      trajectory_id: randomUUID(),
      created_at: '2026-07-17T08:00:00.000Z',
      task_intent: 'structured secrets',
      task_type: 'test',
      context_fingerprint: [],
      steps: [],
      outcome: 'success',
      error_signature: null,
      cost: { tokens: 0, duration_seconds: 0, retries: 0 },
      distilled: false,
      distilled_into: [],
      expires_at: null,
      metadata: structured,
    });
    expect(JSON.stringify(structuredTrajectory.metadata)).not.toContain(CANARY_API_KEY);
    expect(JSON.stringify(structuredTrajectory.metadata)).not.toContain('hunter2-super-secret-value');
  });

  it('A3: unclassified data defaults to quarantine; safe metadata may remain', () => {
    expect(classifySekbPayload({ toolName: 'bash', toolCallId: 'x', isError: false })).toBe('safe');
    expect(classifySekbPayload({ freeform: 'x'.repeat(200) })).toBe('unclassified');
    expect(classifySekbPayload({ apiKey: CANARY_API_KEY })).toBe('sensitive');

    const store = createStore();
    store.save_trajectory({
      trajectory_id: randomUUID(),
      created_at: '2026-07-17T08:00:00.000Z',
      task_intent: 'unclassified blob path',
      task_type: 'test',
      context_fingerprint: [],
      steps: [
        {
          action: 'tool.call',
          input: { args: ['cat', '/etc/passwd'], body: 'x'.repeat(300) },
          output: { toolName: 'bash', toolCallId: 't1' },
          timestamp: '2026-07-17T08:00:01.000Z',
        },
        {
          action: 'steps.compressed',
          input: { omitted_count: 3 },
          output: { summary: '3 middle steps omitted from SEKB trajectory storage.' },
          timestamp: '2026-07-17T08:00:02.000Z',
        },
      ],
      outcome: 'success',
      error_signature: null,
      cost: { tokens: 1, duration_seconds: 1, retries: 0 },
      distilled: false,
      distilled_into: [],
      expires_at: null,
      metadata: {},
    });

    const stored = store.query_trajectories({})[0];
    expect(stored).toBeTruthy();
    const toolStep = stored.steps.find((s) => s.action === 'tool.call');
    expect(toolStep).toBeTruthy();
    expect(isSekbQuarantinedPayload(toolStep!.input)).toBe(true);
    expect((toolStep!.input as { classification: string }).classification).toBe('unclassified');
    expect(JSON.stringify(toolStep!.input)).not.toContain('/etc/passwd');

    const compressed = stored.steps.find((s) => s.action === 'steps.compressed');
    expect(compressed?.input).toEqual({ omitted_count: 3 });
    expect(stored.metadata).toMatchObject({
      sekbPersistence: {
        redacted: true,
        policy: 'logging-redact+quarantine',
        taskId: 'P3-001',
      },
    });
  });

  it('documents sekb surface on the sensitive-content boundary matrix', () => {
    const sekb = findSensitiveContentBoundary('sekb');
    expect(sekb).toMatchObject({
      surface: 'sekb',
      guaranteeLevel: 'redacted-projection',
      fullPlaintextFreeGuarantee: false,
      rawPlaintextRisk: false,
    });
    expect(sekb?.safeClaim).toContain('sanitizeTrajectoryForPersistence');
    expect(sekb?.relatedTaskIds).toEqual(expect.arrayContaining(['P3-001']));
    expect(sekb?.evidenceRefs).toEqual(
      expect.arrayContaining([
        'openclaw_runtime/src/knowledge/sekb/trajectory-redaction.ts',
        'openclaw_runtime/src/logging/redact.ts',
      ]),
    );
  });
});
