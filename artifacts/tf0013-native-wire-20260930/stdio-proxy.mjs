// Transparent recorder for the isolated agent fixture, not a replacement server.
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import { createInterface } from 'node:readline';
const [log, binary, ...args] = process.argv.slice(2);
const child = spawn(binary, args, { stdio: ['pipe', 'pipe', 'inherit'], windowsHide: true });
for (const [direction, input, output] of [['request', process.stdin, child.stdin], ['response', child.stdout, process.stdout]]) {
  createInterface({ input }).on('line', line => {
    fs.appendFileSync(log, JSON.stringify({ direction, message: JSON.parse(line) }) + '\n');
    output.write(line + '\n');
  });
}
child.on('exit', code => process.exit(code ?? 1));
child.on('error', error => { console.error(error); process.exit(1); });
process.stdin.on('end', () => child.stdin.end());
process.on('SIGTERM', () => child.kill());
