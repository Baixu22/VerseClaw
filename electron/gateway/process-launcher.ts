import { app, utilityProcess } from 'electron';
import { existsSync, writeFileSync } from 'fs';
import path from 'path';
import type { GatewayLaunchContext } from './config-sync';
import type { GatewayLifecycleState } from './process-policy';
import { logger } from '../utils/logger';
import { appendNodeRequireToNodeOptions } from '../utils/paths';
import {
  prependOfficeCliPathToEnv,
  type OfficeCliPathOptions,
} from '../utils/officecli-path';
import { nextGatewayGeneration, stampGatewayGeneration } from './generation';
import { observeOwnedGatewayProcess } from './supervisor';

/** Flags that would carry a Gateway shared secret into a child process argv. */
const GATEWAY_SECRET_ARGUMENT_FLAGS = new Set(['--token', '--password', '--gateway-token']);

/**
 * Removes `--token` / `--password` / `--gateway-token` flag+value pairs whose
 * value matches a known Gateway secret.
 *
 * A child process command line is readable by other same-user processes, so the
 * shared token must reach the Gateway through the environment, never through
 * argv (issue #130). Values that do not match a known secret are left untouched,
 * so this guard cannot silently drop an unrelated argument.
 */
export function stripGatewaySecretArgs(
  args: string[],
  secrets: Array<string | undefined>,
): { args: string[]; strippedFlags: string[] } {
  const knownSecrets = new Set(
    secrets.map((secret) => secret?.trim()).filter((secret): secret is string => Boolean(secret)),
  );
  if (knownSecrets.size === 0) {
    return { args: [...args], strippedFlags: [] };
  }
  const next: string[] = [];
  const strippedFlags: string[] = [];
  for (let index = 0; index < args.length; index += 1) {
    const flag = args[index];
    const value = args[index + 1];
    if (GATEWAY_SECRET_ARGUMENT_FLAGS.has(flag) && typeof value === 'string' && knownSecrets.has(value)) {
      strippedFlags.push(flag);
      index += 1;
      continue;
    }
    next.push(flag);
  }
  return { args: next, strippedFlags };
}

const GATEWAY_FETCH_PRELOAD_SOURCE = `'use strict';
(function () {
  var _f = globalThis.fetch;
  if (typeof _f !== 'function') return;
  if (globalThis.__verseClawFetchPatched) return;
  globalThis.__verseClawFetchPatched = true;

  globalThis.fetch = function verseClawFetch(input, init) {
    var url =
      typeof input === 'string' ? input
        : input && typeof input === 'object' && typeof input.url === 'string'
          ? input.url : '';

    if (url.indexOf('openrouter.ai') !== -1) {
      init = init ? Object.assign({}, init) : {};
      var prev = init.headers;
      var flat = {};
      if (prev && typeof prev.forEach === 'function') {
        prev.forEach(function (v, k) { flat[k] = v; });
      } else if (prev && typeof prev === 'object') {
        Object.assign(flat, prev);
      }
      delete flat['http-referer'];
      delete flat['HTTP-Referer'];
      delete flat['x-title'];
      delete flat['X-Title'];
      delete flat['x-openrouter-title'];
      delete flat['X-OpenRouter-Title'];
      flat['HTTP-Referer'] =
        process.env.VERSE_CLAW_OPENROUTER_REFERER || 'https://verseclaw.dev';
      flat['X-OpenRouter-Title'] =
        process.env.VERSE_CLAW_OPENROUTER_TITLE || 'Verse Claw';
      init.headers = flat;
    }
    return _f.call(globalThis, input, init);
  };

  if (process.platform === 'win32') {
    try {
      var cp = require('child_process');
      if (!cp.__verseClawPatched) {
        cp.__verseClawPatched = true;
        ['spawn', 'exec', 'execFile', 'fork', 'spawnSync', 'execSync', 'execFileSync'].forEach(function(method) {
          var original = cp[method];
          if (typeof original !== 'function') return;
          cp[method] = function() {
            var args = Array.prototype.slice.call(arguments);
            var optIdx = -1;
            for (var i = 1; i < args.length; i++) {
              var a = args[i];
              if (a && typeof a === 'object' && !Array.isArray(a)) {
                optIdx = i;
                break;
              }
            }
            if (optIdx >= 0) {
              args[optIdx].windowsHide = true;
            } else {
              var opts = { windowsHide: true };
              if (typeof args[args.length - 1] === 'function') {
                args.splice(args.length - 1, 0, opts);
              } else {
                args.push(opts);
              }
            }
            return original.apply(this, args);
          };
        });
      }
    } catch (e) {
      // ignore
    }
  }
})();
`;

