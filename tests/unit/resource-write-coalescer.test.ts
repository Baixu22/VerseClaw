// @vitest-environment node
import { DatabaseSync } from 'node:sqlite';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { WriteCoalescer } from '../../shared/resources/write-coalescer';

describe('WriteCoalescer SQLite pressure', () => {
  it('coalesces 20 row writes into four transaction flushes', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'clawx-write-coalescer-'));
    const db = new DatabaseSync(join(dir, 'state.sqlite'));
    db.exec('CREATE TABLE rows (value INTEGER NOT NULL);');
    let transactions = 0;
    const coalescer = new WriteCoalescer<number>({
      maxBatch: 5,
      flush: (batch) => {
        db.exec('BEGIN IMMEDIATE');
        const insert = db.prepare('INSERT INTO rows (value) VALUES (?)');
        for (const value of batch) insert.run(value);
        db.exec('COMMIT');
        transactions += 1;
      },
    });
    try {
      const writes = Array.from({ length: 20 }, (_, value) => coalescer.enqueue(value));
      await Promise.all(writes);
      const count = db.prepare('SELECT COUNT(*) AS count FROM rows').get() as { count: number };
      const stats = coalescer.getStats();
      const report = {
        schema: 'clawx.tf0413.write-coalescer-pressure/v1',
        driven_by: 'agent',
        actor: 'codex-tf0413',
        generatedAt: new Date().toISOString(),
        enqueued: 20,
        batchSize: 5,
        transactions,
        rows: Number(count.count),
        stats,
        reductionRatio: 1 - transactions / 20,
      };
      const output = process.env.RESOURCE_WRITE_COALESCER_OUT;
      if (output) writeFileSync(output, JSON.stringify(report, null, 2) + '\n');
      expect(transactions).toBe(4);
      expect(Number(count.count)).toBe(20);
      expect(stats.batches).toBe(4);
      expect(report.reductionRatio).toBeGreaterThanOrEqual(0.4);
    } finally {
      db.close();
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('rejects only the failed batch and keeps later batches eligible', async () => {
    const flushed: number[] = [];
    const coalescer = new WriteCoalescer<number>({
      maxBatch: 2,
      flush: async (batch) => {
        if (batch.includes(2)) throw new Error('synthetic batch failure');
        flushed.push(...batch);
      },
    });

    const failed = [coalescer.enqueue(2), coalescer.enqueue(3)];
    await expect(Promise.all(failed)).rejects.toThrow('synthetic batch failure');
    await Promise.all([coalescer.enqueue(4), coalescer.enqueue(5)]);

    expect(flushed).toEqual([4, 5]);
    expect(coalescer.getStats()).toEqual({ queued: 0, batches: 1, flushedItems: 2 });
  });
});