#!/usr/bin/env node
/**
 * Product policy documentation truthfulness validator.
 *
 *   node scripts/validate-policy-docs.mjs
 *   node scripts/validate-policy-docs.mjs --out artifacts/policy-doc-truthfulness/report.json
 *   node scripts/validate-policy-docs.mjs --json --quiet
 *
 * Closes GitHub issues #133 (SECURITY.md still holds GitHub template text and no
 * real support/reporting policy) and #152 (a source comment promised CLI/config
 * switches that do not exist). Both defects are documentation that must not be
 * able to drift away from the shipped implementation again, so this script
 * compares the policy documents against the real repository facts:
 *
 *   - the current version in package.json,
 *   - the tracking assets the security process actually uses,
 *   - the files the docs link to,
 *   - the acceleration switches the source claims exist.
 *
 * Fails closed on purpose. A missing document, an unreadable manifest or an
 * unresolvable link is a failure, never a silent skip: an unchecked policy is
 * not a satisfied policy.
 *
 * Pure Node, no dependencies, so it can run in a bare checkout before
 * `pnpm install`.
 */
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

export const SCHEMA = 'clawx.policy-doc-truthfulness.v1';

export const POLICY_PATHS = {
  securityPolicy: 'SECURITY.md',
  accelerationPolicy: 'docs/dev/hardware-acceleration-policy.md',
  accelerationSource: 'electron/main/index.ts',
  packageManifest: 'package.json',
  findingsRegistry: 'plans/system-maturity/findings-registry.json',
  securitySuite: 'plans/system-maturity/security-regression-suite.json',
};

const DEFAULT_OUT = 'artifacts/policy-doc-truthfulness/report.json';

// Verbatim GitHub "new repository" template sentences. Their presence means the
// file is still the scaffolding, not a policy.
const TEMPLATE_MARKERS = [
  'use this section to tell people about which versions',
  'use this section to tell people how to report a vulnerability',
  'tell them where to go, how often they can expect to get an update',
  'what to expect if a vulnerability is accepted or declined',
  'this project is currently being supported with security updates',
];

// Sample version rows from the same template (`| 5.1.x | :white_check_mark: |`).
const SAMPLE_VERSION_ROW = /^\|\s*\d+\.\d+\.x\s*\|/m;

// Switches issue #152 proved do not exist anywhere in the codebase. They may be
// named in the decision record only as things that are absent; they must never
// appear in the Main-process source as if a user could pass them.
export const PHANTOM_ACCELERATION_SWITCHES = [
  '--enable-gpu',
  'enableGpu',
  'disable-hardware-acceleration',
  'enable-hardware-acceleration',
];

// Anchors that make each document checkable rather than trust-me prose.
const SECURITY_POLICY_ANCHORS = [
  'Baixu22/VerseClaw',
  'package.json',
  'plans/system-maturity/findings-registry.json',
  'plans/system-maturity/security-regression-suite.json',
  'pnpm docs:policy:validate',
];

const ACCELERATION_POLICY_ANCHORS = [
  'app.disableHardwareAcceleration()',
  '--enable-gpu',
  'does not exist',
  'pnpm docs:policy:validate',
];

const CREDENTIAL_SHAPE_PATTERNS = [
  ['provider-key', /\bsk-[A-Za-z0-9]{20,}\b/],
  ['github-token', /\bgh[pousr]_[A-Za-z0-9]{20,}\b/],
  ['aws-access-key', /\bAKIA[0-9A-Z]{16}\b/],
  ['private-key-block', /-----BEGIN [A-Z ]*PRIVATE KEY-----/],
  ['slack-token', /\bxox[baprs]-[A-Za-z0-9-]{10,}\b/],
];

function sha256(text) {
  return createHash('sha256').update(text, 'utf8').digest('hex');
}

function readTextIfFile(root, relativePath) {
  const absolute = join(root, relativePath);
  try {
    if (!statSync(absolute).isFile()) return null;
    return readFileSync(absolute, 'utf8');
  } catch {
    return null;
  }
}

export function findTemplatePlaceholders(text) {
  const normalized = text.toLowerCase();
  return TEMPLATE_MARKERS.filter((marker) => normalized.includes(marker));
}

export function findSampleVersionRows(text) {
  const match = text.match(SAMPLE_VERSION_ROW);
  return match ? [match[0].trim()] : [];
}

/**
 * Collect repo-relative targets a policy document points at: Markdown link
 * targets plus backticked paths that look like repository files. External URLs,
 * anchors and non-path code spans are ignored.
 */
