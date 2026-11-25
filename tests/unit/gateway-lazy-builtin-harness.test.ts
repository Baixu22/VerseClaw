// @vitest-environment node
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { tmpdir } from 'node:os';
import { pathToFileURL } from 'node:url';
import { transformWithEsbuild } from 'vite';
import { expect, it } from 'vitest';

it('keeps built-in harness metadata lazy and forwards execution identity, results and errors', async () => {
  const root = fs.mkdtempSync(path.join(tmpdir(), 'g3-lazy-harness-'));
  if (path.dirname(path.resolve(root)) !== path.resolve(tmpdir())) throw new Error('Unexpected fixture root');
  try {
    const host = path.join(root, 'host.mjs');
    fs.writeFileSync(host, 'export const OPENCLAW_EMBEDDED_CONTEXT_ENGINE_HOST = { capabilities: globalThis.capabilities };');
    const backend = path.join(root, 'backend.mjs');
    fs.writeFileSync(backend, `
      globalThis.loads++;
      globalThis.events.push('load');
      export async function runEmbeddedAttempt(params) {
        globalThis.events.push('run');
        globalThis.calls.push(params);
        if (params.fail) throw globalThis.backendError;
        return globalThis.backendResult;
      }
    `);
    const cache = path.join(root, 'cache.mjs');
    fs.writeFileSync(cache, "export function flushRuntimeCompileCache() { globalThis.events.push('flush'); }");
    const barrelPath = path.resolve('openclaw_runtime/src/agents/embedded-agent-runner/run/attempt.runtime.ts');
    const barrel = fs.readFileSync(barrelPath, 'utf8')
      .replace('./attempt.js', pathToFileURL(backend).href)
      .replace('../../../infra/runtime-compile-cache.js', pathToFileURL(cache).href);
    const barrelFile = path.join(root, 'attempt-runtime.mjs');
    fs.writeFileSync(barrelFile, (await transformWithEsbuild(barrel, barrelPath, { target: 'node22', format: 'esm' })).code);
    const sourcePath = path.resolve('openclaw_runtime/src/agents/harness/builtin-openclaw.ts');
    const source = fs.readFileSync(sourcePath, 'utf8')
      .replace('../../context-engine/host-compat.js', pathToFileURL(host).href)
      .replace('../embedded-agent-runner/run/attempt.runtime.js', pathToFileURL(barrelFile).href)
      .replace('../embedded-agent-runner/run/attempt.js', pathToFileURL(backend).href);
    const compiled = await transformWithEsbuild(source, sourcePath, { target: 'node22', format: 'esm' });
    const harnessFile = path.join(root, 'harness.mjs');
    fs.writeFileSync(harnessFile, compiled.code);
    const bootstrap = path.join(root, 'bootstrap.mjs');
    fs.writeFileSync(bootstrap, `
      import assert from 'node:assert/strict';
      globalThis.loads = 0;
      globalThis.calls = [];
      globalThis.events = [];
      globalThis.capabilities = ['bootstrap'];
      globalThis.backendResult = { aborted: false, messages: [] };
      globalThis.backendError = new Error('backend failed');
      const { createOpenClawAgentHarness } = await import(${JSON.stringify(pathToFileURL(harnessFile).href)});
      const harness = createOpenClawAgentHarness();
      assert.equal(harness.id, 'openclaw');
      assert.equal(harness.contextEngineHostCapabilities, globalThis.capabilities);
      assert.deepEqual(harness.supports({ provider: 'fixture', requestedRuntime: 'openclaw' }), { supported: true, priority: 0 });
      assert.equal(globalThis.loads, 0, 'Runtime loaded during metadata');
      assert.deepEqual(globalThis.events, []);
      const params = Object.freeze({ runId: 'first' });
      assert.equal(await harness.runAttempt(params), globalThis.backendResult);
      assert.equal(globalThis.calls[0], params);
      assert.equal(globalThis.loads, 1);
      assert.deepEqual(globalThis.events, ['load', 'flush', 'run']);
      const second = Object.freeze({ runId: 'second' });
      assert.equal(await createOpenClawAgentHarness().runAttempt(second), globalThis.backendResult);
      assert.equal(globalThis.calls[1], second);
      assert.equal(globalThis.loads, 1);
      await assert.rejects(harness.runAttempt({ fail: true }), error => error === globalThis.backendError);
      assert.equal(globalThis.loads, 1);
      assert.deepEqual(globalThis.events, ['load', 'flush', 'run', 'run', 'run']);
      console.log(JSON.stringify({ loads: globalThis.loads, calls: globalThis.calls.length, metadataLazy: true, executionIdentityPreserved: true,
        checkpointBeforeRun: true, driven_by: 'agent', actor: 'gateway-lazy-builtin-harness-test', realHumanEvidence: false }));
    `);
    const run = () => spawnSync(process.execPath, [bootstrap], {
      cwd: root, windowsHide: true, timeout: 10_000, encoding: 'utf8',
      env: { ...process.env, TEMP: tmpdir(), TMP: tmpdir() },
    });
    const healthy = run();
    expect(healthy.error).toBeUndefined();
    expect(healthy.status, healthy.stderr).toBe(0);
    expect(JSON.parse(healthy.stdout)).toEqual({ loads: 1, calls: 3, metadataLazy: true, executionIdentityPreserved: true,
      checkpointBeforeRun: true, driven_by: 'agent', actor: 'gateway-lazy-builtin-harness-test', realHumanEvidence: false });
    const eagerSource = `import { runEmbeddedAttempt as unusedAttempt } from ${JSON.stringify(pathToFileURL(backend).href)};\n${source}`;
    fs.writeFileSync(harnessFile, (await transformWithEsbuild(eagerSource, sourcePath, { target: 'node22', format: 'esm' })).code);
    const eager = run();
    expect(eager.error).toBeUndefined();
    expect(eager.status).toBe(1);
    expect(eager.stderr).toContain('Runtime loaded during metadata');
    fs.writeFileSync(harnessFile, compiled.code);
    if (process.env.CLAWX_TEST_EVIDENCE_DIR) {
      fs.cpSync(root, path.join(process.env.CLAWX_TEST_EVIDENCE_DIR, path.basename(root)), { recursive: true, force: false, errorOnExist: true });
      fs.writeFileSync(path.join(process.env.CLAWX_TEST_EVIDENCE_DIR, path.basename(root), 'readback.json'), JSON.stringify({
        schema: 'BuiltinHarnessLazyLoadingProof/v1', healthy: JSON.parse(healthy.stdout), eager: { status: eager.status, stderr: eager.stderr },
        driven_by: 'agent', actor: 'gateway-lazy-builtin-harness-test', realHumanEvidence: false,
      }, null, 2), { flag: 'wx' });
    }
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});
