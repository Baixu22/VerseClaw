/**
 * FP-P0-01 G3 / FP-P0-03 / FP-P0-04 G3: real Electron + real gateway child.
 *
 * Every assertion here reads state out of an actually spawned gateway child, not a
 * vitest process:
 *  - the child env snapshot proves the launch layer does not inject
 *    VERSE_VTOKEN_ASSEMBLY_ENABLED=1 when the operator did not opt in;
 *  - `runtime.flags.ack` proves the child reports its own effective flags with all
 *    seven required fields, which is what lets the control plane reach `applied`.
 *
 * The gateway is started explicitly via the host `gateway.start` route because
 * VERSE_CLAW_E2E=1 skips auto-start (electron/main/index.ts). That is the known
 * obstacle recorded in FP-P0-04; starting it by hand is the real-gateway profile.
 */
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { ElectronApplication } from '@playwright/test';
import { closeElectronApp, expect, getStableWindow, test } from './fixtures/electron';

type HostResponse<T> = { ok: boolean; data?: T; error?: { code?: string; message?: string } };
type GatewayStatus = { state?: string; port?: number; gatewayReady?: boolean };
type HostSuccess = { success: boolean };

const ASSEMBLY_ENV = 'VERSE_VTOKEN_ASSEMBLY_ENABLED';

// The seven fields FP-P0-04 requires before `applied`. `launchEnv` is asserted
// separately: it is FP-P0-01/FP-P0-03 evidence, not part of the gating seven.
const ACK_REQUIRED_FIELDS = [
  'gatewayGeneration',
  'childPid',
  'effectiveFlags',
  'configSource',
  'runtimeBuildOrConfigHash',
  'turnEffectProbe',
  'degradedReason',
] as const;

async function allocatePort(): Promise<number> {
  return await new Promise((resolve, reject) => {
    const server = createServer();
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const address = server.address();
      if (!address || typeof address === 'string') {
        server.close(() => reject(new Error('port allocation failed')));
        return;
      }
      server.close((err) => (err ? reject(err) : resolve(address.port)));
    });
  });
}

async function hostInvoke<T>(
  app: ElectronApplication,
  module: string,
  action: string,
  payload: Record<string, unknown> | null = null,
): Promise<T> {
  const response = (await app.evaluate(async (_electron, request) => {
    const { ipcMain, BrowserWindow } = process.mainModule!.require(
      'electron',
    ) as typeof import('electron');
    const handler = (
      ipcMain as unknown as {
        _invokeHandlers?: Map<string, (event: unknown, request: unknown) => Promise<unknown>>;
      }
    )._invokeHandlers?.get('host:invoke');
    if (!handler) throw new Error('host:invoke handler is not registered');
    const win = BrowserWindow.getAllWindows().find((candidate) => !candidate.isDestroyed());
    if (!win) throw new Error('No BrowserWindow available for host:invoke sender auth');
    const sender = win.webContents;
    const event = {
      sender,
      senderFrame: { url: typeof sender.getURL === 'function' ? sender.getURL() : '' },
    };
    return await handler(event, { id: `fp-p0-${Date.now()}-${Math.random()}`, ...request });
  }, { module, action, payload })) as HostResponse<T>;
  if (!response.ok) {
    throw new Error(`[${response.error?.code ?? 'HOST'}] ${response.error?.message ?? 'failed'}`);
  }
  return response.data as T;
}

