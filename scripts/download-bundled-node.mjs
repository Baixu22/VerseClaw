#!/usr/bin/env zx

import 'zx/globals';
import { createHash, randomUUID } from 'node:crypto';
import { downloadVerifiedAssetToFile } from './lib/verified-download.mjs';
import { getReleaseAsset, getReleaseComponent } from './release-integrity-manifest.mjs';

const ROOT_DIR = path.resolve(__dirname, '..');
const NODE_VERSION = getReleaseComponent('node').version;
const OUTPUT_BASE = path.join(ROOT_DIR, 'resources', 'bin');

const TARGETS = {
  'win32-x64': {
    filename: `node-v${NODE_VERSION}-win-x64.zip`,
    sourceDir: `node-v${NODE_VERSION}-win-x64`,
  },
  'win32-arm64': {
    filename: `node-v${NODE_VERSION}-win-arm64.zip`,
    sourceDir: `node-v${NODE_VERSION}-win-arm64`,
  },
  'darwin-x64': { filename: `node-v${NODE_VERSION}-darwin-x64.tar.gz`, sourceDir: `node-v${NODE_VERSION}-darwin-x64` },
  'darwin-arm64': { filename: `node-v${NODE_VERSION}-darwin-arm64.tar.gz`, sourceDir: `node-v${NODE_VERSION}-darwin-arm64` },
  'linux-x64': { filename: `node-v${NODE_VERSION}-linux-x64.tar.xz`, sourceDir: `node-v${NODE_VERSION}-linux-x64` },
  'linux-arm64': { filename: `node-v${NODE_VERSION}-linux-arm64.tar.xz`, sourceDir: `node-v${NODE_VERSION}-linux-arm64` },
};

const PLATFORM_GROUPS = {
  win: ['win32-x64', 'win32-arm64'],
  mac: ['darwin-x64', 'darwin-arm64'],
  linux: ['linux-x64', 'linux-arm64'],
};

async function setupTarget(id) {
  const target = TARGETS[id];
  if (!target) {
    echo(chalk.yellow`⚠️ Target ${id} is not supported by this script.`);
    return;
  }

  const targetDir = path.join(OUTPUT_BASE, id);
  if (os.platform() === 'win32') { process.env.TEMP = 'D:/tmp'; process.env.TMP = 'D:/tmp'; }
  await fs.ensureDir(os.tmpdir());
  const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'clawx-node-'));
  const archivePath = path.join(tempDir, target.filename);
  const integrityAsset = getReleaseAsset('node', target.filename);
  const downloadUrl = integrityAsset.url;

  echo(chalk.blue`\n📦 Setting up Node.js for ${id}...`);

  const binaryName = id.startsWith('win32-') ? 'node.exe' : 'node';
  const outputNode = path.join(targetDir, binaryName);
  await fs.ensureDir(targetDir);
  await fs.ensureDir(tempDir);

  try {
    echo`⬇️ Downloading: ${downloadUrl}`;
    await downloadVerifiedAssetToFile(integrityAsset, archivePath);

    echo`📂 Extracting...`;
    if (!target.filename.endsWith('.zip')) {
      const { execFileSync } = await import('node:child_process');
      execFileSync('tar', ['-xf', archivePath, '-C', tempDir], { stdio: 'inherit', windowsHide: true });
    } else if (os.platform() === 'win32') {
      const { execFileSync } = await import('child_process');
      const psCommand = `Add-Type -AssemblyName System.IO.Compression.FileSystem; [System.IO.Compression.ZipFile]::ExtractToDirectory('${archivePath.replace(/'/g, "''")}', '${tempDir.replace(/'/g, "''")}')`;
      execFileSync('powershell.exe', ['-NoProfile', '-Command', psCommand], { stdio: 'inherit', windowsHide: true });
    } else {
      await $`unzip -q -o ${archivePath} -d ${tempDir}`;
    }

    const expectedNode = path.join(tempDir, target.sourceDir, ...(binaryName === 'node' ? ['bin'] : []), binaryName);
    if (!await fs.pathExists(expectedNode)) throw new Error('Pinned Node archive lacks its declared executable');
    const staged = outputNode + '.pending-' + randomUUID();
    await fs.copy(expectedNode, staged, { overwrite: false, errorOnExist: true });
    if (binaryName === 'node') await fs.chmod(staged, 0o755);
    await fs.rename(staged, outputNode);

    echo(chalk.green`✅ Success: ${outputNode}`);
    await fs.writeJson(path.join(targetDir, 'node-runtime.json'), {
      version: NODE_VERSION,
      target: id,
      sha256: createHash('sha256').update(await fs.readFile(outputNode)).digest('hex'),
    }, { spaces: 2 });
  } finally {
    if (path.dirname(path.resolve(tempDir)) !== path.resolve(os.tmpdir()) || !path.basename(tempDir).startsWith('clawx-node-'))
      throw new Error('Node temporary cleanup escaped its owned directory');
    await fs.remove(tempDir);
  }
}

const downloadAll = argv.all;
const platform = argv.platform;

if (downloadAll) {
  echo(chalk.cyan`🌐 Downloading Node.js binaries for all release targets...`);
  for (const id of Object.keys(TARGETS)) {
    await setupTarget(id);
  }
} else if (platform) {
  const targets = PLATFORM_GROUPS[platform];
  if (!targets) {
    echo(chalk.red`❌ Unknown platform: ${platform}`);
    echo(`Available platforms: ${Object.keys(PLATFORM_GROUPS).join(', ')}`);
    process.exit(1);
  }
  echo(chalk.cyan`🎯 Downloading Node.js binaries for platform: ${platform}`);
  for (const id of targets) {
    await setupTarget(id);
  }
} else {
  const currentId = `${os.platform()}-${os.arch()}`;
  if (TARGETS[currentId]) {
    echo(chalk.cyan`💻 Detected system: ${currentId}`);
    await setupTarget(currentId);
  } else {
    throw new Error(`Unsupported Node target: ${currentId}`);
  }
}

echo(chalk.green`\n🎉 Done!`);
