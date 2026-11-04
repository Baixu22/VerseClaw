#!/usr/bin/env node
/**
 * Verify VerseBrowser retained evidence as data, not as prose:
 * - manifests cover the exact file set and every digest matches;
 * - N8 historical failure and final pass remain distinct;
 * - N9 historical evidence stays historical;
 * - current evidence is bound to a clean commit whose relevant source has not
 *   changed since the packaged candidate was built/run;
 * - agent attribution is present and credential-like strings are absent.
 */
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { readFile, readdir, stat } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';
import { isMainEntrypoint } from './lib/entrypoint.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const EVIDENCE_ROOT = 'harness/specs/fixtures/versebrowser-invocation-maturity';
const CURRENT = 'current-20261104';
const SOURCE_SCOPE = [
  'packages/versebrowser',
  'electron/services/agent-browser-api.ts',
  'electron/services/agent-browser-network-proxy.ts',
  'electron/main/index.ts',
  'electron/services/agent-browser-capabilities.ts',
  'electron/gateway/agent-browser-bridge.ts',
  'shared/agent-browser',
  'shared/host-api/contract.ts',
  'openclaw_runtime/src/agents/tools/agent-browser-tool.ts',
  'openclaw_runtime/src/gateway/server-methods/agent-browser.ts',
  'scripts/versebrowser-n9-stability-probe.mjs',
  'scripts/versebrowser-m10-packaged-flow-verify.mjs',
  'scripts/versebrowser-evidence-verify.mjs',
  'scripts/versebrowser-host-integration-verify.mjs',
  'scripts/lib/versebrowser-build-identity.mjs',
  'tests/e2e/versebrowser-host-invocation.spec.ts',
  'tests/unit/versebrowser-*.test.ts',
];
const CREDENTIAL_PATTERNS = [
  /(?<![A-Za-z0-9_-])sk-[A-Za-z0-9_-]{20,}/,
  /ghp_[A-Za-z0-9]{20,}/,
  /gho_[A-Za-z0-9]{20,}/,
  /AKIA[A-Z0-9]{16}/,
  /-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/,
];
const TEXT_EXTENSIONS = new Set(['.json', '.jsonl', '.md', '.txt', '.log', '.yml', '.yaml']);

const sha256 = (bytes) => createHash('sha256').update(bytes).digest('hex');
const issue = (kind, detail = {}) => ({ kind, ...detail });
const toPosix = (value) => value.split(path.sep).join('/');

async function walkFiles(root, current = root) {
  const entries = await readdir(current, { withFileTypes: true });
  const files = [];
  for (const entry of entries) {
    const absolute = path.join(current, entry.name);
    if (entry.isDirectory()) files.push(...await walkFiles(root, absolute));
    else if (entry.isFile()) files.push(toPosix(path.relative(root, absolute)));
  }
  return files.sort();
}

function parseManifest(text) {
  const entries = new Map();
  const issues = [];
  text.split(/\r?\n/).forEach((line, index) => {
    if (!line.trim()) return;
    const match = line.match(/^([0-9a-f]{64})  (.+)$/);
    if (!match) {
      issues.push(issue('manifest_line_malformed', { line: index + 1 }));
      return;
    }
    if (entries.has(match[2])) issues.push(issue('manifest_duplicate_path', { path: match[2] }));
    entries.set(match[2], match[1]);
  });
  return { entries, issues };
}

async function verifyManifest(hostRoot, relativeDir) {
  const absoluteDir = path.join(hostRoot, relativeDir);
  const manifestPath = path.join(absoluteDir, 'SHA256SUMS');
  if (!existsSync(manifestPath)) return { status: 'fail', issues: [issue('manifest_missing', { path: toPosix(path.relative(hostRoot, manifestPath)) })] };
  const parsed = parseManifest(await readFile(manifestPath, 'utf8'));
  const actualFiles = new Set((await walkFiles(absoluteDir)).filter((file) => file !== 'SHA256SUMS'));
  const issues = [...parsed.issues];
  for (const relative of parsed.entries.keys()) {
    if (!actualFiles.has(relative)) {
      issues.push(issue('manifest_target_missing', { path: relative }));
      continue;
    }
    const actual = sha256(await readFile(path.join(absoluteDir, relative)));
    const expected = parsed.entries.get(relative);
    if (actual !== expected) issues.push(issue('manifest_digest_mismatch', { path: relative, expected, actual }));
  }
  for (const actual of actualFiles) {
    if (!parsed.entries.has(actual)) issues.push(issue('manifest_unlisted_file', { path: actual }));
  }
  return { status: issues.length ? 'fail' : 'pass', files: actualFiles.size, entries: parsed.entries.size, issues };
}

async function readJson(file, issues, label) {
  try {
    return JSON.parse(await readFile(file, 'utf8'));
  } catch (error) {
    issues.push(issue('json_unreadable', { file: label, message: String(error?.message ?? error) }));
    return undefined;
  }
}