function ensureGatewayFetchPreload(): string {
  const dest = path.join(app.getPath('userData'), 'gateway-fetch-preload.cjs');
  try {
    writeFileSync(dest, GATEWAY_FETCH_PRELOAD_SOURCE, 'utf-8');
  } catch {
    // best-effort
  }
  return dest;
}

export function buildGatewayRuntimeEnv(
  forkEnv: Record<string, string | undefined>,
  officeCliOptions?: OfficeCliPathOptions,
): Record<string, string | undefined> {
  const runtimeEnv = prependOfficeCliPathToEnv({ ...forkEnv }, officeCliOptions).env;

  // Disable OpenClaw's mDNS/Bonjour gateway advertiser unconditionally.
  //
  // The OpenClaw gateway advertises `_openclaw-gw._tcp.local` on every
  // active network interface using a hardcoded `openclaw.local` hostname,
  // which causes:
  //   - cross-machine name collisions when multiple OpenClaw/Verse Claw peers
  //     share a LAN (each falls back to "<name> (OpenClaw) (2)")
  //   - self-collisions on multi-homed hosts (Wi-Fi + Tailscale + utun ...)
  //   - "ghost" record collisions after an unclean Verse Claw exit, because
  //     SIGKILL prevents ciao from emitting the mDNS goodbye record.
  //
  // Verse Claw has no UI for LAN gateway discovery today, so the advertiser is
  // pure log noise.  `OPENCLAW_DISABLE_BONJOUR=1` short-circuits
  // `startGatewayBonjourAdvertiser()` (openclaw `src/infra/bonjour.ts`,
  // `isDisabledByEnv()`).  Set after the `forkEnv` spread so any
  // pre-existing value inherited from the user shell cannot re-enable it.
  runtimeEnv.OPENCLAW_DISABLE_BONJOUR = '1';
  runtimeEnv.CLAWX_AGENT_BROWSER_BRIDGE = '1';
  runtimeEnv.CLAWX_TASK_SCOPE_BRIDGE = '1';
  runtimeEnv.OPENCLAW_RESOURCE_ENVELOPE_WRITE = '1';
  // Model fallback skip cache: default ON for Verse Claw with a 60s TTL.
  //
  // The OpenClaw fallback chain retries every configured candidate on each
  // turn by default, including candidates that just failed with a
  // non-transient credential error (`auth` / `auth_permanent`).  That repeats
  // a known-bad request every turn until the operator fixes the credential.
  // `OPENCLAW_FALLBACK_SKIP_TTL_MS` opts into a session-scoped, in-memory skip
  // cache for those candidates (openclaw_runtime
  // `src/agents/fallback-skip-cache.ts`); the runtime clamps the TTL to
  // 1s-10min and clears the cache on gateway process restart.  60000 matches
  // the example in the OpenClaw model-failover docs.  Only set the default
  // when no explicit value was inherited from the user shell, so an operator
  // override — including `0` to disable — always wins.
  if (!runtimeEnv.OPENCLAW_FALLBACK_SKIP_TTL_MS?.trim()) {
    runtimeEnv.OPENCLAW_FALLBACK_SKIP_TTL_MS = '60000';
  }
  // FP-P0-01: Verse Token assembly is an opt-in product default (OFF).  The
  // launcher must NOT synthesize a value here: the runtime resolver
  // (`vtoken-rpc-client.ts` `isVtokenAssemblyEnvEnabled` /
  // `isVtokenAssemblyEnvForcedOn`) treats unset as OFF, explicit truthy as
  // canary opt-in, and explicit `0`/`false`/`off` as a kill that outranks every
  // enable source.  Writing a default would erase the unset state and make
  // `docs/dev/default-config-matrix.md` ("false (opt-in)") false.  Any
  // inherited user-shell value passes through the `forkEnv` spread untouched.

  return runtimeEnv;
}

