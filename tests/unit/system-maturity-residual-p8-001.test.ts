import { describe, expect, it } from 'vitest';
import {
  evaluateResidualRegister,
  runSystemMaturityResidualAudit,
} from '../../scripts/lib/system-maturity-residual.mjs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');

describe('system maturity residual gate (P8-001)', () => {
  it('fails when Partial+Act-now has no residual-register entry', () => {
    const result = evaluateResidualRegister({
      findings: [
        { id: 'F-SEC-001', status: 'Partial', decision: 'Act-now' },
        { id: 'F-REL-004', status: 'Partial', decision: 'Act-now' },
      ],
      residualRegistry: { schemaVersion: 1, items: [] },
      nowMs: Date.parse('2026-07-18T00:00:00.000Z'),
    });
    expect(result.ok).toBe(false);
    expect(result.errors.some((e: any) => e.includes('F-SEC-001'))).toBe(true);
    expect(result.errors.some((e: any) => e.includes('F-REL-004'))).toBe(true);
  });

  it('passes with valid residual-register entries', () => {
    const result = evaluateResidualRegister({
      findings: [
        { id: 'F-SEC-001', status: 'Partial', decision: 'Act-now' },
        { id: 'F-DATA-004', status: 'Partial', decision: 'Track' },
      ],
      residualRegistry: {
        schemaVersion: 1,
        items: [
          {
            findingId: 'F-SEC-001',
            owner: 'main-boundary',
            reviewBy: '2026-10-18',
            residualScope: 'OpenClaw co-read residual',
          },
        ],
      },
      nowMs: Date.parse('2026-07-18T00:00:00.000Z'),
    });
    expect(result.ok).toBe(true);
    expect(result.rows).toHaveLength(1);
    expect(result.rows[0].status).toBe('active');
  });

  it('fails on expired residual reviewBy', () => {
    const result = evaluateResidualRegister({
      findings: [{ id: 'F-SEC-001', status: 'Partial', decision: 'Act-now' }],
      residualRegistry: {
        items: [
          {
            findingId: 'F-SEC-001',
            owner: 'main-boundary',
            reviewBy: '2026-01-01',
            residualScope: 'expired residual',
          },
        ],
      },
      nowMs: Date.parse('2026-07-18T00:00:00.000Z'),
    });
    expect(result.ok).toBe(false);
    expect(result.errors.some((e: any) => e.includes('expired'))).toBe(true);
  });

  it('repo residual audit is green for committed residual-register', () => {
    const report = runSystemMaturityResidualAudit({
      root,
      nowMs: Date.parse('2026-07-18T12:00:00.000Z'),
    });
    expect(report.ok).toBe(true);
    expect(report.summary.residualMissing).toBe(0);
    expect(report.summary.residualExpired).toBe(0);
    expect(report.summary.residualActive).toBeGreaterThanOrEqual(2);
  });
});
