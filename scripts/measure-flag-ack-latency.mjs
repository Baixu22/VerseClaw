#!/usr/bin/env node
/**
 * FP-P1-09: measure real gateway-child spawn → runtime.flags.ack latency.
 *
 * Spawns the REAL gateway child (openclaw_runtime/dist/entry.js) with an
 * isolated state dir, then polls a real WebSocket RPC (`runtime.flags.ack`,
 * protocol v4 connect handshake with token auth) until the child answers.
 * Reports per-run: listenMs (first ws accept) and ackMs (first complete ack).
 *
 * Usage: node scripts/measure-flag-ack-latency.mjs [runs=6]
 */
import { spawn } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const WebSocket = require('ws');

const ROOT = resolve(new URL('..', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1'));
const ENTRY = join(ROOT, 'openclaw_runtime', 'dist', 'entry.js');
const TOKEN = 'fp-p1-09-measure-token';
const RUNS = Number(process.argv[2] ?? 6);
const POLL_MS = 250;
const RUN_TIMEOUT_MS = 120_000;

function allocatePort() {
  return new Promise((res, rej) => {
    const server = createServer();
    server.once('error', rej);
    server.listen(0, '127.0.0.1', () => {
      const { port } = server.address();
      server.close((err) => (err ? rej(err) : res(port)));
    });
  });
}

function tryAck(port) {
  // One full attempt: ws open → connect.challenge → connect → runtime.flags.ack.
  return new Promise((res) => {
    const ws = new WebSocket(`ws://127.0.0.1:${port}/ws`);
    const done = (value) => {
      try { ws.close(); } catch { /* ignore */ }
      try { ws.terminate(); } catch { /* ignore */ }
      res(value);
    };
    const timer = setTimeout(() => done(null), 8_000);
    ws.on('error', () => { clearTimeout(timer); done(null); });
    ws.on('message', (data) => {
      let message;
      try { message = JSON.parse(data.toString()); } catch { return; }
      if (message.type === 'event' && message.event === 'connect.challenge') {
        ws.send(JSON.stringify({
          type: 'req',
          id: 'connect-measure',
          method: 'connect',
          params: {
            minProtocol: 4,
            maxProtocol: 4,
            client: {
              id: 'gateway-client',
              displayName: 'fp-p1-09-measure',
              version: '0.0.0',
              platform: process.platform,
              mode: 'backend',
            },
            auth: { token: TOKEN },
            caps: [],
            role: 'operator',
            scopes: ['operator.admin', 'operator.read'],
          },
        }));
        return;
      }
      if (message.type === 'res' && message.id === 'connect-measure') {
        if (message.ok === false) { clearTimeout(timer); done(null); return; }
        ws.send(JSON.stringify({ type: 'req', id: 'ack-measure', method: 'runtime.flags.ack', params: {} }));
        return;
      }
      if (message.type === 'res' && message.id === 'ack-measure') {
        clearTimeout(timer);
        const payload = message.payload ?? message.result ?? null;
        done(payload && typeof payload === 'object' ? payload : null);
      }
    });
  });
}

async function measureOnce(runIndex) {
  const stateDir = mkdtempSync(join(tmpdir(), `fp-p1-09-${runIndex}-`));
  const configPath = join(stateDir, 'openclaw.json');
  writeFileSync(configPath, JSON.stringify({
    gateway: { mode: 'local', controlUi: { enabled: false } },
  }, null, 2));
  const port = await allocatePort();
  const startedAt = Date.now();
  const child = spawn(process.execPath, [ENTRY, 'gateway', '--port', String(port), '--token', TOKEN, '--allow-unconfigured'], {
    cwd: join(ROOT, 'openclaw_runtime'),
    env: {
      ...process.env,
      OPENCLAW_CONFIG_PATH: configPath,
      OPENCLAW_STATE_DIR: join(stateDir, 'state'),
      VERSE_GATEWAY_GENERATION: String(runIndex + 1),
    },
    stdio: 'ignore',
  });
  let listenMs = null;
  let ackMs = null;
  let attempts = 0;
  try {
    while (Date.now() - startedAt < RUN_TIMEOUT_MS) {
      attempts += 1;
      const payload = await tryAck(port);
      if (payload) {
        ackMs = Date.now() - startedAt;
        if (listenMs == null) listenMs = ackMs;
        break;
      }
      await new Promise((res) => setTimeout(res, POLL_MS));
    }
  } finally {
    child.kill();
    await new Promise((res) => setTimeout(res, 300));
    try { rmSync(stateDir, { recursive: true, force: true }); } catch { /* windows */ }
  }
  return { run: runIndex, port, ackMs, attempts, pid: child.pid };
}

const results = [];
for (let i = 0; i < RUNS; i += 1) {
  const result = await measureOnce(i);
  results.push(result);
  console.log(JSON.stringify(result));
}
const acks = results.map((r) => r.ackMs).filter((v) => v != null);
const summary = {
  runs: RUNS,
  succeeded: acks.length,
  minMs: Math.min(...acks),
  maxMs: Math.max(...acks),
  meanMs: Math.round(acks.reduce((a, b) => a + b, 0) / acks.length),
  note: 'run 0 is the coldest (fresh state dir each run; OS file cache still warms across runs)',
};
console.log(JSON.stringify({ summary }));
