// @vitest-environment node
import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { afterEach, expect, it } from 'vitest';

const roots: string[] = [];
const runtime = path.resolve('openclaw_runtime/src');
const hash = (bytes: Buffer | string) => createHash('sha256').update(bytes).digest('hex');
type CacheFile = { name: string; bytes: number; sha256: string };
type CacheProof = {
  cacheDir: string | null;
  before: CacheFile[];
  after: CacheFile[];
  result: number;
  node: string;
};

afterEach(() => {
  for (const root of roots.splice(0)) {
    expect(path.dirname(path.resolve(root))).toBe(path.resolve(tmpdir()));
    fs.rmSync(root, { recursive: true, force: true });
  }
});

function cacheFiles(directory: string | null): CacheFile[] {
  return directory ? fs.readdirSync(directory).sort().map(name => {
    const bytes = fs.readFileSync(path.join(directory, name));
    return { name, bytes: bytes.length, sha256: hash(bytes) };
  }) : [];
}

const checkpoints = [
  { name: 'command', file: 'agents/command/attempt-execution.runtime.ts', backends: ['./attempt-execution.js'], helper: '../../infra/runtime-compile-cache.js', entry: 'runAgentAttempt' },
  { name: 'embedded', file: 'agents/embedded-agent-runner/run/attempt.runtime.ts', backends: ['./attempt.js'], helper: '../../../infra/runtime-compile-cache.js', entry: 'runEmbeddedAttempt' },
  { name: 'selection', file: 'agents/harness/selection.runtime.ts', backends: ['./context-engine-lifecycle.js', './lifecycle.js'], helper: '../../infra/runtime-compile-cache.js', entry: 'runAgentHarnessLifecycleAttempt' },
] as const;

