#!/usr/bin/env node
import { createHash } from 'node:crypto';
import { existsSync, readFileSync, statSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const expectedFacade = [
  ['read_file', 'file.view'],
  ['search_content', 'repo.search'],
  ['run_command', 'exec.run'],
  ['result_query', 'result.query'],
];
const expectedOperationCatalogDigest =
  'sha256:857eb12ca6b83da190764263a4e4a0181d3cd047926f0d404fc3a4c93c9f4848';
const expectedOperationCatalogCount = 26;

function readJson(path) {
  return JSON.parse(readFileSync(path, 'utf8').replace(/^﻿/u, ''));
}

function string(value, path, issues) {
  if (typeof value !== 'string' || value.length === 0) issues.push(`${path}: non-empty string required`);
}

function exactKeys(value, allowed, path, issues) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    issues.push(`${path}: object required`);
    return;
  }
  for (const key of Object.keys(value)) {
    if (!allowed.includes(key)) issues.push(`${path}.${key}: unexpected field`);
  }
}

function validateFacadeSource(root, issues) {
  const path = resolve(root, 'shared/verseshell/facade.ts');
  if (!existsSync(path)) {
    issues.push('shared/verseshell/facade.ts: missing');
    return;
  }
  const source = readFileSync(path, 'utf8');
  const catalogStart = source.indexOf('export const CLAWX_VERSESHELL_FACADE = [');
  const catalogEnd = source.indexOf('] as const satisfies', catalogStart);
  const catalogSource = catalogStart >= 0 && catalogEnd > catalogStart
    ? source.slice(catalogStart, catalogEnd)
    : '';
  const pairs = [...catalogSource.matchAll(/name:\s*'([^']+)'[\s\S]*?canonical_op:\s*'([^']+)'/gu)]
    .map((match) => [match[1], match[2]])
    .filter(([name]) => expectedFacade.some(([expected]) => expected === name));
  if (JSON.stringify(pairs) !== JSON.stringify(expectedFacade)) {
    issues.push(`facade order/mapping mismatch: ${JSON.stringify(pairs)}`);
  }
  for (const [name] of expectedFacade) {
    const pattern = new RegExp(`name:\\s*'${name}'[\\s\\S]*?when_to_use:[\\s\\S]*?when_not_to_use:[\\s\\S]*?input_schema:`, 'u');
    if (!pattern.test(source)) issues.push(`facade ${name}: when/not-when descriptions or schema missing`);
  }
}

function validateArtifact(root, platform, artifact, requiredForPackage, issues) {
  const pathLabel = `artifacts.${platform}`;
  exactKeys(artifact, ['path', 'packaged_path', 'sha256', 'bytes', 'version'], pathLabel, issues);
  const values = [artifact?.path, artifact?.sha256, artifact?.bytes];
  const missing = values.filter((value) => value === null).length;
  if (missing !== 0 && missing !== 3) issues.push(`${pathLabel}: path, sha256, and bytes must be populated together`);
  if (missing === 3) {
    if (requiredForPackage) issues.push(`${pathLabel}: artifact and checksum required in package mode`);
    return;
  }
  if (typeof artifact.path !== 'string' || artifact.path.length === 0) {
    issues.push(`${pathLabel}.path: non-empty string required`);
    return;
  }
  if (!/^[0-9a-f]{64}$/u.test(artifact.sha256 || '')) {
    issues.push(`${pathLabel}.sha256: lowercase SHA-256 required`);
  }
  if (!Number.isSafeInteger(artifact.bytes) || artifact.bytes <= 0) {
    issues.push(`${pathLabel}.bytes: positive safe integer required`);
  }
  const absolute = resolve(root, artifact.path);
  if (!existsSync(absolute)) {
    issues.push(`${pathLabel}.path: file does not exist: ${artifact.path}`);
    return;
  }
  const bytes = readFileSync(absolute);
  if (bytes.length !== artifact.bytes) issues.push(`${pathLabel}.bytes: expected ${artifact.bytes}, got ${bytes.length}`);
  const digest = createHash('sha256').update(bytes).digest('hex');
  if (digest !== artifact.sha256) issues.push(`${pathLabel}.sha256: expected ${artifact.sha256}, got ${digest}`);
}

