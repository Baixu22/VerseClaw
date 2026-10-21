#!/usr/bin/env node
// MC2: record the VerseGit behavior fingerprint (characterization golden) of the frozen
// sidecar binary. Every command runs inside a disposable fixture so the real VerseGit
// checkout is never mutated, and no VG source/history/evidence is copied into ClawX.
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { isMainEntrypoint } from './lib/entrypoint.mjs';

const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
export const MC2_SCHEMA = 'clawx.versegit.mc2-fingerprint/v1';
export const MC0_BASELINE_PATH = 'harness/specs/fixtures/versegit-planning-correction/mc0-evidence/baseline.json';

const PRICEDB_BASE = [
  'def charge(amount: int, currency: str = "USD") -> int:',
  '    """Charge the customer."""',
  '    return amount * 100',
  '',
  'def credit(amount: int) -> int:',
  '    """Credit the customer."""',
  '    return amount',
  '',
].join('\n');
const PRICEDB_SIGNATURE_MOVED = PRICEDB_BASE.replace('currency: str = "USD"', 'currency: str = "EUR"');
const PRICEDB_CREDIT_BODY = PRICEDB_BASE.replace('    return amount\n', '    return amount + 1\n');
const SELFWRITER_BASE = ['def note():', '    return 1', ''].join('\n');
const SELFWRITER_EDITED = ['def note():', '    return 2', ''].join('\n');

export const VOLATILE_KEYS = [
  'session_id', 'operation_id', 'change_id', 'wc_commit_id', 'head_hash', 'last_seq',
  'events', 'events_verified', 'derived_entries', 'ts', 'run_at', 'fingerprint',
  'tree_oid', 'commit_oid', 'merged_tree_oid', 'event_id', 'seq', 'bytes', 'candidate_id',
  'duration_ms', 'elapsed_ms', 'output_bytes', 'stdout_sha256', 'stderr_sha256',
];

const IDENTIFIER_PATTERNS = [
  [/sha256:[0-9a-f]{64}/gu, '<fingerprint>'],
  [/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/giu, '<uuid>'],
  [/evt_[0-9a-f]{32}/gu, '<event_id>'],
  [/[0-9a-f]{40,64}/gu, '<oid>'],
  [/[0-9a-f]{8,}/gu, '<hex>'],
  [/\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\S*/gu, '<timestamp>'],
];

export function sha256(value) {
  return createHash('sha256').update(value).digest('hex');
}

export function classifyStderr(stderr) {
  const text = String(stderr ?? '');
  if (!text.trim()) return 'none';
  if (text.includes('会话不存在')) return 'session_not_found';
  if (text.includes('未找到工作区')) return 'workspace_not_found';
  if (text.includes('读 facts')) return 'facts_input_missing';
  if (text.includes('required arguments were not provided')) return 'usage_error';
  if (text.includes('不存在') || text.includes('not found')) return 'subject_not_found';
  return 'error';
}

export function normalizeScalar(value) {
  if (typeof value !== 'string') return value;
  let out = value;
  for (const [pattern, replacement] of IDENTIFIER_PATTERNS) out = out.replaceAll(pattern, replacement);
  return out;
}

function replacePathLiterals(text, roots) {
  let out = String(text);
  for (const root of [...roots].sort((a, b) => b.length - a.length)) {
    if (!root) continue;
    out = out.split(String(root).replaceAll('\\', '/')).join('<temp_root>');
    out = out.split(String(root)).join('<temp_root>');
  }
  return out;
}

function isAbsoluteLike(text) {
  return /^[A-Za-z]:[\\/]/u.test(text) || /^[\\/]{2}\w/u.test(text) || /^[\\/](?:Users|home|tmp|var|usr|private)[\\/]/u.test(text);
}

function normalizeNode(value, key, roots) {
  if (key && VOLATILE_KEYS.includes(key) && (typeof value === 'string' || typeof value === 'number')) return `<${key}>`;
  if (typeof value === 'string') {
    const text = replacePathLiterals(value, roots).replace(/\r/g, '');
    if (isAbsoluteLike(text)) return '<abs_path>';
    return normalizeScalar(text);
  }
  if (Array.isArray(value)) {
    return value
      .map((entry) => normalizeNode(entry, undefined, roots))
      .sort((a, b) => JSON.stringify(a).localeCompare(JSON.stringify(b)));
  }
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.entries(value).map(([childKey, entry]) => [childKey, normalizeNode(entry, childKey, roots)]));
  }
  return value;
}

