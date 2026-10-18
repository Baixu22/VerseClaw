import {
  exec as nodeExec,
  execFile as nodeExecFile,
  execFileSync as nodeExecFileSync,
  execSync as nodeExecSync,
  fork as nodeFork,
  spawn as nodeSpawn,
  spawnSync as nodeSpawnSync,
} from 'node:child_process';
import {
  recordChildProcessSpawn,
  type SpawnMethod,
} from '../services/performance-metrics';

type AnyFunction = (...args: unknown[]) => unknown;

function counted(method: SpawnMethod, original: AnyFunction): AnyFunction {
  return (...args: unknown[]) => {
    recordChildProcessSpawn(method, args);
    return original(...args);
  };
}

export const exec = counted('exec', nodeExec as unknown as AnyFunction) as typeof nodeExec;
export const execFile = counted('execFile', nodeExecFile as unknown as AnyFunction) as typeof nodeExecFile;
export const execFileSync = counted('execFileSync', nodeExecFileSync as unknown as AnyFunction) as typeof nodeExecFileSync;
export const execSync = counted('execSync', nodeExecSync as unknown as AnyFunction) as typeof nodeExecSync;
export const fork = counted('fork', nodeFork as unknown as AnyFunction) as typeof nodeFork;
export const spawn = counted('spawn', nodeSpawn as unknown as AnyFunction) as typeof nodeSpawn;
export const spawnSync = counted('spawnSync', nodeSpawnSync as unknown as AnyFunction) as typeof nodeSpawnSync;