export function validateVerseShellManifest({ root = repositoryRoot, mode = 'dev', platform = 'win32-x64' } = {}) {
  if (!['dev', 'package'].includes(mode)) throw new Error(`unsupported validation mode: ${mode}`);
  const supportedPlatforms = ['win32-x64', 'darwin-x64', 'darwin-arm64', 'linux-x64', 'linux-arm64'];
  if (!supportedPlatforms.includes(platform)) throw new Error(`unsupported packaging platform: ${platform}`);
  const issues = [];
  const manifestPath = resolve(root, 'resources/verseshell/manifest.json');
  if (!existsSync(manifestPath)) return { ok: false, mode, platform, issues: ['resources/verseshell/manifest.json: missing'] };

  let manifest;
  try {
    manifest = readJson(manifestPath);
  } catch (error) {
    return { ok: false, mode, platform, issues: [`manifest JSON parse failed: ${error instanceof Error ? error.message : error}`] };
  }

  exactKeys(
    manifest,
    ['schema_version', 'component', 'upstream', 'license', 'crate', 'protocol', 'provenance', 'compliance', 'build', 'artifacts'],
    'manifest',
    issues,
  );
  if (manifest.schema_version !== 1) issues.push('schema_version: expected 1');
  if (manifest.component !== 'verseshell') issues.push('component: expected verseshell');
  if (manifest.license !== 'AGPL-3.0-or-later') issues.push('license: expected AGPL-3.0-or-later');

  exactKeys(manifest.upstream, ['cargo_repository', 'source_repository', 'pinned_commit', 'pinned_commit_status'], 'upstream', issues);
  string(manifest.upstream?.cargo_repository, 'upstream.cargo_repository', issues);
  string(manifest.upstream?.source_repository, 'upstream.source_repository', issues);
  if (manifest.upstream?.pinned_commit !== null && !/^[0-9a-f]{40}$/u.test(manifest.upstream.pinned_commit || '')) {
    issues.push('upstream.pinned_commit: full lowercase Git commit required');
  }
  if (manifest.upstream?.pinned_commit === null) {
    string(manifest.upstream?.pinned_commit_status, 'upstream.pinned_commit_status', issues);
    if (mode === 'package') issues.push('upstream.pinned_commit: required in package mode');
  }

  exactKeys(
    manifest.provenance,
    ['repository', 'commit', 'dirty', 'build_input', 'corresponding_source', 'dirty_build_override'],
    'manifest.provenance',
    issues,
  );
  if (manifest.provenance) {
    if (manifest.provenance.repository !== manifest.upstream?.source_repository) {
      issues.push('provenance.repository must match upstream.source_repository');
    }
    if (manifest.provenance.commit !== manifest.upstream?.pinned_commit || !/^[0-9a-f]{40}$/u.test(manifest.provenance.commit || '')) {
      issues.push('provenance.commit must match the pinned full lowercase Git commit');
    }
    if (manifest.provenance.dirty !== false) {
      issues.push('provenance.dirty must be false for the synchronized release bundle');
    }
    exactKeys(manifest.provenance.build_input, ['source_directory', 'status_porcelain', 'diff_sha256', 'dirty_entry_count'], 'provenance.build_input', issues);
    string(manifest.provenance.build_input?.source_directory, 'provenance.build_input.source_directory', issues);
    if (!Array.isArray(manifest.provenance.build_input?.status_porcelain) || manifest.provenance.build_input.status_porcelain.length !== 0) {
      issues.push('provenance.build_input.status_porcelain must be an empty array for a clean bundle');
    }
    if (manifest.provenance.build_input?.diff_sha256 !== 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855') {
      issues.push('provenance.build_input.diff_sha256 must be the empty Git diff SHA-256');
    }
    if (manifest.provenance.build_input?.dirty_entry_count !== 0) {
      issues.push('provenance.build_input.dirty_entry_count must be 0 for a clean bundle');
    }
    exactKeys(manifest.provenance.corresponding_source, ['locator', 'patch_instructions'], 'provenance.corresponding_source', issues);
    const expectedLocator = `${manifest.upstream?.source_repository}@${manifest.upstream?.pinned_commit}`;
    if (manifest.provenance.corresponding_source?.locator !== expectedLocator) {
      issues.push('provenance.corresponding_source.locator must identify the pinned upstream commit');
    }
    if (manifest.provenance.corresponding_source?.patch_instructions !== null) {
      issues.push('provenance.corresponding_source.patch_instructions must be null for a clean bundle');
    }
    exactKeys(manifest.provenance.dirty_build_override, ['approved', 'source_snapshot', 'patch_instructions'], 'provenance.dirty_build_override', issues);
    if (manifest.provenance.dirty_build_override?.approved !== false
      || manifest.provenance.dirty_build_override?.source_snapshot !== null
      || manifest.provenance.dirty_build_override?.patch_instructions !== null) {
      issues.push('provenance.dirty_build_override must record no override for a clean bundle');
    }
  } else {
    issues.push('manifest.provenance: required for a synchronized binary bundle');
  }

  exactKeys(manifest.crate, ['name', 'version', 'rust_version', 'edition'], 'crate', issues);
  if (manifest.crate?.name !== 'verseshell') issues.push('crate.name: expected verseshell');
  if (manifest.crate?.version !== '1.0.0') issues.push('crate.version: expected 1.0.0');
  if (manifest.crate?.rust_version !== '1.75') issues.push('crate.rust_version: expected 1.75');
  if (manifest.crate?.edition !== '2021') issues.push('crate.edition: expected 2021');

  exactKeys(
    manifest.protocol,
    [
      'observation_schema',
      'mcp_protocol_version',
      'expected_server_protocol',
      'operation_catalog_schema',
      'operation_catalog_digest',
      'operation_catalog_count',
      'handshake_operation',
      'server_name',
      'server_version',
    ],
    'protocol',
    issues,
  );
  if (manifest.protocol?.observation_schema !== 'verseshell.observation/v1') {
    issues.push('protocol.observation_schema: expected verseshell.observation/v1');
  }
  if (manifest.protocol?.mcp_protocol_version !== '2024-11-05') {
    issues.push('protocol.mcp_protocol_version: expected 2024-11-05');
  }
  if (manifest.protocol?.expected_server_protocol !== 'verseshell.jsonl/v1') {
    issues.push('protocol.expected_server_protocol: expected verseshell.jsonl/v1');
  }
  if (manifest.protocol?.operation_catalog_schema !== 'verseshell.operation-catalog/v1') {
    issues.push('protocol.operation_catalog_schema mismatch');
  }
  if (manifest.protocol?.operation_catalog_digest !== expectedOperationCatalogDigest) {
    issues.push(`protocol.operation_catalog_digest: expected ${expectedOperationCatalogDigest}`);
  }
  if (manifest.protocol?.operation_catalog_count !== expectedOperationCatalogCount) {
    issues.push(`protocol.operation_catalog_count: expected ${expectedOperationCatalogCount}`);
  }
  if (manifest.protocol?.handshake_operation !== 'runtime.handshake') {
    issues.push('protocol.handshake_operation mismatch');
  }
  if (manifest.protocol?.server_name !== 'ae-mcp' || manifest.protocol?.server_version !== '1.0.0') {
    issues.push('protocol server identity mismatch');
  }

  exactKeys(
    manifest.compliance,
    [
      'license_file',
      'notice_file',
      'source_file',
      'build_file',
      'notice_path',
      'source_instructions_path',
      'build_instructions_path',
      'corresponding_source_locator',
      'corresponding_source_path',
      'corresponding_source_status',
    ],
    'compliance',
    issues,
  );
  for (const [field, expected] of [
    ['license_file', 'LICENSE-AGPL-3.0-or-later.txt'],
    ['notice_file', 'NOTICE.md'],
    ['source_file', 'SOURCE.md'],
    ['build_file', 'BUILD.md'],
    ['notice_path', 'resources/verseshell/NOTICE.md'],
    ['source_instructions_path', 'resources/verseshell/SOURCE.md'],
    ['build_instructions_path', 'resources/verseshell/BUILD.md'],
  ]) {
    if (manifest.compliance?.[field] !== expected) issues.push(`compliance.${field}: expected ${expected}`);
    const relative = expected.startsWith('resources/') ? expected : `resources/verseshell/${expected}`;
    const absolute = resolve(root, relative);
    if (!existsSync(absolute) || statSync(absolute).size === 0) issues.push(`${relative}: required non-empty file missing`);
  }
  const correspondingLocator = manifest.compliance?.corresponding_source_locator;
  const correspondingSourcePath = manifest.compliance?.corresponding_source_path;
  const expectedLocator = `${manifest.upstream?.source_repository}@${manifest.upstream?.pinned_commit}`;
  if (correspondingLocator !== expectedLocator) {
    issues.push('compliance.corresponding_source_locator must identify the pinned upstream commit');
  }
  if (correspondingSourcePath !== null) {
    if (typeof correspondingSourcePath !== 'string' || correspondingSourcePath.length === 0) {
      issues.push('compliance.corresponding_source_path: string or null required');
    } else if (!existsSync(resolve(root, correspondingSourcePath))) {
      issues.push('compliance.corresponding_source_path does not exist');
    }
  }
  if (manifest.compliance?.corresponding_source_status !== 'identified_by_repository_and_commit') {
    issues.push('compliance.corresponding_source_status must attest a clean pinned source commit');
  }

  exactKeys(
    manifest.build,
    ['instructions_path', 'command', 'primary_binary', 'mcp_binary', 'cargo_version', 'rustc_version', 'cargo_target', 'cargo_metadata', 'cargo_toml_sha256', 'cargo_lock_sha256', 'synchronized_at'],
    'build',
    issues,
  );
  if (manifest.build?.instructions_path !== 'resources/verseshell/BUILD.md') issues.push('build.instructions_path mismatch');
  if (manifest.build?.command !== 'cargo build --release --bin ae') issues.push('build.command mismatch');
  if (manifest.build?.primary_binary !== 'ae' || manifest.build?.mcp_binary !== 'not_packaged') {
    issues.push('build binary names mismatch');
  }
  for (const field of ['cargo_version', 'rustc_version', 'cargo_target', 'cargo_toml_sha256', 'cargo_lock_sha256', 'synchronized_at']) {
    string(manifest.build?.[field], `build.${field}`, issues);
  }
  if (!/^[0-9a-f]{64}$/u.test(manifest.build?.cargo_toml_sha256 || '')) issues.push('build.cargo_toml_sha256: lowercase SHA-256 required');
  if (!/^[0-9a-f]{64}$/u.test(manifest.build?.cargo_lock_sha256 || '')) issues.push('build.cargo_lock_sha256: lowercase SHA-256 required');
  exactKeys(manifest.build?.cargo_metadata, ['package_name', 'package_version', 'target_directory'], 'build.cargo_metadata', issues);
  if (manifest.build?.cargo_metadata?.package_name !== 'verseshell' || manifest.build?.cargo_metadata?.package_version !== manifest.crate?.version) {
    issues.push('build.cargo_metadata package identity mismatch');
  }
  string(manifest.build?.cargo_metadata?.target_directory, 'build.cargo_metadata.target_directory', issues);

  exactKeys(
    manifest.artifacts,
    ['win32-x64', 'darwin-x64', 'darwin-arm64', 'linux-x64', 'linux-arm64'],
    'artifacts',
    issues,
  );
  for (const artifactPlatform of supportedPlatforms) {
    validateArtifact(
      root,
      artifactPlatform,
      manifest.artifacts?.[artifactPlatform],
      mode === 'package' && artifactPlatform === platform,
      issues,
    );
  }
  validateFacadeSource(root, issues);
  return { ok: issues.length === 0, mode, platform, issues };
}

function readArg(name) {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : undefined;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const result = validateVerseShellManifest({
    root: readArg('--root') || repositoryRoot,
    mode: process.argv.includes('--package') ? 'package' : 'dev',
    platform: readArg('--platform') || 'win32-x64',
  });
  if (!result.ok) {
    for (const issue of result.issues) console.error(`[verseshell-manifest] FAIL: ${issue}`);
    process.exit(1);
  }
  console.log(`[verseshell-manifest] OK: mode=${result.mode} platform=${result.platform}`);
}
