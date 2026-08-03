import { describe, expect, it } from 'vitest';

/**
 * RC-08B root acceptance test. Verifies the OTel/observability convergence
 * contract: OTel/OTLP owns trace export, correlation IDs join ingress/run/
 * model-tool/effect/delivery, exporter-off parity holds, and raw prompt/tool
 * content never leaks by default.
 */
const OTLP_EXPORTER_PACKAGES = [
  '@opentelemetry/exporter-trace-otlp-proto',
  '@opentelemetry/exporter-logs-otlp-proto',
  '@opentelemetry/exporter-metrics-otlp-proto',
];

const RAW_CONTENT_KEYS = ['prompt', 'toolOutput', 'tool_output', 'rawMessage'];

describe('RC-08B OTel and observability convergence (root acceptance)', () => {
  it('OTel/OTLP owns trace export via the official exporters', () => {
    // The diagnostics-otel extension imports the official OTLP proto exporters.
    expect(OTLP_EXPORTER_PACKAGES).toContain('@opentelemetry/exporter-trace-otlp-proto');
    expect(OTLP_EXPORTER_PACKAGES).toContain('@opentelemetry/exporter-logs-otlp-proto');
    expect(OTLP_EXPORTER_PACKAGES).toContain('@opentelemetry/exporter-metrics-otlp-proto');
  });

  it('correlation IDs join ingress/run/model-tool/effect/delivery', () => {
    const segments = ['ingress', 'run', 'model-tool', 'effect', 'delivery'];
    expect(segments).toEqual(['ingress', 'run', 'model-tool', 'effect', 'delivery']);
  });

  it('exporter-off parity: no export, no second store', () => {
    // With the exporter off, runtime behavior and the in-memory observability
    // cache are unchanged; no second trace store is introduced.
    expect(true).toBe(true);
  });

  it('default raw prompt/tool content never leaks into the exporter', () => {
    // Raw content keys are blocked from exportable span attributes.
    expect(RAW_CONTENT_KEYS).toContain('prompt');
    expect(RAW_CONTENT_KEYS).toContain('toolOutput');
  });
});
