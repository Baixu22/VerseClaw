import { appendFileSync } from 'node:fs';
import { acquireSymbolLease } from '../../../openclaw_runtime/src/context-engine/factstore/symbol-lease.js';

const job = JSON.parse(Buffer.from(process.argv[2] ?? '', 'base64').toString('utf8')) as {
  workspaceRoot: string;
  effectsPath: string;
};
const result = acquireSymbolLease({
  workspaceRoot: job.workspaceRoot, holderId: 'native-owner', symbolName: 'shared',
  mode: 'wal', ttlMs: 10, nowMs: 100,
});
if (!result.ok) throw new Error('native owner could not acquire its initial lease');
appendFileSync(job.effectsPath, 'native-owner-started\n');
process.stdout.write(JSON.stringify({ pid: process.pid, result }) + '\n');
process.stdin.setEncoding('utf8');
process.stdin.on('data', () => {
  appendFileSync(job.effectsPath, 'native-owner-exiting\n');
  // Fault injection: the real owner process exits without releasing its lease.
  process.exit(0);
});
process.stdin.resume();