async function ensureGatewayRunning(app: ElectronApplication, port: number): Promise<void> {
  const deadline = Date.now() + 180_000;
  let attempts = 0;
  let lastStatus: GatewayStatus | undefined;
  let lastError: string | undefined;
  while (Date.now() < deadline) {
    try {
      lastStatus = await hostInvoke<GatewayStatus>(app, 'gateway', 'status');
      if (lastStatus.gatewayReady === true || lastStatus.state === 'running') return;
      if (lastStatus.state !== 'starting' && attempts < 3) {
        attempts += 1;
        try {
          await hostInvoke<HostSuccess>(app, 'gateway', 'start');
        } catch (error) {
          lastError = error instanceof Error ? error.message : String(error);
        }
      }
    } catch (error) {
      lastError = error instanceof Error ? error.message : String(error);
    }
    await new Promise((resolve) => setTimeout(resolve, 2_000));
  }
  throw new Error(
    `gateway never became ready: ${JSON.stringify({ lastStatus, lastError, port })}`,
  );
}

async function seedConfig(
  homeDir: string,
  userDataDir: string,
  workspaceDir: string,
  options: { configKillSwitch?: boolean; enableWorkingMemory?: boolean } = {},
) {
  const config = {
    gateway: { mode: 'local', controlUi: { enabled: false } },
    runtime: {
      contextBlock: {
        sekb: { enabled: false },
        ...(options.enableWorkingMemory
          ? { 'working-memory': { enabled: true }, 'tool-registry': { enabled: true } }
          : {}),
      },
      // FP-P0-02: the *config* form of the kill switch. Before that task this was an
      // empty switch on the Assembler path (only the env form worked).
      ...(options.configKillSwitch ? { contextEnhancement: { killSwitch: true } } : {}),
    },
    agents: { defaults: { workspace: workspaceDir }, list: [{ id: 'main', default: true }] },
  };
  const serialized = `${JSON.stringify(config, null, 2)}\n`;
  const openclawDir = join(homeDir, '.openclaw');
  const sourceStateDir = join(userDataDir, 'openclaw-source-state');
  await mkdir(openclawDir, { recursive: true });
  await mkdir(sourceStateDir, { recursive: true });
  await writeFile(join(openclawDir, 'openclaw.json'), serialized, 'utf8');
  await writeFile(join(sourceStateDir, 'openclaw.json'), serialized, 'utf8');
}

