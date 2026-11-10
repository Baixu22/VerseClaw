import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

export type ProductCandidateIdentity = { commit: string; tree: string; dirty: boolean };
export type ProductBuildCommand = {
  command: string[];
  exitCode: number | null;
  candidate: ProductCandidateIdentity;
};
export type FreshProductBuildProof = {
  schema: 'TF0580FreshBuild/v1';
  candidate: ProductCandidateIdentity;
  inputDigest: string;
  buildCommands: ProductBuildCommand[];
};

export function readProductCandidate(root = process.cwd()) {
  const git = (...args: string[]) => execFileSync('git', args, {
    cwd: root, encoding: 'utf8', windowsHide: true, maxBuffer: 16 * 1024 * 1024,
  }).trim();
  const commit = git('rev-parse', 'HEAD');
  const tree = git('rev-parse', 'HEAD^{tree}');
  const dirty = git('status', '--porcelain').length > 0;
  const files: Array<{ path: string; sha256: string; bytes: number }> = [];
  const sources = git('ls-files', '-z').split('\0').filter(file =>
    /^(?:src\/|electron\/|shared\/|openclaw_runtime\/(?:src|packages)\/|tests\/e2e\/fixtures\/)/.test(file)
    || /^(?:package.json|pnpm-lock.yaml|vite.config.ts|playwright.config.ts|openclaw_runtime\/(?:package.json|pnpm-lock.yaml|tsdown.config.ts))$/.test(file));
  sources.push('tests/e2e/product-acceptance-space-bunny.spec.ts', 'tests/e2e/fixtures/space-bunny-responses.ts',
    'harness/specs/tasks/product-acceptance-space-bunny.md', 'harness/specs/tasks/product-acceptance-closeout.md');
  const addFile = (file: string) => {
    const bytes = readFileSync(join(root, file));
    files.push({ path: file.replaceAll('\\', '/'), sha256: createHash('sha256').update(bytes).digest('hex'), bytes: bytes.length });
  };
  for (const file of [...new Set(sources)].sort()) addFile(file);
  const sourceCount = files.length;
  const walk = (directory: string) => {
    for (const entry of readdirSync(join(root, directory), { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
      const file = join(directory, entry.name);
      if (entry.isDirectory()) walk(file);
      else if (entry.isFile()) addFile(file);
    }
  };
  for (const directory of ['dist', 'dist-electron', 'openclaw_runtime/dist', 'openclaw_runtime/dist-runtime']) walk(directory);
  const buildCount = files.length - sourceCount;
  const resourceStart = files.length;
  for (const file of ['resources/verseshell/manifest.json', 'resources/versegit/manifest.json',
    'resources/bin/win32-x64/ae.exe', 'resources/bin/win32-x64/vg.exe']) {
    if (existsSync(join(root, file))) addFile(file);
  }
  return { commit, tree, dirty, sourceCount, buildCount, resourceCount: files.length - resourceStart,
    runtimeBuildStamp: JSON.parse(readFileSync(join(root, 'openclaw_runtime/dist/.buildstamp'), 'utf8')) as { head: string },
    inputDigest: createHash('sha256').update(JSON.stringify(files)).digest('hex'), files };
}

export function assertFreshProductBuildProof(proof: unknown,
  binding: ProductCandidateIdentity & { inputDigest: string }): asserts proof is FreshProductBuildProof {
  assert.equal(binding.dirty, false, 'Fresh-build proof requires a clean candidate');
  assert(proof && typeof proof === 'object', 'Fresh-build proof is missing');
  const value = proof as FreshProductBuildProof;
  assert.equal(value.schema, 'TF0580FreshBuild/v1');
  const candidate = { commit: binding.commit, tree: binding.tree, dirty: false };
  assert.deepEqual(value.candidate, candidate, 'Fresh-build candidate does not match');
  assert.equal(value.inputDigest, binding.inputDigest, 'Fresh-build inputs changed');
  assert(Array.isArray(value.buildCommands), 'Fresh-build commands are missing');
  assert.deepEqual(value.buildCommands.map(command => command.command), [
    ['pnpm', 'run', 'build:vite'], ['pnpm', 'run', 'build:runtime'],
  ], 'Fresh-build commands do not match');
  for (const command of value.buildCommands) {
    assert.equal(command.exitCode, 0, 'Fresh-build command failed');
    assert.deepEqual(command.candidate, candidate, 'Build command candidate does not match');
  }
}

export function createFreshProductBuildProof(binding: ProductCandidateIdentity & { inputDigest: string },
  buildCommands: ProductBuildCommand[]): FreshProductBuildProof {
  const proof: FreshProductBuildProof = { schema: 'TF0580FreshBuild/v1',
    candidate: { commit: binding.commit, tree: binding.tree, dirty: binding.dirty },
    inputDigest: binding.inputDigest, buildCommands };
  assertFreshProductBuildProof(proof, binding);
  return proof;
}
