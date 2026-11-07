import { app, utilityProcess } from 'electron';
import path from 'path';
import { existsSync } from 'fs';
import { getActiveOpenClawDir, getActiveOpenClawEntryPath } from '../utils/paths';
import { getUvMirrorEnv } from '../utils/uv-env';
import { isPythonReady, setupManagedPython } from '../utils/uv-setup';
import { logger } from '../utils/logger';
import { prependPathEntry } from '../utils/env-path';
import { listConfiguredChannelsFromConfig, readOpenClawConfig } from '../utils/channel-config';
import { probeGatewayReady } from './ws-client';

export function warmupManagedPythonReadiness(): void {
  void isPythonReady().then((pythonReady) => {
    if (!pythonReady) {
      logger.info('Python environment missing or incomplete, attempting background repair...');
      void setupManagedPython().catch((err) => {
        logger.error('Background Python repair failed:', err);
      });
    }
  }).catch((err) => {
    logger.error('Failed to check Python environment:', err);
  });
}

export async function terminateOwnedGatewayProcess(child: Electron.UtilityProcess): Promise<void> {
  const terminateWindowsProcessTree = async (pid: number): Promise<void> => {
    const cp = await import('child_process');
    await new Promise<void>((resolve, reject) => {
      cp.execFile('taskkill.exe', ['/F', '/PID', String(pid), '/T'], { timeout: 5000, windowsHide: true }, (error) => error ? reject(error) : resolve());
    });
  };

  await new Promise<void>((resolve, reject) => {
    let exited = false;
    let forced = false;
    let timeout: ReturnType<typeof setTimeout>;
    const forceTerminate = () => {
      if (exited || forced) return;
      forced = true;
      clearTimeout(timeout);
      // taskkill can stall when Windows process enumeration is unavailable.
      // Terminate the still-owned pid directly if the helper or utility IPC stalls.
      // Keep waiting for the exit event; signalling alone is not proof of exit.
      timeout = setTimeout(() => {
        child.removeListener('exit', onExit);
        reject(new Error(`Owned Gateway process did not exit (pid=${child.pid ?? 'unknown'})`));
      }, 5000);
      try {
        if (child.pid) process.kill(child.pid, 'SIGKILL');
        else child.kill();
      } catch (error) {
        clearTimeout(timeout);
        child.removeListener('exit', onExit);
        reject(error);
      }
    };

    // Register a single exit listener before any kill attempt to avoid
    // the race where exit fires between two separate `once('exit')` calls.
    const onExit = () => {
      exited = true;
      clearTimeout(timeout);
      resolve();
    };
    child.once('exit', onExit);

    const pid = child.pid;
    logger.info(`Sending kill to Gateway process (pid=${pid ?? 'unknown'})`);
    timeout = setTimeout(forceTerminate, 5000);

    if (process.platform === 'win32' && pid) {
      void terminateWindowsProcessTree(pid).catch((err) => {
        logger.warn(`Windows process-tree kill failed for Gateway pid=${pid}:`, err);
        forceTerminate();
      });
    } else {
      try {
        child.kill();
      } catch {
        // ignore if already exited
      }
    }

  });
}

export async function unloadLaunchctlGatewayService(): Promise<void> {
  if (process.platform !== 'darwin') return;

  try {
    const uid = process.getuid?.();
    if (uid === undefined) return;

    const launchdLabel = 'ai.openclaw.gateway';
    const serviceTarget = `gui/${uid}/${launchdLabel}`;
    const cp = await import('child_process');
    const fsPromises = await import('fs/promises');
    const os = await import('os');

    const loaded = await new Promise<boolean>((resolve) => {
      cp.exec(`launchctl print ${serviceTarget}`, { timeout: 5000 }, (err) => {
        resolve(!err);
      });
    });

    if (!loaded) return;

    logger.info(`Unloading launchctl service ${serviceTarget} to prevent auto-respawn`);
    await new Promise<void>((resolve) => {
      cp.exec(`launchctl bootout ${serviceTarget}`, { timeout: 10000 }, (err) => {
        if (err) {
          logger.warn(`Failed to bootout launchctl service: ${err.message}`);
        } else {
          logger.info('Successfully unloaded launchctl gateway service');
        }
        resolve();
      });
    });

    await new Promise((resolve) => setTimeout(resolve, 2000));

    try {
      const plistPath = path.join(os.homedir(), 'Library', 'LaunchAgents', `${launchdLabel}.plist`);
      await fsPromises.access(plistPath);
      await fsPromises.unlink(plistPath);
      logger.info(`Removed legacy launchd plist to prevent reload on next login: ${plistPath}`);
    } catch {
      // File doesn't exist or can't be removed -- not fatal
    }
  } catch (err) {
    logger.warn('Error while unloading launchctl gateway service:', err);
  }
}

