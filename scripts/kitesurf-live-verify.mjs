import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { promisify } from 'node:util';
import { execFile } from 'node:child_process';
import { createServer } from 'node:http';
import { mkdtemp, readFile, readdir, writeFile, copyFile, rm, mkdir } from 'node:fs/promises';
import { dirname, isAbsolute, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { cdpVersionUrl } from '../packages/versebrowser/dist/engine/kitesurf-cdp.js';
import { createKitesurfHostApi } from '../packages/versebrowser/dist/engine/kitesurf-session.js';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const endpoint = process.env.KITESURF_CDP_ENDPOINT ?? 'ws://127.0.0.1:8787/devtools/browser';
const scratch = resolve('D:/tmp');
const startedAt = new Date().toISOString();
const workspace = process.env.KITESURF_VERIFY_WORKSPACE
  ? resolve(process.env.KITESURF_VERIFY_WORKSPACE)
  : await mkdtemp(join(scratch, 'kitesurf-cli-acceptance-'));
const scratchRelative = relative(scratch, workspace);
assert.ok(scratchRelative && !scratchRelative.startsWith('..') && !isAbsolute(scratchRelative), 'Use a new CLI acceptance directory under D:/tmp');
if (process.env.KITESURF_VERIFY_WORKSPACE) await mkdir(workspace);
const output = resolve(root, 'harness/specs/fixtures/kitesurf-loopback-cdp/live.json');
let sessionId, workerPid, versionServer;
const steps = [];
const pass = (name, detail) => steps.push({ name, ok: true, ...(detail === undefined ? {} : { detail }) });
const alive = pid => { try { process.kill(pid, 0); return true; } catch { return false; } };

async function invoke(args) {
  let stdout, status = 0;
  try {
    ({ stdout } = await promisify(execFile)(process.execPath, [resolve(root, 'packages/versebrowser/dist/cli.js'), ...args], {
      cwd: workspace, timeout: 65_000, env: { ...process.env, TEMP: 'D:/tmp', TMP: 'D:/tmp' },
    }));
  } catch (error) {
    if (typeof error.code !== 'number') throw error;
    stdout = error.stdout;
    status = error.code;
  }
  const start = stdout.indexOf('{');
  assert.ok(start >= 0, args[0] + ' must return a JSON result');
  return { status, result: JSON.parse(stdout.slice(start)) };
}
async function cli(args) {
  const { status, result } = await invoke(args);
  assert.equal(status, 0, args[0] + ' failed: ' + result.content);
  assert.equal(result.ok, true, result.content);
  return result;
}
async function rejectCli(args, pattern) {
  const { status, result } = await invoke(args);
  assert.notEqual(status, 0, 'Rejected commands must return nonzero');
  assert.equal(result.ok, false);
  assert.match((result.error?.code ?? '') + '\n' + result.content, pattern);
  return result.error?.code;
}
async function confirmClosed(id, pid) {
  const deadline = Date.now() + 10_000;
  while (alive(pid) && Date.now() < deadline) await new Promise(resolve => setTimeout(resolve, 50));
  assert.equal(alive(pid), false, 'Owned control worker must exit');
  await assert.rejects(readFile(resolve(workspace, '.ae/sessions', id, 'session.json'), 'utf8'));
  assert.equal((await readdir(resolve(workspace, '.ae/sessions')).catch(() => [])).includes(id), false);
}

try {
  const version = await (await fetch(cdpVersionUrl(endpoint), { signal: AbortSignal.timeout(5000) })).json();
  assert.match(version.Browser, /Kitesurf/i);
  pass('engine-identity', version.Browser);
  pass('missing-endpoint-rejected', await rejectCli(['open', '--kitesurf'], /E_KITESURF_ENDPOINT/));
  pass('remote-endpoint-rejected', await rejectCli(['open', '--kitesurf', '--cdp', 'wss://kitesurf.example.workers.dev/devtools/browser'], /E_KITESURF_ENDPOINT/));
  versionServer = createServer((_req, res) => res.writeHead(200, { 'content-type': 'application/json' }).end(JSON.stringify({ Browser: 'Chrome/131.0.0.0' })));
  await new Promise(resolve => versionServer.listen(0, '127.0.0.1', resolve));
  const wrongEndpoint = 'ws://127.0.0.1:' + versionServer.address().port + '/devtools/browser';
  await rejectCli(['open', '--kitesurf', '--cdp', wrongEndpoint], /E_KITESURF_ENDPOINT/);
  assert.deepEqual(await readdir(resolve(workspace, '.ae/sessions')).catch(() => []), []);
  pass('misidentified-endpoint-and-failed-open-cleanup');

  const fixtures = new URL('/__fixtures/', cdpVersionUrl(endpoint)).href;
  const opened = await cli(['open', '--kitesurf', '--cdp', endpoint, '--url', fixtures + 'accessibility.html']);
  sessionId = opened.data.session.id;
  assert.equal(opened.data.session.title, 'a11y');
  const record = JSON.parse(await readFile(resolve(workspace, '.ae/sessions', sessionId, 'session.json'), 'utf8'));
  workerPid = record.pid;
  assert.equal(record.engine, 'kitesurf');
  assert.equal(record.external, true);
  assert.equal(alive(workerPid), true);
  const lease = JSON.parse(await readFile(resolve(workspace, '.ae/sessions', sessionId, 'kitesurf-control.json'), 'utf8'));
  assert.equal(new URL(lease.endpoint).hostname, '127.0.0.1');
  const denied = await fetch(new URL('/call', lease.endpoint), {
    method: 'POST', headers: { authorization: 'Bearer wrong', 'content-type': 'application/json' },
    body: JSON.stringify({ method: 'status', payload: { sessionId } }),
  });
  assert.equal(denied.status, 403);
  pass('control-auth');
  pass('open', { title: opened.data.session.title, pid: workerPid, engine: record.engine });

  const snapshot = await cli(['snapshot', '--session', sessionId]);
  assert.match(snapshot.content, /Email address/);
  assert.match(snapshot.content, /Sign up/);
  pass('cross-process-snapshot');
  const shot = await cli(['screenshot', '--session', sessionId, '--name', 'page.png']);
  const png = await readFile(resolve(workspace, shot.data.path));
  assert.deepEqual(png.subarray(0, 8), Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]));
  pass('cross-process-screenshot', { bytes: png.length, width: png.readUInt32BE(16), height: png.readUInt32BE(20) });
  const pdf = await cli(['pdf', '--session', sessionId, '--name', 'page.pdf']);
  const pdfBytes = await readFile(resolve(workspace, pdf.data.path));
  assert.equal(pdfBytes.subarray(0, 5).toString(), '%PDF-');
  assert.ok(pdfBytes.toString('latin1').includes('%%EOF'));
  pass('pdf', { bytes: pdfBytes.length, path: pdf.data.path });
  await rejectCli(['pdf', '--session', sessionId, '--name', '../../../../outside.pdf'], /E_PDF|path|outside/i);
  await assert.rejects(readFile(resolve(workspace, 'outside.pdf')));
  pass('pdf-path-escape-rejected');
  if (process.env.KITESURF_ACCEPTANCE_OUTPUT) {
    const exports = resolve(process.env.KITESURF_ACCEPTANCE_OUTPUT, 'exports');
    await mkdir(exports, { recursive: true });
    await copyFile(resolve(workspace, shot.data.path), resolve(exports, 'cli-page.png'));
    await copyFile(resolve(workspace, pdf.data.path), resolve(exports, 'cli-page.pdf'));
  }

  await cli(['nav', '--session', sessionId, '--url', fixtures + 'bench-static.html']);
  const consoleResult = await cli(['console', '--session', sessionId]);
  const verified = await cli(['verify', '--session', sessionId]);
  assert.equal(verified.data.outcome, 'pass');
  pass('cross-process-navigation-console-verify', { consoleBytes: consoleResult.content.length, outcome: verified.data.outcome });
  try {
    await cli(['nav', '--session', sessionId, '--url', 'https://example.com/']);
    const api = createKitesurfHostApi(sessionId, workspace);
    await api.waitForSelector({ sessionId, selector: 'body > p:first-of-type', timeoutMs: 15_000 });
    const snapshot = await cli(['snapshot', '--session', sessionId]);
    assert.match(snapshot.content, /title: Example Domain/);
    const page = await api.extractPageText({ sessionId, rules: [] });
    assert.match(page.text, /documentation examples/);
    const { requests } = await api.networkListRequests({ sessionId });
    const response = requests.findLast(request => request.url === 'https://example.com/');
    assert.equal(response?.status, 200);
    assert.equal(response.failed, false);
    if (process.env.KITESURF_ACCEPTANCE_OUTPUT) {
      await writeFile(resolve(process.env.KITESURF_ACCEPTANCE_OUTPUT, 'public-page-snapshot.txt'), snapshot.content);
      await writeFile(resolve(process.env.KITESURF_ACCEPTANCE_OUTPUT, 'public-page-text.txt'), page.text);
      await writeFile(resolve(process.env.KITESURF_ACCEPTANCE_OUTPUT, 'public-page-network.json'), JSON.stringify(response, null, 2) + '\n');
    }
    pass('public-page-navigation-and-read', { url: response.url, status: response.status, textChars: page.text.length,
      snapshotHash: createHash('sha256').update(snapshot.content).digest('hex') });
  } catch (error) {
    const api = createKitesurfHostApi(sessionId, workspace);
    const page = await api.extractPageText({ sessionId, rules: [] }).catch(failure => ({ error: failure.message }));
    const network = await api.networkListRequests({ sessionId }).catch(failure => ({ error: failure.message }));
    steps.push({ name: 'public-page-navigation-and-read', ok: false, error: error.message, page, network });
  }

  await cli(['close', '--session', sessionId]);
  await confirmClosed(sessionId, workerPid);
  pass('close-removes-worker-and-session');
  await rejectCli(['snapshot', '--session', sessionId], /E_NO_SESSION/);
  pass('closed-session-reuse-rejected');
  sessionId = undefined; workerPid = undefined;

  const detected = await cli(['open', '--cdp', endpoint, '--url', fixtures + 'accessibility.html']);
  sessionId = detected.data.session.id;
  const detectedRecord = JSON.parse(await readFile(resolve(workspace, '.ae/sessions', sessionId, 'session.json'), 'utf8'));
  workerPid = detectedRecord.pid;
  assert.equal(detectedRecord.engine, 'kitesurf');
  assert.ok(workerPid > 0);
  assert.match((await cli(['snapshot', '--session', sessionId])).content, /Email address/);
  pass('auto-detected-cross-process-session');
  await cli(['nav', '--session', sessionId, '--url', fixtures + 'bench-static.html']);
  assert.equal((await cli(['verify', '--session', sessionId])).data.outcome, 'pass');
  pass('auto-detected-navigation-and-verify');
  await cli(['close', '--session', sessionId]);
  await confirmClosed(sessionId, workerPid);
  assert.deepEqual(await readdir(resolve(workspace, '.ae/sessions')).catch(() => []), []);
  pass('auto-detected-close-and-cleanup');
  sessionId = undefined; workerPid = undefined;

  const receipt = JSON.parse(await readFile(resolve(root, 'harness/specs/fixtures/kitesurf-loopback-cdp/receipt.json'), 'utf8'));
  const sourceFiles = [...new Set([...Object.keys(receipt.sourceHashes), 'scripts/kitesurf-local-runtime.mjs', 'pnpm-workspace.yaml', 'scripts/contract-check.mjs', 'vitest.agent-dev.node.config.ts', 'scripts/typecheck-agent-dev.mjs', 'tests/unit/typecheck-gate.test.ts'])];
  const sourceHashes = Object.fromEntries(await Promise.all(sourceFiles.map(async file => [
    file, createHash('sha256').update(await readFile(resolve(root, file))).digest('hex'),
  ])));
  const ok = steps.every(step => step.ok);
  const destination = ok ? output : resolve(process.env.KITESURF_ACCEPTANCE_OUTPUT ?? scratch, 'cli-failed-attempt-' + Date.now() + '.json');
  await writeFile(destination, JSON.stringify({
    ok,
    schema: 'clawx.kitesurf-loopback-cdp-live/v2', driven_by: 'agent', actor: 'codex',
    upstream: 'https://github.com/cloudflare/kitesurf', upstreamRevision: '4a2903813a22b08d4f3cc64a4b35339d0293a5d1',
    engine: version.Browser, liveEngine: true, remoteBrowserRun: false, sourceHashes,
    startedAt, finishedAt: new Date().toISOString(), steps,
    scriptHash: createHash('sha256').update(await readFile(fileURLToPath(import.meta.url))).digest('hex'),
    cliHash: createHash('sha256').update(await readFile(resolve(root, 'packages/versebrowser/dist/cli.js'))).digest('hex'),
  }, null, 2) + '\n');
  console.log('Kitesurf CLI checks: ' + steps.filter(step => step.ok).length + '/' + steps.length + '; receipt: ' + destination);
  if (!ok) process.exitCode = 1;
} catch (error) {
  if (sessionId) await cli(['close', '--session', sessionId]).catch(() => undefined);
  if (workerPid && alive(workerPid)) { try { process.kill(workerPid); } catch {} }
  if (process.env.KITESURF_ACCEPTANCE_OUTPUT) {
    await writeFile(resolve(process.env.KITESURF_ACCEPTANCE_OUTPUT, 'cli-failed-attempt-' + Date.now() + '.json'), JSON.stringify({
      driven_by: 'agent', actor: 'codex', startedAt, finishedAt: new Date().toISOString(), ok: false,
      steps, error: error.message,
    }, null, 2) + '\n');
  }
  throw error;
} finally {
  if (versionServer) await new Promise(resolve => versionServer.close(resolve));
  await rm(workspace, { recursive: true, force: true, maxRetries: 50, retryDelay: 200 });
}
