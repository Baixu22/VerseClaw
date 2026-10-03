import { createHash } from 'node:crypto';
import { lstat, readFile, readdir, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';

const nonBlank = (value) => typeof value === 'string' && value.trim().length > 0;
const digest = (value) => typeof value === 'string' && /^[a-f0-9]{64}$/u.test(value);

export function summarizeRc10Receipts(rows, runId) {
  const matching = nonBlank(runId) ? rows.filter((row) => row.run_id === runId) : [];
  const parseArray = (value) => {
    // ReceiptStore stores empty arrays as SQL NULL; malformed JSON is distinct.
    if (value === null) return [];
    try {
      const parsed = JSON.parse(value ?? 'null');
      return Array.isArray(parsed) ? parsed : null;
    } catch {
      return null;
    }
  };
  const map = (row) => ({
    receipt_id: row.receipt_id,
    kind: row.kind,
    version: row.version,
    runtime_mode: row.runtime_mode,
    run_id: row.run_id,
    correlation_digest: row.correlation_digest,
    ...(row.kind === 'context' ? { selected: parseArray(row.selected_json), omitted: parseArray(row.omitted_json) } : {}),
  });
  const context = matching.filter((row) => row.kind === 'context' && row.version === '1' && row.runtime_mode === 'source').map(map);
  const wire = matching.filter((row) => row.kind === 'wire' && row.version === '1' && row.runtime_mode === 'source').map(map);
  const wireDigests = new Set(wire.map((row) => row?.correlation_digest).filter(digest));
  const paired = new Set(context.map((row) => row?.correlation_digest).filter((value) => digest(value) && wireDigests.has(value)));
  return { available: true, total: matching.length, kinds: [...new Set(matching.map((row) => row.kind))], context, wire, pairs: paired.size };
}

export function evaluateRc10H01({ candidate, runId, finished, before, after, receipts }) {
  const errors = [];
  if (candidate?.dirty !== false) errors.push('candidate-not-clean');
  if (!nonBlank(runId)) errors.push('missing-run-id');
  if (finished !== true || before?.tests?.exitCode !== 1 || after?.tests?.exitCode !== 0) errors.push('workload-not-completed');
  const testFiles = Object.keys(before?.files ?? {}).filter((name) => /(?:^|\/)(?:test[^/]*|[^/]+\.test)\.[cm]?[jt]s$/u.test(name));
  if (testFiles.length === 0 || testFiles.some((name) => !before.files[name]?.sha256
    || before.files[name].sha256 !== after?.files?.[name]?.sha256)) errors.push('workload-test-modified-or-missing');
  const context = Array.isArray(receipts?.context) ? receipts.context : [];
  const wire = Array.isArray(receipts?.wire) ? receipts.wire : [];
  const valid = (row, kind) => row?.kind === kind && row.version === '1' && row.runtime_mode === 'source'
    && row.run_id === runId && nonBlank(row.receipt_id) && digest(row.correlation_digest);
  if (receipts?.available !== true || context.length === 0 || wire.length === 0
    || !context.every((row) => valid(row, 'context')) || !wire.every((row) => valid(row, 'wire'))) {
    errors.push('missing-or-invalid-current-run-v1-receipts');
  }
  if (!context.every((row) => Array.isArray(row?.selected) && Array.isArray(row?.omitted))) {
    errors.push('context-lineage-incomplete');
  }
  const contextDigests = new Set(context.map((row) => row?.correlation_digest));
  const wireDigests = new Set(wire.map((row) => row?.correlation_digest));
  if (contextDigests.size === 0 || [...contextDigests].some((value) => !wireDigests.has(value))
    || [...wireDigests].some((value) => !contextDigests.has(value))) errors.push('unpaired-context-wire-receipts');
  return { result: errors.length === 0 ? 'pass' : 'fail', errors };
}

export function evaluateRc10ChannelProbe({ channelType, validation, accounts, targets }) {
  const errors = [];
  if (validation?.valid !== true) errors.push('credential-validation-failed');
  const online = accounts?.success === true && Array.isArray(accounts.channels) && accounts.channels.some((channel) => channel?.channelType === channelType
    && Array.isArray(channel.accounts) && channel.accounts.some((account) => account?.configured === true && account.connected === true && account.running === true));
  if (!online) errors.push('channel-not-connected');
  if (targets?.success !== true || !Array.isArray(targets.targets) || !targets.targets.some((target) => nonBlank(target?.value))) {
    errors.push('delivery-target-unavailable');
  }
  return { result: errors.length === 0 ? 'pass' : 'blocked', errors, provesDelivery: false };
}

async function evidenceFiles(root) {
  const files = [];
  async function visit(relative) {
    const path = join(root, relative);
    const info = await lstat(path);
    if (info.isSymbolicLink()) throw new Error('Evidence must not contain symbolic links');
    if (info.isDirectory()) {
      for (const entry of await readdir(path)) await visit(relative ? `${relative}/${entry}` : entry);
    } else if (info.isFile() && relative !== 'hashes.json') files.push(relative);
  }
  await visit('');
  return files.sort();
}

export async function sealRc10Evidence(evidenceDir, secrets = []) {
  const files = {};
  const credentialScanHits = [];
  const values = [...new Set(secrets.filter(nonBlank))];
  if (values.length === 0) throw new Error('Credential scan requires the credentials used by this run');
  for (const path of await evidenceFiles(evidenceDir)) {
    const bytes = await readFile(join(evidenceDir, path));
    files[path] = { bytes: bytes.length, sha256: createHash('sha256').update(bytes).digest('hex') };
    if (values.some((value) => bytes.includes(Buffer.from(value)))) credentialScanHits.push(path);
  }
  const manifest = { algorithm: 'sha256', driven_by: 'agent', credentialScanHits, files };
  // The caller must finish all evidence writes before sealing; existing seals are immutable.
  await writeFile(join(evidenceDir, 'hashes.json'), `${JSON.stringify(manifest, null, 2)}\n`, { flag: 'wx' });
  return manifest;
}

export async function verifyRc10Evidence(evidenceDir) {
  const errors = [];
  let manifest;
  try {
    manifest = JSON.parse(await readFile(join(evidenceDir, 'hashes.json'), 'utf8'));
  } catch {
    return { ok: false, errors: ['missing-or-invalid-hash-manifest'], checkedFiles: 0 };
  }
  // Operator scenarios use a flat filename -> SHA-256 map. It carries integrity
  // only, so never invent a credential-scan result for that historical format.
  const legacy = manifest && typeof manifest === 'object' && !Array.isArray(manifest)
    && Object.keys(manifest).length > 0 && Object.values(manifest).every(digest);
  if (!legacy && (manifest?.algorithm !== 'sha256' || !manifest.files || typeof manifest.files !== 'object' || Array.isArray(manifest.files))) {
    return { ok: false, errors: ['invalid-hash-manifest-schema'], checkedFiles: 0 };
  }
  if (!legacy && (!Array.isArray(manifest.credentialScanHits) || manifest.credentialScanHits.length !== 0)) errors.push('credential-scan-not-clean');
  const entries = legacy
    ? Object.fromEntries(Object.entries(manifest).map(([name, sha256]) => [name, { sha256 }]))
    : manifest.files;
  let actual;
  try {
    actual = await evidenceFiles(evidenceDir);
  } catch {
    return { ok: false, errors: [...errors, 'unsafe-evidence-entry'], checkedFiles: 0 };
  }
  const names = Object.keys(entries);
  if (names.length === 0) errors.push('empty-evidence-manifest');
  for (const path of actual) if (!Object.hasOwn(entries, path)) errors.push(`unsealed-file:${path}`);
  for (const path of names) {
    if (path === 'hashes.json' || path.includes('\\') || path.startsWith('/') || /^[a-z]:/iu.test(path)
      || path.split('/').some((part) => !part || part === '.' || part === '..')) {
      errors.push('unsafe-manifest-path');
      continue;
    }
    if (!actual.includes(path)) { errors.push(`missing-file:${path}`); continue; }
    const bytes = await readFile(resolve(evidenceDir, path));
    const expected = entries[path];
    if ((!legacy && (!Number.isInteger(expected?.bytes) || expected.bytes !== bytes.length))
      || !digest(expected?.sha256) || expected.sha256 !== createHash('sha256').update(bytes).digest('hex')) errors.push(`digest-mismatch:${path}`);
  }
  return { ok: errors.length === 0, errors, checkedFiles: names.length,
    format: legacy ? 'operator-flat' : 'manifest-v1',
    credentialScan: legacy ? 'not-recorded' : errors.includes('credential-scan-not-clean') ? 'not-clean' : 'recorded-clean' };
}
