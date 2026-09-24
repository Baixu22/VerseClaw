import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';

import { describe, expect, it } from 'vitest';

/**
 * RC-08B root acceptance. The golden OTLP trace through the diagnostics-otel
 * exporter is proven in openclaw_runtime/src/observability/rc08b-otel.test.ts;
 * this file checks the repository-wide single-owner invariants:
 * - only the diagnostics-otel extension constructs an OTLP exporter;
 * - no runtime source hand-encodes an OTLP ExportTraceServiceRequest;
 * - the observability trace buffer is a cache with no export hook.
 */
const runtimeRoot = join(process.cwd(), 'openclaw_runtime');

function sourceFiles(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir)) {
    if (entry === 'node_modules' || entry === 'dist') continue;
    const path = join(dir, entry);
    if (statSync(path).isDirectory()) out.push(...sourceFiles(path));
    else if (/\.(ts|mts|js|mjs)$/.test(entry) && !/\.test\.(ts|mts)$/.test(entry)) out.push(path);
  }
  return out;
}

const productionSources = [
  ...sourceFiles(join(runtimeRoot, 'src')),
  ...sourceFiles(join(runtimeRoot, 'extensions')),
].map((path) => ({ path: relative(runtimeRoot, path).replaceAll('\\', '/'), text: readFileSync(path, 'utf8') }));

describe('RC-08B OTel and observability convergence (root acceptance)', () => {
  it('only the diagnostics-otel extension constructs an OTLP trace exporter', () => {
    const owners = productionSources
      .filter((file) => /new OTLPTraceExporter\(/.test(file.text))
      .map((file) => file.path);
    expect(owners).toEqual(['extensions/diagnostics-otel/src/service.ts']);
  });

  it('no runtime source hand-encodes an OTLP ExportTraceServiceRequest', () => {
    const encoders = productionSources
      .filter((file) => /resourceSpans\s*:/.test(file.text) && /\/v1\/traces/.test(file.text))
      .map((file) => file.path);
    expect(encoders).toEqual([]);
  });

  it('the observability trace buffer is a cache with no export hook', async () => {
    const buffer = await import('../../openclaw_runtime/src/observability/trace-buffer.js');
    expect(Object.keys(buffer)).not.toContain('setObservabilityTraceExporter');
    expect(productionSources.find((file) => file.path === 'src/observability/trace-buffer.ts')?.text).not.toMatch(
      /fetch\(/,
    );
  });
});
