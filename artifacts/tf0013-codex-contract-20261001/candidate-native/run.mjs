// Agent-driven native process proof. The HTTP model response is scripted.
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import fs from 'node:fs';
import os from 'node:os';
import http from 'node:http';
import { execFileSync } from 'node:child_process';

const out = path.dirname(fileURLToPath(import.meta.url));
fs.writeFileSync(path.join(out, 'rpc.jsonl'), '');
const runtime = path.resolve(out, '../../openclaw_runtime');
const require = createRequire(path.join(runtime, 'package.json'));
const { createJiti } = require('jiti');
const jiti = createJiti(path.join(runtime, 'package.json'), { interopDefault: true });
const scratch = fs.mkdtempSync(path.join(os.tmpdir(), 'tf0013-native-wire-'));
const agentDir = path.join(scratch, 'agent');
const workspaceDir = path.join(scratch, 'workspace');
fs.mkdirSync(agentDir, { recursive: true });
fs.mkdirSync(workspaceDir);
// Prevent fallback auth discovery from reading or forwarding a user's credential.
process.env.OPENAI_API_KEY = 'agent-fixture-not-a-credential';
process.env.CODEX_API_KEY = 'agent-fixture-not-a-credential';
process.env.OPENCLAW_STATE_DIR = path.join(scratch, 'state');
process.env.OPENCLAW_CONFIG_PATH = path.join(scratch, 'openclaw.json');
process.env.OPENCLAW_COMPASS_DISABLE = '0';
process.env.OPENCLAW_COMPASS_SSP = '1';
process.env.VERSE_CONTEXT_ENHANCEMENT_KILL_SWITCH = '0';
process.env.OPENCLAW_DEV_SOURCE_ROOT = runtime;
const binary = path.join(runtime, 'node_modules/.pnpm/@openai+codex@0.137.0-win32-x64/node_modules/@openai/codex/vendor/x86_64-pc-windows-msvc/bin/codex.exe');
const binaryVersion = execFileSync(binary, ['--version'], { encoding: 'utf8' }).trim();
assert.equal(binaryVersion, 'codex-cli 0.137.0');
const requests = [];
const server = http.createServer(async (req, res) => {
  const chunks = [];
  for await (const chunk of req) chunks.push(chunk);
  const text = Buffer.concat(chunks).toString();
  if (!req.url.endsWith('/responses')) {
    res.writeHead(404); res.end(); return;
  }
  const body = JSON.parse(text);
  requests.push(body);
  fs.writeFileSync(path.join(out, 'provider-requests.json'), JSON.stringify(requests, null, 2));
  const id = `response-${requests.length}`;
  const message = { type: 'message', role: 'assistant', id: `message-${requests.length}`, content: [{ type: 'output_text', text: 'agent fixture complete' }] };
  res.writeHead(200, { 'content-type': 'text/event-stream' });
  for (const event of [
    { type: 'response.created', response: { id } },
    { type: 'response.output_item.added', item: message },
    { type: 'response.output_item.done', item: message },
    { type: 'response.completed', response: { id, usage: { input_tokens: 1, input_tokens_details: null, output_tokens: 1, output_tokens_details: null, total_tokens: 2 } } },
  ]) res.write(`data: ${JSON.stringify(event)}\n\n`);
  res.end();
});
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
const baseUrl = `http://127.0.0.1:${server.address().port}/v1`;
const config = {
  plugins: { allow: ['codex'], entries: { codex: { enabled: true, config: {
    discovery: { enabled: false }, computerUse: { enabled: false }, codexPlugins: { enabled: false },
    appServer: { command: process.execPath, args: [path.join(out, 'stdio-proxy.mjs'), path.join(out, 'rpc.jsonl'), binary, 'app-server', '-c', 'model_provider="native_fixture"', '-c', 'model_providers.native_fixture.name="Agent fixture"', '-c', `model_providers.native_fixture.base_url="${baseUrl}"`, '-c', 'model_providers.native_fixture.wire_api="responses"', '-c', 'model_providers.native_fixture.request_max_retries=0', '-c', 'model_providers.native_fixture.stream_max_retries=0'], approvalPolicy: 'never', sandbox: 'read-only' },
  } } } },
  agents: { defaults: { workspace: workspaceDir, skipBootstrap: true } },
  tools: { allow: ['exec'] },
};
fs.writeFileSync(process.env.OPENCLAW_CONFIG_PATH, JSON.stringify(config));
const report = { actor: 'codex/root', driven_by: 'agent', provider: 'scripted-local-responses', binaryVersion, scratch, scenarios: [] };
let harness;
try {
  console.log('Loading host and real Codex plugin');
  const { loadOpenClawPlugins } = await jiti.import(path.join(runtime, 'src/plugins/loader.ts'));
  const { runAgentHarnessAttempt } = await jiti.import(path.join(runtime, 'src/agents/harness/selection.ts'));
  const registry = loadOpenClawPlugins({ config, workspaceDir, onlyPluginIds: ['codex'], pluginSdkResolution: 'src', preferBuiltPluginArtifacts: false, cache: false });
  report.plugins = registry.plugins.map(({ id, status, source, error }) => ({ id, status, source, error }));
  assert.equal(report.plugins.find(p => p.id === 'codex')?.status, 'loaded');
  harness = registry.agentHarnesses[0].harness;
  for (const scenario of [
    { name: 'atomic-drop', added: 7000, compass: 100, system: 100, killed: false },
    { name: 'shared-exhaustion', added: 100, compass: 8000, system: 100, killed: false },
    { name: 'kill', added: 100, compass: 100, system: 100, killed: true },
    { name: 'bootstrap', added: 100, compass: 100, system: 100, killed: false, turns: 2 },
    { name: 'stale-retry', added: 100, compass: 100, system: 5000, killed: false, turns: 2 },
  ]) {
    console.log(`Running ${scenario.name}`);
    const sessionId = scenario.name;
    const sessionKey = `agent:main:${sessionId}`;
    const sessionFile = path.join(scratch, `${sessionId}.jsonl`);
    const history = { role: 'user', content: 'HISTORY_' + 'H'.repeat(9000), timestamp: 1 };
    fs.writeFileSync(sessionFile, [
      { type: 'session', version: 3, id: sessionId, timestamp: new Date().toISOString(), cwd: workspaceDir },
      { type: 'message', id: 'history', parentId: null, timestamp: new Date().toISOString(), message: history },
    ].map(JSON.stringify).join('\n') + '\n');
    let assemblies = 0;
    const engine = {
      info: { id: 'agent-budget-fixture', name: 'Agent budget fixture' },
      assemble: async ({ messages }) => {
        assemblies++;
        return { messages: [...messages, { role: 'user', content: 'NEW_' + 'N'.repeat(scenario.added), timestamp: 2 }], estimatedTokens: 3000, systemPromptAddition: 'ENGINE_' + 'E'.repeat(scenario.system), contextProjection: { mode: 'thread_bootstrap', epoch: '1', fingerprint: scenario.name } };
      },
      ingest: async () => ({ ingested: true }),
      compact: async () => ({ ok: false, compacted: false, reason: 'fixture' }),
    };
    for (let turn = 0; turn < (scenario.turns ?? 1); turn++) {
    if (turn > 0 && scenario.name === 'stale-retry') {
      // Simulate a binding whose native thread was lost. The actual app-server
      // rejects resume; the plugin owns fresh-thread recovery and reassembly.
      const bindingPath = sessionFile + '.codex-app-server.json';
      const binding = JSON.parse(fs.readFileSync(bindingPath, 'utf8'));
      binding.threadId = '00000000-0000-4000-8000-000000000013';
      fs.writeFileSync(bindingPath, JSON.stringify(binding));
    }
    const before = requests.length;
    const rpcBefore = fs.readFileSync(path.join(out, 'rpc.jsonl'), 'utf8').trim().split('\n').filter(Boolean).length;
    const assemblyBefore = assemblies;
    const events = [];
    const result = await runAgentHarnessAttempt({
      agentHarnessId: 'codex', provider: 'codex', modelId: 'gpt-5.5',
      model: { id: 'gpt-5.5', name: 'fixture', api: 'openai-responses', provider: 'openai', baseUrl, reasoning: false, input: ['text'], contextWindow: 128000, maxTokens: 1024, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 } },
      sessionId, sessionKey, sessionFile, workspaceDir, agentDir, agentId: 'main', runId: scenario.name,
      prompt: `CURRENT_REQUEST_${turn}`, config: { ...config, runtime: { contextEnhancement: { killSwitch: scenario.killed } } }, contextEngine: engine, contextTokenBudget: 128000,
      timeoutMs: 45000, thinkLevel: 'off', authProfileStore: { version: 1, profiles: {} },
      compassContext: { sessionKey, injection: { sspString: 'COMPASS_' + 'S'.repeat(scenario.compass), iFrameRefreshed: false }, candidateFactIds: [], appliedFactIds: [] },
      onAgentEvent: event => events.push(event),
    });
    fs.writeFileSync(path.join(out, `${scenario.name}-${turn}-events.json`), JSON.stringify(events, null, 2));
    const binding = JSON.parse(fs.readFileSync(sessionFile + '.codex-app-server.json', 'utf8'));
    fs.writeFileSync(path.join(out, `${scenario.name}-${turn}-binding.json`), JSON.stringify(binding, null, 2));
    const row = { ...scenario, turn, assemblies: assemblies - assemblyBefore, requests: requests.length - before, aborted: result.aborted, timedOut: result.timedOut, promptError: result.promptError ? String(result.promptError) : null };
    report.scenarios.push(row);
    console.log(JSON.stringify(row));
    assert.equal(row.promptError, null);
    assert.equal(row.timedOut, false);
    assert.equal(row.requests, 1);
    const wire = JSON.stringify(requests.at(-1));
    if (!scenario.killed) assert(wire.includes('HISTORY_'));
    const admitted = !scenario.killed && scenario.added < 6000 && scenario.compass < 6000;
    assert.equal(wire.includes('NEW_'), admitted, 'replacement admission differs on native wire');
    assert.equal(wire.includes('ENGINE_'), !scenario.killed && scenario.compass < 6000);
    assert.equal(wire.includes('COMPASS_'), !scenario.killed);
    if (!admitted) assert.equal(binding.contextEngine?.projection, undefined);
    if (scenario.killed) assert.equal(row.assemblies, 0);
    const rpc = fs.readFileSync(path.join(out, 'rpc.jsonl'), 'utf8').trim().split('\n').filter(Boolean).map(JSON.parse).slice(rpcBefore);
    row.rpcMethods = rpc.filter(x => x.direction === 'request').map(x => x.message.method);
    if (scenario.name === 'bootstrap' && turn === 1) {
      assert.equal((wire.match(/NEW_/g) ?? []).length, 1, 'native bootstrap was injected twice');
      assert(row.rpcMethods.includes('thread/resume'), 'bootstrap did not exercise resume');
      const first = JSON.parse(fs.readFileSync(path.join(out, 'bootstrap-0-binding.json'), 'utf8'));
      assert.equal(binding.threadId, first.threadId);
    }
    if (scenario.name === 'stale-retry' && turn === 1) {
      assert(row.rpcMethods.includes('thread/resume') && row.rpcMethods.includes('thread/start'));
      assert.notEqual(binding.threadId, '00000000-0000-4000-8000-000000000013');
      assert(wire.includes('E'.repeat(scenario.system)), 'recovery lost the admitted projection');
    }
    row.pass = true;
    }
  }
  report.pass = true;
} catch (error) {
  report.pass = false;
  report.error = error.stack;
  console.error(error);
  process.exitCode = 1;
} finally {
  await harness?.dispose?.();
  server.closeAllConnections();
  await new Promise(resolve => server.close(resolve));
  fs.writeFileSync(path.join(out, 'native-report.json'), JSON.stringify(report, null, 2) + '\n');
}
