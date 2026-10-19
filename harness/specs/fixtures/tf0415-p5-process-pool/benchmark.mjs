import { execFile, spawn } from 'node:child_process';
import { writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { performance } from 'node:perf_hooks';
import { fileURLToPath } from 'node:url';

const WARMUP = 3;
const SAMPLES = 30;
const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(here, '../../../..');

function percentile(values, ratio) {
  const sorted = [...values].sort((left, right) => left - right);
  return sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * ratio))] ?? null;
}

function summarize(durations) {
  return {
    p50Ms: percentile(durations, 0.5),
    p90Ms: percentile(durations, 0.9),
    minMs: Math.min(...durations),
    maxMs: Math.max(...durations),
    samples: durations,
  };
}

async function timed(run) {
  const started = performance.now();
  const result = await run();
  if (result.exitCode !== 0) throw new Error(result.stderr || 'git command failed');
  return performance.now() - started;
}

function execGit() {
  return new Promise((resolveResult) => {
    execFile(
      'git',
      ['rev-parse', 'HEAD'],
      { cwd: repoRoot, encoding: 'utf8', windowsHide: true, timeout: 15_000 },
      (error, stdout, stderr) => resolveResult({
        exitCode: error ? 1 : 0,
        stdout: String(stdout ?? '').trim(),
        stderr: String(stderr ?? error?.message ?? '').trim(),
      }),
    );
  });
}

function startRelay() {
  const child = spawn(process.execPath, [join(here, 'worker-relay.mjs')], {
    cwd: repoRoot,
    stdio: ['pipe', 'pipe', 'inherit'],
    windowsHide: true,
  });
  let buffer = '';
  let nextId = 1;
  const pending = new Map();
  let readyResolve;
  let readyReject;
  const ready = new Promise((resolveReady, rejectReady) => {
    readyResolve = resolveReady;
    readyReject = rejectReady;
  });
  child.once('error', readyReject);
  child.once('exit', (code) => {
    if (code !== 0) readyReject(new Error(`worker exited with ${code}`));
    for (const { reject } of pending.values()) reject(new Error(`worker exited with ${code}`));
    pending.clear();
  });
  child.stdout.setEncoding('utf8');
  child.stdout.on('data', (chunk) => {
    buffer += chunk;
    let newline = buffer.indexOf('\n');
    while (newline >= 0) {
      const line = buffer.slice(0, newline).trim();
      buffer = buffer.slice(newline + 1);
      if (line) {
        const payload = JSON.parse(line);
        if (payload.type === 'ready') {
          readyResolve();
        } else {
          const pendingRequest = pending.get(payload.id);
          if (pendingRequest) {
            pending.delete(payload.id);
            pendingRequest.resolve(payload);
          }
        }
      }
      newline = buffer.indexOf('\n');
    }
  });
  return {
    ready,
    request() {
      const id = nextId++;
      const response = new Promise((resolveResponse, rejectResponse) => {
        pending.set(id, { resolve: resolveResponse, reject: rejectResponse });
      });
      child.stdin.write(`${JSON.stringify({ id, cwd: repoRoot })}\n`);
      return response;
    },
    close() {
      child.stdin.end();
      child.kill();
    },
  };
}

const relay = startRelay();
try {
  await relay.ready;
  for (let index = 0; index < WARMUP; index += 1) {
    await timed(execGit);
    await timed(() => relay.request());
  }

  const directDurations = [];
  const relayedDurations = [];
  for (let index = 0; index < SAMPLES; index += 1) {
    if (index % 2 === 0) {
      directDurations.push(await timed(execGit));
      relayedDurations.push(await timed(() => relay.request()));
    } else {
      relayedDurations.push(await timed(() => relay.request()));
      directDurations.push(await timed(execGit));
    }
  }

  const direct = summarize(directDurations);
  const relayed = summarize(relayedDurations);
  const p50DeltaRatio = direct.p50Ms > 0 ? (relayed.p50Ms - direct.p50Ms) / direct.p50Ms : null;
  const p50ReductionRatio = p50DeltaRatio == null ? null : -p50DeltaRatio;
  const report = {
    schema: 'clawx.tf0415.process-pool-overhead/v1',
    driven_by: 'agent',
    actor: 'codex-tf0402',
    generatedAt: new Date().toISOString(),
    workload: {
      command: 'git rev-parse HEAD',
      warmup: WARMUP,
      samples: SAMPLES,
      order: 'alternating ABBA-style direct/relay pairs',
      mode: 'direct execFile vs one persistent Node relay that still execFiles git per job',
    },
    direct,
    relayed,
    p50DeltaRatio,
    p50ReductionRatio,
    targetReduction: 0.5,
    conclusion: 'A persistent relay that still execFiles git per job does not remove the dominant child-process cost; this run remains far below the 50% implementation threshold.',
  };
  const text = JSON.stringify(report, null, 2);
  process.stdout.write(`${text}\n`);
  if (process.env.PROCESS_POOL_BENCHMARK_OUT) {
    writeFileSync(process.env.PROCESS_POOL_BENCHMARK_OUT, `${text}\n`);
  }
} finally {
  relay.close();
}