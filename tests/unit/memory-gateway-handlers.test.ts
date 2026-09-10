import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../openclaw_runtime/src/agents/subagent-spawn', () => ({
  spawnSubagentDirect: vi.fn(),
}));

vi.mock('../../openclaw_runtime/src/media/image-ops.js', () => ({
  IMAGE_REDUCE_QUALITY_STEPS: [85, 75, 65, 55, 45, 35],
  ImageProcessorUnavailableError: class ImageProcessorUnavailableError extends Error {},
  buildImageResizeSideGrid: vi.fn(() => []),
  convertHeicToJpeg: vi.fn(async (buffer: Buffer) => buffer),
  createImageProcessor: vi.fn(),
  getImageMetadata: vi.fn(async () => null),
  hasAlphaChannel: vi.fn(async () => false),
  isImageProcessorUnavailableError: vi.fn(() => false),
  normalizeExifOrientation: vi.fn(async (buffer: Buffer) => buffer),
  optimizeImageToPng: vi.fn(),
  readImageMetadataFromHeader: vi.fn(() => null),
  readImageProbeFromHeader: vi.fn(() => null),
  resizeToJpeg: vi.fn(async ({ buffer }: { buffer: Buffer }) => buffer),
  resizeToPng: vi.fn(async ({ buffer }: { buffer: Buffer }) => buffer),
}));

vi.mock('rastermill', () => ({
  createRastermill: () => ({
    probe: vi.fn(),
    encode: vi.fn(),
  }),
  isRastermillUnavailableError: () => false,
  RastermillError: class RastermillError extends Error {},
  RastermillUnavailableError: class RastermillUnavailableError extends Error {},
  readImageProbeFromHeader: vi.fn(),
  readImageMetadataFromHeader: vi.fn(),
}));

import { roleOrchestrationHandlers } from '../../openclaw_runtime/src/gateway/server-methods/role-orchestration-methods';
import {
  buildHandlerArgs,
  emptyConfig,
  type CapturedRespond,
} from './helpers/role-gateway-test-utils';
import { clearRuntimeTraceBuffer } from '../../openclaw_runtime/src/observability/trace-buffer';
import { clearMemoryCards } from '../../openclaw_runtime/src/memory/memory-store';

async function callHandler(
  method: string,
  params: Record<string, unknown>,
  cfg = emptyConfig(),
): Promise<CapturedRespond | undefined> {
  const captured: CapturedRespond[] = [];
  const handler = (roleOrchestrationHandlers as Record<string, (args: unknown) => Promise<void>>)[method];
  if (!handler) throw new Error(`unknown handler: ${method}`);
  await handler(buildHandlerArgs(params, cfg, captured));
  return captured[0];
}

afterEach(() => {
  delete process.env.OPENCLAW_ROLE_MEMORY_ENABLED;
  delete process.env.OPENCLAW_MEMORY_USE_GATE;
  clearRuntimeTraceBuffer();
  clearMemoryCards();
});

describe('memory.governance handler (P1-1)', () => {
  it('returns a governance report with the four signals', async () => {
    // Empty fact store: signals must be 0/absent-safe, topDecision "none".
    const res = await callHandler('memory.governance', {});
    expect(res?.ok).toBe(true);
    const report = (res?.payload as { report?: { signals?: unknown; topDecision?: unknown } })?.report;
    expect(report).toBeDefined();
    const signals = report?.signals as Record<string, unknown> | undefined;
    expect(signals).toBeDefined();
    // All four roadmap §D3 signals are present.
    for (const key of ['conflictDensity', 'driftScore', 'staleRatio', 'hotSpotCount']) {
      expect(signals).toHaveProperty(key);
    }
    expect(report?.topDecision).toMatchObject({ action: 'none' });
  });

  it('respects a positive limit parameter', async () => {
    const res = await callHandler('memory.governance', { limit: 5 });
    expect(res?.ok).toBe(true);
    expect((res?.payload as { report?: unknown })?.report).toBeDefined();
  });
});

describe('memory.operatorInspection handler (P3-1)', () => {
  it('returns a sanitized inspection result', async () => {
    const res = await callHandler('memory.operatorInspection', {});
    expect(res?.ok).toBe(true);
    expect((res?.payload as { inspection?: unknown })?.inspection).toBeDefined();
  });

  it('clamps the limit to the 1..200 bound', async () => {
    const res = await callHandler('memory.operatorInspection', { limit: 5000 });
    expect(res?.ok).toBe(true);
    expect((res?.payload as { inspection?: unknown })?.inspection).toBeDefined();
  });
});
