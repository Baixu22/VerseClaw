import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';

// Resolve the templates used by this electron-builder, including pnpm's
// non-hoisted layout. Patching a guessed root node_modules path can be a no-op.
const require = createRequire(import.meta.url);
const builderRequire = createRequire(require.resolve('electron-builder'));
export const NSIS_TEMPLATE_DIR = join(dirname(builderRequire.resolve('app-builder-lib/package.json')), 'templates', 'nsis');
// NSIS itself is 32-bit; this existing packager binary also runs on x64/ARM64 Windows.
export const NSIS_SEVENZIP_EXE = join(dirname(builderRequire.resolve('7zip-bin/package.json')), 'win', 'ia32', '7za.exe');