export async function waitForPortFree(port: number, timeoutMs = 30000): Promise<void> {
  const net = await import('net');
  const start = Date.now();
  const pollInterval = 500;
  let logged = false;

  while (Date.now() - start < timeoutMs) {
    const available = await new Promise<boolean>((resolve) => {
      const server = net.createServer();
      server.once('error', () => resolve(false));
      server.once('listening', () => {
        server.close(() => resolve(true));
      });
      server.listen(port, '127.0.0.1');
    });

    if (available) {
      const elapsed = Date.now() - start;
      if (elapsed > pollInterval) {
        logger.info(`Port ${port} became available after ${elapsed}ms`);
      }
      return;
    }

    if (!logged) {
      logger.info(`Waiting for port ${port} to become available (Windows TCP TIME_WAIT)...`);
      logged = true;
    }
    await new Promise((resolve) => setTimeout(resolve, pollInterval));
  }

  logger.error(`Port ${port} still occupied after ${timeoutMs}ms; aborting startup to avoid port conflict`);
  throw new Error(`Port ${port} still occupied after ${timeoutMs}ms`);
}

async function getListeningProcessIds(port: number): Promise<string[]> {
  const cmd = process.platform === 'win32'
    ? `netstat -ano | findstr :${port}`
    : `lsof -i :${port} -sTCP:LISTEN -t`;

  const cp = await import('child_process');
  const { stdout } = await new Promise<{ stdout: string }>((resolve) => {
    cp.exec(cmd, { timeout: 5000, windowsHide: true }, (err, stdout) => {
      if (err) {
        resolve({ stdout: '' });
      } else {
        resolve({ stdout });
      }
    });
  });

  if (!stdout.trim()) {
    return [];
  }

  if (process.platform === 'win32') {
    const pids: string[] = [];
    for (const line of stdout.trim().split(/\r?\n/)) {
      const parts = line.trim().split(/\s+/);
      if (parts.length >= 5 && parts[3] === 'LISTENING') {
        pids.push(parts[4]);
      }
    }
    return [...new Set(pids)];
  }

  return [...new Set(stdout.trim().split(/\r?\n/).map((value) => value.trim()).filter(Boolean))];
}

export type GatewayPortConflict = { port: number; pids: string[] };
export class GatewayPortConflictError extends Error {
  readonly conflict: GatewayPortConflict;
  constructor(conflict: GatewayPortConflict) {
    super(`Gateway port ${conflict.port} is already owned by PID(s) ${conflict.pids.join(', ')}`);
    this.name = 'GatewayPortConflictError';
    this.conflict = conflict;
  }
}

export async function findExistingGatewayProcess(options: {
  port: number;
  ownedPid?: number;
}): Promise<{ port: number; externalToken?: string } | null> {
  const { port, ownedPid } = options;

  try {
    const pids = await getListeningProcessIds(port);
    if (pids.length > 0 && (!ownedPid || !pids.includes(String(ownedPid)))) {
      throw new GatewayPortConflictError({ port, pids });
    }
  } catch (err) {
    if (err instanceof GatewayPortConflictError) throw err;
    logger.warn('Error checking for existing process on port:', err);
  }

  try {
    const ready = await probeGatewayReady(port, 5000);
    return ready ? { port } : null;
  } catch {
    return null;
  }
}

