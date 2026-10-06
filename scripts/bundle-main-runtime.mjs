import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { copyRuntimeDependencies } from './copy-runtime-package.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const source = path.join(root, 'build', 'main-runtime');
const delivery = path.join(root, 'build', 'main-runtime-delivery');
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
