// @vitest-environment node
/**
 * S05 provider credential-use boundary ledger guard.
 *
 * Verifies the existing provider-credential-use policy matrix and pins the
 * coverage boundary: the policy is consulted only by the image-generate tool's
 * explicit model-override path, so other credential users remain residual.
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
import { resolveProviderCredentialUsePolicy } from '../../openclaw_runtime/src/agents/tools/provider-credential-use-policy';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
const POLICY = 'openclaw_runtime/src/agents/tools/provider-credential-use-policy.ts';
const CALL_SITE = 'openclaw_runtime/src/agents/tools/image-generate-tool.ts';
const LEDGER = 'docs/dev/harness-gap-closure/s05-credential-use-boundary.md';

const external = createExternalProvenance({ sourceKind: 'web', sourceId: 'web:s05', receivedAt: '2026-08-21T00:00:00.000Z' });
const derivedExternal = deriveProvenance({ sourceKind: 'tool-result', sourceId: 'tool-result:s05', receivedAt: '2026-08-21T00:00:00.000Z', parents: [external] });
const trusted = createTrustedProvenance({ sourceKind: 'user-direct', sourceId: 'operator:s05', receivedAt: '2026-08-21T00:00:00.000Z' });
const BOUND = ['openai', 'google'];

function read(repoPath: string): string {
  return readFileSync(join(ROOT, repoPath), 'utf8');
}
function decide(overrides: Partial<Parameters<typeof resolveProviderCredentialUsePolicy>[0]> = {}) {
  return resolveProviderCredentialUsePolicy({
    provenanceContext: { provenance: external },
    hasExplicitModelOverride: true,
    requestedProvider: 'openai',
    boundProviderIds: BOUND,
    ...overrides,
  });
}

describe('S05 provider credential-use boundary ledger', () => {
  it('allows trusted provenance and no-override paths unchanged', () => {
    expect(decide({ provenanceContext: { provenance: trusted }, requestedProvider: 'unbound' })).toMatchObject({ allowed: true });
    for (const provenance of [external, derivedExternal, undefined]) {
      expect(decide({ provenanceContext: { provenance }, hasExplicitModelOverride: false, requestedProvider: 'unbound' })).toMatchObject({ allowed: true });
    }
  });

  it('keeps external/unknown provenance inside the bound provider scope', () => {
    for (const provenance of [external, derivedExternal, undefined]) {
      expect(decide({ provenanceContext: { provenance }, requestedProvider: 'openai' })).toMatchObject({ allowed: true, restricted: false });
      expect(decide({ provenanceContext: { provenance }, requestedProvider: 'evil-provider' })).toMatchObject({ allowed: false, restricted: true });
      expect(decide({ provenanceContext: { provenance }, requestedProvider: undefined })).toMatchObject({ allowed: false, restricted: true });
      expect(decide({ provenanceContext: { provenance }, requestedProvider: '   ' })).toMatchObject({ allowed: false, restricted: true });
    }
  });

  it('never takes credential values as policy input', () => {
    const source = read(POLICY);
    const block = source.slice(
      source.indexOf('ProviderCredentialUsePolicyInput = {'),
      source.indexOf('};', source.indexOf('ProviderCredentialUsePolicyInput = {')),
    );
    // The input type carries provenance + provider scope only; no credential value.
    for (const expected of ['provenanceContext', 'hasExplicitModelOverride', 'requestedProvider', 'boundProviderIds']) {
      expect(block).toContain(expected);
    }
    for (const forbidden of ['apiKey', 'api_key', 'secretValue', 'tokenValue', 'credentialValue']) {
      expect(block.includes(forbidden), `${forbidden} must not be an input field`).toBe(false);
    }
  });

  it('pins the single call site and records the residual credential users', () => {
    const callSite = read(CALL_SITE);
    expect(callSite).toMatch(/resolveProviderCredentialUsePolicy\(/);
    const doc = read(LEDGER);
    expect(doc.toLowerCase()).toContain('residual');
    expect(doc).toMatch(/image-generate/);
    expect(doc).toMatch(/其它|other/);
  });
});
