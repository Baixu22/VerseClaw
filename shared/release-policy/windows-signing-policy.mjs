/**
 * P6-001 — Windows release channel / code-signing / public-publish policy.
 * Pure ESM so CI Node and Vitest can import without a TS compile step.
 */

const PRE_ID_RE = /(?:^|-)((?:alpha|beta|rc|next|canary|dev|snapshot))(?:[.-]|$)/i;

/**
 * @param {string} versionRaw
 * @returns {'stable'|'alpha'|'beta'|'other-prerelease'}
 */
export function detectReleaseChannel(versionRaw) {
  const version = String(versionRaw || '').trim().replace(/^v/i, '');
  if (!version) return 'other-prerelease';
  const dash = version.indexOf('-');
  if (dash < 0) return 'stable';
  const pre = version.slice(dash + 1).toLowerCase();
  if (pre.startsWith('alpha')) return 'alpha';
  if (pre.startsWith('beta')) return 'beta';
  if (/\balpha\b/.test(pre) || pre.includes('alpha.')) return 'alpha';
  if (/\bbeta\b/.test(pre) || pre.includes('beta.')) return 'beta';
  if (PRE_ID_RE.test(version)) return 'other-prerelease';
  return 'other-prerelease';
}

/**
 * @param {string} versionRaw
 */
export function getWindowsSigningPolicy(versionRaw) {
  const channel = detectReleaseChannel(versionRaw);
  if (channel === 'stable') {
    return {
      channel,
      ossChannelDir: 'latest',
      requireCodeSigning: true,
      allowPublicPublish: true,
      githubPrereleaseRequired: false,
      riskLevel: 'high',
      summary:
        'Stable Windows builds MUST be SignPath-signed; unsigned artifacts cannot enter public publish (GitHub latest / OSS latest/).',
    };
  }
  if (channel === 'alpha') {
    return {
      channel,
      ossChannelDir: 'alpha',
      requireCodeSigning: false,
      allowPublicPublish: false,
      githubPrereleaseRequired: true,
      riskLevel: 'medium',
      summary:
        'Alpha may skip Windows code signing for iteration speed, but MUST stay prerelease and MUST NOT promote to public latest.',
    };
  }
  if (channel === 'beta') {
    return {
      channel,
      ossChannelDir: 'beta',
      requireCodeSigning: false,
      allowPublicPublish: false,
      githubPrereleaseRequired: true,
      riskLevel: 'medium',
      summary:
        'Beta may skip Windows code signing, but MUST stay prerelease and MUST NOT promote to public latest.',
    };
  }
  return {
    channel: 'other-prerelease',
    ossChannelDir: 'other',
    requireCodeSigning: true,
    allowPublicPublish: false,
    githubPrereleaseRequired: true,
    riskLevel: 'high',
    summary:
      'Unknown prerelease channel is fail-closed: require signing and forbid public latest until explicitly classified.',
  };
}

/**
 * @param {{ version: string, windowsArtifactsSigned: boolean|null, targetPublicPublish: boolean }} input
 */
export function evaluatePublicReleaseGate(input) {
  const policy = getWindowsSigningPolicy(input.version);
  const reasons = [];

  if (input.targetPublicPublish && !policy.allowPublicPublish) {
    reasons.push(
      `channel=${policy.channel} forbids public publish (use prerelease + OSS ${policy.ossChannelDir}/ only)`,
    );
  }

  if (policy.requireCodeSigning && input.windowsArtifactsSigned === false) {
    reasons.push('Windows artifacts are unsigned but policy requires code signing');
  }

  if (
    input.targetPublicPublish &&
    policy.requireCodeSigning &&
    input.windowsArtifactsSigned !== true
  ) {
    reasons.push('public publish requires proven Windows code signing');
  }

  if (input.targetPublicPublish && input.windowsArtifactsSigned === false) {
    reasons.push('unsigned Windows artifacts cannot enter public release');
  }

  return {
    allowed: reasons.length === 0,
    policy,
    reasons,
  };
}

/**
 * Validate the attestation emitted by the Windows build before any public
 * GitHub/OSS publishing job is allowed to start.
 *
 * @param {unknown} value
 * @param {string} expectedVersionRaw
 */
