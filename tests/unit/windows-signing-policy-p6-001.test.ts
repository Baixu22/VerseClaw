import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  checkWorkflowPolicyConsistency,
  detectReleaseChannel,
  evaluatePublicReleaseGate,
  getWindowsSigningPolicy,
  patchUpdateYmlHashes,
  validateSigningAttestation,
  verifyUpdateYmlHashes,
} from '../../shared/release-policy/windows-signing-policy.mjs';

describe('P6-001 Windows signing policy', () => {
  it('detects alpha/beta/stable channels', () => {
    expect(detectReleaseChannel('1.0.0')).toBe('stable');
    expect(detectReleaseChannel('v1.0.0')).toBe('stable');
    expect(detectReleaseChannel('0.4.9-alpha.0')).toBe('alpha');
    expect(detectReleaseChannel('1.2.0-beta.3')).toBe('beta');
    expect(detectReleaseChannel('2.0.0-rc.1')).toBe('other-prerelease');
  });

  it('A1 policy matrix: stable requires signing; alpha/beta skip but not public', () => {
    const stable = getWindowsSigningPolicy('1.0.0');
    expect(stable.requireCodeSigning).toBe(true);
    expect(stable.allowPublicPublish).toBe(true);
    expect(stable.ossChannelDir).toBe('latest');
    expect(stable.githubPrereleaseRequired).toBe(false);

    const alpha = getWindowsSigningPolicy('0.4.9-alpha.0');
    expect(alpha.requireCodeSigning).toBe(false);
    expect(alpha.allowPublicPublish).toBe(false);
    expect(alpha.githubPrereleaseRequired).toBe(true);
    expect(alpha.ossChannelDir).toBe('alpha');

    const beta = getWindowsSigningPolicy('1.0.0-beta.1');
    expect(beta.requireCodeSigning).toBe(false);
    expect(beta.allowPublicPublish).toBe(false);
    expect(beta.ossChannelDir).toBe('beta');

    // fail-closed unknown prerelease
    const rc = getWindowsSigningPolicy('1.0.0-rc.1');
    expect(rc.requireCodeSigning).toBe(true);
    expect(rc.allowPublicPublish).toBe(false);
  });

  it('A1 release.yml stays consistent with policy anchors', () => {
    const wf = readFileSync(join(process.cwd(), '.github/workflows/release.yml'), 'utf8');
    const result = checkWorkflowPolicyConsistency(wf);
    expect(result.missing, JSON.stringify(result.missing)).toEqual([]);
    expect(result.ok).toBe(true);
  });

  it('A2 blocks unsigned artifacts from public publish', () => {
    const denied = evaluatePublicReleaseGate({
      version: '1.0.0',
      windowsArtifactsSigned: false,
      targetPublicPublish: true,
    });
    expect(denied.allowed).toBe(false);
    expect(denied.reasons.join(' ')).toMatch(/unsigned|signing/i);

    const allowed = evaluatePublicReleaseGate({
      version: '1.0.0',
      windowsArtifactsSigned: true,
      targetPublicPublish: true,
    });
    expect(allowed.allowed).toBe(true);

    const alphaUnsigned = evaluatePublicReleaseGate({
      version: '1.0.0-alpha.2',
      windowsArtifactsSigned: false,
      targetPublicPublish: false,
    });
    expect(alphaUnsigned.allowed).toBe(true);

    const alphaPublic = evaluatePublicReleaseGate({
      version: '1.0.0-alpha.2',
      windowsArtifactsSigned: true,
      targetPublicPublish: true,
    });
    expect(alphaPublic.allowed).toBe(false);
  });

  it('A2 validates real Authenticode evidence before public publishing', () => {
    const stableAttestation = {
      schemaVersion: 1,
      task: 'P6-001',
      platform: 'win',
      version: '1.0.0',
      channel: 'stable',
      requiresCodeSigning: true,
      targetPublicPublish: true,
      windowsArtifactsSigned: true,
      exeCount: 2,
      exeNames: ['Verse Claw-1.0.0-win-x64.exe', 'Verse Claw-1.0.0-win-arm64.exe'],
      signatureVerification: {
        status: 'verified',
        verifiedExeCount: 2,
        verifiedExeNames: [
          'Verse Claw-1.0.0-win-x64.exe',
          'Verse Claw-1.0.0-win-arm64.exe',
        ],
        signatures: [
          {
            name: 'Verse Claw-1.0.0-win-x64.exe',
            status: 'Valid',
            signerSubject: 'CN=Verse Claw Release',
          },
          {
            name: 'Verse Claw-1.0.0-win-arm64.exe',
            status: 'Valid',
            signerSubject: 'CN=Verse Claw Release',
          },
        ],
      },
    };

    expect(validateSigningAttestation(stableAttestation, '1.0.0').ok).toBe(true);

    const forged = structuredClone(stableAttestation);
    forged.signatureVerification.signatures[0].status = 'NotSigned';
    const forgedResult = validateSigningAttestation(forged, '1.0.0');
    expect(forgedResult.ok).toBe(false);
    expect(forgedResult.reasons.join(' ')).toMatch(/Authenticode|Valid/i);

    const alphaAttestation = {
      schemaVersion: 1,
      task: 'P6-001',
      platform: 'win',
      version: '1.0.0-alpha.1',
      channel: 'alpha',
      requiresCodeSigning: false,
      targetPublicPublish: false,
      windowsArtifactsSigned: false,
      exeCount: 1,
      exeNames: ['Verse Claw-1.0.0-alpha.1-win-x64.exe'],
      signatureVerification: {
        status: 'not-required',
        verifiedExeCount: 0,
        verifiedExeNames: [],
        signatures: [],
      },
    };
    expect(validateSigningAttestation(alphaAttestation, '1.0.0-alpha.1').ok).toBe(true);
  });

  it('A3 patches and verifies latest.yml sha512/size after resign', () => {
    const fileName = 'Verse Claw-1.0.0-win-x64.exe';
    const oldHash = createHash('sha512').update('unsigned-bytes').digest('base64');
    const newBytes = Buffer.from('signed-bytes-after-signpath');
    const newHash = createHash('sha512').update(newBytes).digest('base64');
    const newSize = newBytes.length;

    const originalYml = [
      'version: 1.0.0',
      'files:',
      `  - url: ${fileName}`,
      `    sha512: ${oldHash}`,
      '    size: 14',
      `path: ${fileName}`,
      `sha512: ${oldHash}`,
      'releaseDate: 2026-07-17T00:00:00.000Z',
      '',
    ].join('\n');

    const patched = patchUpdateYmlHashes(originalYml, [
      { name: fileName, sha512Base64: newHash, size: newSize },
    ]);
    expect(patched.updated).toEqual([fileName]);
    expect(patched.text).toContain(newHash);
    expect(patched.text).not.toContain(oldHash);
    expect(patched.text).toContain(`size: ${newSize}`);

    const verify = verifyUpdateYmlHashes(patched.text, [
      { name: fileName, sha512Base64: newHash, size: newSize },
    ]);
    expect(verify.ok).toBe(true);
    expect(verify.checked).toBe(1);

    const tampered = verifyUpdateYmlHashes(patched.text, [
      { name: fileName, sha512Base64: oldHash, size: newSize },
    ]);
    expect(tampered.ok).toBe(false);
    expect(tampered.mismatches.length).toBeGreaterThan(0);

    const missingHash = patched.text.replace(`sha512: ${newHash}`, 'sha512:');
    const missingHashResult = verifyUpdateYmlHashes(missingHash, [
      { name: fileName, sha512Base64: newHash, size: newSize },
    ]);
    expect(missingHashResult.ok).toBe(false);
    expect(missingHashResult.mismatches.some((item) => item.actual === '<missing>')).toBe(true);
  });
});
