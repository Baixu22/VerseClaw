// @vitest-environment node
import { execFileSync } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:https';
import type { AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { performance } from 'node:perf_hooks';
import { Agent, fetch as undiciFetch } from 'undici';
import { describe, expect, it } from 'vitest';
import { NetworkPool } from '../../electron/utils/network-pool';

function percentile(values: number[], ratio: number): number | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((left, right) => left - right);
  return sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * ratio))] ?? null;
}

const openssl = process.env.OPENSSL_BIN
  ?? (process.platform === 'win32'
    ? 'C:\\Program Files\\Git\\usr\\bin\\openssl.exe'
    : 'openssl');

describe.skipIf(!existsSync(openssl))('NetworkPool HTTPS reuse', () => {
  it('reduces repeated HTTPS P50 latency and connection count', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'clawx-network-pool-'));
    const keyPath = join(dir, 'key.pem');
    const certPath = join(dir, 'cert.pem');
    execFileSync(openssl, [
      'req', '-x509', '-newkey', 'rsa:2048', '-nodes',
      '-keyout', keyPath, '-out', certPath, '-days', '1', '-subj', '/CN=localhost',
      '-addext', 'subjectAltName=DNS:localhost',
    ], { stdio: 'ignore' });
    const server = createServer({
      key: readFileSync(keyPath),
      cert: readFileSync(certPath),
    }, (_request, response) => { response.end('ok'); });
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    const port = (server.address() as AddressInfo).port;
    const url = `https://localhost:${port}/`;
    let connections = 0;
    server.on('connection', () => { connections += 1; });

    const beforeDurations: number[] = [];
    for (let index = 0; index < 5; index += 1) {
      const agent = new Agent({ connect: { rejectUnauthorized: false } });
      const started = performance.now();
      const response = await undiciFetch(url, { dispatcher: agent });
      await response.text();
      beforeDurations.push(performance.now() - started);
      await agent.close();
    }
    const beforeConnections = connections;

    connections = 0;
    const pool = new NetworkPool({ connections: 1, tlsInsecure: true });
    const afterDurations: number[] = [];
    try {
      for (let index = 0; index < 5; index += 1) {
        const started = performance.now();
        const response = await pool.fetch(url);
        await response.text();
        afterDurations.push(performance.now() - started);
      }
    } finally {
      await pool.close();
    }
    const afterConnections = connections;
    const beforeP50 = percentile(beforeDurations, 0.5);
    const afterP50 = percentile(afterDurations, 0.5);
    const metrics = pool.getMetrics();
    const report = {
      schema: 'clawx.tf0413.network-pool-https/v1',
      driven_by: 'agent',
      actor: 'codex-tf0413',
      generatedAt: new Date().toISOString(),
      workload: { requests: 5, url: 'https://localhost', mode: 'fresh-agent-vs-keep-alive-pool' },
      before: { p50Ms: beforeP50, connections: beforeConnections, durationsMs: beforeDurations },
      after: { p50Ms: afterP50, connections: afterConnections, durationsMs: afterDurations, metrics },
    };
    const output = process.env.RESOURCE_NETWORK_POOL_OUT;
    if (output) writeFileSync(output, JSON.stringify(report, null, 2) + '\n');
    server.close();
    rmSync(dir, { recursive: true, force: true });
    expect(beforeP50).not.toBeNull();
    expect(afterP50).not.toBeNull();
    expect(afterP50!).toBeLessThan(beforeP50! * 0.7);
    expect(afterConnections).toBeLessThan(beforeConnections);
    expect(metrics.openedConnections).toBe(afterConnections);
    expect(metrics.connectionLimit).toBe(1);
    expect(metrics.reuseRatio).toBeGreaterThanOrEqual(0.8);
  }, 20_000);
});