function git(hostRoot, args) {
  return execFileSync('git', args, { cwd: hostRoot, encoding: 'utf8', windowsHide: true }).trim();
}

async function verifyN8(hostRoot) {
  const dir = path.join(EVIDENCE_ROOT, 'n8-20261016');
  const issues = [];
  const manifest = await verifyManifest(hostRoot, dir);
  issues.push(...manifest.issues);
  const status = await readJson(path.join(hostRoot, dir, 'final-status.json'), issues, `${dir}/final-status.json`);
  if (status?.status !== 'pass') issues.push(issue('n8_status_not_pass', { status: status?.status ?? null }));
  if (status?.driven_by !== 'agent' || !status?.actor) issues.push(issue('n8_attribution_missing'));
  const summaryPath = path.join(hostRoot, dir, 'SUMMARY.md');
  const historyPath = path.join(hostRoot, dir, 'HISTORICAL-FAILURE-20261016.md');
  if (!existsSync(summaryPath) || !existsSync(historyPath)) {
    issues.push(issue('n8_history_split_missing'));
  } else {
    const summary = await readFile(summaryPath, 'utf8');
    const history = await readFile(historyPath, 'utf8');
    if (!summary.includes('状态：**通过**')) issues.push(issue('n8_summary_not_pass'));
    if (!history.includes('状态：**未通过**')) issues.push(issue('n8_history_failure_marker_missing'));
    if (summary.includes('F1（阻断 N8') && !summary.includes('原始 N8 证据先暴露')) issues.push(issue('n8_summary_contradicts_current_state'));
  }
  return { status: issues.length ? 'fail' : 'pass', manifest, issues };
}

async function verifyHistoricalN9(hostRoot) {
  const dir = path.join(EVIDENCE_ROOT, 'n9-20261017');
  const issues = [];
  const manifest = await verifyManifest(hostRoot, dir);
  issues.push(...manifest.issues);
  const acceptance = await readJson(path.join(hostRoot, dir, 'acceptance.json'), issues, `${dir}/acceptance.json`);
  if (acceptance?.status !== 'pass') issues.push(issue('n9_historical_status_not_pass'));
  if (acceptance?.driven_by !== 'agent' || !acceptance?.actor) issues.push(issue('n9_historical_attribution_missing'));
  return { status: issues.length ? 'fail' : 'pass', manifest, issues };
}

