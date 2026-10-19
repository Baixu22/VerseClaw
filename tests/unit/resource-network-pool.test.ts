// @vitest-environment node
import { createServer } from 'node:http';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { NetworkPool, resetNetworkPoolForTest } from '../../electron/utils/network-pool';
import { getResourceEnvelopeLedger, resetResourceEnvelopeLedgerForTest } from '../../openclaw_runtime/src/resources/resource-envelope';

afterEach(() => {
  resetNetworkPoolForTest();
  resetResourceEnvelopeLedgerForTest();
});

describe('NetworkPool', () => {
  it('reuses a keep-alive connection and reports metrics in the resource envelope', async () => {
    resetResourceEnvelopeLedgerForTest();
    let connections = 0;
    const server = createServer((_request, response) => { response.end('ok'); });
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    const address = server.address();
    if (!address || typeof address === 'string') throw new Error('server address unavailable');
    server.on('connection', () => { connections += 1; });
    const lookups = vi.fn((_hostname: string, _options: unknown, callback: (...args: unknown[]) => void) => {
      callback(null, [{ address: '127.0.0.1', family: 4 }]);
    });
    const pool = new NetworkPool({ connections: 2, lookup: lookups as never });
    try {
      for (let index = 0; index < 5; index += 1) {
        const response = await pool.fetch(`http://localhost:${address.port}/`);
        expect(await response.text()).toBe('ok');
      }
      const metrics = pool.getMetrics();
      expect(connections).toBeLessThan(5);
      expect(metrics.dnsLookups).toBe(1);
      expect(metrics.connectionLimit).toBe(2);
      expect(metrics.openedConnections).toBe(connections);
      expect(metrics.reuseRatio).toBeGreaterThan(0.5);
      const entry = getResourceEnvelopeLedger().get('main:network-pool');
      expect(entry).toMatchObject({ kind: 'network-pool', limits: { concurrencySlots: 2 } });
      expect(JSON.parse(entry?.reason ?? '{}')).toMatchObject({
        transport: 'undici-agent',
        requests: 5,
        connectionLimit: 2,
        openedConnections: connections,
      });
    } finally {
      await pool.close();
      server.close();
    }
  });

  it('expires cached DNS answers after the configured TTL', async () => {
    let now = 1_000;
    const lookups = vi.fn((_hostname: string, _options: unknown, callback: (...args: unknown[]) => void) => {
      callback(null, [{ address: '127.0.0.1', family: 4 }]);
    });
    const pool = new NetworkPool({ dnsTtlMs: 100, now: () => now, lookup: lookups as never });
    try {
      await expect(pool.resolveHostname('cache.test')).resolves.toEqual([{ address: '127.0.0.1', family: 4 }]);
      now += 50;
      await expect(pool.resolveHostname('cache.test')).resolves.toEqual([{ address: '127.0.0.1', family: 4 }]);
      expect(lookups).toHaveBeenCalledTimes(1);
      now += 51;
      await expect(pool.resolveHostname('cache.test')).resolves.toEqual([{ address: '127.0.0.1', family: 4 }]);
      expect(lookups).toHaveBeenCalledTimes(2);
    } finally {
      await pool.close();
    }
  });
});