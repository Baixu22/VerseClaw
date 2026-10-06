import fs from 'node:fs';
import path from 'node:path';
import { createRequire, isBuiltin } from 'node:module';
import { fileURLToPath } from 'node:url';
import { copyRuntimeDependencies } from './copy-runtime-package.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const source = path.join(root, 'build', 'main-runtime');
const delivery = path.join(root, 'build', 'main-runtime-delivery');
const manifest = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));
const mainDir = path.join(root, 'dist-electron', 'main');
for (const file of fs.readdirSync(mainDir, { recursive: true }).filter((file) => file.endsWith('.js'))) {
  const code = fs.readFileSync(path.join(mainDir, file), 'utf8');
  for (const match of code.matchAll(/\b(?:require|import)\s*\(\s*['"]([^'"]+)['"]/g)) {
    const id = match[1];
    if (id.startsWith('.') || id.startsWith('#') || id.includes(':') || id === 'electron' || id.startsWith('electron/') || id === 'original-fs' || isBuiltin(id)) continue;
    const name = id.startsWith('@') ? id.split('/').slice(0, 2).join('/') : id.split('/')[0];
    if (!manifest.dependencies?.[name]) throw new Error(`Main runtime import must be a production dependency: ${name}`);
  }
}
for (const directory of [source, delivery]) {
  if (path.dirname(directory) !== path.join(root, 'build')) throw new Error('Invalid bundle output');
  fs.rmSync(directory, { recursive: true, force: true });
  fs.mkdirSync(directory, { recursive: true });
}
const copied = copyRuntimeDependencies(root, source, root);
const require = createRequire(path.join(root, 'package.json'));
const builderRequire = createRequire(require.resolve('electron-builder'));
const { createPackageWithOptions, listPackage, statFile } = builderRequire('@electron/asar');
// Native binaries remain beside the archive; all JS is covered by the extra
// ASAR integrity entry electron-builder embeds before afterPack/signing.
const archive = path.join(delivery, 'main-runtime.asar');
await createPackageWithOptions(source, archive, {
  // matchBase avoids excluding checkouts underneath hidden folders like .codex.
  unpack: '*.{node,dll,exe,so,dylib}',
});
const nativeFiles = listPackage(archive).filter((file) => /\.(node|dll|exe|so|dylib)$/i.test(file));
for (const file of nativeFiles) {
  const relative = file.replace(/^[/\\]+/, '');
  if (!statFile(archive, relative).unpacked || !fs.existsSync(path.join(archive + '.unpacked', relative))) {
    throw new Error(`Native Main dependency was not unpacked: ${relative}`);
  }
}
console.log(`Main runtime archive: ${copied} installed packages, ${nativeFiles.length} verified native companions.`);
