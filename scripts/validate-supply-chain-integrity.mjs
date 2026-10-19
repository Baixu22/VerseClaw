#!/usr/bin/env node
import { isMainEntrypoint } from './lib/entrypoint.mjs';
import { readFileSync, readdirSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { fetchVerifiedAsset, verifyAssetBuffer } from './lib/verified-download.mjs';
import { RELEASE_INTEGRITY_MANIFEST } from './release-integrity-manifest.mjs';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');

export function validateSupplyChainIntegrity(rootDir = root) {
  const issues = [
    ...validateManifest(RELEASE_INTEGRITY_MANIFEST),
    ...scanWorkflowDirectory(join(rootDir, '.github', 'workflows')),
    ...validateDownloaderBindings(rootDir),
  ];
  return { ok: issues.length === 0, issues };
}

export function validateManifest(manifest) {
  const issues = [];
  for (const [component, release] of Object.entries(manifest.downloads || {})) {
    if (!release.version) issues.push(`manifest ${component}: version is missing`);
    const assets = Object.entries(release.assets || {});
    if (assets.length === 0) issues.push(`manifest ${component}: assets are missing`);
    for (const [name, asset] of assets) {
      let parsed;
      try {
        parsed = new URL(asset.url);
      } catch {
        issues.push(`manifest ${component}/${name}: invalid URL`);
        continue;
      }
      if (parsed.protocol !== 'https:') issues.push(`manifest ${component}/${name}: HTTPS required`);
      if (!Number.isSafeInteger(asset.size) || asset.size <= 0) {
        issues.push(`manifest ${component}/${name}: positive size required`);
      }
      if (!/^[0-9a-f]{64}$/u.test(asset.sha256 || '')) {
        issues.push(`manifest ${component}/${name}: 64-character SHA256 required`);
      }
    }
  }
  for (const [repository, pin] of Object.entries(manifest.githubActions || {})) {
    if (!/^[0-9a-f]{40}$/u.test(pin.sha || '')) {
      issues.push(`action ${repository}: full 40-character commit SHA required`);
    }
    if (!pin.version) issues.push(`action ${repository}: documentation version is missing`);
  }
  return issues;
}

export function scanWorkflowText(text, fileName = '<workflow>') {
  const issues = [];
  const usesPattern = /^\s*(?:-\s*)?uses:\s*([^@\s]+)@([^\s#]+)/gmu;
  for (const match of text.matchAll(usesPattern)) {
    const [, repository, ref] = match;
    if (repository.startsWith('./')) continue;
    const approved = RELEASE_INTEGRITY_MANIFEST.githubActions[repository];
    if (!approved) {
      issues.push(`${fileName}: unregistered external action ${repository}@${ref}`);
      continue;
    }
    if (!/^[0-9a-f]{40}$/u.test(ref)) {
      issues.push(`${fileName}: action ${repository} must use a full commit SHA, got ${ref}`);
    } else if (ref !== approved.sha) {
      issues.push(`${fileName}: action ${repository} SHA ${ref} is not approved ${approved.sha}`);
    }
  }
  if (/\b(?:curl|wget)\b[^\r\n|]*\|\s*(?:sudo\s+)?(?:bash|sh)\b/iu.test(text)) {
    issues.push(`${fileName}: remote installer pipe is forbidden`);
  }
  return issues;
}

function scanWorkflowDirectory(directory) {
  const issues = [];
  for (const fileName of readdirSync(directory).filter((name) => /\.ya?ml$/iu.test(name)).sort()) {
    const path = join(directory, fileName);
    const text = readFileSync(path, 'utf8');
    issues.push(...scanWorkflowText(text, `.github/workflows/${fileName}`));
    if (fileName === 'release.yml') {
      if (!text.includes('P6-003 assert pinned supply-chain inputs')) {
        issues.push('.github/workflows/release.yml: pre-publish supply-chain gate is missing');
      }
      if (!text.includes('node scripts/install-pinned-ossutil.mjs')) {
        issues.push('.github/workflows/release.yml: pinned ossutil installer is missing');
      }
      if (text.includes('https://gosspublic.alicdn.com/ossutil/install.sh')) {
        issues.push('.github/workflows/release.yml: mutable ossutil installer script is forbidden');
      }
    }
  }
  return issues;
}

function validateDownloaderBindings(rootDir) {
  const issues = [];
  for (const fileName of [
    'download-bundled-uv.mjs',
    'download-bundled-agent-browser.mjs',
    'download-bundled-node.mjs',
  ]) {
    const path = join(rootDir, 'scripts', fileName);
    const text = readFileSync(path, 'utf8');
    const label = relative(rootDir, path).replaceAll('\\', '/');
    if (!text.includes('downloadVerifiedAssetToFile')) {
      issues.push(`${label}: verified download helper is missing`);
    }
    if (!text.includes('getReleaseAsset')) {
      issues.push(`${label}: release integrity manifest binding is missing`);
    }
    if (/\bfetch\s*\(/u.test(text)) {
      issues.push(`${label}: direct fetch bypasses integrity verification`);
    }
  }
  return issues;
}

async function runCli() {
  if (process.argv.includes('--self-test-mismatch')) {
    verifyAssetBuffer(
      { name: 'mismatch.bin', size: 3, sha256: '0'.repeat(64) },
      Buffer.from('abc'),
    );
    throw new Error('checksum mismatch self-test unexpectedly passed');
  }
  const result = validateSupplyChainIntegrity();
  if (!result.ok) {
    for (const issue of result.issues) console.error(`[supply-chain-integrity] FAIL: ${issue}`);
    process.exit(1);
  }
  if (process.argv.includes('--probe-live')) await probeLiveSources();
  const assetCount = Object.values(RELEASE_INTEGRITY_MANIFEST.downloads).reduce(
    (total, release) => total + Object.keys(release.assets).length,
    0,
  );
  console.log(
    `[supply-chain-integrity] OK: assets=${assetCount} actions=${Object.keys(RELEASE_INTEGRITY_MANIFEST.githubActions).length}`,
  );
}

async function probeLiveSources() {
  if (process.env.NODE_TLS_REJECT_UNAUTHORIZED === '0') {
    throw new Error('live supply-chain probe requires TLS certificate verification');
  }
  const headers = { Accept: 'application/vnd.github+json', 'User-Agent': 'ClawX-P6-003' };
  for (const [component, repository, tag] of [
    ['uv', 'astral-sh/uv', RELEASE_INTEGRITY_MANIFEST.downloads.uv.version],
    ['agentBrowser', 'vercel-labs/agent-browser', RELEASE_INTEGRITY_MANIFEST.downloads.agentBrowser.version],
  ]) {
    const release = await fetchGitHubJson(
      `https://api.github.com/repos/${repository}/releases/tags/${tag}`,
      headers,
    );
    const upstream = new Map(release.assets.map((asset) => [asset.name, asset]));
    for (const [name, policy] of Object.entries(RELEASE_INTEGRITY_MANIFEST.downloads[component].assets)) {
      const asset = upstream.get(name);
      if (!asset) throw new Error(`GitHub release asset missing: ${repository}/${name}`);
      if (asset.size !== policy.size || asset.digest !== `sha256:${policy.sha256}`) {
        throw new Error(`GitHub release digest mismatch: ${repository}/${name}`);
      }
    }
  }

  const nodeRelease = RELEASE_INTEGRITY_MANIFEST.downloads.node;
  const nodeResponse = await fetch(
    `https://nodejs.org/dist/v${nodeRelease.version}/SHASUMS256.txt`,
  );
  if (!nodeResponse.ok) throw new Error(`Node SHASUMS probe failed: ${nodeResponse.status}`);
  const nodeSums = new Map(
    (await nodeResponse.text())
      .split(/\r?\n/u)
      .map((line) => /^(?<hash>[0-9a-f]{64})\s+(?<name>.+)$/u.exec(line)?.groups)
      .filter(Boolean)
      .map(({ hash, name }) => [name, hash]),
  );
  for (const [name, policy] of Object.entries(nodeRelease.assets)) {
    if (nodeSums.get(name) !== policy.sha256) throw new Error(`Node SHASUM mismatch: ${name}`);
  }

  await fetchVerifiedAsset({
    name: 'ossutil-linux-amd64.zip',
    ...RELEASE_INTEGRITY_MANIFEST.downloads.ossutil.assets['ossutil-linux-amd64.zip'],
  });

  for (const [repository, pin] of Object.entries(RELEASE_INTEGRITY_MANIFEST.githubActions)) {
    const commit = await fetchGitHubJson(
      `https://api.github.com/repos/${repository}/commits/${pin.sha}`,
      headers,
    );
    if (commit.sha !== pin.sha) throw new Error(`Action commit probe failed: ${repository}@${pin.sha}`);
  }
  console.log('[supply-chain-integrity] LIVE: upstream digests, ossutil bytes, and Action commits verified');
}

async function fetchGitHubJson(url, headers) {
  try {
    const response = await fetch(url, { headers });
    if (!response.ok) throw new Error(`status=${response.status}`);
    return await response.json();
  } catch (error) {
    if (process.platform !== 'win32') {
      throw new Error(`GitHub API probe failed for ${url}: ${error instanceof Error ? error.message : error}`);
    }
    const escapedUrl = url.replaceAll("'", "''");
    const command = [
      "$headers=@{Accept='application/vnd.github+json';'User-Agent'='ClawX-P6-003'}",
      `$value=Invoke-RestMethod -Headers $headers -Uri '${escapedUrl}'`,
      '$value | ConvertTo-Json -Depth 20 -Compress',
    ].join('; ');
    const result = spawnSync('powershell.exe', ['-NoProfile', '-Command', command], {
      encoding: 'utf8',
      maxBuffer: 16 * 1024 * 1024,
    });
    if (result.status !== 0) {
      throw new Error(`GitHub API system-proxy fallback failed for ${url}: ${result.stderr || ''}`);
    }
    return JSON.parse(result.stdout);
  }
}

if (isMainEntrypoint(import.meta.url)) {
  runCli().catch((error) => {
    console.error(`[supply-chain-integrity] FAIL: ${error instanceof Error ? error.message : String(error)}`);
    process.exit(1);
  });
}