export function shapeOf(value, prefix = '', depth = 0, out = []) {
  if (depth > 6) { out.push(`${prefix || 'node'}:deep`); return out; }
  if (Array.isArray(value)) {
    out.push(`${prefix || 'node'}:array(${value.length})`);
    value.forEach((entry, index) => shapeOf(entry, `${prefix}[${index}]`, depth + 1, out));
    return out;
  }
  if (value && typeof value === 'object') {
    for (const [key, entry] of Object.entries(value)) shapeOf(entry, prefix ? `${prefix}.${key}` : key, depth + 1, out);
    return out;
  }
  out.push(`${prefix || 'node'}:${value === null ? 'null' : typeof value}`);
  return out;
}

export function normalizeCapture({ stdout, stderr, code }, roots = []) {
  let parsed = null;
  const text = String(stdout ?? '').trim();
  if (text.startsWith('{') || text.startsWith('[')) {
    try { parsed = JSON.parse(text); } catch { parsed = null; }
  }
  const normalizedStdout = parsed === null ? normalizeNode(text, undefined, roots) : normalizeNode(parsed, undefined, roots);
  return {
    exit_code: code ?? null,
    stdout_kind: parsed === null ? 'text' : Array.isArray(normalizedStdout) ? 'json_array' : 'json_object',
    normalized_stdout: normalizedStdout,
    normalized_stderr: normalizeNode(replacePathLiterals(String(stderr ?? ''), roots).replace(/\r/g, '').trim(), undefined, roots),
    stderr_class: classifyStderr(stderr),
    output_shape: shapeOf(normalizedStdout).sort(),
    output_digest: sha256(JSON.stringify(normalizedStdout)),
  };
}

function runBinary(binary, args, cwd) {
  try {
    const stdout = execFileSync(binary, args, {
      cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], timeout: 120_000, windowsHide: true,
    });
    return { stdout: String(stdout).trim(), stderr: '', code: 0 };
  } catch (error) {
    return {
      stdout: String(error?.stdout ?? '').trim(),
      stderr: String(error?.stderr ?? error?.message ?? error).replace(/\r/g, ''),
      code: typeof error?.status === 'number' ? error.status : null,
    };
  }
}

function runGit(args, cwd) {
  const output = runBinary('git', ['-c', 'core.autocrlf=false', ...args], cwd);
  if (output.code !== 0) throw new Error(`git ${args.join(' ')} failed: ${output.stderr}`);
  return output;
}