test.describe('FP-P0 runtime launch contract (real gateway child)', () => {
  test('child env omits the VToken assembly opt-in and the child acknowledges its own flags', async ({
    homeDir,
    userDataDir,
    launchElectronApp,
  }) => {
    test.setTimeout(420_000);
    const workspaceDir = await mkdtemp(join(tmpdir(), 'clawx-fp-p0-'));
    await seedConfig(homeDir, userDataDir, workspaceDir);
    // Guarantee the operator did NOT opt in, so "absent" is a real signal.
    const previousAssembly = process.env[ASSEMBLY_ENV];
    delete process.env[ASSEMBLY_ENV];

    const app = await launchElectronApp({ skipSetup: true });
    try {
      const page = await getStableWindow(app);
      await expect(page.getByTestId('main-layout')).toBeVisible({ timeout: 60_000 });

      // ---- start a real gateway child ----
      const port = await allocatePort();
      const set = await hostInvoke<HostSuccess>(app, 'settings', 'set', {
        key: 'gatewayPort',
        value: port,
      });
      expect(set.success).toBe(true);
      await ensureGatewayRunning(app, port);

      const ack = await hostInvoke<Record<string, unknown>>(app, 'gateway', 'rpc', {
        method: 'runtime.flags.ack',
        params: {},
        timeoutMs: 30_000,
      });

      for (const field of ACK_REQUIRED_FIELDS) {
        expect(field in ack, `ack missing required field ${field}`).toBe(true);
      }

      expect('launchEnv' in ack, 'ack missing launchEnv evidence').toBe(true);

      // ---- FP-P0-01 G3 / FP-P0-03: the CHILD's own env, no opt-in was set ----
      // The child reports its own process.env, so `present: false` is direct
      // evidence that the launch layer did not synthesize the opt-in.
      const launchEnv = ack.launchEnv as Record<string, { present: boolean; value?: string }>;
      expect(
        launchEnv[ASSEMBLY_ENV]?.present,
        `child env must not contain ${ASSEMBLY_ENV}; got ${JSON.stringify(launchEnv[ASSEMBLY_ENV])}`,
      ).toBe(false);
      expect(launchEnv[ASSEMBLY_ENV]?.value).toBeUndefined();
      // The kill switch was not set either, so the default really is "nothing on".
      expect(launchEnv.VERSE_CONTEXT_ENHANCEMENT_KILL_SWITCH?.present).toBe(false);
      // FP-P0-04: the launch layer stamped a generation the child read back, so the
      // host can discard acks from an older child. 'unknown' would mean unstamped.
      expect(String(ack.gatewayGeneration)).toMatch(/^\d+$/);
      // The ack must describe a real other process, not the Electron main process.
      expect(typeof ack.childPid).toBe('number');
      expect(ack.childPid as number).toBeGreaterThan(0);
      expect(ack.childPid).not.toBe(process.pid);
      expect(typeof ack.runtimeBuildOrConfigHash).toBe('string');
      expect((ack.runtimeBuildOrConfigHash as string).length).toBeGreaterThan(0);

      // The child resolved VToken assembly OFF, matching default-config-matrix.md.
      const effectiveFlags = ack.effectiveFlags as Record<string, unknown>;
      expect(effectiveFlags['runtime.vtoken.assembly.enabled']).toBe(false);
      expect(effectiveFlags['runtime.contextEnhancement.killSwitch']).toBe(false);

      const probe = ack.turnEffectProbe as { wouldChangeTurn?: unknown };
      expect(typeof probe.wouldChangeTurn).toBe('boolean');

      // ---- FP-P0-05 G3: the shared injection budget is live in the child ----
      const budget = ack.injectionBudget as {
        totalChars?: number;
        precedence?: string[];
        dropAlertRatio?: number;
        counters?: Record<string, number>;
      };
      expect(budget.totalChars).toBeGreaterThan(0);
      // Declared precedence, correctness-bearing context first, enrichment last.
      expect(budget.precedence?.[0]).toBe('knowledge');
      expect(budget.precedence).toContain('cvk_addition');
      expect(budget.precedence).toContain('vtoken');
      expect(budget.precedence).toContain('memory_pilot');
      expect(budget.dropAlertRatio).toBeGreaterThan(0);
      // Counters must be summable: applied + dropped + truncated <= requested.
      const counters = budget.counters ?? {};
      for (const key of [
        'turns',
        'killedTurns',
        'appliedChars',
        'requestedChars',
        'droppedChars',
        'truncatedChars',
        'dropAlerts',
      ]) {
        expect(typeof counters[key], `budget counter ${key} missing`).toBe('number');
      }
      expect(
        (counters.appliedChars ?? 0) + (counters.droppedChars ?? 0) + (counters.truncatedChars ?? 0),
      ).toBeLessThanOrEqual(counters.requestedChars ?? 0);


      console.log('[fp-p0-05-budget]', JSON.stringify(budget));


      console.log('[fp-p0-ack]', JSON.stringify({
        childPid: ack.childPid,
        gatewayGeneration: ack.gatewayGeneration,
        configSource: ack.configSource,
        degradedReason: ack.degradedReason,
        turnEffectProbe: ack.turnEffectProbe,
        vtokenAssembly: effectiveFlags['runtime.vtoken.assembly.enabled'],
      }));
    } finally {
      await closeElectronApp(app);
      await rm(workspaceDir, { recursive: true, force: true });
      if (previousAssembly === undefined) delete process.env[ASSEMBLY_ENV];
      else process.env[ASSEMBLY_ENV] = previousAssembly;
    }
  });

  /**
   * FP-P0-02 G3: the CONFIG form of the kill switch, proven inside a real child.
   *
   * The child is given `runtime.contextEnhancement.killSwitch: true` and
   * working-memory/tool-registry turned ON in config. If the config kill were still
   * the empty switch this task fixes, the child would report those flags as enabled
   * and `wouldChangeTurn: true`. No env kill is set, so only the config form can be
   * responsible for the zeroing.
   */
  test('config-form kill switch zeroes the child\'s effective flags with no env kill set', async ({
    homeDir,
    userDataDir,
    launchElectronApp,
  }) => {
    test.setTimeout(420_000);
    const workspaceDir = await mkdtemp(join(tmpdir(), 'clawx-fp-p0-kill-'));
    await seedConfig(homeDir, userDataDir, workspaceDir, {
      configKillSwitch: true,
      enableWorkingMemory: true,
    });
    const previousAssembly = process.env[ASSEMBLY_ENV];
    const previousKill = process.env.VERSE_CONTEXT_ENHANCEMENT_KILL_SWITCH;
    delete process.env[ASSEMBLY_ENV];
    // Critical: no env kill. Any zeroing observed must come from config alone.
    delete process.env.VERSE_CONTEXT_ENHANCEMENT_KILL_SWITCH;

    const app = await launchElectronApp({ skipSetup: true });
    try {
      const page = await getStableWindow(app);
      await expect(page.getByTestId('main-layout')).toBeVisible({ timeout: 60_000 });

      const port = await allocatePort();
      const set = await hostInvoke<HostSuccess>(app, 'settings', 'set', {
        key: 'gatewayPort',
        value: port,
      });
      expect(set.success).toBe(true);
      await ensureGatewayRunning(app, port);

      const ack = await hostInvoke<Record<string, unknown>>(app, 'gateway', 'rpc', {
        method: 'runtime.flags.ack',
        params: {},
        timeoutMs: 30_000,
      });

      const launchEnv = ack.launchEnv as Record<string, { present: boolean }>;
      // Proves the env form was NOT the cause.
      expect(launchEnv.VERSE_CONTEXT_ENHANCEMENT_KILL_SWITCH?.present).toBe(false);

      const effectiveFlags = ack.effectiveFlags as Record<string, unknown>;
      expect(effectiveFlags['runtime.contextEnhancement.killSwitch']).toBe(true);
      // Config said these were on; the kill switch must have zeroed them.
      expect(effectiveFlags['runtime.contextBlock.working_memory.enabled']).toBe(false);
      expect(effectiveFlags['runtime.contextBlock.tool_registry.enabled']).toBe(false);
      expect(effectiveFlags['runtime.vtoken.assembly.enabled']).toBe(false);

      const probe = ack.turnEffectProbe as {
        wouldChangeTurn?: unknown;
        killSwitchEngaged?: unknown;
        activeSurfaces?: unknown;
      };
      expect(probe.killSwitchEngaged).toBe(true);
      expect(probe.wouldChangeTurn).toBe(false);
      expect(probe.activeSurfaces).toEqual([]);


      console.log('[fp-p0-02-config-kill]', JSON.stringify({
        childPid: ack.childPid,
        envKillPresent: launchEnv.VERSE_CONTEXT_ENHANCEMENT_KILL_SWITCH?.present,
        killSwitch: effectiveFlags['runtime.contextEnhancement.killSwitch'],
        workingMemory: effectiveFlags['runtime.contextBlock.working_memory.enabled'],
        toolRegistry: effectiveFlags['runtime.contextBlock.tool_registry.enabled'],
        turnEffectProbe: ack.turnEffectProbe,
      }));
    } finally {
      await closeElectronApp(app);
      await rm(workspaceDir, { recursive: true, force: true });
      if (previousAssembly === undefined) delete process.env[ASSEMBLY_ENV];
      else process.env[ASSEMBLY_ENV] = previousAssembly;
      if (previousKill === undefined) delete process.env.VERSE_CONTEXT_ENHANCEMENT_KILL_SWITCH;
      else process.env.VERSE_CONTEXT_ENHANCEMENT_KILL_SWITCH = previousKill;
    }
  });

  /**
   * FP-P0-04 G3: flip a real flag through the real control plane against a real
   * running gateway, and require that `applied` came from a child acknowledgement.
   *
   * `restartGateway: true` is passed explicitly because the E2E default is to skip
   * auto-restart. The assertion that matters is not "success: true" — it is that the
   * result carries an `ackTrail` ending in `applied` plus a `runtimeAck` whose
   * `childPid` belongs to a real process. If the old "restart() resolved ⇒ applied"
   * logic were still in place, `runtimeAck` would be absent.
   */
  test('flag set reaches applied only via a real child acknowledgement', async ({
    homeDir,
    userDataDir,
    launchElectronApp,
  }) => {
    test.setTimeout(420_000);
    const workspaceDir = await mkdtemp(join(tmpdir(), 'clawx-fp-p0-ack-'));
    await seedConfig(homeDir, userDataDir, workspaceDir);
    const previousAssembly = process.env[ASSEMBLY_ENV];
    delete process.env[ASSEMBLY_ENV];

    const app = await launchElectronApp({ skipSetup: true });
    try {
      const page = await getStableWindow(app);
      await expect(page.getByTestId('main-layout')).toBeVisible({ timeout: 60_000 });

      const port = await allocatePort();
      await hostInvoke<HostSuccess>(app, 'settings', 'set', { key: 'gatewayPort', value: port });
      await ensureGatewayRunning(app, port);

      const result = await hostInvoke<Record<string, unknown>>(app, 'dcsProdFlags', 'setFlag', {
        id: 'working-memory',
        enabled: true,
        restartGateway: true,
      });


      console.log('[fp-p0-04-setflag]', JSON.stringify({
        status: result.status,
        ackTrail: result.ackTrail,
        restartedGateway: result.restartedGateway,
        failureReason: result.failureReason,
        operatorHintKey: result.operatorHintKey,
        gatewayGeneration: result.gatewayGeneration,
        ackChildPid: (result.runtimeAck as { childPid?: number } | undefined)?.childPid,
        ackGeneration: (result.runtimeAck as { gatewayGeneration?: string } | undefined)
          ?.gatewayGeneration,
        ackMissingFields: result.ackMissingFields,
      }));

      expect(result.success).toBe(true);
      // The trail must be the real ordered lifecycle, not a two-state shortcut.
      expect(result.ackTrail).toEqual([
        'saved',
        'pending-restart',
        'restarting',
        'runtime-acknowledged',
        'applied',
      ]);
      expect(result.status).toBe('applied');
      // applied is only legitimate with a child ack attached.
      const ack = result.runtimeAck as Record<string, unknown> | undefined;
      expect(ack, 'applied without runtimeAck would be the old unverifiable behavior').toBeDefined();
      for (const field of ACK_REQUIRED_FIELDS) {
        expect(field in (ack ?? {}), `runtimeAck missing ${field}`).toBe(true);
      }
      expect(typeof ack?.childPid).toBe('number');
      expect(ack?.childPid).not.toBe(process.pid);
      // The ack must be for the generation the host waited on, not an older child.
      expect(ack?.gatewayGeneration).toBe(result.gatewayGeneration);
      expect(result.ackMissingFields).toBeUndefined();

      // The flag the operator asked for is really on in the child now.
      const effectiveFlags = ack?.effectiveFlags as Record<string, unknown>;
      expect(effectiveFlags['runtime.contextBlock.working_memory.enabled']).toBe(true);
      // ...and the turn-effect probe reports that it would actually change a turn.
      expect((ack?.turnEffectProbe as { wouldChangeTurn?: unknown }).wouldChangeTurn).toBe(true);
    } finally {
      await closeElectronApp(app);
      await rm(workspaceDir, { recursive: true, force: true });
      if (previousAssembly === undefined) delete process.env[ASSEMBLY_ENV];
      else process.env[ASSEMBLY_ENV] = previousAssembly;
    }
  });
});
