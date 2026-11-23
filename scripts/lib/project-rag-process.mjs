import { spawn, spawnSync } from 'node:child_process';
import { open } from 'node:fs/promises';
import { isAbsolute, join } from 'node:path';

/** Own one argv child and its process group; never use a shell or a process-name kill. */
export async function runRagCommand(argv, options) {
  if (!Array.isArray(argv) || !argv.length || !argv.every(part => typeof part === 'string') || !isAbsolute(argv[0])
    || !Number.isSafeInteger(options.timeoutMs) || options.timeoutMs <= 0) throw new Error('Invalid bounded RAG command');
  const log = await open(options.log, 'wx');
  let timedOut = false;
  const started = performance.now();
  const child = spawn(argv[0], argv.slice(1), { cwd: options.cwd, env: options.env,
    windowsHide: true, detached: process.platform !== 'win32', stdio: ['ignore', log.fd, log.fd] });
  const timer = setTimeout(() => {
    timedOut = true;
    if (!child.pid || child.exitCode !== null) return;
    if (process.platform === 'win32') spawnSync(join(process.env.SystemRoot || 'C:/Windows', 'System32', 'taskkill.exe'), ['/PID', String(child.pid), '/T', '/F'], { windowsHide: true, timeout: 5000 });
    else { try { process.kill(-child.pid, 'SIGKILL'); } catch { child.kill('SIGKILL'); } }
  }, options.timeoutMs);
  try {
    const exitCode = await new Promise((accept, reject) => {
      const hardStop = setTimeout(() => reject(new Error('Owned RAG process tree did not confirm termination')), options.timeoutMs + 6000);
      child.once('error', error => { clearTimeout(hardStop); reject(error); });
      child.once('exit', code => { clearTimeout(hardStop); accept(code); });
    });
    return { exitCode, timedOut, durationMs: Math.round(performance.now() - started) };
  } finally { clearTimeout(timer); await log.close(); }
}
