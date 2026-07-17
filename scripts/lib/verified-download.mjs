import { createHash } from 'node:crypto';
import { mkdir, rename, rm, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';

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
  const response = await fetchImpl(source, { redirect: 'follow' });
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