export function collectMc2Fingerprint({ binary, mc0 } = {}) {
  if (!binary || !existsSync(binary)) throw new Error('VerseGit binary is required');
  if (!mc0?.source?.head || !mc0?.binary?.sha256) throw new Error('MC0 baseline is required');
  const binaryBytes = readFileSync(binary);
  const binarySha = sha256(binaryBytes);
  if (binarySha !== mc0.binary.sha256) throw new Error('VerseGit binary drifted from the MC0 frozen digest');
  const rootBase = process.env.VERSEGIT_MC2_ROOT || process.env.TEMP || process.env.TMP || tmpdir();
  mkdirSync(rootBase, { recursive: true });
  const runRoot = mkdtempSync(join(rootBase, 'versegit-mc2-'));
  const repo = join(runRoot, 'repo');
  const worktreeA = join(runRoot, 'wt-a');
  const worktreeB = join(runRoot, 'wt-b');
  const outside = join(runRoot, 'outside');
  mkdirSync(repo, { recursive: true });
  mkdirSync(outside, { recursive: true });
  const roots = [runRoot];
  const vg = (args, cwd) => runBinary(binary, args, cwd);

  runGit(['init', '--quiet', '-b', 'main'], repo);
  runGit(['config', 'user.name', 'versegit-mc2'], repo);
  runGit(['config', 'user.email', 'versegit-mc2@example.invalid'], repo);
  writeFileSync(join(repo, 'pricedb.py'), PRICEDB_BASE, 'utf8');
  runGit(['add', '-A'], repo);
  runGit(['commit', '--quiet', '-m', 'base'], repo);
  runGit(['worktree', 'add', '--quiet', '-b', 'side-a', worktreeA], repo);
  runGit(['worktree', 'add', '--quiet', '-b', 'side-b', worktreeB], repo);

  const cases = [];
  const record = (entry) => {
    const capture = normalizeCapture(entry.run(), roots);
    const assertion = entry.assert ? entry.assert(capture) : undefined;
    cases.push({
      id: entry.id,
      role: entry.role,
      purpose: entry.purpose,
      argv: entry.args.map((arg) => (arg === binary ? '<vg_binary>' : replacePathLiterals(String(arg), roots))),
      cwd_role: entry.cwd_role,
      oracle: entry.oracle,
      status: capture.exit_code !== null ? 'observed' : 'unavailable',
      ...capture,
      ...(assertion ? { assertion } : {}),
    });
    return capture;
  };

  record({ id: 'identity_version', role: 'identity', purpose: 'Frozen binary version string.', args: ['--version'], cwd_role: 'fixture_repo', oracle: { exit: 0, stdout_kind: 'text' }, run: () => vg(['--version'], repo) });
  const capabilities = record({
    id: 'identity_capabilities', role: 'identity', purpose: 'Versioned capability document the sidecar contract consumes.',
    args: ['capabilities', '--json'], cwd_role: 'fixture_repo', oracle: { exit: 0, stdout_kind: 'json_object', schema: 'versegit.capabilities/v1' },
    run: () => vg(['capabilities', '--json'], repo),
    assert: (capture) => ({
      capability_schema: capture.normalized_stdout?.schema ?? null,
      verdict_dimensions: capture.normalized_stdout?.verdict?.dimensions ?? null,
      single_green_light: capture.normalized_stdout?.verdict?.single_green_light ?? null,
      default_enable: capture.normalized_stdout?.safety?.default_enable ?? null,
      unobserved_read_channels: capture.normalized_stdout?.verdict?.read_surface?.unobserved_channels ?? null,
    }),
  });

  record({ id: 'fixture_workspace_init', role: 'health', purpose: 'Disposable fixture ledger creation (vg workspace init).', args: ['init', '--json'], cwd_role: 'fixture_repo', oracle: { exit: 0, stdout_kind: 'json_object' }, run: () => vg(['init', '--json'], repo) });
  record({ id: 'health_doctor', role: 'health', purpose: 'Ledger chain, derived cache, plugin and worktree diagnostic shape.', args: ['doctor', '--json'], cwd_role: 'fixture_repo', oracle: { exit: 0, stdout_kind: 'json_object' }, run: () => vg(['doctor', '--json'], repo) });
  record({
    id: 'health_verify_registry_empty', role: 'health',
    purpose: 'Trusted check registry on a fresh workspace must not invent checks.',
    args: ['verify', 'list', '--json'], cwd_role: 'fixture_repo', oracle: { exit: 0, stdout_kind: 'json_object' },
    run: () => vg(['verify', 'list', '--json', '--repo', repo], repo),
    assert: (capture) => ({ registered_checks: Object.keys(capture.normalized_stdout?.registry?.checks ?? {}).length }),
  });
  record({
    id: 'health_verify_status_unverified', role: 'health',
    purpose: 'A worktree with no matching validation record must be UNVERIFIED, never passed.',
    args: ['verify', 'status', '--json'], cwd_role: 'fixture_repo', oracle: { exit: 0, verdict: 'UNVERIFIED' },
    run: () => vg(['verify', 'status', '--json', '--repo', repo, '--worktree', worktreeA], repo),
    assert: (capture) => ({ verdict: capture.normalized_stdout?.verdict ?? null }),
  });
  record({
    id: 'error_workspace_not_found', role: 'error',
    purpose: 'VG commands outside a VG workspace are refused rather than silently scoped elsewhere.',
    args: ['doctor', '--json'], cwd_role: 'outside_fixture', oracle: { exit: 1, stderr_class: 'workspace_not_found' },
    run: () => vg(['doctor', '--json'], outside),
  });

  const startSession = (actor, worktree) => JSON.parse(vg(['session', 'start', '--json', '--actor', actor, '--worktree', worktree, '--client', 'manual'], repo).stdout).session_id;
  const producer = startSession('agent:mc2-producer', worktreeA);
  const consumer = startSession('agent:mc2-consumer', worktreeB);
  const bystander = startSession('agent:mc2-bystander', worktreeA);
  const selfWriter = startSession('agent:mc2-self-writer', worktreeA);
  const observeRead = (session, lines) => vg(['observe', 'read', '--json', '--session', session, '--path', 'pricedb.py', '--line-start', String(lines[0]), '--line-end', String(lines[1])], repo);
  const observeWrite = (session, kind) => vg(['observe', 'write', '--json', '--session', session, '--path', 'pricedb.py', '--kind', kind], repo);
  const check = (session) => vg(['check', '--json', '--file', 'pricedb.py', '--session', session], repo);
  const checkFile = (session, file) => vg(['check', '--json', '--file', file, '--session', session], repo);
  const observeReadFile = (session, file, lines) => vg(['observe', 'read', '--json', '--session', session, '--path', file, '--line-start', String(lines[0]), '--line-end', String(lines[1])], repo);
  const observeWriteFile = (session, file, kind) => vg(['observe', 'write', '--json', '--session', session, '--path', file, '--kind', kind], repo);
  const advisoryKinds = (capture) => (capture.normalized_stdout?.advisories ?? []).map((entry) => entry.kind).sort();

  record({ id: 'behavior_session_list', role: 'behavior', purpose: 'Session projection lists fixture sessions with actor and state.', args: ['session', 'list', '--json'], cwd_role: 'fixture_repo', oracle: { exit: 0, stdout_kind: 'json_array' }, run: () => vg(['session', 'list', '--json'], repo) });
  record({ id: 'behavior_session_show', role: 'behavior', purpose: 'session show carries identity, read set and write set projections.', args: ['session', 'show', '<session_id>', '--json'], cwd_role: 'fixture_repo', oracle: { exit: 0, stdout_kind: 'json_object' }, run: () => vg(['session', 'show', producer, '--json'], repo) });

  observeRead(producer, [1, 3]);
  record({
    id: 'negative_control_silent_before_peer_write', role: 'negative_control',
    purpose: 'A read with no peer write must produce zero advisories.',
    args: ['check', '--json', '--file', 'pricedb.py', '--session', '<session_id>'], cwd_role: 'fixture_repo',
    oracle: { exit: 0, advisories: 0 }, run: () => check(producer),
    assert: (capture) => ({ advisory_kinds: advisoryKinds(capture) }),
  });

  writeFileSync(join(worktreeB, 'pricedb.py'), PRICEDB_SIGNATURE_MOVED, 'utf8');
  observeWrite(consumer, 'modify_signature');
  record({
    id: 'positive_stale_read_producer_consumer', role: 'positive',
    purpose: 'A peer signature change must invalidate the reader premise.',
    args: ['check', '--json', '--file', 'pricedb.py', '--session', '<session_id>'], cwd_role: 'fixture_repo',
    oracle: { exit: 0, advisory_kind: 'ssi/stale-read' }, run: () => check(producer),
    assert: (capture) => ({ advisory_kinds: advisoryKinds(capture) }),
  });

  observeRead(bystander, [5, 7]);
  record({
    id: 'negative_control_unrelated_symbol_silent', role: 'negative_control',
    purpose: 'Reading another symbol must stay silent when a peer changes a different symbol.',
    args: ['check', '--json', '--file', 'pricedb.py', '--session', '<session_id>'], cwd_role: 'fixture_repo',
    oracle: { exit: 0, advisories: 0 }, run: () => check(bystander),
    assert: (capture) => ({ advisory_kinds: advisoryKinds(capture) }),
  });

  // The self-write control must use a file no peer touched: a file-level textual
  // overlap with the consumer's edit would otherwise mask the symbol-level assertion.
  writeFileSync(join(worktreeA, 'notes.py'), SELFWRITER_BASE, 'utf8');
  observeReadFile(selfWriter, 'notes.py', [1, 2]);
  writeFileSync(join(worktreeA, 'notes.py'), SELFWRITER_EDITED, 'utf8');
  observeWriteFile(selfWriter, 'notes.py', 'modify_body');
  record({
    id: 'negative_control_own_write_not_cross_session', role: 'negative_control',
    purpose: 'A session reading and writing its own file (untouched by peers) is not a cross-session conflict.',
    args: ['check', '--json', '--file', 'notes.py', '--session', '<session_id>'], cwd_role: 'fixture_repo',
    oracle: { exit: 0, advisories: 0 }, run: () => checkFile(selfWriter, 'notes.py'),
    assert: (capture) => ({ advisory_kinds: advisoryKinds(capture) }),
  });

  record({
    id: 'behavior_conflicts_worktree_mode', role: 'behavior',
    purpose: 'Multi-worktree conflict report shape must always carry the four class counters.',
    args: ['conflicts', '--repo', '<fixture_repo>', '--json'], cwd_role: 'fixture_repo',
    oracle: { exit: 0, stdout_kind: 'json_object', counter_classes: 4 },
    run: () => vg(['conflicts', '--repo', repo, '--json'], repo),
    assert: (capture) => ({ mode: capture.normalized_stdout?.mode ?? null, counts: capture.normalized_stdout?.counts ?? null }),
  });

  record({
    id: 'behavior_verify_registered_check', role: 'behavior',
    purpose: 'Registering a trusted check is an explicit registry write.',
    args: ['verify', 'set', 'mc2smoke', '--timeout', '30', '--', 'git', '--version'], cwd_role: 'fixture_repo',
    oracle: { stdout_kind: 'text_or_json' }, run: () => vg(['verify', 'set', 'mc2smoke', '--timeout', '30', '--', 'git', '--version'], repo),
  });
  record({
    id: 'behavior_verify_run_then_status', role: 'behavior',
    purpose: 'A registered check that passes must produce a fingerprint-bound VERIFIED status for that worktree only.',
    args: ['verify', 'run', 'mc2smoke', '--json'], cwd_role: 'fixture_repo',
    oracle: { stdout_kind: 'json_object' },
    run: () => {
      const runResult = vg(['verify', 'run', 'mc2smoke', '--json', '--repo', repo, '--worktree', worktreeA], repo);
      return vg(['verify', 'status', '--json', '--repo', repo, '--worktree', worktreeA], repo);
    },
    assert: (capture) => ({ verdict: capture.normalized_stdout?.verdict ?? null }),
  });
  record({
    id: 'negative_control_sibling_worktree_not_verified', role: 'negative_control',
    purpose: 'Verifying one worktree must not upgrade a sibling worktree verdict.',
    args: ['verify', 'status', '--json', '--worktree', '<side_b>'], cwd_role: 'fixture_repo',
    oracle: { exit: 0, verdict: 'UNVERIFIED' },
    run: () => vg(['verify', 'status', '--json', '--repo', repo, '--worktree', worktreeB], repo),
    assert: (capture) => ({ verdict: capture.normalized_stdout?.verdict ?? null }),
  });
  record({
    id: 'error_verify_unknown_check', role: 'error',
    purpose: 'Running an unregistered check must fail closed, not execute arbitrary argv.',
    args: ['verify', 'run', 'mc2missing', '--json'], cwd_role: 'fixture_repo',
    oracle: { stderr_class: 'subject_not_found_or_error', executed_argv: false },
    run: () => vg(['verify', 'run', 'mc2missing', '--json', '--repo', repo], repo),
  });

  vg(['session', 'end', consumer, '--reason', 'probe', '--json'], repo);
  record({
    id: 'negative_control_ended_session_stops_conflicting', role: 'negative_control',
    purpose: 'Ending a session must purge conflict views derived from it.',
    args: ['check', '--json', '--file', 'pricedb.py', '--session', '<session_id>'], cwd_role: 'fixture_repo',
    oracle: { exit: 0, advisories: 0 }, run: () => check(producer),
    assert: (capture) => ({ advisory_kinds: advisoryKinds(capture) }),
  });

  record({ id: 'error_session_not_found', role: 'error', purpose: 'An unknown session must fail closed with a classified error.', args: ['session', 'show', 'missing-session', '--json'], cwd_role: 'fixture_repo', oracle: { exit: 1, stderr_class: 'session_not_found' }, run: () => vg(['session', 'show', 'missing-session', '--json'], repo) });
  record({ id: 'error_verdict_facts_missing', role: 'error', purpose: 'verdict --facts must reject a missing input file.', args: ['verdict', '--facts', 'missing-facts.json', '--json'], cwd_role: 'fixture_repo', oracle: { exit: 1, stderr_class: 'facts_input_missing' }, run: () => vg(['verdict', '--facts', 'missing-facts.json', '--json'], repo) });
  record({ id: 'error_usage_missing_argument', role: 'error', purpose: 'Argument validation must be structured, not a crash.', args: ['verdict', '--json'], cwd_role: 'fixture_repo', oracle: { stderr_class: 'usage_error' }, run: () => vg(['verdict', '--json'], repo) });
  record({ id: 'error_unsupported_argument', role: 'error', purpose: 'Unknown flags must be refused by the CLI surface.', args: ['session', 'show', 'x', '--workspace', 'y', '--json'], cwd_role: 'fixture_repo', oracle: { stderr_class: 'usage_error' }, run: () => vg(['session', 'show', 'x', '--workspace', 'y', '--json'], repo) });

  for (const root of roots.slice().reverse()) {
    rmSync(root, { recursive: true, force: true, maxRetries: 10, retryDelay: 50 });
  }
  const survivors = roots.filter((root) => existsSync(root));
  const cleanup = {
    disposable_root_pattern: 'versegit-mc2-*',
    roots_created: roots.length,
    roots_removed: roots.length - survivors.length,
    survivors: survivors.length,
    cleanup_status: survivors.length === 0 ? 'clean' : 'recovery_required',
    host_worktrees_deleted: 0,
    evidence_retained: true,
  };

  const fingerprint = {
    fingerprintSchema: MC2_SCHEMA,
    generated_at: new Date().toISOString(),
    driven_by: 'agent',
    actor: 'codex',
    identity: {
      binary_sha256: binarySha,
      binary_bytes: binaryBytes.length,
      binary_relative: relative(repositoryRoot, binary).replaceAll('\\', '/'),
      matches_mc0: true,
      mc0_source_head: mc0.source.head,
      mc0_source_tree: mc0.source.tree,
      mc0_source_status: mc0.source.status,
      mc0_deliverable: mc0.deliverable,
      mc0_binary_sha256: mc0.binary.sha256,
      capabilities_schema: capabilities.normalized_stdout?.schema ?? null,
    },
    fixture: {
      kind: 'disposable_git_repo_with_linked_worktrees',
      created_outside_repos: true,
      temp_root_placeholder: '<temp_root>',
      producer_consumer_sessions: 2,
      worktree_count: 3,
      base_content_sha256: sha256(PRICEDB_BASE),
      signature_change_sha256: sha256(PRICEDB_SIGNATURE_MOVED),
      body_change_sha256: sha256(PRICEDB_CREDIT_BODY),
    },
    normalization: {
      volatile_keys: VOLATILE_KEYS,
      value_rules: [
        'uuid -> <uuid>', 'evt_<hex32> -> <event_id>', 'sha256:<hex64> -> <fingerprint>',
        '<hex40-64> -> <oid>', 'iso-8601 -> <timestamp>',
        'absolute path -> <abs_path>', 'disposable temp root -> <temp_root>',
        'volatile ledger keys -> <key>', 'array entries canonicalized before hashing',
      ],
      paths_policy: 'repo_relative_or_placeholder_only',
    },
    cases,
    coverage: {
      roles: ['identity', 'health', 'behavior', 'positive', 'negative_control', 'error', 'cleanup'],
      positive_controls: cases.filter((entry) => entry.role === 'positive').map((entry) => entry.id),
      negative_controls: cases.filter((entry) => entry.role === 'negative_control').map((entry) => entry.id),
      error_paths: cases.filter((entry) => entry.role === 'error').map((entry) => entry.id),
      unobserved_surfaces: [
        'real_agent_tool_invocation (fixture sessions are host-injected observations)',
        'network and browser read surface',
        'direct filesystem reads outside hooks',
        'non-Windows platforms',
        'languages outside the declared index coverage',
        'vg land and vg admit (never invoked by MC2)',
      ],
    },
    cleanup,
    boundaries: {
      vg_source_tree_copied: false,
      vg_history_copied: false,
      vg_task_forest_copied: false,
      vg_build_outputs_copied: false,
      vg_private_evidence_copied: false,
      fixture_only_execution: true,
      user_repository_mutated: false,
      land_or_admit_invoked: false,
      deliverable: mc0.deliverable === 'eligible' ? 'eligible' : 'rejected',
      blockers: mc0.deliverable === 'eligible' ? [] : ['source_worktree_dirty', 'not_a_deliverable_baseline'],
    },
  };
  fingerprint.digest = sha256(JSON.stringify({ ...fingerprint, generated_at: undefined, digest: undefined }));
  return fingerprint;
}

