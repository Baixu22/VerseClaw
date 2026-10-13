// @vitest-environment node
/**
 * S04 browser source/session/side-effect ledger guard.
 *
 * Verifies the two existing browser provenance policies and pins the coverage
 * boundary: the external-access gate applies to every action, while the
 * session-ownership (Main-owned managed) gate applies only to click/type. The
 * remaining side-effecting actions are recorded as residual in the S04 ledger.
 */
import { readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

import {
  createExternalProvenance,
  createTrustedProvenance,
  deriveProvenance,
} from '../../shared/security/content-provenance';
import {
  resolveAgentBrowserExternalAccessPolicy,
  resolveAgentBrowserSessionEffectPolicy,
} from '../../openclaw_runtime/src/agents/tools/agent-browser-external-access-policy';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
const TOOL = 'openclaw_runtime/src/agents/tools/agent-browser-tool.ts';
const LEDGER = 'docs/dev/harness-gap-closure/s04-browser-effect-boundary.md';
const EXTERNAL_TOOL_ACTIONS = ['status','navigate','waitForSelector','click','type','evaluate','screenshot','command','close','getConsoleMessages'];
const RESIDUAL_SESSION_GATE = ['evaluate', 'command', 'close'];

const external = createExternalProvenance({ sourceKind: 'web', sourceId: 'web:s04', receivedAt: '2026-08-21T00:00:00.000Z' });
const derivedExternal = deriveProvenance({ sourceKind: 'tool-result', sourceId: 'tool-result:s04', receivedAt: '2026-08-21T00:00:00.000Z', parents: [external] });
const trusted = createTrustedProvenance({ sourceKind: 'user-direct', sourceId: 'operator:s04', receivedAt: '2026-08-21T00:00:00.000Z' });

function read(repoPath: string): string {
  return readFileSync(join(ROOT, repoPath), 'utf8');
}

describe('S04 browser effect boundary ledger', () => {
  it('denies external/unknown provenance the external connection modes, allows managed', () => {
    for (const provenance of [external, derivedExternal, undefined]) {
      expect(resolveAgentBrowserExternalAccessPolicy({ provenanceContext: { provenance }, connectionMode: 'managed' })).toMatchObject({ allowed: true });
      for (const connectionMode of ['auto-connect', 'cdp', 'external-profile']) {
        expect(resolveAgentBrowserExternalAccessPolicy({ provenanceContext: { provenance }, connectionMode })).toMatchObject({ allowed: false, restricted: true });
      }
    }
  });

  it('allows trusted provenance every connection mode', () => {
    for (const connectionMode of ['managed', 'auto-connect', 'cdp', 'external-profile']) {
      expect(resolveAgentBrowserExternalAccessPolicy({ provenanceContext: { provenance: trusted }, connectionMode })).toMatchObject({ allowed: true });
    }
  });

  it('requires a Main-owned managed session for click/type under external/unknown provenance', () => {
    for (const action of ['click', 'type'] as const) {
      for (const provenance of [external, derivedExternal, undefined]) {
        expect(resolveAgentBrowserSessionEffectPolicy({ provenanceContext: { provenance }, sessionConnectionMode: 'managed', action })).toMatchObject({ allowed: true });
        for (const sessionConnectionMode of ['auto-connect', 'cdp', 'external-profile', undefined]) {
          expect(resolveAgentBrowserSessionEffectPolicy({ provenanceContext: { provenance }, sessionConnectionMode, action })).toMatchObject({ allowed: false, restricted: true });
        }
      }
      expect(resolveAgentBrowserSessionEffectPolicy({ provenanceContext: { provenance: trusted }, sessionConnectionMode: 'cdp', action })).toMatchObject({ allowed: true });
    }
  });

  it('pins the wiring: external-access on every action, session gate only on click/type', () => {
    const tool = read(TOOL);
    // Every action consults the external-access policy before invoking.
    expect(tool).toMatch(/resolveAgentBrowserExternalAccessPolicy\(/);
    expect(tool.indexOf('resolveAgentBrowserExternalAccessPolicy(')).toBeLessThan(tool.indexOf('options.invoke!(action'));
    // The session-ownership gate is wired only for click/type.
    expect(tool).toMatch(/action === "click" \|\| action === "type"/);
  });

  it('records every action and the residual session-gate gap in the ledger doc', () => {
    const doc = read(LEDGER);
    for (const action of EXTERNAL_TOOL_ACTIONS) expect(doc).toContain(action);
    for (const action of RESIDUAL_SESSION_GATE) expect(doc).toContain(action);
    expect(doc.toLowerCase()).toContain('residual');
  });
});
