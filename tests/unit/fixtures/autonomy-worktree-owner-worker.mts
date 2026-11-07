import path from 'node:path';
import { withTaskLedgerJournalLock } from '../../../shared/task-ledger-journal-lock.js';
import { createWorktreeService } from '../../../openclaw_runtime/src/agents/worktree-service.js';

const job = JSON.parse(Buffer.from(process.argv[2], 'base64').toString('utf8')) as {
  root: string; mode: 'hold-lock' | 'create'; id: string;
};
if (job.mode === 'hold-lock') {
  await withTaskLedgerJournalLock(path.join(job.root, '.openclaw/worktrees/.merge.lock'), async () => {
    process.stdout.write(JSON.stringify({ pid: process.pid, locked: true }) + '\n');
    await new Promise<void>(resolve => { process.stdin.once('data', () => resolve()); process.stdin.resume(); });
  });
  process.exit(0);
} else {
  process.stdout.write(JSON.stringify({ pid: process.pid, ready: true }) + '\n');
  process.stdin.once('data', () => {
    try {
      const record = createWorktreeService(job.root).create(job.id);
      process.stdout.write(JSON.stringify({ pid: process.pid, status: 'created', record }) + '\n');
    } catch (error) {
      process.stdout.write(JSON.stringify({ pid: process.pid, status: 'rejected', error: String(error) }) + '\n');
    }
    process.exit(0);
  });
  process.stdin.resume();
}