async function shouldSkipChannelsForDoctorRepair(): Promise<boolean> {
  try {
    const config = await readOpenClawConfig();
    return (await listConfiguredChannelsFromConfig(config)).length === 0;
  } catch (error) {
    logger.warn('Failed to determine channel policy for OpenClaw doctor repair:', error);
    return false;
  }
}

export async function runOpenClawDoctorRepair(): Promise<boolean> {
  const openclawDir = getActiveOpenClawDir();
  const entryScript = getActiveOpenClawEntryPath();
  if (!existsSync(entryScript)) {
    logger.error(`Cannot run OpenClaw doctor repair: entry script not found at ${entryScript}`);
    return false;
  }

  const platform = process.platform;
  const arch = process.arch;
  const target = `${platform}-${arch}`;
  const binPath = app.isPackaged
    ? path.join(process.resourcesPath, 'bin')
    : path.join(process.cwd(), 'resources', 'bin', target);
  const binPathExists = existsSync(binPath);
  const baseProcessEnv = process.env as Record<string, string | undefined>;
  const baseEnvPatched = binPathExists
    ? prependPathEntry(baseProcessEnv, binPath).env
    : baseProcessEnv;

  const uvEnv = await getUvMirrorEnv();
  const skipChannels = await shouldSkipChannelsForDoctorRepair();
  const doctorArgs = ['doctor', '--fix', '--yes', '--non-interactive'];
  logger.info(
    `Running OpenClaw doctor repair (entry="${entryScript}", args="${doctorArgs.join(' ')}", cwd="${openclawDir}", bundledBin=${binPathExists ? 'yes' : 'no'})`,
  );

  return await new Promise<boolean>((resolve) => {
    const forkEnv: Record<string, string | undefined> = {
      ...baseEnvPatched,
      ...uvEnv,
      OPENCLAW_NO_RESPAWN: '1',
      // Electron's utilityProcess.fork rejects non-string env values, so an unset
      // inherited skip-channels flag must fall back to '' rather than undefined.
      OPENCLAW_SKIP_CHANNELS: skipChannels ? '1' : (baseEnvPatched.OPENCLAW_SKIP_CHANNELS ?? ''),
      CLAWDBOT_SKIP_CHANNELS: skipChannels ? '1' : (baseEnvPatched.CLAWDBOT_SKIP_CHANNELS ?? ''),
    };

    const child = utilityProcess.fork(entryScript, doctorArgs, {
      cwd: openclawDir,
      stdio: 'pipe',
      env: forkEnv as NodeJS.ProcessEnv,
    });

    let settled = false;
    const finish = (ok: boolean) => {
      if (settled) return;
      settled = true;
      resolve(ok);
    };

    const timeout = setTimeout(() => {
      logger.error('OpenClaw doctor repair timed out after 120000ms');
      try {
        child.kill();
      } catch {
        // ignore
      }
      finish(false);
    }, 120000);

    child.on('error', (err) => {
      clearTimeout(timeout);
      logger.error('Failed to spawn OpenClaw doctor repair process:', err);
      finish(false);
    });

    child.stdout?.on('data', (data) => {
      const raw = data.toString();
      for (const line of raw.split(/\r?\n/)) {
        const normalized = line.trim();
        if (!normalized) continue;
        logger.debug(`[Gateway doctor stdout] ${normalized}`);
      }
    });

    child.stderr?.on('data', (data) => {
      const raw = data.toString();
      for (const line of raw.split(/\r?\n/)) {
        const normalized = line.trim();
        if (!normalized) continue;
        logger.warn(`[Gateway doctor stderr] ${normalized}`);
      }
    });

    child.on('exit', (code: number) => {
      clearTimeout(timeout);
      if (code === 0) {
        logger.info('OpenClaw doctor repair completed successfully');
        finish(true);
        return;
      }
      logger.warn(`OpenClaw doctor repair exited (code=${code})`);
      finish(false);
    });
  });
}