export function extractRepoReferences(text) {
  const targets = new Set();
  for (const match of text.matchAll(/\]\(([^)\s]+)\)/g)) {
    targets.add(match[1]);
  }
  for (const match of text.matchAll(/`([^`\n]+)`/g)) {
    targets.add(match[1]);
  }
  const references = [];
  for (const raw of targets) {
    let target = raw.trim();
    if (!target || target.startsWith('#')) continue;
    if (/^[a-z][a-z0-9+.-]*:/i.test(target)) continue; // http:, https:, mailto:
    target = target.split('#')[0].split('?')[0];
    if (!target) continue;
    // A repository path must reach into a directory (or be a known root file).
    const looksLikePath = target.includes('/') || /^[A-Z][A-Z0-9-]+\.md$/.test(target) || target === 'package.json';
    if (!looksLikePath) continue;
    if (!/^[A-Za-z0-9._@/-]+$/.test(target)) continue;
    if (target.startsWith('/') || target.includes('..')) continue;
    if (!/\.[A-Za-z0-9]+$/.test(target)) continue;
    references.push(target);
  }
  return [...new Set(references)].sort();
}

export function findMissingReferences(text, { root, docPath }) {
  const docDir = dirname(join(root, docPath));
  const missing = [];
  for (const reference of extractRepoReferences(text)) {
    const fromDoc = resolve(docDir, reference);
    const fromRoot = resolve(root, reference);
    if (existsSync(fromDoc) || existsSync(fromRoot)) continue;
    missing.push(reference);
  }
  return missing;
}

export function findPhantomAccelerationSwitches(sourceText) {
  return PHANTOM_ACCELERATION_SWITCHES.filter((token) => sourceText.includes(token));
}

export function findCredentialShapes(text) {
  return CREDENTIAL_SHAPE_PATTERNS
    .filter(([, pattern]) => pattern.test(text))
    .map(([label]) => label);
}

export function findMissingAnchors(text, anchors) {
  return anchors.filter((anchor) => !text.includes(anchor));
}

function check(id, description, findings) {
  return {
    id,
    description,
    status: findings.length === 0 ? 'pass' : 'fail',
    findings,
  };
}

/**
 * Build the fail-closed policy documentation report.
 * @param {{ root?: string }} options
 */
export function validatePolicyDocs({ root = process.cwd() } = {}) {
  const checks = [];
  const inputs = {};
  const contents = {};

  for (const [key, relativePath] of Object.entries(POLICY_PATHS)) {
    const text = readTextIfFile(root, relativePath);
    if (text === null) {
      inputs[key] = { path: relativePath, present: false };
      continue;
    }
    contents[key] = text;
    inputs[key] = { path: relativePath, present: true, bytes: Buffer.byteLength(text, 'utf8'), sha256: sha256(text) };
  }

  const manifestText = contents.packageManifest;
  let version = null;
  if (manifestText === null) {
    checks.push(check('package-version-resolvable', 'The authoritative product version is readable', [
      `${POLICY_PATHS.packageManifest} is missing or unreadable`,
    ]));
  } else {
    try {
      version = JSON.parse(manifestText).version ?? null;
    } catch {
      version = null;
    }
    checks.push(check('package-version-resolvable', 'The authoritative product version is readable', version
      ? []
      : [`${POLICY_PATHS.packageManifest} does not expose a string "version"`]));
  }

  // --- Issue #133: SECURITY.md must describe this project, not the template ---
  const security = contents.securityPolicy;
  if (security === undefined) {
    for (const id of [
      'security-policy-no-template-text',
      'security-policy-supported-version',
      'security-policy-reporting-path',
      'security-policy-tracking-process',
      'security-policy-references-resolve',
      'security-policy-no-credential-shapes',
    ]) {
      checks.push(check(id, 'SECURITY.md policy check', [`${POLICY_PATHS.securityPolicy} is missing`]));
    }
  } else {
    checks.push(check(
      'security-policy-no-template-text',
      'SECURITY.md contains no GitHub template scaffolding',
      findTemplatePlaceholders(security).map((marker) => `template sentence still present: "${marker}"`),
    ));

    const versionFindings = [];
    const sampleRows = findSampleVersionRows(security);
    versionFindings.push(...sampleRows.map((row) => `sample template version row still present: ${row}`));
    if (version) {
      if (!security.includes(version)) {
        versionFindings.push(`current package.json version ${version} is not declared as supported`);
      }
    } else {
      versionFindings.push('cannot compare because the package version is unresolvable');
    }
    if (!/\bmain\b/.test(security)) {
      versionFindings.push('the maintained branch/ref ("main") is not declared');
    }
    checks.push(check(
      'security-policy-supported-version',
      'Supported-version scope matches package.json and the maintained ref',
      versionFindings,
    ));

    const reportingFindings = [];
    if (!security.includes('Baixu22/VerseClaw')) {
      reportingFindings.push('the private repository slug is not named as the reporting destination');
    }
    if (!/private/i.test(security)) {
      reportingFindings.push('the report path does not state that the repository/report is private');
    }
    if (!/do not (paste|include|send)/i.test(security)) {
      reportingFindings.push('the report path does not warn against pasting live credentials or user data');
    }
    if (/\bSLA\b/.test(security) && !/no (committed )?(response )?(time|SLA)|not promise/i.test(security)) {
      reportingFindings.push('an SLA is mentioned without an explicit refusal to commit to one');
    }
    checks.push(check(
      'security-policy-reporting-path',
      'A usable private reporting path is defined without unverified contacts',
      reportingFindings,
    ));

    checks.push(check(
      'security-policy-tracking-process',
      'The policy is wired to the real Findings registry and security suite',
      findMissingAnchors(security, SECURITY_POLICY_ANCHORS).map(
        (anchor) => `missing required policy anchor: ${anchor}`,
      ),
    ));

    checks.push(check(
      'security-policy-references-resolve',
      'Every repository path referenced by the security policy exists',
      findMissingReferences(security, { root, docPath: POLICY_PATHS.securityPolicy }).map(
        (reference) => `referenced path does not exist: ${reference}`,
      ),
    ));

    checks.push(check(
      'security-policy-no-credential-shapes',
      'The security policy contains no credential-shaped strings',
      findCredentialShapes(security).map((label) => `credential-shaped content detected: ${label}`),
    ));
  }

  // --- Issue #152: the acceleration default must be described as it is ---
  const accelerationSource = contents.accelerationSource;
  checks.push(check(
    'acceleration-source-matches-decision',
    'Main-process source documents only switches that exist',
    accelerationSource === undefined
      ? [`${POLICY_PATHS.accelerationSource} is missing`]
      : findPhantomAccelerationSwitches(accelerationSource).map(
        (token) => `source advertises a non-existent acceleration switch: ${token}`,
      ),
  ));

  const accelerationPolicy = contents.accelerationPolicy;
  if (accelerationPolicy === undefined) {
    checks.push(check('acceleration-decision-record', 'The acceleration decision record exists and is complete', [
      `${POLICY_PATHS.accelerationPolicy} is missing`,
    ]));
  } else {
    const decisionFindings = findMissingAnchors(accelerationPolicy, ACCELERATION_POLICY_ANCHORS).map(
      (anchor) => `decision record is missing required anchor: ${anchor}`,
    );
    if (!/product-lock|product lock|frozen default/i.test(accelerationPolicy)) {
      decisionFindings.push('decision record does not state the default is product-locked/frozen');
    }
    decisionFindings.push(...findMissingReferences(accelerationPolicy, {
      root,
      docPath: POLICY_PATHS.accelerationPolicy,
    }).map((reference) => `referenced path does not exist: ${reference}`));
    checks.push(check(
      'acceleration-decision-record',
      'The acceleration decision record exists and is complete',
      decisionFindings,
    ));
  }

  // The security policy points at the tracking process; if those assets vanish
  // the policy would describe a process that no longer exists.
  checks.push(check(
    'security-process-assets-exist',
    'The Findings registry and security regression suite referenced by the policy exist',
    ['findingsRegistry', 'securitySuite']
      .filter((key) => !inputs[key]?.present)
      .map((key) => `tracking asset is missing: ${inputs[key]?.path ?? key}`),
  ));

  const result = checks.every((entry) => entry.status === 'pass') ? 'pass' : 'fail';
  return {
    schema: SCHEMA,
    generatedAt: new Date().toISOString(),
    drivenBy: 'agent',
    root,
    version,
    inputs,
    checks,
    result,
  };
}

function parseArgs(argv) {
  const args = { _: [] };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === '--out') {
      args.out = argv[i + 1];
      i += 1;
    } else if (arg === '--root') {
      args.root = argv[i + 1];
      i += 1;
    } else {
      args._.push(arg);
    }
  }
  return args;
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  const root = args.root ? resolve(args.root) : process.cwd();
  const report = validatePolicyDocs({ root });
  const outPath = resolve(root, args.out || DEFAULT_OUT);
  mkdirSync(dirname(outPath), { recursive: true });
  writeFileSync(outPath, `${JSON.stringify(report, null, 2)}\n`);

  const failed = report.checks.filter((entry) => entry.status === 'fail');
  if (args._.includes('--json')) {
    process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
  } else if (!args.quiet) {
    for (const entry of report.checks) {
      console.log(`[policy-docs] ${entry.status.toUpperCase()} ${entry.id}`);
      for (const finding of entry.findings) console.log(`  - ${finding}`);
    }
    console.log(`[policy-docs] report: ${outPath}`);
  }

  if (failed.length > 0) {
    console.error(`[policy-docs] FAIL: ${failed.length} check(s) failed`);
    process.exitCode = 1;
    return;
  }
  if (!args.quiet) console.log(`[policy-docs] PASS: ${report.checks.length} checks`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main();
}
