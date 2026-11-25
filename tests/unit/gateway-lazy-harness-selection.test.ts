// @vitest-environment node
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { tmpdir } from 'node:os';
import { pathToFileURL } from 'node:url';
import { transformWithEsbuild } from 'vite';
import { expect, it } from 'vitest';

it('defers harness execution wrappers while preserving selection, trace and policy', async () => {
  const directory = fs.mkdtempSync(path.join(tmpdir(), 'g3-harness-selection-'));
  if (path.dirname(path.resolve(directory)) !== path.resolve(tmpdir())) throw new Error('Unexpected fixture root');
  try {
    const metadata = path.join(directory, 'metadata.mjs');
    fs.writeFileSync(metadata, `
      const state = () => globalThis.fixture;
      export const getActiveDiagnosticTraceContext = () => state().trace;
      export const createChildDiagnosticTraceContext = parent => ({ parent });
      export const createDiagnosticTraceContext = () => ({ parent: null });
      export const freezeDiagnosticTraceContext = Object.freeze;
      export async function runWithDiagnosticTraceContext(trace, run) {
        const previous = state().activeTrace;
        state().activeTrace = trace;
        try { return await run(); } finally { state().activeTrace = previous; }
      }
      export const formatErrorMessage = error => error.message;
      export const createSubsystemLogger = () => ({ isEnabled: () => false, debug() {}, warn(...args) { state().warnings.push(args); } });
      export const isDefaultAgentRuntimeId = id => id === 'default';
      export const normalizeOptionalAgentRuntimeId = id => id?.trim();
      export const resolveAgentHarnessPolicy = () => state().policy;
      export const createOpenClawAgentHarness = () => state().builtin;
      export const listRegisteredAgentHarnesses = () => state().plugins.map(harness => ({ harness }));
      export const getRegisteredAgentHarness = id => state().plugins.find(harness => harness.id === id);
      export const isCliRuntimeAliasForProvider = () => false;
      export class MissingAgentHarnessError extends Error { constructor(id) { super('Missing harness: ' + id); } }
      export const resolveEffectiveToolPolicy = () => state().toolPolicy;
      export const resolveGroupToolPolicy = () => undefined;
      export const resolveSenderToolPolicy = () => undefined;
      export const resolveInheritedToolPolicyForSession = () => undefined;
      export const resolveSubagentToolPolicyForSession = () => undefined;
      export const resolveSandboxRuntimeStatus = () => ({ sandboxed: false });
      export const isSubagentEnvelopeSession = () => false;
      export const resolveSubagentCapabilityStore = () => undefined;
      export const expandToolGroups = names => names;
      export const normalizeToolName = name => name.trim().toLowerCase();
    `);
    const context = path.join(directory, 'context.mjs');
    fs.writeFileSync(context, `
      const state = globalThis.fixture;
      state.contextLoads++;
      state.events.push('context-load');
      state.builtin = { id: 'openclaw', runAttempt() { throw new Error('Late selection'); } };
      state.trace = { changed: true };
      export async function runWithHarnessContextBudget(params, native, run) {
        state.events.push('budget');
        state.budgets.push({ params, native });
        const prepared = native ? { ...params, prepared: true } : params;
        state.prepared.push(prepared);
        return run(prepared);
      }
    `);
    const lifecycle = path.join(directory, 'lifecycle.mjs');
    fs.writeFileSync(lifecycle, `
      globalThis.fixture.lifecycleLoads++;
      globalThis.fixture.events.push('lifecycle-load');
      export async function runAgentHarnessLifecycleAttempt(harness, params) {
        globalThis.fixture.events.push('lifecycle');
        return harness.runAttempt(params);
      }
    `);
    const cache = path.join(directory, 'cache.mjs');
    fs.writeFileSync(cache, `export function flushRuntimeCompileCache() {
      globalThis.fixture.flushes++;
      globalThis.fixture.events.push('flush');
    }`);
    const runtimeFile = path.join(directory, 'runtime.mjs');
    const rewrite = (source: string) => source.replace(/\b(from\s+|import\(\s*)(["'])([^"']+)\2/g, (_match, prefix: string, quote: string, specifier: string) => {
      const target = specifier.endsWith('/context-engine-lifecycle.js') ? context
        : specifier.endsWith('/lifecycle.js') ? lifecycle
          : specifier.endsWith('/runtime-compile-cache.js') ? cache
            : specifier.endsWith('/selection.runtime.js') ? runtimeFile : metadata;
      return prefix + quote + pathToFileURL(target).href + quote;
    });
    const runtimeSourcePath = path.resolve('openclaw_runtime/src/agents/harness/selection.runtime.ts');
    let runtimeSource: string | undefined;
    if (fs.existsSync(runtimeSourcePath)) {
      runtimeSource = rewrite(fs.readFileSync(runtimeSourcePath, 'utf8'));
      fs.writeFileSync(runtimeFile, (await transformWithEsbuild(runtimeSource, runtimeSourcePath, { target: 'node22', format: 'esm' })).code);
    }
    const sourcePath = path.resolve('openclaw_runtime/src/agents/harness/selection.ts');
    const source = rewrite(fs.readFileSync(sourcePath, 'utf8'));
    const moduleFile = path.join(directory, 'selection.mjs');
    const compiled = await transformWithEsbuild(source, sourcePath, { target: 'node22', format: 'esm' });
    fs.writeFileSync(moduleFile, compiled.code);
    const bootstrap = path.join(directory, 'bootstrap.mjs');
    fs.writeFileSync(bootstrap, `
      import assert from 'node:assert/strict';
      const originalTrace = { original: true }, result = { messages: [] }, failure = new Error('plugin failed');
      const state = globalThis.fixture = { trace: originalTrace, policy: { runtime: 'openclaw', runtimeSource: 'model' },
        toolPolicy: {}, contextLoads: 0, lifecycleLoads: 0, flushes: 0, events: [], budgets: [], prepared: [], calls: [], warnings: [] };
      const harness = id => ({ id, label: id, supports: () => ({ supported: true }),
        async runAttempt(params) { state.calls.push({ id, params, trace: state.activeTrace });
          if (params.fail) throw failure; return result; } });
      const originalBuiltin = state.builtin = harness('openclaw');
      state.plugins = [harness('fixture-plugin')];
      const selection = await import(${JSON.stringify(pathToFileURL(moduleFile).href)});
      const metadata = await import(${JSON.stringify(pathToFileURL(metadata).href)});
      assert.equal(state.contextLoads + state.lifecycleLoads, 0, 'Execution graph loaded during metadata');
      assert.equal(selection.selectAgentHarness({ provider: 'fixture' }), originalBuiltin);
      assert.deepEqual(selection.resolveAvailableAgentHarnessPolicy({ provider: 'fixture' }), state.policy);
      state.policy = { runtime: 'missing-plugin', runtimeSource: 'model' };
      assert.throws(() => selection.selectAgentHarness({ provider: 'fixture' }), metadata.MissingAgentHarnessError);
      await assert.rejects(selection.runAgentHarnessAttempt({ provider: 'fixture' }), metadata.MissingAgentHarnessError);
      assert.equal(state.contextLoads + state.lifecycleLoads, 0, 'Unsupported selection loaded execution');
      state.policy = { runtime: 'openclaw', runtimeSource: 'model' };
      const native = Object.freeze({ provider: 'fixture', runId: 'native' });
      assert.equal(await selection.runAgentHarnessAttempt(native), result);
      assert.equal(state.calls[0].params, native);
      assert.equal(state.calls[0].trace.parent, originalTrace, 'Trace captured after runtime loading');
      assert.equal(state.budgets[0].native, false);
      assert.equal(state.flushes, 1, 'Execution graph must flush before attempts');
      assert(state.events.indexOf('flush') < state.events.indexOf('budget'));
      state.policy = { runtime: 'fixture-plugin', runtimeSource: 'model' };
      state.toolPolicy = { globalPolicy: { deny: ['*'] } };
      const plugin = Object.freeze({ provider: 'fixture', runId: 'plugin', toolsAllow: ['exec'], extraSystemPrompt: 'existing' });
      assert.equal(await selection.runAgentHarnessAttempt(plugin), result);
      assert.equal(state.budgets[1].params, plugin);
      assert.equal(state.budgets[1].native, true);
      assert.deepEqual(state.calls[1].params.toolsAllow, []);
      assert(state.calls[1].params.extraSystemPrompt.startsWith('existing'));
      assert(state.calls[1].params.extraSystemPrompt.includes('disabled by runtime policy'));
      assert.deepEqual(plugin.toolsAllow, ['exec']);
      state.toolPolicy = {};
      await assert.rejects(selection.runAgentHarnessAttempt({ provider: 'fixture', fail: true }), error => error === failure);
      assert.equal(state.warnings.length, 1);
      assert.deepEqual(state.calls.map(call => call.id), ['openclaw', 'fixture-plugin', 'fixture-plugin']);
      assert.equal(state.contextLoads, 1);
      assert.equal(state.lifecycleLoads, 1);
      assert.equal(state.flushes, 1);
      console.log(JSON.stringify({ metadataLazy: true, selectionAndTraceCapturedBeforeLoading: true,
        pluginPolicyPreserved: true, errorIdentityPreserved: true, checkpointBeforeRun: true,
        driven_by: 'agent', actor: 'gateway-lazy-harness-selection-test', realHumanEvidence: false }));
    `);
    const run = () => spawnSync(process.execPath, [bootstrap], { cwd: directory, windowsHide: true, timeout: 10_000, encoding: 'utf8', env: { ...process.env, TEMP: tmpdir(), TMP: tmpdir() } });
    const healthy = run();
    expect(healthy.error).toBeUndefined();
    expect(healthy.status, healthy.stderr).toBe(0);
    const evidence = JSON.parse(healthy.stdout);
    expect(evidence.metadataLazy).toBe(true);
    const eager = `import { runWithHarnessContextBudget as unusedBudget } from ${JSON.stringify(pathToFileURL(context).href)};\n${source}`;
    const eagerCode = (await transformWithEsbuild(eager, sourcePath, { target: 'node22', format: 'esm' })).code;
    fs.writeFileSync(moduleFile, eagerCode);
    const eagerResult = run();
    expect(eagerResult.status).toBe(1);
    expect(eagerResult.stderr).toContain('Execution graph loaded during metadata');
    fs.writeFileSync(moduleFile, compiled.code);
    expect(runtimeSource).toBeDefined();
    const unflushedCode = (await transformWithEsbuild(runtimeSource!.replace('flushRuntimeCompileCache();', ''), runtimeSourcePath, { target: 'node22', format: 'esm' })).code;
    fs.writeFileSync(runtimeFile, unflushedCode);
    const unflushed = run();
    expect(unflushed.status).toBe(1);
    expect(unflushed.stderr).toContain('Execution graph must flush before attempts');
    fs.writeFileSync(path.join(directory, 'selection-eager.mjs'), eagerCode);
    fs.writeFileSync(path.join(directory, 'runtime-unflushed.mjs'), unflushedCode);
    fs.writeFileSync(runtimeFile, (await transformWithEsbuild(runtimeSource!, runtimeSourcePath, { target: 'node22', format: 'esm' })).code);
    if (process.env.CLAWX_TEST_EVIDENCE_DIR) {
      fs.cpSync(directory, path.join(process.env.CLAWX_TEST_EVIDENCE_DIR, path.basename(directory)), { recursive: true, force: false, errorOnExist: true });
      fs.writeFileSync(path.join(process.env.CLAWX_TEST_EVIDENCE_DIR, path.basename(directory), 'readback.json'), JSON.stringify({ originalRoot: directory, healthy: evidence, eager: { status: eagerResult.status, stderr: eagerResult.stderr, variant: 'selection-eager.mjs' }, unflushed: { status: unflushed.status, stderr: unflushed.stderr, variant: 'runtime-unflushed.mjs' }, driven_by: 'agent', actor: 'gateway-lazy-harness-selection-test', realHumanEvidence: false }, null, 2), { flag: 'wx' });
    }
  } finally {
    fs.rmSync(directory, { recursive: true, force: true });
  }
});