export async function verifyCurrent(hostRoot) {
  const dir = path.join(EVIDENCE_ROOT, CURRENT);
  const issues = [];
  if (!existsSync(path.join(hostRoot, dir))) return { status: 'fail', issues: [issue('current_evidence_missing', { path: dir })] };
  const manifest = await verifyManifest(hostRoot, dir);
  issues.push(...manifest.issues);
  const candidate = await readJson(path.join(hostRoot, dir, 'candidate.json'), issues, `${dir}/candidate.json`);
  const n8 = await readJson(path.join(hostRoot, dir, 'n8-result.json'), issues, `${dir}/n8-result.json`);
  const n9 = await readJson(path.join(hostRoot, dir, 'n9-result.json'), issues, `${dir}/n9-result.json`);
  const status = await readJson(path.join(hostRoot, dir, 'status.json'), issues, `${dir}/status.json`);
  if (candidate?.driven_by !== 'agent' || !candidate?.actor) issues.push(issue('current_attribution_missing'));
  if (candidate?.dirty !== false) issues.push(issue('current_candidate_not_clean', { dirty: candidate?.dirty ?? null }));
  if (typeof candidate?.sourceCommit !== 'string' || !/^[0-9a-f]{40}$/.test(candidate.sourceCommit)) issues.push(issue('current_candidate_commit_invalid'));
  if (typeof candidate?.sourceTree !== 'string' || !/^[0-9a-f]{40}$/.test(candidate.sourceTree)) issues.push(issue('current_candidate_tree_invalid'));
  if (status?.status !== 'pass') issues.push(issue('current_status_not_pass'));
  if (n8?.status !== 'pass') issues.push(issue('current_n8_not_pass'));
  if (n9?.status !== 'pass') issues.push(issue('current_n9_not_pass'));
  const build = candidate?.build;
  const expectedPaths = ['Verse Claw.exe', 'resources/app.asar', 'resources/main-runtime.asar'];
  const validBuild = build?.schemaVersion === 1 && Array.isArray(build.artifacts)
    && JSON.stringify(build.artifacts.map(entry => entry.path)) === JSON.stringify(expectedPaths)
    && build.artifacts.every(entry => Number.isSafeInteger(entry.bytes) && entry.bytes > 0 && /^[0-9a-f]{64}$/.test(entry.sha256))
    && build.digest === sha256(Buffer.from(JSON.stringify(build.artifacts)));
  if (!validBuild) issues.push(issue('current_build_identity_invalid'));
  for (const [label, result] of [['n8', n8], ['n9', n9]]) {
    if (!validBuild || JSON.stringify(result?.build) !== JSON.stringify(build)) issues.push(issue('current_run_build_mismatch', { run: label }));
  }
  if (n9?.summary?.loops?.passed !== 30 || n9?.summary?.loops?.fullLoops !== 30) issues.push(issue('current_n9_loop_count_mismatch'));
  if (n9?.summary?.coldStarts?.passed !== 10) issues.push(issue('current_n9_cold_start_mismatch'));
  if (n9?.summary?.interrupts?.killedWithLiveSession !== 3 || n9?.summary?.interrupts?.recoveryPassed !== 3) issues.push(issue('current_n9_interrupt_mismatch'));
  if (n9?.summary?.runDirsReclaimed !== n9?.summary?.totalRounds || n9?.summary?.totalRounds !== 46) issues.push(issue('current_n9_cleanup_mismatch'));

  if (candidate?.sourceCommit && candidate?.sourceTree) {
    try {
      const commitTree = git(hostRoot, ['rev-parse', `${candidate.sourceCommit}^{tree}`]);
      if (commitTree !== candidate.sourceTree) issues.push(issue('current_candidate_tree_mismatch', { expected: candidate.sourceTree, actual: commitTree }));
      git(hostRoot, ['merge-base', '--is-ancestor', candidate.sourceCommit, 'HEAD']);
      // Include index/worktree edits and newly introduced source files, not only
      // committed changes. A dirty candidate must not inherit a historical pass.
      const changed = [...new Set([
        ...git(hostRoot, ['diff', '--name-only', candidate.sourceCommit, 'HEAD', '--', ...SOURCE_SCOPE]).split(/\r?\n/),
        ...git(hostRoot, ['diff', '--cached', '--name-only', '--', ...SOURCE_SCOPE]).split(/\r?\n/),
        ...git(hostRoot, ['diff', '--name-only', '--', ...SOURCE_SCOPE]).split(/\r?\n/),
        ...git(hostRoot, ['ls-files', '--others', '--exclude-standard', '--', ...SOURCE_SCOPE]).split(/\r?\n/),
      ].filter(Boolean))];
      if (changed.length) issues.push(issue('current_evidence_stale', { changed }));
    } catch (error) {
      issues.push(issue('current_candidate_git_check_failed', { message: String(error?.stderr || error?.message || error) }));
    }
  }
  return { status: issues.length ? 'fail' : 'pass', manifest, issues };
}

async function scanCredentials(hostRoot) {
  const base = path.join(hostRoot, EVIDENCE_ROOT);
  const hits = [];
  for (const relative of await walkFiles(base)) {
    if (!TEXT_EXTENSIONS.has(path.extname(relative).toLowerCase())) continue;
    const absolute = path.join(base, relative);
    const size = (await stat(absolute)).size;
    if (size > 5_000_000) continue;
    const text = await readFile(absolute, 'utf8');
    for (const pattern of CREDENTIAL_PATTERNS) {
      if (pattern.test(text)) hits.push({ file: `${EVIDENCE_ROOT}/${relative}`, pattern: pattern.source });
    }
  }
  return hits;
}

export async function verifyEvidence(hostRoot = ROOT) {
  const [n8, n9, previous, current] = await Promise.all([
    verifyN8(hostRoot),
    verifyHistoricalN9(hostRoot),
    verifyManifest(hostRoot, path.join(EVIDENCE_ROOT, 'current-merge-20261025')),
    verifyCurrent(hostRoot),
  ]);
  const credentials = await scanCredentials(hostRoot);
  const issues = [n8, n9, previous, current].flatMap((section) => section.issues ?? []);
  for (const hit of credentials) issues.push(issue('credential_pattern_hit', hit));
  return {
    schemaVersion: 1,
    driven_by: 'agent',
    actor: 'codex',
    status: issues.length ? 'fail' : 'pass',
    scope: 'retained VerseBrowser evidence manifests, attribution, current-candidate binding and credential scan',
    sections: { n8, n9, previous, current },
    credentialScan: { hits: credentials.length, matches: credentials },
    issues,
  };
}

async function main() {
  const { values } = parseArgs({
    options: { 'host-root': { type: 'string' }, output: { type: 'string' } },
    allowPositionals: false,
  });
  const report = await verifyEvidence(values['host-root'] ?? ROOT);
  const text = JSON.stringify(report, null, 2) + '\n';
  if (values.output) {
    const { writeFile } = await import('node:fs/promises');
    await writeFile(path.resolve(values.output), text, 'utf8');
  }
  process.stdout.write(text);
  process.exitCode = report.status === 'fail' ? 1 : 0;
}

if (isMainEntrypoint(import.meta.url)) main().catch((error) => {
  process.stderr.write(String(error?.stack ?? error) + '\n');
  process.exitCode = 1;
});
