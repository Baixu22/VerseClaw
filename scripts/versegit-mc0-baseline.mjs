#!/usr/bin/env node
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { isMainEntrypoint } from './lib/entrypoint.mjs';

const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');

export const MC0_SCHEMA = 'clawx.versegit.mc0-baseline/v1';

function sha256(bytes) {
  return createHash('sha256').update(bytes).digest('hex');
}

function sha256File(path) {
  return sha256(readFileSync(path));
}

function run(command, args, cwd, options = {}) {
  try {
    return {
      ok: true,
      stdout: execFileSync(command, args, {
        cwd,
        encoding: 'utf8',
        stdio: ['ignore', 'pipe', 'pipe'],
        timeout: options.timeoutMs ?? 60_000,
        windowsHide: true,
        env: { ...process.env, ...(options.env ?? {}) },
      }).trim(),
    };
  } catch (error) {
    return {
      ok: false,
      stdout: String(error?.stdout ?? '').trim(),
      stderr: String(error?.stderr ?? error?.message ?? error).trim(),
      status: error?.status ?? null,
    };
  }
}

function git(repo, args) {
  return run('git', args, repo);
}

function readVersion(repo) {
  const result = run('cargo', ['metadata', '--no-deps', '--format-version', '1'], repo, { timeoutMs: 120_000 });
  if (!result.ok) return { status: 'unavailable', reason: result.stderr };
  try {
    const metadata = JSON.parse(result.stdout);
    const pkg = metadata.packages?.find((entry) => entry.name === 'vg-cli');
    return { status: pkg?.version ? 'observed' : 'unavailable', version: pkg?.version ?? null, rust_version: pkg?.rust_version ?? null };
  } catch (error) {
    return { status: 'invalid', reason: error instanceof Error ? error.message : String(error) };
  }
}

function readRustToolchain(repo) {
  const path = resolve(repo, 'rust-toolchain.toml');
  return existsSync(path) ? { path: 'rust-toolchain.toml', sha256: sha256File(path) } : { status: 'missing' };
}

function readSchema(repo) {
  const schemaPath = resolve(repo, 'crates/vg-schema/src/lib.rs');
  const ledgerPath = resolve(repo, 'crates/vg-kernel/src/ledger.rs');
  const schema = existsSync(schemaPath) ? readFileSync(schemaPath, 'utf8') : '';
  const ledger = existsSync(ledgerPath) ? readFileSync(ledgerPath, 'utf8') : '';
  const schemaVersion = schema.match(/pub const SCHEMA_VERSION:\s*u32\s*=\s*(\d+)/u)?.[1];
  const supported = schema.match(/pub const SUPPORTED_SCHEMA_VERSIONS:\s*\[u32;\s*(\d+)\]\s*=\s*\[([^\]]+)\]/u);
  const ledgerVersion = ledger.match(/pub const LEDGER_SCHEMA_VERSION:\s*u32\s*=\s*(\d+)/u)?.[1];
  return {
    schema_version: schemaVersion ? Number(schemaVersion) : null,
    supported_schema_versions: supported ? supported[2].split(',').map((value) => Number(value.trim())).filter(Number.isFinite) : [],
    ledger_schema_version: ledgerVersion ? Number(ledgerVersion) : null,
  };
}

function readBinary(repo) {
  const candidates = [
    resolve(repo, 'target/release/vg.exe'),
    resolve(repo, 'target/release/vg'),
    resolve(repo, 'target/debug/vg.exe'),
    resolve(repo, 'target/debug/vg'),
  ];
  const found = candidates.find((path) => existsSync(path));
  if (!found) return { status: 'missing' };
  const version = run(found, ['--version'], repo);
  const capabilities = run(found, ['capabilities', '--json'], repo);
  let capabilityDocument = null;
  if (capabilities.ok) {
    try { capabilityDocument = JSON.parse(capabilities.stdout); } catch { capabilityDocument = null; }
  }
  return {
    status: version.ok && capabilityDocument ? 'observed' : 'invalid',
    path: found.replaceAll('\\', '/'),
    sha256: sha256File(found),
    bytes: readFileSync(found).length,
    version: version.ok ? version.stdout : null,
    capabilities_schema: capabilityDocument?.schema ?? null,
    capabilities_sha256: capabilityDocument ? sha256(JSON.stringify(capabilityDocument)) : null,
    capability_document: capabilityDocument,
    failure: version.ok ? capabilities.stderr ?? null : version.stderr ?? null,
  };
}

function goldenCase(repo, binaryPath, name, args) {
  if (!binaryPath || !existsSync(binaryPath)) {
    return { name, status: 'unavailable', args };
  }
  const result = run(binaryPath, args, repo);
  return {
    name,
    status: result.ok ? 'observed' : 'failed',
    args,
    exit_ok: result.ok,
    stdout_sha256: sha256(result.stdout ?? ''),
    stderr_sha256: sha256(result.stderr ?? ''),
    stdout: result.ok ? result.stdout : null,
    stderr: result.ok ? null : result.stderr,
  };
}

