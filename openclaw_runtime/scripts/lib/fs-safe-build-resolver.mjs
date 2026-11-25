import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
// Resolve through package exports when Rolldown misses the installed Windows subpaths.
export const fsSafeExports = {
  name: 'resolve-fs-safe-exports',
  resolveId(id) {
    return id === '@openclaw/fs-safe' || id.startsWith('@openclaw/fs-safe/')
      ? require.resolve(id)
      : null;
  },
};
