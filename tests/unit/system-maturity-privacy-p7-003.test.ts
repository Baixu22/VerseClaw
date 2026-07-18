import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  decideSensitiveCapture,
  isRetentionExpired,
  normalizeSensitiveCapturePolicy,
} from '../../shared/privacy/sensitive-capture-policy';
import {
  assertNoStackOrSecret,
  sanitizeUiErrorText,
} from '../../shared/privacy/ui-error-sanitize';
import {
  validatePrivacyDataFlowInventory,
  validateSensitiveCapturePolicySemantics,
} from '../../scripts/lib/system-maturity-privacy.mjs';

describe('P7-003 privacy controls', () => {
  it('exposes model/oauth/mcp/update/capture/telemetry data flows with destinations', () => {
    const root = process.cwd();
    const inventory = JSON.parse(readFileSync(join(root, 'plans/system-maturity/privacy-data-flow-inventory.json'), 'utf8'));
    expect(validatePrivacyDataFlowInventory({ root, inventory })).toEqual([]);
    expect(inventory.flows.map((flow: { category: string }) => flow.category).sort()).toEqual([
      'mcp',
      'model',
      'oauth',
      'sensitive-capture',
      'telemetry',
      'update',
    ].sort());
  });

  it('denies sensitive capture when kill switch is on or grant is missing/expired', () => {
    expect(validateSensitiveCapturePolicySemantics(decideSensitiveCapture)).toEqual([]);
    const denied = decideSensitiveCapture({
      policy: normalizeSensitiveCapturePolicy({ killSwitch: true }),
      channel: 'clipboard',
    });
    expect(denied).toMatchObject({ allowed: false, code: 'kill-switch' });
  });

  it('expires retained captures after retentionMaxHours', () => {
    expect(isRetentionExpired({
      capturedAt: '2026-07-01T00:00:00.000Z',
      retentionMaxHours: 24,
      nowMs: Date.parse('2026-07-03T00:00:00.000Z'),
    })).toBe(true);
    expect(isRetentionExpired({
      capturedAt: '2026-07-17T00:00:00.000Z',
      retentionMaxHours: 72,
      nowMs: Date.parse('2026-07-18T00:00:00.000Z'),
    })).toBe(false);
  });

  it('sanitizes UI errors so stack frames and secret-shaped text never render', () => {
    const clean = sanitizeUiErrorText('Failed sk-abcdefghijklmnopqrstuvwxyz12\n    at Object.boom (src/x.ts:10:5)\nCLAWX_CANARY_LEAK99');
    expect(assertNoStackOrSecret(clean)).toEqual([]);
    expect(clean).not.toContain('at Object.boom');
    expect(clean).not.toMatch(/sk-[A-Za-z0-9]{20,}/);
    expect(clean).not.toContain('CLAWX_CANARY_LEAK99');
  });

  it('wires Main capture gates and ErrorBoundary sanitizer into product code', () => {
    const root = process.cwd();
    for (const rel of [
      'electron/services/agent-browser-api.ts',
      'electron/services/remote-control-api.ts',
      'electron/services/gateway-api.ts',
      'electron/services/sensitive-capture-gate.ts',
      'src/components/common/ErrorBoundary.tsx',
    ]) {
      const text = readFileSync(join(root, rel), 'utf8');
      if (rel.endsWith('ErrorBoundary.tsx')) {
        expect(text).toContain('sanitizeUiErrorText');
        expect(text).not.toContain('error.stack');
      } else {
        expect(text).toContain('assertSensitiveCaptureAllowed');
      }
    }
  });
});