export function validateSigningAttestation(value, expectedVersionRaw) {
  const reasons = [];
  const attestation = value && typeof value === 'object' ? value : {};
  const expectedVersion = String(expectedVersionRaw || '').replace(/^v/i, '');
  const policy = getWindowsSigningPolicy(expectedVersion);
  const expectedSigned = policy.requireCodeSigning;

  if (attestation.schemaVersion !== 1) reasons.push('attestation schemaVersion must be 1');
  if (attestation.task !== 'P6-001') reasons.push('attestation task must be P6-001');
  if (attestation.platform !== 'win') reasons.push('attestation platform must be win');
  if (attestation.version !== expectedVersion) reasons.push('attestation version does not match release');
  if (attestation.channel !== policy.channel) reasons.push('attestation channel does not match policy');
  if (attestation.requiresCodeSigning !== policy.requireCodeSigning) {
    reasons.push('attestation requiresCodeSigning does not match policy');
  }
  if (attestation.targetPublicPublish !== policy.allowPublicPublish) {
    reasons.push('attestation targetPublicPublish does not match policy');
  }

  const exeNames = Array.isArray(attestation.exeNames) ? attestation.exeNames : [];
  if (!Number.isInteger(attestation.exeCount) || attestation.exeCount <= 0) {
    reasons.push('attestation exeCount must be a positive integer');
  }
  if (exeNames.length !== attestation.exeCount || exeNames.some((name) => !/\.exe$/i.test(name))) {
    reasons.push('attestation exeNames must match exeCount and contain only .exe files');
  }

  const verification =
    attestation.signatureVerification && typeof attestation.signatureVerification === 'object'
      ? attestation.signatureVerification
      : {};
  const verifiedNames = Array.isArray(verification.verifiedExeNames)
    ? verification.verifiedExeNames
    : [];
  const signatures = Array.isArray(verification.signatures) ? verification.signatures : [];

  if (expectedSigned) {
    if (attestation.windowsArtifactsSigned !== true) {
      reasons.push('signing-required release must attest windowsArtifactsSigned=true');
    }
    if (verification.status !== 'verified') {
      reasons.push('signing-required release must have signatureVerification.status=verified');
    }
    if (verification.verifiedExeCount !== attestation.exeCount) {
      reasons.push('verifiedExeCount must match exeCount');
    }
    if (!sameStringSet(verifiedNames, exeNames)) {
      reasons.push('verifiedExeNames must match exeNames');
    }
    if (
      signatures.length !== attestation.exeCount ||
      signatures.some(
        (entry) =>
          !entry ||
          entry.status !== 'Valid' ||
          typeof entry.name !== 'string' ||
          !exeNames.includes(entry.name) ||
          typeof entry.signerSubject !== 'string' ||
          entry.signerSubject.length === 0,
      )
    ) {
      reasons.push('each signed executable must have a Valid Authenticode signature and signer');
    }
  } else {
    if (attestation.windowsArtifactsSigned !== false) {
      reasons.push('unsigned prerelease must attest windowsArtifactsSigned=false');
    }
    if (verification.status !== 'not-required') {
      reasons.push('unsigned prerelease must have signatureVerification.status=not-required');
    }
  }

  return {
    ok: reasons.length === 0,
    reasons,
    policy,
    expectedSigned,
  };
}

/**
 * @param {string} ymlText
 * @param {Array<{ name: string, sha512Base64: string, size?: number }>} artifacts
 */