export function collectMc0Baseline({ repo, sourceStatus = 'auto', requireClean = false } = {}) {
  if (!repo || !existsSync(repo)) throw new Error('VerseGit repository path is required');
  const head = git(repo, ['rev-parse', 'HEAD']);
  const status = git(repo, ['status', '--porcelain=v1', '--untracked-files=all']);
  const commitTime = git(repo, ['show', '-s', '--format=%ct', 'HEAD']);
  const tree = git(repo, ['rev-parse', 'HEAD^{tree}']);
  const shallow = git(repo, ['rev-parse', '--is-shallow-repository']);
  const dirty = status.ok && status.stdout.length > 0;
  const deliverable = !dirty && sourceStatus !== 'dirty';
  const binary = readBinary(repo);
  const capabilities = binary.capability_document;
  const schema = readSchema(repo);
  const version = readVersion(repo);
  const golden = [
    goldenCase(repo, binary.path, 'version', ['--version']),
    goldenCase(repo, binary.path, 'capabilities', ['capabilities', '--json']),
    goldenCase(repo, binary.path, 'doctor', ['doctor', '--json']),
  ];
  const blockers = [];
  if (!head.ok) blockers.push('source_head_unavailable');
  if (!status.ok) blockers.push('source_status_unavailable');
  if (dirty) blockers.push('source_worktree_dirty');
  if (requireClean && dirty) blockers.push('clean_source_required');
  if (!deliverable) blockers.push('not_a_deliverable_baseline');
  if (binary.status !== 'observed') blockers.push('binary_identity_unavailable');
  if (!capabilities) blockers.push('capabilities_unavailable');
  if (golden.some((entry) => entry.status === 'unavailable')) blockers.push('golden_command_unavailable');
  const baseline = {
    baselineSchema: MC0_SCHEMA,
    generated_at: new Date().toISOString(),
    driven_by: 'agent',
    actor: 'codex',
    source: {
      repo: repo.replaceAll('\\', '/'),
      head: head.ok ? head.stdout : null,
      tree: tree.ok ? tree.stdout : null,
      commit_time_unix: commitTime.ok ? Number(commitTime.stdout) : null,
      status: dirty ? 'dirty' : status.ok ? 'clean' : 'unavailable',
      status_porcelain_sha256: status.ok ? sha256(status.stdout) : null,
      changed_path_count: status.ok ? status.stdout.split(/\r?\n/u).filter(Boolean).length : null,
      shallow: shallow.ok ? shallow.stdout === 'true' : null,
    },
    toolchain: readRustToolchain(repo),
    version,
    vgSchema: schema,
    binary,
    golden,
    deliverable: deliverable ? 'eligible' : 'rejected',
    blockers,
    boundaries: {
      source_tree_copied: false,
      source_history_copied: false,
      task_forest_copied: false,
      build_outputs_copied: false,
    },
  };
  baseline.digest = sha256(JSON.stringify({ ...baseline, digest: undefined }));
  return baseline;
}

export function validateMc0Baseline(baseline, { requireDeliverable = false } = {}) {
  const issues = [];
  if (baseline?.baselineSchema !== MC0_SCHEMA) issues.push(`baselineSchema must be ${MC0_SCHEMA}`);
  if (!baseline?.source?.head) issues.push('source head missing');
  if (!baseline?.source?.tree) issues.push('source tree missing');
  if (!baseline?.vgSchema) issues.push('vg schema missing');
  if (!baseline?.version?.version) issues.push('version unavailable');
  if (!baseline?.vgSchema?.schema_version) issues.push('schema version unavailable');
  if (!baseline?.vgSchema?.ledger_schema_version) issues.push('ledger schema version unavailable');
  if (baseline?.binary?.status !== 'observed') issues.push('binary identity unavailable');
  if (!baseline?.binary?.sha256) issues.push('binary sha256 missing');
  if (!baseline?.binary?.capabilities_sha256) issues.push('capabilities digest missing');
  if (!Array.isArray(baseline?.golden) || baseline.golden.length < 2) issues.push('at least two golden cases required');
  if (baseline?.source?.status === 'dirty' && baseline.deliverable !== 'rejected') issues.push('dirty source cannot be deliverable');
  if (requireDeliverable && baseline.deliverable !== 'eligible') issues.push('deliverable baseline required');
  if (baseline?.boundaries?.source_tree_copied !== false) issues.push('source tree must not be copied');
  return { ok: issues.length === 0, issues };
}

export function writeMc0Baseline({ repo, output, requireClean = false } = {}) {
  const baseline = collectMc0Baseline({ repo, requireClean });
  const path = output ?? resolve(repositoryRoot, 'artifacts/versegit/mc0/baseline.json');
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, `${JSON.stringify(baseline, null, 2)}\n`, 'utf8');
  return { path, baseline };
}

async function main() {
  const repoIndex = process.argv.indexOf('--repo');
  const repo = repoIndex >= 0 ? resolve(process.argv[repoIndex + 1]) : resolve(repositoryRoot, '..', 'VerseGit');
  const outIndex = process.argv.indexOf('--out');
  const output = outIndex >= 0 ? resolve(process.argv[outIndex + 1]) : undefined;
  const requireClean = process.argv.includes('--require-clean');
  const result = writeMc0Baseline({ repo, output, requireClean });
  const validation = validateMc0Baseline(result.baseline, { requireDeliverable: requireClean });
  console.log(JSON.stringify({ path: result.path, deliverable: result.baseline.deliverable, blockers: result.baseline.blockers, validation }, null, 2));
  if (!validation.ok) process.exitCode = 1;
}

if (isMainEntrypoint(import.meta.url)) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.stack ?? error.message : String(error));
    process.exitCode = 1;
  });
}
