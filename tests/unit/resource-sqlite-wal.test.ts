// @vitest-environment node
import { DatabaseSync } from 'node:sqlite';
import { writeFileSync } from 'node:fs';
import { afterEach, describe, expect, it } from 'vitest';
import { configureSqliteWalMaintenance } from '../../openclaw_runtime/src/infra/sqlite-wal';
import { getTimerAligner, resetTimerAlignerForTest } from '../../shared/resources/timer-aligner';

afterEach(() => { resetTimerAlignerForTest(); });

describe('SQLite WAL checkpoint scheduling', () => {
  it('registers a configurable background checkpoint task and removes it on close', () => {
    const db = new DatabaseSync(':memory:');
    db.exec('CREATE TABLE t (value INTEGER);');
    const maintenance = configureSqliteWalMaintenance(db, {
      databaseLabel: 'wal-test',
      checkpointIntervalMs: 1_000,
      checkpointMode: 'PASSIVE',
    });
    const registeredTasks = getTimerAligner().getDiagnostics().tasks;
    expect(registeredTasks).toEqual([
      expect.objectContaining({ id: 'sqlite-wal:wal-test', intervalMs: 1_000, priority: 'background' }),
    ]);
    const checkpointSucceeded = maintenance.checkpoint();
    expect(checkpointSucceeded).toBe(true);
    maintenance.close();
    const tasksAfterClose = getTimerAligner().getDiagnostics().tasks;
    expect(tasksAfterClose).toEqual([]);
    const output = process.env.RESOURCE_SQLITE_WAL_OUT;
    if (output) {
      writeFileSync(output, JSON.stringify({
        schema: 'clawx.tf0413.sqlite-wal-schedule/v1',
        driven_by: 'agent',
        actor: 'codex-tf0413',
        generatedAt: new Date().toISOString(),
        databaseLabel: 'wal-test',
        intervalMs: 1_000,
        checkpointMode: 'PASSIVE',
        checkpointSucceeded,
        registeredTasks,
        tasksAfterClose,
      }, null, 2) + '\n');
    }
    db.close();
  });
});