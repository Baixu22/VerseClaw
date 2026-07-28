#!/usr/bin/env node
/**
 * P6-001 Windows release signing policy validator.
 *
 *   node scripts/validate-windows-release-policy.mjs
 *   node scripts/validate-windows-release-policy.mjs --gate-public --version 1.2.3 --windows-signed false
 *   node scripts/validate-windows-release-policy.mjs --verify-yml release/latest.yml --artifact-dir release/
 *   node scripts/validate-windows-release-policy.mjs --print-policy --version 0.4.9-alpha.0
 */
import { createHash } from 'node:crypto';
import { appendFileSync, existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { basename, dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import {
  checkWorkflowPolicyConsistency,
  detectReleaseChannel,
  evaluatePublicReleaseGate,
  getWindowsSigningPolicy,
  validateSigningAttestation,
  verifyUpdateYmlHashes,
} from '../shared/release-policy/windows-signing-policy.mjs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = join(__dirname, '..');

function parseArgs(argv) {
  const out = { _: [] };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a.startsWith('--')) {
      const key = a.slice(2);
      const next = argv[i + 1];
      if (!next || next.startsWith('--')) out[key] = true;
      else {
        out[key] = next;
        i++;
      }
    } else out._.push(a);
  }
  return out;
}

function fail(msg) {
  console.error(`[windows-release-policy] FAIL: ${msg}`);
  process.exitCode = 1;
}

function ok(msg) {
  console.log(`[windows-release-policy] OK: ${msg}`);
}

function sha512Base64(filePath) {
  return createHash('sha512').update(readFileSync(filePath)).digest('base64');
}

function readReleaseVersion(args) {
  const version = String(args.version || '').trim().replace(/^v/i, '');
  if (!version) {
    fail('release policy command requires --version');
    process.exit(1);
  }
  return version;
}

