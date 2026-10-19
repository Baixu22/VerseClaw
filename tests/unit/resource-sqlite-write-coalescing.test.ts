// @vitest-environment node
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { afterEach, describe, expect, it } from 'vitest';
import { createSqliteAcpEventLedger } from '../../openclaw_runtime/src/acp/event-ledger';
import {
  closeOpenClawStateDatabaseForTest,
} from '../../openclaw_runtime/src/state/openclaw-state-db';
import { resetTimerAlignerForTest } from '../../shared/resources/timer-aligner';

afterEach(() => {
  closeOpenClawStateDatabaseForTest();
  resetTimerAlignerForTest();
});

describe('production ACP SQLite write coalescing', () => {
  it('turns a 20-update burst into one transaction without losing rows', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'clawx-acp-write-batch-'));
    const baselinePath = join(dir, 'baseline.sqlite');
    const ledgerPath = join(dir, 'state.sqlite');
    const baseline = new DatabaseSync(baselinePath);
    baseline.exec('CREATE TABLE events (value INTEGER NOT NULL);');
    let baselineTransactions = 0;
    try {
      for (let value = 0; value < 20; value += 1) {
        baseline.exec('BEGIN IMMEDIATE');
        baseline.prepare('INSERT INTO events (value) VALUES (?)').run(value);
        baseline.exec('COMMIT');
        baselineTransactions += 1;
      }
    } finally {
      baseline.close();
    }

    const ledger = createSqliteAcpEventLedger({
      path: ledgerPath,
      writeBatchSize: 32,
      writeFlushDelayMs: 25,
    });
    try {
      await ledger.startSession({
        sessionId: 'session-1',
        sessionKey: 'agent:session-1',
        cwd: process.cwd(),
        complete: false,
      });
      const batchesAfterSession = ledger.getWriteStats().batches;

      await Promise.all(Array.from({ length: 20 }, (_, value) => ledger.recordUpdate({
        sessionId: 'session-1',
        sessionKey: 'agent:session-1',
        runId: 'run-1',
        update: {
          sessionUpdate: 'agent_message_chunk',
          content: { type: 'text', text: `event-${value}` },
        },
      })));

      const stats = ledger.getWriteStats();
      const updateTransactions = stats.batches - batchesAfterSession;
      const db = new DatabaseSync(ledgerPath, { readOnly: true });
      const row = db.prepare('SELECT COUNT(*) AS count FROM acp_replay_events').get() as {
        count: number;
      };
      db.close();
      const reductionRatio = 1 - updateTransactions / baselineTransactions;
      const report = {
        schema: 'clawx.tf0413.production-write-coalescing/v1',
        driven_by: 'agent',
        actor: 'codex-tf0413',
        generatedAt: new Date().toISOString(),
        workload: {
          updates: 20,
          writeBatchSize: 32,
          writeFlushDelayMs: 25,
          implementation: 'createSqliteAcpEventLedger',
        },
        before: { transactions: baselineTransactions, rows: 20 },
        after: {
          updateTransactions,
          totalTransactions: stats.batches,
          rows: Number(row.count),
          stats,
        },
        reductionRatio,
      };
      const output = process.env.RESOURCE_SQLITE_COALESCER_OUT;
      if (output) writeFileSync(output, JSON.stringify(report, null, 2) + '\n');

      expect(updateTransactions).toBe(1);
      expect(Number(row.count)).toBe(20);
      expect(stats.queued).toBe(0);
      expect(reductionRatio).toBeGreaterThanOrEqual(0.4);
    } finally {
      closeOpenClawStateDatabaseForTest();
      resetTimerAlignerForTest();
      rmSync(dir, { recursive: true, force: true });
    }
  });
});