const PROVENANCE_KEYS = new Set([
  'binary_sha256', 'mc0_binary_sha256', 'mc0_source_head', 'mc0_source_tree',
  'base_content_sha256', 'signature_change_sha256', 'body_change_sha256',
  'digest', 'output_digest',
]);

function redactProvenance(value) {
  if (Array.isArray(value)) return value.map(redactProvenance);
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.entries(value)
      .filter(([key]) => !PROVENANCE_KEYS.has(key))
      .map(([key, entry]) => [key, redactProvenance(entry)]));
  }
  return value;
}

const EMBEDDED_PATH_RE = /(?:^|[\s"'=(,:;\[\{])([A-Za-z]:[\\/][^\s"'),;\]}]{2,}|\\\\[^\\\s]+[\\/][^\s"'),;\]}]{2,})/u;

function containsEmbeddedPath(text) {
  if (isAbsoluteLike(text)) return true;
  EMBEDDED_PATH_RE.lastIndex = 0;
  return EMBEDDED_PATH_RE.test(text);
}

function findAbsolutePaths(value, nodePath = 'root', out = []) {
  if (typeof value === 'string') {
    if (containsEmbeddedPath(value)) out.push({ path: nodePath, sample: value.slice(0, 60) });
    return out;
  }
  if (Array.isArray(value)) {
    value.forEach((entry, index) => findAbsolutePaths(entry, `${nodePath}[${index}]`, out));
    return out;
  }
  if (value && typeof value === 'object') {
    for (const [key, entry] of Object.entries(value)) findAbsolutePaths(entry, `${nodePath}.${key}`, out);
  }
  return out;
}

