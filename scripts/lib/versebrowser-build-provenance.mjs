import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { readFile, readdir } from 'node:fs/promises';
import path from 'node:path';

export const PROVENANCE_PATH = 'dist-electron/versebrowser-build-provenance.json';
export const PRODUCT_SOURCE_SCOPE = [
  'electron', 'shared', 'src', 'packages/versebrowser', 'package.json', 'pnpm-lock.yaml',
  'vite.config.ts', 'electron-builder.yml', 'scripts/generate-ext-bridge.mjs',
  'scripts/sync-lobe-icons.mjs', 'scripts/versebrowser-build-provenance.mjs',
  'scripts/lib/versebrowser-build-provenance.mjs',
  'scripts/build-versebrowser.mjs',
  'scripts/lib/consolidated-icons.mjs', 'scripts/lib/consolidated-icons.d.mts',
];
export const COMPILED_ROOTS = [
  { archive: 'app.asar', source: 'dist', prefix: 'dist/' },
  { archive: 'app.asar', source: 'dist-electron', prefix: 'dist-electron/' },
  { archive: 'main-runtime.asar', source: 'packages/versebrowser/dist', prefix: 'node_modules/@verse-claw/versebrowser/dist/' },
  // electron-builder omits dependency declarations from app.asar. The complete
  // main-runtime copy above still binds them; all executable outputs stay bound.
  { archive: 'app.asar', source: 'packages/versebrowser/dist', prefix: 'node_modules/@verse-claw/versebrowser/dist/', omitDeclarations: true },
];
export const sha256 = value => createHash('sha256').update(value).digest('hex');

export function snapshotBuildSource(root) {
  const git = args => execFileSync('git', args, {cwd:root,encoding:'utf8',windowsHide:true}).trim();
  return {
    sourceCommit: git(['rev-parse','HEAD']), sourceTree: git(['rev-parse','HEAD^{tree}']),
    dirty: Boolean(git(['status','--porcelain=v1','--',...PRODUCT_SOURCE_SCOPE])),
  };
}

export async function collectCompiledOutputs(root) {
  const outputs = [];
  async function visit(mapping, relative = '') {
    for (const entry of await readdir(path.join(root,mapping.source,relative),{withFileTypes:true})) {
      const file = relative + entry.name;
      if (entry.isDirectory()) await visit(mapping,file+'/');
      else if (entry.isFile() && mapping.prefix+file !== PROVENANCE_PATH && !(mapping.omitDeclarations && file.endsWith('.d.ts'))) {
        outputs.push({archive:mapping.archive,path:mapping.prefix+file,sha256:sha256(await readFile(path.join(root,mapping.source,file)))});
      }
    }
  }
  for (const mapping of COMPILED_ROOTS) await visit(mapping);
  return outputs.sort((a,b)=>(a.archive+'/'+a.path).localeCompare(b.archive+'/'+b.path));
}

export function validBuildProvenance(value) {
  return value?.schemaVersion === 1 && value.scope === 'versebrowser-desktop-build-v1'
    && value.status === 'bound' && value.dirty === false && value.driven_by === 'agent'
    && typeof value.actor === 'string' && value.actor.length > 0 && /^[a-f0-9]{40}$/.test(value.sourceCommit)
    && /^[a-f0-9]{40}$/.test(value.sourceTree) && Array.isArray(value.outputs) && value.outputs.length > 0
    && value.outputs.every(output => output && typeof output.path === 'string' && COMPILED_ROOTS.some(root => root.archive === output.archive && output.path.startsWith(root.prefix))
      && !output.path.includes('\\') && !output.path.split('/').includes('..') && /^[a-f0-9]{64}$/.test(output.sha256))
    && [['app.asar','dist/index.html'],['app.asar','dist-electron/main/index.js'],['main-runtime.asar','node_modules/@verse-claw/versebrowser/dist/engine/service.js']].every(([archive,file])=>value.outputs.some(output=>output.archive===archive && output.path===file));
}
