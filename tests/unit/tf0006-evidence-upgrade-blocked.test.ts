import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const ROOT = resolve(process.cwd());

describe('TF-0006 evidence upgrade remains blocked without real evidence', () => {
  it('status.json locks blocked + false graduation gates', () => {
    const path = resolve(ROOT, 'artifacts/tf0006-evidence-upgrade/status.json');
    expect(existsSync(path)).toBe(true);
    const status = JSON.parse(readFileSync(path, 'utf8')) as {
      status: string;
      decision: string;
      gates: Record<string, unknown>;
      allRequiredEvidencePresent: boolean;
      requiredEvidence: Record<string, boolean>;
    };

    expect(status.status).toBe('blocked');
    expect(status.decision).toBe('keep-blocked');
    expect(status.gates.liveReady).toBe(false);
    expect(status.gates.productApproved).toBe(false);
    expect(status.gates.readyForDefaultFlagGraduation).toBe(false);
    expect(status.gates.jointSystemGa).toBe('NO-GO');
    expect(status.allRequiredEvidencePresent).toBe(false);
    for (const [file, present] of Object.entries(status.requiredEvidence)) {
      expect(present, file).toBe(false);
      expect(existsSync(resolve(ROOT, file)), file).toBe(false);
    }
  });

  it('unblock doc forbids P0-green graduation', () => {
    const doc = readFileSync(
      resolve(ROOT, 'docs/dev/tf0006-evidence-upgrade-unblock.md'),
      'utf8',
    );
    expect(doc).toMatch(/blocked/i);
    expect(doc).toMatch(/liveReady/);
    expect(doc).toMatch(/64K|corpus/i);
    expect(doc).toMatch(/human live A\/B|live A\/B/i);
    expect(doc).toMatch(/do not/i);
  });

  it('tf0001 close-out still forbids GA while TF-0006 blocked', () => {
    const closeout = JSON.parse(
      readFileSync(resolve(ROOT, 'artifacts/tf0001-closeout/evidence.json'), 'utf8'),
    ) as { verdict: Record<string, unknown>; children: Record<string, string> };
    expect(closeout.verdict.liveReady).toBe(false);
    expect(closeout.verdict.jointSystemGa).toBe('NO-GO');
    expect(closeout.children['TF-0006']).toBe('blocked');
  });
});