export function verifyUpdateYmlHashes(ymlText, artifacts) {
  const mismatches = [];
  const missingArtifacts = [];
  let checked = 0;
  const byName = new Map(artifacts.map((a) => [a.name, a]));

  const refs = new Set();
  const urlRe = /(?:^|\n)\s*(?:-\s*)?(?:url|path):\s*(.+?)[^\S\r\n]*(?=\r?\n|$)/g;
  let m;
  while ((m = urlRe.exec(ymlText)) !== null) {
    const name = m[1].trim().replace(/^['"]|['"]$/g, '');
    if (!name) continue;
    if (!name.includes('/') && !name.includes('\\')) refs.add(name);
    else refs.add(name.split(/[/\\]/).pop() || name);
  }

  for (const name of refs) {
    const art = byName.get(name);
    if (!art) {
      if (artifacts.some((a) => extOf(a.name) === extOf(name))) {
        missingArtifacts.push(name);
      }
      continue;
    }
    checked += 1;

    for (const label of ['url', 'path']) {
      if (!hasLabelReference(ymlText, label, name)) continue;
      const actualSha = matchShaAfterLabel(ymlText, label, name);
      if (actualSha !== art.sha512Base64) {
        mismatches.push({
          name,
          field: label === 'url' ? 'files[].sha512' : 'path.sha512',
          expected: art.sha512Base64,
          actual: actualSha ?? '<missing>',
        });
      }
    }

    if (art.size != null && hasLabelReference(ymlText, 'url', name)) {
      const sizeMatch = matchSizeAfterUrl(ymlText, name);
      if (sizeMatch !== art.size) {
        mismatches.push({
          name,
          field: 'files[].size',
          expected: String(art.size),
          actual: sizeMatch == null ? '<missing>' : String(sizeMatch),
        });
      }
    }
  }

  return {
    ok: mismatches.length === 0 && missingArtifacts.length === 0 && checked > 0,
    checked,
    mismatches,
    missingArtifacts,
  };
}

/**
 * @param {string} ymlText
 * @param {Array<{ name: string, sha512Base64: string, size: number }>} updates
 */
export function patchUpdateYmlHashes(ymlText, updates) {
  let content = ymlText;
  const updated = [];
  for (const u of updates) {
    const escaped = escapeRegExp(u.name);
    let touched = false;
    const urlPattern = new RegExp(
      `(url:\\s*${escaped}[^\\S\\r\\n]*\\r?\\n\\s*sha512:\\s*)(\\S+)(\\s*\\r?\\n\\s*size:\\s*)(\\d+)`,
      'm',
    );
    if (urlPattern.test(content)) {
      content = content.replace(urlPattern, `$1${u.sha512Base64}$3${u.size}`);
      touched = true;
    }
    const pathPattern = new RegExp(
      `(path:\\s*${escaped}[^\\S\\r\\n]*\\r?\\n)sha512:\\s*\\S+`,
      'm',
    );
    if (pathPattern.test(content)) {
      content = content.replace(pathPattern, `$1sha512: ${u.sha512Base64}`);
      touched = true;
    }
    if (touched) updated.push(u.name);
  }
  return { text: content, updated };
}

/** Anchors that release.yml must contain for policy consistency (A1/A2). */
export const WINDOWS_RELEASE_WORKFLOW_ANCHORS = [
  {
    id: 'channel-detect',
    pattern: /Detect Windows release channel/,
    meaning: 'Workflow derives its channel/signing decision before signing',
  },
  {
    id: 'signpath-policy-output',
    pattern: /requires_signing[\s\S]{0,260}Sign Windows artifacts via SignPath|Sign Windows artifacts via SignPath[\s\S]{0,260}requires_signing/i,
    meaning: 'SignPath follows the codified requires_signing output',
  },
  {
    id: 'authenticode-verification',
    pattern: /Get-AuthenticodeSignature[\s\S]{0,320}Status[\s\S]{0,120}Valid/i,
    meaning: 'Workflow verifies Authenticode before attesting signed artifacts',
  },
  {
    id: 'yml-hash-update',
    pattern: /Update latest\.yml sha512 after code signing/,
    meaning: 'Recompute latest.yml hashes after SignPath',
  },
  {
    id: 'pre-publish-gate',
    pattern: /release-policy-gate:[\s\S]*P6-001 pre-publish Windows policy gate/i,
    meaning: 'A dedicated gate validates attestation before publishing',
  },
  {
    id: 'github-publish-dependency',
    pattern: /publish:[\s\S]{0,160}needs:\s*release-policy-gate/i,
    meaning: 'GitHub publishing cannot start before the release policy gate',
  },
  {
    id: 'oss-publish-dependency',
    pattern: /upload-oss:[\s\S]{0,160}needs:\s*release-policy-gate/i,
    meaning: 'OSS publishing cannot start before the release policy gate',
  },
  {
    id: 'keep-alpha-beta-prerelease',
    pattern: /keeping as pre-release/i,
    meaning: 'Finalize keeps alpha/beta as GitHub prerelease',
  },
];

/**
 * @param {string} workflowText
 */
export function checkWorkflowPolicyConsistency(workflowText) {
  const missing = [];
  for (const a of WINDOWS_RELEASE_WORKFLOW_ANCHORS) {
    if (!a.pattern.test(workflowText)) {
      missing.push({ id: a.id, meaning: a.meaning });
    }
  }
  return { ok: missing.length === 0, missing };
}

function sameStringSet(left, right) {
  return left.length === right.length && left.every((value) => right.includes(value));
}

function extOf(name) {
  const i = name.lastIndexOf('.');
  return i >= 0 ? name.slice(i).toLowerCase() : '';
}

function escapeRegExp(s) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function hasLabelReference(yml, label, name) {
  const re = new RegExp(
    `(?:^|\\n)\\s*(?:-\\s*)?${label}:\\s*${escapeRegExp(name)}[^\\S\\r\\n]*(?=\\r?\\n|$)`,
    'm',
  );
  return re.test(yml);
}

function matchShaAfterLabel(yml, label, name) {
  const re = new RegExp(
    `${label}:\\s*${escapeRegExp(name)}[^\\S\\r\\n]*\\r?\\n\\s*sha512:[^\\S\\r\\n]*(\\S+)`,
    'm',
  );
  const m = yml.match(re);
  return m ? m[1] : null;
}

function matchSizeAfterUrl(yml, name) {
  const re = new RegExp(
    `url:\\s*${escapeRegExp(name)}[^\\S\\r\\n]*\\r?\\n\\s*sha512:[^\\S\\r\\n]*\\S+[^\\S\\r\\n]*\\r?\\n\\s*size:[^\\S\\r\\n]*(\\d+)`,
    'm',
  );
  const m = yml.match(re);
  return m ? Number(m[1]) : null;
}