function main() {
  const args = parseArgs(process.argv.slice(2));

  if (args['print-policy']) {
    const version = readReleaseVersion(args);
    console.log(
      JSON.stringify(
        { version, channel: detectReleaseChannel(version), policy: getWindowsSigningPolicy(version) },
        null,
        2,
      ),
    );
    return;
  }

  if (args['github-output']) {
    const version = readReleaseVersion(args);
    const policy = getWindowsSigningPolicy(version);
    const outputPath = process.env.GITHUB_OUTPUT;
    if (!outputPath) {
      fail('--github-output requires GITHUB_OUTPUT');
      process.exit(1);
    }
    const lines = [
      `version=${version}`,
      `channel=${policy.channel}`,
      `requires_signing=${policy.requireCodeSigning}`,
      `target_public=${policy.allowPublicPublish}`,
    ];
    appendFileSync(outputPath, `${lines.join('\n')}\n`, 'utf8');
    ok(
      `GitHub outputs: version=${version} channel=${policy.channel} requires_signing=${policy.requireCodeSigning} target_public=${policy.allowPublicPublish}`,
    );
    return;
  }

  if (args['gate-attestation']) {
    const version = readReleaseVersion(args);
    const attestationPath = String(args['gate-attestation']);
    if (!existsSync(attestationPath)) {
      fail(`attestation not found: ${attestationPath}`);
      process.exit(1);
    }
    let attestation;
    try {
      attestation = JSON.parse(readFileSync(attestationPath, 'utf8').replace(/^\uFEFF/, ''));
    } catch (error) {
      fail(`invalid attestation JSON: ${error instanceof Error ? error.message : String(error)}`);
      process.exit(1);
    }
    const validation = validateSigningAttestation(attestation, version);
    const gate = evaluatePublicReleaseGate({
      version,
      windowsArtifactsSigned:
        typeof attestation.windowsArtifactsSigned === 'boolean'
          ? attestation.windowsArtifactsSigned
          : null,
      targetPublicPublish: validation.policy.allowPublicPublish,
    });
    console.log(
      JSON.stringify(
        { attestationPath, version, validation, publicReleaseGate: gate },
        null,
        2,
      ),
    );
    if (!validation.ok || !gate.allowed) {
      for (const reason of [...validation.reasons, ...gate.reasons]) fail(reason);
      process.exit(1);
    }
    ok(`pre-publish attestation gate passed for ${version}`);
    return;
  }

  if (args['gate-public']) {
    const version = readReleaseVersion(args);
    const signedRaw = String(args['windows-signed'] ?? 'na').toLowerCase();
    let windowsArtifactsSigned = null;
    if (['true', '1', 'yes'].includes(signedRaw)) windowsArtifactsSigned = true;
    else if (['false', '0', 'no'].includes(signedRaw)) windowsArtifactsSigned = false;

    const targetPublic =
      args['target-public'] === undefined
        ? detectReleaseChannel(version) === 'stable'
        : String(args['target-public']).toLowerCase() === 'true';

    const result = evaluatePublicReleaseGate({
      version,
      windowsArtifactsSigned,
      targetPublicPublish: targetPublic,
    });
    console.log(JSON.stringify(result, null, 2));
    if (!result.allowed) {
      for (const r of result.reasons) fail(r);
      process.exit(1);
    }
    ok(`public gate allowed for ${version} (signed=${windowsArtifactsSigned}, public=${targetPublic})`);
    return;
  }

  if (args['verify-yml']) {
    const ymlPath = String(args['verify-yml']);
    const dir = String(args['artifact-dir'] || dirname(ymlPath));
    if (!existsSync(ymlPath)) {
      fail(`yml not found: ${ymlPath}`);
      process.exit(1);
    }
    const ymlText = readFileSync(ymlPath, 'utf8');
    const files = readdirSync(dir)
      .filter((n) => /\.(exe|dmg|AppImage|deb|rpm|zip)$/i.test(n))
      .map((n) => {
        const p = join(dir, n);
        return { name: n, sha512Base64: sha512Base64(p), size: statSync(p).size };
      });
    const result = verifyUpdateYmlHashes(ymlText, files);
    console.log(JSON.stringify({ ymlPath, artifactDir: dir, ...result }, null, 2));
    if (!result.ok) {
      fail('latest.yml hash verification failed');
      process.exit(1);
    }
    ok(`verified ${result.checked} artifact hash(es) in ${basename(ymlPath)}`);
    return;
  }

  let failed = false;
  const matrix = [
    ['1.0.0', 'stable', true, true],
    ['0.4.9-alpha.0', 'alpha', false, false],
    ['1.2.0-beta.3', 'beta', false, false],
    ['2.0.0-rc.1', 'other-prerelease', true, false],
  ];
  for (const [ver, ch, reqSign, allowPub] of matrix) {
    const p = getWindowsSigningPolicy(ver);
    if (p.channel !== ch || p.requireCodeSigning !== reqSign || p.allowPublicPublish !== allowPub) {
      fail(`policy matrix mismatch for ${ver}: got ${JSON.stringify(p)}`);
      failed = true;
    } else ok(`policy ${ver} → ${ch} sign=${reqSign} public=${allowPub}`);
  }

  const deny = evaluatePublicReleaseGate({
    version: '1.0.0',
    windowsArtifactsSigned: false,
    targetPublicPublish: true,
  });
  if (deny.allowed) {
    fail('stable unsigned must be denied for public publish');
    failed = true;
  } else ok('stable unsigned denied for public publish');

  const allowAlpha = evaluatePublicReleaseGate({
    version: '1.0.0-alpha.1',
    windowsArtifactsSigned: false,
    targetPublicPublish: false,
  });
  if (!allowAlpha.allowed) {
    fail(`alpha non-public unsigned should be allowed: ${allowAlpha.reasons.join('; ')}`);
    failed = true;
  } else ok('alpha prerelease unsigned allowed (non-public)');

  const wfPath = join(root, '.github/workflows/release.yml');
  if (!existsSync(wfPath)) {
    fail('missing .github/workflows/release.yml');
    failed = true;
  } else {
    const wfText = readFileSync(wfPath, 'utf8');
    const cons = checkWorkflowPolicyConsistency(wfText);
    if (!cons.ok) {
      for (const m of cons.missing) fail(`workflow missing anchor ${m.id}: ${m.meaning}`);
      failed = true;
    } else ok('release.yml anchors match windows signing policy (A1)');

    // FP-P3-02: release notes must not advertise artifacts that are not built.
    // First product controlled preview publishes only Windows x64.
    const forbiddenArtifacts = [
      'win-arm64.exe',
      'mac-arm64.dmg',
      'mac-x64.dmg',
      'linux-arm64.AppImage',
      'linux-arm64.deb',
      'linux-amd64.deb',
      'linux-x86_64.AppImage',
      'linux-x86_64.rpm',
    ];
    const bodyMatch = wfText.match(/body:\s*\|[\s\S]*?(?=\n\s{8,}\w)/);
    const bodyText = bodyMatch ? bodyMatch[0] : wfText;
    const offending = forbiddenArtifacts.filter((a) => bodyText.includes(a));
    if (offending.length > 0) {
      fail(
        `release.yml body advertises artifacts not built in this preview: ${offending.join(', ')}`,
      );
      failed = true;
    } else ok('release.yml body only lists Windows x64 installer (FP-P3-02)');

    // release-info.json must only reference win.x64
    const releaseInfoMatch = wfText.match(/downloads:\s*\{[^}]*win:\s*\{[^}]*\}/);
    if (releaseInfoMatch) {
      const winBlock = releaseInfoMatch[0];
      if (winBlock.includes('arm64')) {
        fail('release-info.json win block still references arm64');
        failed = true;
      } else ok('release-info.json only includes win.x64 (FP-P3-02)');
    }
  }

  if (failed) process.exit(1);
  ok('P6-001 windows release policy validation passed');
}

main();
