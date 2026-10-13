// @vitest-environment node
/**
 * S02 residual ledger guard.
 *
 * The sensitive-sink drift guard (tests/unit/sensitive-sink-enforcement-drift.test.ts)
 * proves the *declared* enforcement points exist. This guard pins the other half of
 * the S02 ledger: the egress entry points that are NOT yet wired to the shared
 * provenance gate. If any of them is wired, this test fails so the ledger must be
 * updated instead of silently drifting into an over-claim.
 */
import { readFileSync, statSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

import {
  SENSITIVE_SINK_CLASSIFICATION,
  SENSITIVE_SINK_KINDS,
} from '../../shared/security/content-provenance';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
const LEDGER_DOC = 'docs/dev/harness-gap-closure/s02-sink-ledger.md';
const GATE_RE = /isExternalOrUnknownProvenance|enforceCrossContextPolicy/;

/** The one wired network-send egress entry. */
const COVERED_EGRESS = ['openclaw_runtime/src/infra/outbound/message-action-runner.ts'];

/** Egress entries recorded as residual (not wired to the shared gate). */
const RESIDUAL_EGRESS = [
  'openclaw_runtime/src/infra/outbound/outbound-send-service.ts',
  'openclaw_runtime/src/channels/plugins/message-action-dispatch.ts',
  'openclaw_runtime/src/gateway/cli-runtime/outbound-send-deps.ts',
  'openclaw_runtime/src/sessions/send-policy.ts',
  'openclaw_runtime/src/auto-reply/send-policy.ts',
  'openclaw_runtime/src/gateway/server-broadcast.ts',
];

function read(repoPath: string): string {
  return readFileSync(join(ROOT, repoPath), 'utf8');
}

describe('S02 sensitive-sink residual ledger', () => {
  it('classifies every sink with a bounded enforcement level', () => {
    expect([...SENSITIVE_SINK_KINDS]).toEqual([
      'secret-read',
      'network-send',
      'external-write',
      'command-exec',
      'browser-effect',
      'credential-use',
    ]);
    for (const kind of SENSITIVE_SINK_KINDS) {
      const classification = SENSITIVE_SINK_CLASSIFICATION[kind];
      expect(['narrow', 'source-dependent', 'classification-only']).toContain(classification.enforcement);
      if (classification.enforcement !== 'classification-only') {
        expect(classification.enforcedAt.length).toBeGreaterThan(0);
      }
    }
  });

  it('keeps the covered message-action egress path gated', () => {
    for (const file of COVERED_EGRESS) {
      const text = read(file);
      expect(GATE_RE.test(text), `${file} must still invoke the cross-context gate`).toBe(true);
    }
  });

  it('pins the residual egress entry points so wiring them forces a ledger update', () => {
    for (const file of RESIDUAL_EGRESS) {
      expect(statSync(join(ROOT, file), { throwIfNoEntry: false })?.isFile(), file).toBe(true);
      expect(
        GATE_RE.test(read(file)),
        `${file} now invokes the provenance gate - update ${LEDGER_DOC}`,
      ).toBe(false);
    }
  });

  it('records the residual ledger doc with every sink kind', () => {
    const doc = read(LEDGER_DOC);
    for (const kind of SENSITIVE_SINK_KINDS) expect(doc).toContain(kind);
    expect(doc.toLowerCase()).toContain('residual');
  });
});
