import { execFile } from 'node:child_process';
import { createInterface } from 'node:readline';

const lines = createInterface({ input: process.stdin, crlfDelay: Infinity });
let ready = false;

lines.on('line', (line) => {
  let message;
  try {
    message = JSON.parse(line);
  } catch {
    return;
  }
  if (!message || typeof message.id !== 'number' || typeof message.cwd !== 'string') return;
  execFile(
    'git',
    ['rev-parse', 'HEAD'],
    { cwd: message.cwd, encoding: 'utf8', windowsHide: true, timeout: 15_000 },
    (error, stdout, stderr) => {
      const payload = {
        id: message.id,
        exitCode: error ? 1 : 0,
        stdout: String(stdout ?? '').trim(),
        stderr: String(stderr ?? error?.message ?? '').trim(),
      };
      process.stdout.write(`${JSON.stringify(payload)}\n`);
    },
  );
});

process.stdout.write(`${JSON.stringify({ type: 'ready', pid: process.pid })}\n`);
ready = true;