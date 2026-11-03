import fs from 'node:fs/promises';
import syncFs, { writeSync } from 'node:fs';
import { syncBuiltinESMExports } from 'node:module';
import type { TaskLedgerEventInput, TaskLedgerOperationIdentity } from '../../shared/types/task-ledger.js';

const input = JSON.parse(process.argv[2]) as {
  workspaceId: string;
  operationId: string;
  expectedRevision: number;
  request: unknown;
  identity: TaskLedgerOperationIdentity;
  events: TaskLedgerEventInput[];
};
if (process.env.A2_EXIT_LOCK_PUBLISH) {
  const rename = syncFs.renameSync;
  syncFs.renameSync = (from, to) => {
    if (String(to).endsWith('.json') && String(to).includes('.clawx-write.lock')) {
      if (process.env.A2_EXIT_LOCK_PUBLISH === 'after') rename(from, to);
      writeSync(1, JSON.stringify({ interruptedLockPublication: process.env.A2_EXIT_LOCK_PUBLISH }) + '\n');
      process.exit(process.env.A2_EXIT_LOCK_PUBLISH === 'after' ? 75 : 74);
    }
    rename(from, to);
  };
  syncBuiltinESMExports();
}
if (process.env.A2_EXIT_DURING_PROJECTION === '1') {
  const write = fs.writeFile;
  fs.writeFile = async (...args: Parameters<typeof write>) => {
    if (String(args[0]).endsWith('snapshot.json')) {
      // Exit inside the locked projection write after appendCommitFrame fsync.
      // No JS finally runs, so the next process must recover the orphan lock.
      writeSync(1, JSON.stringify({ abruptExitAfterAppend: true }) + '\n');
      process.exit(73);
    }
    return write(...args);
  };
  syncBuiltinESMExports();
}
if (process.env.A2_RUNTIME_WRITE === '1') {
  const { appendLongTaskLedgerEvents, readLongTaskLedgerRevision } = await import('../../openclaw_runtime/src/agents/long-task-control/task-ledger.js');
  appendLongTaskLedgerEvents(input.workspaceId, input.events);
  process.stdout.write(JSON.stringify({ status: 'runtime-committed', revision: readLongTaskLedgerRevision({
    workspaceId: input.workspaceId, taskLedgerRootId: input.events[0].payload.node?.id ?? '',
  }) }) + '\n');
  process.exit(0);
}
const { readTaskLedgerEvents, commitTaskLedgerOperation } = await import('../../electron/services/task-ledger-service.js');
if (process.env.A2_LOCK_ONLY === '1' || process.env.A2_LOCK_STRESS === '1') {
  const { getTaskLedgerEventsPath } = await import('../../electron/services/task-ledger-service.js');
  const { withTaskLedgerJournalLockSync } = await import('../../shared/task-ledger-journal-lock.js');
  const journal = getTaskLedgerEventsPath(input.workspaceId);
  const counter = journal + '.test-counter';
  const guard = journal + '.test-guard';
  const iterations = process.env.A2_LOCK_STRESS === '1' ? 25 : 1;
  for (let index = 0; index < iterations; index++) {
    withTaskLedgerJournalLockSync(journal, () => {
      const fd = syncFs.openSync(guard, 'wx');
      try {
        const value = syncFs.existsSync(counter) ? Number(syncFs.readFileSync(counter, 'utf8')) : 0;
        Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 2);
        syncFs.writeFileSync(counter, String(value + 1));
      } finally { syncFs.closeSync(fd); syncFs.unlinkSync(guard); }
    }, { timeoutMs: process.env.A2_LOCK_ONLY === '1' ? 750 : 10000 });
  }
  process.stdout.write(JSON.stringify({ lockAcquired: true, iterations }) + '\n');
  process.exit(0);
}
try {
  const result = await commitTaskLedgerOperation(input);
  process.stdout.write(JSON.stringify({ status: 'committed', receipt: result.receipt }) + '\n');
} catch (error) {
  const committed = (await readTaskLedgerEvents(input.workspaceId)).events;
  const projectionFailureAfterAppend = process.env.A2_EXPECT_PROJECTION_FAILURE === '1' && committed.length > 0;
  process.stdout.write(JSON.stringify({ status: 'rejected', code: (error as { code?: string }).code ?? null,
    error: String(error), durableEventsBeforeExit: committed.length, projectionFailureAfterAppend }) + '\n');
  process.exitCode = projectionFailureAfterAppend ? 73 : 2;
}
