#!/usr/bin/env node
// Local, isolated Electron UtilityProcess startup measurement. No user profile or provider calls.
import { spawn } from 'node:child_process';
import { createHash, randomUUID } from 'node:crypto';
import { mkdir, readFile, readdir, rename, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { createServer } from 'node:net';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(fileURLToPath(new URL('..', import.meta.url)));
const require = createRequire(import.meta.url);
const desktopEnvKeys = new Set([
  'PATH', 'PATHEXT', 'SYSTEMROOT', 'SYSTEMDRIVE', 'COMSPEC', 'WINDIR', 'LANG', 'TERM',
  'USER', 'LOGNAME', 'USERNAME', 'DISPLAY', 'WAYLAND_DISPLAY', 'XAUTHORITY',
  'XDG_RUNTIME_DIR', 'DBUS_SESSION_BUS_ADDRESS',
]);
const output = resolve(process.argv[2] ?? 'artifacts/gateway-startup-performance/measurement.json');
const rounds = Number(process.argv[3] ?? 3);
if (!Number.isInteger(rounds) || rounds < 1 || rounds > 10) throw new Error('Rounds must be 1-10');
const runRoot = join(root, '.tmp', `gateway-startup-${randomUUID()}`);
await mkdir(runRoot, { recursive: true });
const dist = join(root, 'openclaw_runtime', 'dist');
const contractChunks = [];
for (const name of await readdir(dist)) {
  if (!name.startsWith('state-migrations-') || !name.endsWith('.js')) continue;
  const source = await readFile(join(dist, name), 'utf8');
  if (source.includes('function loadPluginDoctorContractModule(modulePath)')
    && source.includes('if (!moduleLoaderFactoryForTest)')
    && source.includes('function resolveContractApiPath(rootDir)')) contractChunks.push({ name, source });
}
if (contractChunks.length !== 1) throw new Error('Build the current runtime before measuring');
const contract = contractChunks[0];
const loaderStart = contract.source.indexOf('function loadPluginDoctorContractModule(modulePath)');
const loaderEnd = contract.source.indexOf('function resolveContractApiPath', loaderStart);
const loaderSource = contract.source.slice(loaderStart, loaderEnd);
const fallbackStart = loaderSource.indexOf('return getCachedPluginModuleLoader(');
if (loaderEnd < loaderStart || fallbackStart < 0 || !loaderSource.includes('tryNativeRequireJavaScriptModule')) {
  throw new Error('Unexpected doctor loader artifact; update the measurement driver');
}
// Keep the fallback's actual compiled bindings; only remove the early native path.
const baselineLoader = loaderSource.slice(0, loaderSource.indexOf('{') + 1)
  + ' ' + loaderSource.slice(fallbackStart);
const probePath = join(runRoot, 'probe.cjs');
await writeFile(probePath, `(${electronProbe.toString()})();`);
const results = [];
await writeReport();
// Alternate order to reduce warm-cache and host-load bias. Both arms keep migrations and sidecars.
for (let round = 1; round <= rounds; round++) {
  for (const arm of round % 2 ? ['before', 'after'] : ['after', 'before']) {
    const run = join(runRoot, `${round}-${arm}`);
    await mkdir(join(run, 'electron'), { recursive: true });
    // Both arms start without a transform cache, so neither reuses the other
    // arm's TS compilation. Keep it writable by the Electron utility process.
    const tempDir = join(run, 'temp');
    await mkdir(tempDir, { recursive: true });
    await mkdir(join(run, 'AppData', 'Roaming'), { recursive: true });
    await mkdir(join(run, 'AppData', 'Local'), { recursive: true });
    await writeFile(join(run, 'openclaw.json'), JSON.stringify({
      gateway: { mode: 'local', bind: 'loopback', auth: { mode: 'token' }, controlUi: { enabled: false } },
      plugins: { enabled: true },
      update: { checkOnStart: false },
    }));
    const port = await new Promise((resolvePort, reject) => {
      const server = createServer();
      server.once('error', reject);
      server.listen(0, '127.0.0.1', () => {
        const { port: freePort } = server.address();
        server.close((error) => error ? reject(error) : resolvePort(freePort));
      });
    });
    const options = { root, run, port, arm, contractName: contract.name, baselineLoader };
    // Keep desktop/OS plumbing, never user credentials or runtime bypass flags.
    const env = Object.fromEntries(Object.entries(process.env).filter(([key]) => (
      desktopEnvKeys.has(key.toUpperCase()) || key.startsWith('LC_') || key.startsWith('__CF_')
    )));
    Object.assign(env, {
      TEMP: tempDir, TMP: tempDir, TMPDIR: tempDir, HOME: run, USERPROFILE: run,
      APPDATA: join(run, 'AppData', 'Roaming'), LOCALAPPDATA: join(run, 'AppData', 'Local'),
      XDG_CONFIG_HOME: join(run, '.config'), XDG_CACHE_HOME: join(run, '.cache'),
      XDG_DATA_HOME: join(run, '.local', 'share'), GATEWAY_STARTUP_PROBE: JSON.stringify(options),
    });
    const launchedAt = Date.now();
    const exitCode = await new Promise((resolveExit) => {
      const child = spawn(require('electron'), ['--no-sandbox', '--disable-gpu', probePath], {
        cwd: root, env, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'], timeout: 120_000,
      });
      let diagnostic = '';
      child.stdout.on('data', (chunk) => { diagnostic += chunk; });
      child.stderr.on('data', (chunk) => { diagnostic += chunk; });
      child.once('error', (error) => { diagnostic += String(error); });
      child.once('close', async (code) => {
        await writeFile(join(run, 'electron.log'), diagnostic);
        resolveExit(code);
      });
    });
    let result;
    try {
      result = JSON.parse(await readFile(join(run, 'result.json'), 'utf8'));
    } catch (error) {
      result = { ok: false, error: `Electron exited without a readable result: ${error.message}` };
    }
    const runtimeLog = await readFile(join(run, 'runtime.log'), 'utf8').catch(() => '');
    results.push({ round, arm, exitCode, wallMs: Date.now() - launchedAt, ...result,
      trace: runtimeLog.split(/\r?\n/).filter((line) => line.includes('startup trace:')) });
    await writeReport();
    console.log(JSON.stringify({ round, arm, exitCode, ...result }));
  }
}
console.log(JSON.stringify({ output, metrics: await writeReport() }));
if (results.some((row) => !row.ok || row.exitCode !== 0)) process.exitCode = 1;

async function writeReport() {
  const percentile = (values, fraction) => [...values].sort((a, b) => a - b)[Math.max(0, Math.ceil(values.length * fraction) - 1)] ?? null;
  const metrics = Object.fromEntries(['before', 'after'].map((arm) => {
    const samples = results.filter((row) => row.arm === arm && row.ok && row.exitCode === 0);
    return [arm, { count: samples.length, rpcP50Ms: percentile(samples.map((row) => row.rpcReadyMs), 0.5),
      rpcP95Ms: percentile(samples.map((row) => row.rpcReadyMs), 0.95) }];
  }));
  const report = {
    schema: 'clawx.gateway-startup-performance/v1', driven_by: 'agent', actor: 'gateway-startup-probe',
    recordedAt: new Date().toISOString(), platform: process.platform, rounds, runRoot,
    contractArtifact: { path: contract.name, sha256: createHash('sha256').update(contract.source).digest('hex') },
    baseline: 'The before arm removes the early native path using the exact fallback from the same compiled doctor loader. Both arms verify a real call to that loader; dist files remain unchanged.',
    environment: 'Only desktop/OS environment is inherited; user homes and caches are isolated. Runtime bypass flags and credentials are omitted; binding and token authentication are explicit.',
    transformCache: 'fresh-per-attempt', complete: results.length === rounds * 2, metrics, results,
    limitations: ['Local Windows development Electron, fresh isolated profiles, plugins enabled, no configured channels or provider calls.',
      'Each attempt has a fresh transform cache; OS caches are not flushed. Both arm orders are included when rounds > 1. P95 is descriptive for this small sample.',
      'Readiness requires an authenticated system-presence RPC; no migration or sidecar is skipped.'],
  };
  await mkdir(resolve(output, '..'), { recursive: true });
  await writeFile(output + '.tmp', JSON.stringify(report, null, 2) + '\n');
  await rename(output + '.tmp', output);
  return metrics;
}

function electronProbe() {
  const { app, utilityProcess } = require('electron');
  const fs = require('node:fs');
  const path = require('node:path');
  const { root, run, port, arm, contractName, baselineLoader } = JSON.parse(process.env.GATEWAY_STARTUP_PROBE);
  app.disableHardwareAcceleration();
  app.setPath('userData', path.join(run, 'electron'));
  app.whenReady().then(() => {
    const entry = path.join(root, 'openclaw_runtime', 'dist', 'entry.js');
    const bootstrap = path.join(run, 'runtime.cjs');
    const proofPath = path.join(run, 'doctor-loader-proof.json');
    fs.writeFileSync(bootstrap, `
      const { registerHooks } = require('node:module');
      const { pathToFileURL } = require('node:url');
      const entry = ${JSON.stringify(entry)};
      process.argv[1] = entry;
      let loaderObserved = false;
      globalThis.__gatewayStartupDoctorObserved = () => {
        if (loaderObserved) return;
        loaderObserved = true;
        require('node:fs').writeFileSync(${JSON.stringify(proofPath)}, JSON.stringify({
          arm: ${JSON.stringify(arm)}, loaderObserved: true, baselineApplied: ${JSON.stringify(arm === 'before')},
        }));
      };
      registerHooks({ load(url, context, nextLoad) {
        const result = nextLoad(url, context);
        if (url.endsWith(${JSON.stringify('/' + contractName)})) {
          const source = Buffer.isBuffer(result.source) ? result.source.toString('utf8') : result.source;
          if (typeof source !== 'string') throw new Error('Doctor loader source unavailable');
          const start = source.indexOf('function loadPluginDoctorContractModule(modulePath)');
          const end = source.indexOf('function resolveContractApiPath', start);
          if (start < 0 || end < start || source.lastIndexOf('function loadPluginDoctorContractModule(modulePath)') !== start) throw new Error('Baseline module loader mismatch');
          const loader = ${JSON.stringify(arm)} === 'before' ? ${JSON.stringify(baselineLoader)} : source.slice(start, end);
          const observed = loader.replace('{', '{ globalThis.__gatewayStartupDoctorObserved();');
          return { ...result, source: source.slice(0, start) + observed + source.slice(end) };
        }
        return result;
      }});
      import(pathToFileURL(entry).href);
    `);
    const token = require('node:crypto').randomBytes(32).toString('hex');
    const startedAt = performance.now();
    const child = utilityProcess.fork(bootstrap, ['gateway', '--bind', 'loopback', '--port', String(port), '--allow-unconfigured'], {
      cwd: path.dirname(path.dirname(entry)), stdio: 'pipe',
      env: { ...process.env, OPENCLAW_CONFIG_PATH: path.join(run, 'openclaw.json'), OPENCLAW_STATE_DIR: path.join(run, 'state'),
        OPENCLAW_HOME: run, HOME: run, USERPROFILE: run,
        APPDATA: path.join(run, 'AppData', 'Roaming'), LOCALAPPDATA: path.join(run, 'AppData', 'Local'),
        OPENCLAW_GATEWAY_TOKEN: token, OPENCLAW_DISABLE_BONJOUR: '1', OPENCLAW_SKIP_CHANNELS: '1',
        OPENCLAW_NO_RESPAWN: '1', OPENCLAW_GATEWAY_STARTUP_TRACE: '1' },
      serviceName: 'Gateway startup measurement',
    });
    const log = fs.createWriteStream(path.join(run, 'runtime.log'));
    child.stdout.on('data', (data) => log.write(data));
    child.stderr.on('data', (data) => log.write(data));
    const result = { ok: false, bind: 'loopback', tokenPerAttempt: true, loaderObserved: false };
    let finished = false;
    let ws;
    const finish = (error) => {
      if (finished) return;
      finished = true;
      if (error) result.error = String(error);
      clearTimeout(deadline);
      ws?.terminate();
      child.kill();
    };
    child.on('spawn', () => { result.spawnMs = performance.now() - startedAt; });
    child.on('exit', (code) => {
      if (!finished) { result.error = `Gateway exited before RPC readiness (${code})`; finished = true; }
      clearTimeout(deadline);
      result.childExitCode = code;
      fs.writeFileSync(path.join(run, 'result.json'), JSON.stringify(result));
      log.end(() => app.quit());
    });
    const deadline = setTimeout(() => finish('Gateway startup exceeded 90 seconds'), 90_000);
    const WebSocket = require(require.resolve('ws', { paths: [root] }));
    const connect = () => {
      if (finished) return;
      ws = new WebSocket(`ws://127.0.0.1:${port}/ws`);
      const socket = ws;
      socket.on('error', () => {});
      socket.on('close', () => { if (!finished) setTimeout(connect, 200); });
      socket.on('message', (data) => {
        const msg = JSON.parse(data.toString());
        if (msg.type === 'event' && msg.event === 'connect.challenge') {
          result.challengeMs ??= performance.now() - startedAt;
          socket.send(JSON.stringify({ type: 'req', id: 'measure-connect', method: 'connect', params: {
            minProtocol: 4, maxProtocol: 4, client: { id: 'gateway-client', version: 'startup-measurement', platform: process.platform, mode: 'backend' },
            auth: { token }, role: 'operator', scopes: ['operator.admin', 'operator.read'],
          } }));
        } else if (msg.type === 'res' && msg.id === 'measure-connect') {
          if (!msg.ok) { socket.terminate(); return; }
          result.connectedMs = performance.now() - startedAt;
          socket.send(JSON.stringify({ type: 'req', id: 'measure-rpc', method: 'system-presence', params: {} }));
        } else if (msg.type === 'res' && msg.id === 'measure-rpc') {
          if (!msg.ok) { finish(`system-presence failed: ${msg.error?.code}`); return; }
          result.rpcReadyMs = performance.now() - startedAt;
          if (!Array.isArray(msg.payload)) { finish('system-presence returned an invalid payload'); return; }
          try {
            const proof = JSON.parse(fs.readFileSync(proofPath, 'utf8'));
            if (proof.arm !== arm || proof.loaderObserved !== true || proof.baselineApplied !== (arm === 'before')) {
              throw new Error('Doctor loader proof does not match this arm');
            }
            result.loaderObserved = true;
            result.baselineApplied = proof.baselineApplied;
          } catch (error) {
            finish(`Measured doctor loader was not observed: ${error.message}`);
            return;
          }
          result.ok = true;
          finish();
        }
      });
    };
    connect();
  });
}
