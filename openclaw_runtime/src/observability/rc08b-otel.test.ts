import { describe, expect, it } from 'vitest';

import {
  buildCorrelationIdentity,
  correlationDigest,
  toOtelSpanId,
  toOtelTraceId,
} from './correlation-ids.js';
import { exportSpansWithParity, isSpanExportable, type ExportableSpan } from './exporter-parity.js';

describe('RC-08B OTel and observability convergence', () => {
  it('ingress/run/model-tool/effect/delivery share a stable correlation digest', () => {
    const identity = buildCorrelationIdentity({
      ingressId: 'cron-1',
      runId: 'run-1',
      modelCallId: 'model-call-1',
      effectId: 'effect-1',
      deliveryId: 'delivery-1',
    });
    expect(identity.correlationDigest).toMatch(/^[a-f0-9]{64}$/);
    // Same segments -> same digest.
    const again = buildCorrelationIdentity({
      ingressId: 'cron-1',
      runId: 'run-1',
      modelCallId: 'model-call-1',
      effectId: 'effect-1',
      deliveryId: 'delivery-1',
    });
    expect(again.correlationDigest).toBe(identity.correlationDigest);
    // A different segment changes the digest.
    const changed = buildCorrelationIdentity({
      ingressId: 'cron-1',
      runId: 'run-2',
      modelCallId: 'model-call-1',
      effectId: 'effect-1',
      deliveryId: 'delivery-1',
    });
    expect(changed.correlationDigest).not.toBe(identity.correlationDigest);
  });

  it('correlation digests map to valid OTel trace/span ids', () => {
    const digest = correlationDigest({ runId: 'run-otel' });
    expect(toOtelTraceId(digest)).toMatch(/^[a-f0-9]{32}$/);
    expect(toOtelSpanId(digest)).toMatch(/^[a-f0-9]{16}$/);
    expect(toOtelSpanId(digest, 'child')).toMatch(/^[a-f0-9]{16}$/);
  });

  it('exporter-off parity: no export, no second store, spans unchanged', () => {
    const spans: ExportableSpan[] = [
      { traceId: 'a'.repeat(32), spanId: 'b'.repeat(16), name: 'run', correlationDigest: 'c', attributes: { kind: 'run' } },
    ];
    const off = exportSpansWithParity({ exporterEnabled: false, spans });
    expect(off.exported).toBe(false);
    expect(off.spans).toEqual(spans);
  });

  it('exporter-on exports only spans with zero raw prompt/tool content', () => {
    const clean: ExportableSpan = {
      traceId: 'a'.repeat(32),
      spanId: 'b'.repeat(16),
      name: 'model-call',
      correlationDigest: 'c',
      attributes: { model: 'claude', tokens: 100 },
    };
    expect(isSpanExportable(clean).ok).toBe(true);

    const leaky: ExportableSpan = {
      ...clean,
      attributes: { prompt: 'raw user prompt' },
    };
    expect(isSpanExportable(leaky).ok).toBe(false);

    const on = exportSpansWithParity({ exporterEnabled: true, spans: [clean, leaky] });
    expect(on.exported).toBe(true);
    // Only the clean span exports; the raw-prompt span is dropped.
    expect(on.spans).toHaveLength(1);
  });
});