export async function launchGatewayProcess(options: {
  port: number;
  launchContext: GatewayLaunchContext;
  sanitizeSpawnArgs: (args: string[]) => string[];
  getCurrentState: () => GatewayLifecycleState;
  getShouldReconnect: () => boolean;
  onStderrLine: (line: string) => void;
  onSpawn: (pid: number | undefined) => void;
  onExit: (child: Electron.UtilityProcess, code: number | null) => void;
  onError: (error: Error) => void;
}): Promise<{ child: Electron.UtilityProcess; lastSpawnSummary: string }> {
  const {
    openclawDir,
    entryScript,
    entryScriptArgs,
    execArgv,
    gatewayArgs,
    forkEnv,
    mode,
    runtimeMode,
    binPathExists,
    loadedProviderKeyCount,
    proxySummary,
    channelStartupSummary,
  } = options.launchContext;
  const finalArgs = [...entryScriptArgs, ...gatewayArgs];
  const sanitizedArgs = options.sanitizeSpawnArgs(finalArgs);
  // Second line of defence for issue #130: even if a future edit puts a secret
  // flag back into the launch args, the credential never reaches the real argv.
  const { args: spawnArgs, strippedFlags } = stripGatewaySecretArgs(finalArgs, [
    forkEnv.OPENCLAW_GATEWAY_TOKEN,
    forkEnv.OPENCLAW_GATEWAY_PASSWORD,
  ]);
  if (strippedFlags.length > 0) {
    logger.warn(
      `Removed Gateway secret argument(s) from the spawned argv (${strippedFlags.join(', ')}); ` +
        'the shared secret is provided through the environment instead.',
    );
  }

  logger.info(
    `Starting Gateway process (mode=${mode}, runtime=${runtimeMode}, port=${options.port}, entry="${entryScript}", args="${sanitizedArgs.join(' ')}", execArgv="${execArgv.join(' ')}", cwd="${openclawDir}", bundledBin=${binPathExists ? 'yes' : 'no'}, providerKeys=${loadedProviderKeyCount}, channels=${channelStartupSummary}, proxy=${proxySummary})`,
  );
  const lastSpawnSummary = `mode=${mode}, runtime=${runtimeMode}, entry="${entryScript}", args="${sanitizedArgs.join(' ')}", execArgv="${execArgv.join(' ')}", cwd="${openclawDir}"`;

  const runtimeEnv = buildGatewayRuntimeEnv(forkEnv);
  // FP-P0-04: stamp the generation so a runtime acknowledgement can be matched to
  // *this* child. An ack carrying an older generation is discarded by the control
  // plane instead of being read as proof that a flag applied.
  stampGatewayGeneration(runtimeEnv, nextGatewayGeneration());

  // Only apply the fetch/child_process preload in dev mode.
  // In packaged builds Electron's UtilityProcess rejects NODE_OPTIONS
  // with --require, logging "Most NODE_OPTIONs are not supported in
  // packaged apps" and the preload never loads.
  if (!app.isPackaged) {
    try {
      const preloadPath = ensureGatewayFetchPreload();
      if (existsSync(preloadPath)) {
        runtimeEnv.NODE_OPTIONS = appendNodeRequireToNodeOptions(
          runtimeEnv.NODE_OPTIONS,
          preloadPath,
        );
      }
    } catch (err) {
      logger.warn('Failed to set up OpenRouter headers preload:', err);
    }
  }

  return await new Promise<{ child: Electron.UtilityProcess; lastSpawnSummary: string }>((resolve, reject) => {
    const child = utilityProcess.fork(entryScript, spawnArgs, {
      cwd: openclawDir,
      stdio: 'pipe',
      env: runtimeEnv as NodeJS.ProcessEnv,
      execArgv,
      serviceName: 'OpenClaw Gateway',
    });
    observeOwnedGatewayProcess(child);
    // Only stderr is forwarded, but stdout is also piped. Drain it so a full
    // Windows pipe cannot block Gateway requests behind routine log output.
    child.stdout?.on('data', () => {});

    let settled = false;
    const resolveOnce = () => {
      if (settled) return;
      settled = true;
      resolve({ child, lastSpawnSummary });
    };
    const rejectOnce = (error: Error) => {
      if (settled) return;
      settled = true;
      reject(error);
    };

    child.on('error', (error: unknown) => {
      const normalizedError = error instanceof Error ? error : new Error(String(error));
      logger.error('Gateway process spawn error:', error);
      options.onError(normalizedError);
      rejectOnce(normalizedError);
    });

    child.on('exit', (code: number) => {
      // Only check shouldReconnect — not current state.  On Windows the WS
      // close handler fires before the process exit handler and sets state to
      // 'stopped', which would make an unexpected crash look like a planned
      // shutdown in logs.  shouldReconnect is the reliable indicator: stop()
      // sets it to false (expected), crashes leave it true (unexpected).
      const expectedExit = !options.getShouldReconnect();
      const level = expectedExit ? logger.info : logger.warn;
      level(`Gateway process exited (code=${code}, expected=${expectedExit ? 'yes' : 'no'})`);
      options.onExit(child, code);
    });

    child.stderr?.on('data', (data) => {
      const raw = data.toString();
      for (const line of raw.split(/\r?\n/)) {
        options.onStderrLine(line);
      }
    });

    child.on('spawn', () => {
      logger.info(`Gateway process started (pid=${child.pid})`);
      options.onSpawn(child.pid);
      resolveOnce();
    });
  });
}