async function interruptLateRuntime(mode: 'enabled' | 'disabled' | 'unavailable' | 'unsupported', checkpoint: typeof checkpoints[number]) {
  const root = fs.mkdtempSync(path.join(tmpdir(), 'g3-late-cache-'));
  roots.push(root);
  const source = fs.readFileSync(path.join(runtime, checkpoint.file), 'utf8');
  const backend = path.join(root, 'backend.mjs');
  const exports = [...source.matchAll(/export\s*\{([^}]+)\}\s*from\s*"[^"]+"/gs)]
    .flatMap(match => match[1].split(',').map(value => value.trim()).filter(Boolean));
  expect(exports?.length).toBeGreaterThan(0);
  fs.writeFileSync(backend, exports!.map(name => `export function ${name}() { return 42; }`).join('\n'));
  let helper = path.join(runtime, 'infra/runtime-compile-cache.ts');
  if (mode === 'unsupported') {
    const missingApi = path.join(root, 'optional-module-api.mjs');
    fs.writeFileSync(missingApi, 'export {};');
    const helperSource = fs.readFileSync(helper, 'utf8');
    helper = path.join(root, 'runtime-compile-cache.ts');
    // Reproduce Bun's missing flush API with real ESM linking, preserving the
    // production helper body so a named-import regression fails this check.
    fs.writeFileSync(helper, helperSource.replace(/(['"])node:module\1/, JSON.stringify(pathToFileURL(missingApi).href)));
  }
  // Keep the production barrel body; redirect only its backend dependency so
  // the cache boundary can be tested without starting a provider or agent.
  let barrel = source.replace(checkpoint.helper, pathToFileURL(helper).href);
  for (const dependency of checkpoint.backends) barrel = barrel.replace(dependency, pathToFileURL(backend).href);
  const barrelFile = path.join(root, 'attempt-runtime.mjs');
  fs.writeFileSync(barrelFile, barrel);
  const cache = path.join(root, 'cache');
  if (mode === 'unavailable') fs.writeFileSync(cache, 'not a directory');
  const ready = path.join(root, 'ready.json');
  const bootstrap = path.join(root, 'bootstrap.mjs');
  fs.writeFileSync(bootstrap, `
    import { flushCompileCache, getCompileCacheDir } from 'node:module';
    import fs from 'node:fs';
    import { createHash } from 'node:crypto';
    import path from 'node:path';
    flushCompileCache();
    const cacheDir = getCompileCacheDir() ?? null;
    const files = () => cacheDir ? fs.readdirSync(cacheDir).sort().map(name => {
      const bytes = fs.readFileSync(path.join(cacheDir, name));
      return { name, bytes: bytes.length, sha256: createHash('sha256').update(bytes).digest('hex') };
    }) : [];
    const before = files();
    const late = await import(${JSON.stringify(pathToFileURL(barrelFile).href)});
    fs.writeFileSync(${JSON.stringify(ready + '.tmp')}, JSON.stringify({
      cacheDir, before, after: files(), result: late[${JSON.stringify(checkpoint.entry)}](), node: process.version,
    }));
    fs.renameSync(${JSON.stringify(ready + '.tmp')}, ${JSON.stringify(ready)});
    setInterval(() => {}, 1000);
  `);
  const inherited = Object.fromEntries(Object.entries(process.env).filter(([key]) =>
    ['PATH', 'PATHEXT', 'SYSTEMROOT', 'WINDIR', 'COMSPEC'].includes(key.toUpperCase())));
  const child = spawn(process.execPath, [bootstrap], {
    cwd: root, windowsHide: true, stdio: ['ignore', 'ignore', 'pipe'],
    env: { ...inherited, TEMP: tmpdir(), TMP: tmpdir(), NODE_COMPILE_CACHE: cache,
      NODE_DISABLE_COMPILE_CACHE: mode === 'disabled' || mode === 'unsupported' ? '1' : undefined },
  });
  let stderr = '';
  child.stderr.on('data', data => { stderr += String(data); });
  let spawnError: Error | undefined;
  const exit = new Promise(resolve => {
    child.once('exit', (code, signal) => resolve({ code, signal }));
    child.once('error', error => { spawnError = error; resolve({ error: String(error) }); });
  });
  let proof: CacheProof | undefined;
  try {
    const deadline = Date.now() + 10_000;
    while (!fs.existsSync(ready) && !spawnError && child.exitCode === null && Date.now() < deadline) {
      await new Promise(resolve => setTimeout(resolve, 25));
    }
    expect(fs.existsSync(ready), spawnError?.message ?? stderr).toBe(true);
    proof = JSON.parse(fs.readFileSync(ready, 'utf8')) as CacheProof;
  } finally {
    child.kill('SIGKILL');
    await exit;
  }
  if (!proof) throw new Error('Late runtime did not report its cache state');
  const afterKill = cacheFiles(proof.cacheDir);
  expect(afterKill).toEqual(proof.after);
  expect(proof.result).toBe(42);
  const readback = {
    schema: 'LateRuntimeBytecodeCacheProof/v1', mode, checkpoint: checkpoint.name, pid: child.pid, exit: await exit,
    sourceSha256: hash(source), ...proof, afterKill,
    apiBasis: mode === 'unsupported' ? 'agent-driven missing-API fixture' : 'native-node',
    driven_by: 'agent', actor: 'gateway-late-bytecode-cache-test', realHumanEvidence: false,
  };
  if (process.env.CLAWX_TEST_EVIDENCE_DIR) {
    const evidence = path.join(process.env.CLAWX_TEST_EVIDENCE_DIR, checkpoint.name + '-' + mode + '-' + child.pid);
    fs.cpSync(root, path.join(evidence, 'fixture'), { recursive: true, errorOnExist: true, force: false });
    fs.writeFileSync(path.join(evidence, 'readback.json'), JSON.stringify(readback, null, 2), { flag: 'wx' });
  }
  return proof;
}

it.each(checkpoints)('$name retains its late runtime bytecode across a real process kill', async checkpoint => {
  const proof = await interruptLateRuntime('enabled', checkpoint);
  expect(proof.cacheDir).toBeTruthy();
  expect(proof.after.length).toBeGreaterThan(proof.before.length);
}, 15_000);

const cacheFallbackCases = checkpoints.flatMap(checkpoint =>
  (['disabled', 'unavailable', 'unsupported'] as const).map(mode => ({ checkpoint, name: checkpoint.name, mode })));
it.each(cacheFallbackCases)('$name keeps execution usable when the cache is $mode', async ({ checkpoint, mode }) => {
  const proof = await interruptLateRuntime(mode, checkpoint);
  expect(proof.cacheDir).toBeNull();
  expect(proof.after).toEqual([]);
}, 15_000);
