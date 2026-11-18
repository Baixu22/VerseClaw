import { spawn, type ChildProcess } from 'node:child_process';
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { createHash, createPrivateKey, createPublicKey, generateKeyPairSync, randomUUID, sign } from 'node:crypto';
import { expect, test } from '@playwright/test';
import { GatewayClient } from '../../openclaw_runtime/packages/gateway-client/src/index';
import type { SessionActivitySnapshot } from '@shared/types/session-activity';
import { allocatePort, buildMockProviderConfig, startScriptedLlm } from './fixtures/fp-p1-harness';

test('reads actual Gateway tool exposure and continues the same isolated session after runtime restart', async () => {
  test.setTimeout(300_000);
  const testInfo = test.info();
  const root = await mkdtemp(join(tmpdir(), 'clawx-a5-runtime-'));
  const workspace = join(root, 'workspace');
  await mkdir(workspace);
  const llm = await startScriptedLlm((text) => ({ text: text.includes('A5-NODE-CONTINUE') ? 'A5-NODE-CONTINUE-RECEIPT' : 'A5-NODE-FIRST-RECEIPT' }));
  const configPath = join(root, 'openclaw.json');
  await writeFile(configPath, JSON.stringify(buildMockProviderConfig(llm.port, workspace)));
  const keys = generateKeyPairSync('ed25519');
  const publicKeyPem = keys.publicKey.export({ type: 'spki', format: 'pem' }).toString();
  const privateKeyPem = keys.privateKey.export({ type: 'pkcs8', format: 'pem' }).toString();
  const rawPublicKey = (pem: string) => Buffer.from(createPublicKey(pem).export({ type: 'spki', format: 'der' })).subarray(-32);
  const identity = { deviceId: createHash('sha256').update(rawPublicKey(publicKeyPem)).digest('hex'), publicKeyPem, privateKeyPem };
  const port = await allocatePort();
  const token = 'a5-isolated-runtime-fixture';
  const env = { ...process.env, OPENCLAW_CONFIG_PATH: configPath, OPENCLAW_STATE_DIR: join(root, 'state'), OPENCLAW_DISABLE_BONJOUR: '1' };
  let child: ChildProcess | undefined;
  let client: GatewayClient | undefined;
  let output = '';
  async function boot() {
    output = '';
    // The direct launcher supplies the generation normally stamped by Main.
    const launchEnv = { ...env, VERSE_CLAW_GATEWAY_GENERATION: randomUUID() };
    child = spawn(process.execPath, [resolve('openclaw_runtime/dist/entry.js'), 'gateway', 'run', '--port', String(port), '--bind', 'loopback', '--token', token, '--tailscale', 'off', '--allow-unconfigured'], { cwd: resolve('openclaw_runtime'), env: launchEnv, stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true });
    const append = (chunk: Buffer) => { output = (output + chunk.toString()).slice(-16000); };
    child.stdout?.on('data', append);
    child.stderr?.on('data', append);
    let lastProbe = 'not-attempted';
    await expect.poll(async () => {
      if (child?.exitCode !== null) throw new Error(`Gateway exited: ${output}`);
      try { const r = await fetch(`http://127.0.0.1:${port}/readyz`, { signal: AbortSignal.timeout(1000) }); const body = await r.json() as { ready?: boolean }; lastProbe = JSON.stringify({ status: r.status, body }); return r.ok && body.ready === true; }
      catch (error) { lastProbe = String(error); return false; }
    }, { timeout: 90_000, intervals: [500] }).toBe(true).catch(() => { throw new Error(`Gateway readiness failed: ${lastProbe}\n${output}`); });
    await new Promise<void>((done, reject) => {
      const timeout = setTimeout(() => reject(new Error(`Gateway client handshake timed out: ${output}`)), 30_000);
      const connected = () => { clearTimeout(timeout); done(); };
      const failed = (error: Error) => { clearTimeout(timeout); reject(error); };
      client = new GatewayClient({ url: `ws://127.0.0.1:${port}`, token, clientName: 'cli', mode: 'cli', role: 'operator', scopes: ['operator.admin'], deviceIdentity: identity, env,
        // Only client-side token persistence and ambient proxy setup are isolated;
        // server authentication, signature verification and runtime effects are real.
        hostDeps: { loadOrCreateDeviceIdentity: () => identity, loadDeviceAuthToken: () => null, storeDeviceAuthToken: () => {}, clearDeviceAuthToken: () => {}, publicKeyRawBase64UrlFromPem: (pem) => rawPublicKey(pem).toString('base64url'), signDevicePayload: (pem, payload) => sign(null, Buffer.from(payload), createPrivateKey(pem)).toString('base64url') },
        onHelloOk: connected, onConnectError: failed,
      });
      client.start();
    });
  }
  async function stop() {
    await client?.stopAndWait({ timeoutMs: 3000 });
    client = undefined;
    const owned = child;
    child = undefined;
    if (!owned || owned.exitCode !== null) return;
    let didExit = false;
    const exited = new Promise<void>((done) => owned.once('exit', () => { didExit = true; done(); }));
    owned.kill();
    await Promise.race([exited, new Promise<void>((done) => setTimeout(done, 5000))]);
    if (!didExit && owned.pid) {
      if (process.platform === 'win32') {
        const killer = spawn('taskkill.exe', ['/PID', String(owned.pid), '/T', '/F'], { windowsHide: true, stdio: 'ignore' });
        await new Promise<void>((done) => { killer.once('exit', () => done()); killer.once('error', () => done()); });
      } else owned.kill('SIGKILL');
      await exited;
    }
  }
  try {
    await boot();
    const created = await client!.request<{ key?: string; sessionKey?: string }>('sessions.create', { agentId: 'main', label: 'A5 actual runtime isolated' });
    const sessionKey = created.key ?? created.sessionKey;
    if (!sessionKey) throw new Error('No created session key');
    const workspaceId = 'a5-isolated-runtime-workspace';
    const snapshot = async () => (await client!.request<{ snapshot: SessionActivitySnapshot }>('session.activitySnapshot', { workspaceId, sessionKey })).snapshot;
    const history = async (marker: string) => JSON.stringify(await client!.request('chat.history', { sessionKey })).includes(marker);
    const turn = async (marker: string) => {
      await client!.request('chat.send', { sessionKey, workspaceId, message: marker, idempotencyKey: marker });
      await expect.poll(() => history(`${marker}-RECEIPT`), { timeout: 120000, intervals: [500] }).toBe(true);
    };
    expect((await snapshot()).policy?.generation.state).toBe('missing');
    await expect(client!.request('chat.send', { sessionKey, workspaceId, workspaceDir: workspace, message: 'negative control', idempotencyKey: 'a5-reserved-root-negative' })).rejects.toThrow(/reserved for backend callers/);
    await turn('A5-NODE-FIRST');
    const first = await snapshot();
    expect(first.policy?.generation.state, JSON.stringify(first.policy?.generation)).toBe('effective');
    expect(first.policy?.tools?.status).toBe('effective');
    expect(first.policy?.tools?.value?.names.length).toBeGreaterThan(0);
    const firstAck = await client!.request<{ gatewayGeneration: string; childPid: number }>('runtime.flags.ack', {});
    expect(first.policy?.generation.runtimeGeneration).toBe(firstAck.gatewayGeneration);
    const cron = await client!.request<{ enabled: boolean }>('cron.status', {});
    expect(typeof cron.enabled).toBe('boolean');
    await stop();
    await boot();
    const secondAck = await client!.request<{ gatewayGeneration: string; childPid: number }>('runtime.flags.ack', {});
    expect(secondAck.gatewayGeneration).not.toBe(firstAck.gatewayGeneration);
    expect(secondAck.childPid).not.toBe(firstAck.childPid);
    expect((await snapshot()).policy?.generation.state).toBe('missing');
    expect(await history('A5-NODE-FIRST-RECEIPT')).toBe(true);
    await turn('A5-NODE-CONTINUE');
    const continued = await snapshot();
    expect(continued.policy?.generation.runtimeGeneration).toBe(secondAck.gatewayGeneration);
    expect(continued.policy?.tools?.status).toBe('effective');
    expect(llm.anomalies).toEqual([]);
    if (process.env.CLAWX_A5_RUNTIME_RECEIPT) {
      await writeFile(process.env.CLAWX_A5_RUNTIME_RECEIPT, JSON.stringify({ schema: 'AutonomyA5RuntimeIntegration/v1', driven_by: 'agent', actor: 'codex-a5-runtime-integration', realHumanEvidence: false, candidate: process.env.CLAWX_TEST_CANDIDATE ?? null, firstAck, secondAck, firstPolicy: first.policy, continuedPolicy: continued.policy, cronEnabled: cron.enabled, providerRequests: llm.log.length, transcriptReadback: true, limitations: ['Node Gateway integration; native Electron host and production close-to-tray not exercised', 'scripted local provider; no model quality or installed-service claim'] }, null, 2));
      await testInfo.attach('reads actual Gateway tool exposure', { path: process.env.CLAWX_A5_RUNTIME_RECEIPT, contentType: 'application/json' });
    }
  } finally {
    const logPath = testInfo.outputPath('gateway.log');
    await writeFile(logPath, output);
    await testInfo.attach('gateway-runtime-log', { path: logPath, contentType: 'text/plain' });
    await stop();
    llm.server.closeAllConnections();
    await new Promise<void>((done) => llm.server.close(() => done()));
    await rm(root, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
  }
});
