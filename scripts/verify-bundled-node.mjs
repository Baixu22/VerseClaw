import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { join } from 'node:path';
import { getReleaseComponent } from './release-integrity-manifest.mjs';

// Reuse the packager's declared semver dependency without relying on hoisting.
const require = createRequire(import.meta.url);
const semver = createRequire(require.resolve('electron-builder/package.json'))('semver');

// The receipt is written only after extracting a checksum-verified Node archive.
// Hash the delivered executable, so editing the pin cannot bless a stale binary.
export function verifyBundledNode(resourcesDir, arch, platform = 'win32') {
  const receipt = JSON.parse(readFileSync(join(resourcesDir, 'bin', 'node-runtime.json'), 'utf8'));
  const binary = readFileSync(join(resourcesDir, 'bin', platform === 'win32' ? 'node.exe' : 'node'));
  const required = JSON.parse(readFileSync(join(resourcesDir, 'openclaw-runtime', 'package.json'), 'utf8')).engines.node;
  if (receipt.version !== getReleaseComponent('node').version || receipt.target !== `${platform}-${arch}` ||
      receipt.sha256 !== createHash('sha256').update(binary).digest('hex')) {
    throw new Error('Bundled Node receipt does not match the pinned version, target or delivered binary; run the target node:download command.');
  }
  if (!semver.satisfies(receipt.version, required)) {
    throw new Error(`Bundled Node ${receipt.version} does not satisfy runtime ${required}`);
  }
  return { version: receipt.version, required, sha256: receipt.sha256, target: receipt.target };
}