export function validateMc2Fingerprint(fingerprint) {
  const issues = [];
  if (fingerprint?.fingerprintSchema !== MC2_SCHEMA) issues.push(`fingerprintSchema must be ${MC2_SCHEMA}`);
  if (!/^[0-9a-f]{64}$/u.test(String(fingerprint?.identity?.binary_sha256 ?? ''))) issues.push('binary sha256 missing');
  if (fingerprint?.identity?.matches_mc0 !== true) issues.push('fingerprinted binary does not match the MC0 frozen binary');
  if (!/^[0-9a-f]{40}$/u.test(String(fingerprint?.identity?.mc0_source_head ?? ''))) issues.push('MC0 source head missing');
  const cases = fingerprint?.cases ?? [];
  if (!Array.isArray(cases) || cases.length < 22) issues.push('at least twenty-two fingerprint cases required');
  for (const role of ['identity', 'health', 'behavior', 'positive', 'negative_control', 'error']) {
    if (!cases.some((entry) => entry.role === role)) issues.push(`missing role ${role}`);
  }
  for (const entry of cases) {
    if (!entry.id) issues.push('case missing id');
    if (!Array.isArray(entry.output_shape) || entry.output_shape.length === 0) issues.push(`case ${entry.id}: missing output_shape`);
    if (!/^[0-9a-f]{64}$/u.test(String(entry.output_digest ?? ''))) issues.push(`case ${entry.id}: missing output_digest`);
    if (entry.status !== 'observed') issues.push(`case ${entry.id}: status ${entry.status} is not observed`);
  }
  if (cases.filter((entry) => entry.role === 'positive').length < 1) issues.push('at least one behavioral positive control required');
  if (cases.filter((entry) => entry.role === 'negative_control').length < 5) issues.push('at least five negative controls required');
  if (cases.filter((entry) => entry.role === 'error').length < 5) issues.push('at least five error paths required');
  const staleRead = cases.find((entry) => entry.id === 'positive_stale_read_producer_consumer');
  if (!staleRead || !(staleRead.assertion?.advisory_kinds ?? []).includes('ssi/stale-read')) issues.push('producer-consumer stale-read positive control did not fire');
  for (const id of [
    'negative_control_silent_before_peer_write',
    'negative_control_unrelated_symbol_silent',
    'negative_control_own_write_not_cross_session',
    'negative_control_ended_session_stops_conflicting',
  ]) {
    const entry = cases.find((candidate) => candidate.id === id);
    if (!entry) { issues.push(`missing negative control ${id}`); continue; }
    if ((entry.assertion?.advisory_kinds ?? []).length !== 0) issues.push(`negative control ${id} must stay silent`);
  }
  const sibling = cases.find((entry) => entry.id === 'negative_control_sibling_worktree_not_verified');
  if (!sibling) issues.push('missing sibling worktree verification negative control');
  else if (sibling.assertion?.verdict === 'VERIFIED') issues.push('verifying one worktree must not verify a sibling worktree');
  const unverified = cases.find((entry) => entry.id === 'health_verify_status_unverified');
  if (unverified && unverified.assertion?.verdict === 'VERIFIED') issues.push('an untouched worktree must not read as VERIFIED');
  const verifiedRun = cases.find((entry) => entry.id === 'behavior_verify_run_then_status');
  if (!verifiedRun) issues.push('missing fingerprint-bound verification behavior case');
  else if (verifiedRun.assertion?.verdict !== 'VERIFIED') issues.push('a passing registered check must produce a fingerprint-bound VERIFIED status');
  const emptyRegistry = cases.find((entry) => entry.id === 'health_verify_registry_empty');
  if (emptyRegistry && emptyRegistry.assertion?.registered_checks !== 0) issues.push('a fresh fixture registry must have zero checks');
  if (fingerprint?.cleanup?.cleanup_status !== 'clean') issues.push('cleanup must be clean');
  if (fingerprint?.cleanup?.survivors !== 0) issues.push('cleanup survivors must be zero');
  if (fingerprint?.boundaries?.vg_source_tree_copied !== false) issues.push('VG source tree must not be copied');
  if (fingerprint?.boundaries?.user_repository_mutated !== false) issues.push('the user repository must not be mutated');
  if (fingerprint?.boundaries?.fixture_only_execution !== true) issues.push('fingerprint must run fixture-only');
  if (fingerprint?.boundaries?.land_or_admit_invoked !== false) issues.push('MC2 must not invoke land or admit');
  if (fingerprint?.identity?.capabilities_schema !== 'versegit.capabilities/v1') issues.push('capabilities schema drifted from versegit.capabilities/v1');
  if (fingerprint?.identity?.mc0_binary_sha256 !== fingerprint?.identity?.binary_sha256) issues.push('fingerprint binary differs from the MC0 frozen binary');
  const scrubbed = JSON.stringify(redactProvenance(fingerprint));
  if (/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/iu.test(scrubbed)) issues.push('raw uuid leaked into the fingerprint');
  if (/[0-9a-f]{40,}/u.test(scrubbed)) issues.push('raw object id leaked into the fingerprint');
  for (const hit of findAbsolutePaths(redactProvenance(fingerprint))) issues.push(`raw absolute path leaked into the fingerprint at ${hit.path}`);
  return { ok: issues.length === 0, issues };
}

