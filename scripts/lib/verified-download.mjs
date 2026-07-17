import { createHash, randomUUID } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';

export class ReleaseIntegrityError extends Error {
  constructor(code, message) {
    super(message);
    this.name = 'ReleaseIntegrityError';
    this.code = code;
  }
}

export function verifyAssetBuffer(asset, input) {
  const buffer = Buffer.isBuffer(input) ? input : Buffer.from(input);
  if (!asset || typeof asset !== 'object') {
    throw new ReleaseIntegrityError('ERR_RELEASE_ASSET_MISSING', 'release asset policy is missing');
  }
  if (!Number.isSafeInteger(asset.size) || asset.size <= 0) {
    throw new ReleaseIntegrityError('ERR_RELEASE_ASSET_SIZE_POLICY', `invalid size policy for ${asset.name}`);
  }
  if (!/^[0-9a-f]{64}$/u.test(asset.sha256 || '')) {
    throw new ReleaseIntegrityError('ERR_RELEASE_ASSET_HASH_POLICY', `invalid SHA256 policy for ${asset.name}`);
  }
  if (buffer.length !== asset.size) {
    throw new ReleaseIntegrityError(
      'ERR_RELEASE_ASSET_SIZE_MISMATCH',
      `size mismatch for ${asset.name}: expected=${asset.size} actual=${buffer.length}`,
    );
  }
  const actualSha256 = createHash('sha256').update(buffer).digest('hex');
  if (actualSha256 !== asset.sha256) {
    throw new ReleaseIntegrityError(
      'ERR_RELEASE_ASSET_HASH_MISMATCH',
      `SHA256 mismatch for ${asset.name}: expected=${asset.sha256} actual=${actualSha256}`,
    );
  }
  return { buffer, size: buffer.length, sha256: actualSha256 };
}

export async function fetchVerifiedAsset(
  asset,
  {
    fetchImpl = globalThis.fetch,
    tlsRejectUnauthorized = process.env.NODE_TLS_REJECT_UNAUTHORIZED,
    systemProxyFetch = process.platform === 'win32' ? fetchWithWindowsSystemProxy : null,
  } = {},
) {
  if (tlsRejectUnauthorized === '0') {
    throw new ReleaseIntegrityError(
      'ERR_RELEASE_TLS_VERIFICATION_DISABLED',
      'release downloads require TLS certificate verification',
    );
  }
  const source = assertHttps(asset.url, 'release asset source');
  if (typeof fetchImpl !== 'function') {
    throw new ReleaseIntegrityError('ERR_RELEASE_FETCH_UNAVAILABLE', 'fetch implementation is unavailable');
  }
  let response;
  try {
    response = await fetchImpl(source, { redirect: 'follow' });
  } catch (error) {
    if (!systemProxyFetch) throw error;
    const fallback = await systemProxyFetch(source);
    if (!fallback.url) {
      throw new ReleaseIntegrityError(
        'ERR_RELEASE_TLS_REQUIRED',
        'Windows system-proxy download did not report its final HTTPS URL',
      );
    }
    assertHttps(fallback.url, 'release asset response');
    return verifyAssetBuffer(asset, fallback.buffer);
  }
  if (!response.ok) {
    throw new ReleaseIntegrityError(
      'ERR_RELEASE_DOWNLOAD_FAILED',
      `download failed for ${asset.name}: ${response.status} ${response.statusText}`,
    );
  }
  if (response.url) assertHttps(response.url, 'release asset response');
  const contentLength = response.headers?.get?.('content-length');
  if (contentLength && Number(contentLength) !== asset.size) {
    throw new ReleaseIntegrityError(
      'ERR_RELEASE_ASSET_SIZE_MISMATCH',
      `Content-Length mismatch for ${asset.name}: expected=${asset.size} actual=${contentLength}`,
    );
  }
  return verifyAssetBuffer(asset, Buffer.from(await response.arrayBuffer()));
}

async function fetchWithWindowsSystemProxy(url) {
  const temporary = join(tmpdir(), `clawx-release-download-${randomUUID()}.bin`);
  const escapedUrl = url.replaceAll("'", "''");
  const escapedPath = temporary.replaceAll("'", "''");
  const command = [
    "$ErrorActionPreference='Stop'",
    `$response=Invoke-WebRequest -UseBasicParsing -Uri '${escapedUrl}' -OutFile '${escapedPath}'`,
    '@{status=[int]$response.StatusCode;url=$response.BaseResponse.ResponseUri.AbsoluteUri} | ConvertTo-Json -Compress',
  ].join('; ');
  try {
    const result = spawnSync('powershell.exe', ['-NoProfile', '-Command', command], {
      encoding: 'utf8',
      maxBuffer: 1024 * 1024,
      timeout: 5 * 60 * 1000,
    });
    if (result.status !== 0) {
      throw new ReleaseIntegrityError(
        'ERR_RELEASE_SYSTEM_PROXY_DOWNLOAD_FAILED',
        `Windows system-proxy download failed: ${result.stderr || result.stdout || ''}`,
      );
    }
    const metadata = JSON.parse(result.stdout);
    if (metadata.status > 0 && (metadata.status < 200 || metadata.status >= 300)) {
      throw new ReleaseIntegrityError(
        'ERR_RELEASE_SYSTEM_PROXY_DOWNLOAD_FAILED',
        `Windows system-proxy download returned status=${metadata.status}`,
      );
    }
    return { buffer: await readFile(temporary), url: metadata.url };
  } finally {
    await rm(temporary, { force: true });
  }
}

export async function downloadVerifiedAssetToFile(asset, destination, options = {}) {
  const temporary = `${destination}.part-${process.pid}`;
  await mkdir(dirname(destination), { recursive: true });
  await rm(destination, { force: true });
  await rm(temporary, { force: true });
  try {
    const verified = await fetchVerifiedAsset(asset, options);
    await writeFile(temporary, verified.buffer);
    await rename(temporary, destination);
    return { path: destination, size: verified.size, sha256: verified.sha256 };
  } catch (error) {
    await rm(temporary, { force: true });
    await rm(destination, { force: true });
    throw error;
  }
}

function assertHttps(value, label) {
  let parsed;
  try {
    parsed = new URL(value);
  } catch {
    throw new ReleaseIntegrityError('ERR_RELEASE_SOURCE_INVALID', `${label} is not a valid URL`);
  }
  if (parsed.protocol !== 'https:' || parsed.username || parsed.password) {
    throw new ReleaseIntegrityError(
      'ERR_RELEASE_SOURCE_UNTRUSTED',
      `${label} must be HTTPS without embedded credentials`,
    );
  }
  return parsed.toString();
}