export function resolveMc2Binary(mc0) {
  const declared = mc0?.binary?.path ? resolve(String(mc0.binary.path)) : null;
  const candidates = [
    declared,
    resolve(repositoryRoot, '..', 'VerseGit', 'target', 'debug', 'vg.exe'),
    resolve(repositoryRoot, '..', 'VerseGit', 'target', 'release', 'vg.exe'),
  ].filter(Boolean);
  const found = candidates.find((path) => existsSync(path));
  if (!found) throw new Error('VerseGit binary not found; MC0 must freeze it first');
  return found;
}

export function writeMc2Fingerprint({ output } = {}) {
  const mc0 = JSON.parse(readFileSync(resolve(repositoryRoot, MC0_BASELINE_PATH), 'utf8'));
  const binary = resolveMc2Binary(mc0);
  const fingerprint = collectMc2Fingerprint({ binary, mc0 });
  const validation = validateMc2Fingerprint(fingerprint);
  const path = output ? resolve(output) : resolve(repositoryRoot, 'harness/specs/fixtures/versegit-planning-correction/mc2-evidence/golden.json');
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, `${JSON.stringify(fingerprint, null, 2)}\n`, 'utf8');
  return { path, fingerprint, validation };
}

function main() {
  const outputIndex = process.argv.indexOf('--out');
  const output = outputIndex >= 0 ? resolve(process.argv[outputIndex + 1]) : undefined;
  const result = writeMc2Fingerprint({ output });
  console.log(JSON.stringify({
    path: result.path,
    cases: result.fingerprint.cases.length,
    cleanup: result.fingerprint.cleanup.cleanup_status,
    validation: result.validation,
  }, null, 2));
  if (!result.validation.ok) process.exitCode = 1;
}

if (isMainEntrypoint(import.meta.url)) main();
