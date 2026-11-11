import { EventEmitter } from 'node:events';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const originalPlatform = process.platform;

const {
  mockExec,
  mockExecFile,
  mockCreateServer,
  mockProcessKill,
} = vi.hoisted(() => ({
  mockExec: vi.fn(),
  mockExecFile: vi.fn(),
  mockCreateServer: vi.fn(),
  mockProcessKill: vi.fn(),
}));

vi.mock('electron', () => ({
  app: {
    isPackaged: false,
    getPath: () => '/tmp',
  },
  utilityProcess: {},
}));

vi.mock('child_process', () => ({
  exec: mockExec,
  execFile: mockExecFile,
  execSync: vi.fn(),
  spawn: vi.fn(),
  default: {
    exec: mockExec,
    execFile: mockExecFile,
    execSync: vi.fn(),
    spawn: vi.fn(),
  },
}));

vi.mock('net', () => ({
  createServer: mockCreateServer,
}));

class MockUtilityChild extends EventEmitter {
  pid?: number;
  kill = vi.fn();

  constructor(pid?: number) {
    super();
    this.pid = pid;
  }
}

function setPlatform(platform: string): void {
  Object.defineProperty(process, 'platform', { value: platform, writable: true });
}

describe('gateway supervisor process cleanup', () => {
  it('uses a native exit receipt emitted before stop was called', async () => {
    setPlatform('win32');
    const child = new MockUtilityChild(4321);
    const { observeOwnedGatewayProcess, terminateOwnedGatewayProcess } = await import('@electron/gateway/supervisor');
    observeOwnedGatewayProcess(child as unknown as Electron.UtilityProcess);
    child.emit('exit', 0);
    await terminateOwnedGatewayProcess(child as unknown as Electron.UtilityProcess);
    expect(mockExec).not.toHaveBeenCalled();
    expect(child.kill).not.toHaveBeenCalled();
  });

  it('shares one native termination request between concurrent stop callers', async () => {
    setPlatform('linux');
    const child = new MockUtilityChild(4321);
    const { terminateOwnedGatewayProcess } = await import('@electron/gateway/supervisor');
    const first = terminateOwnedGatewayProcess(child as unknown as Electron.UtilityProcess);
    const second = terminateOwnedGatewayProcess(child as unknown as Electron.UtilityProcess);
    try {
      expect(child.kill).toHaveBeenCalledOnce();
      expect(mockExec).not.toHaveBeenCalled();
    } finally { child.emit('exit', 0); await Promise.allSettled([first, second]); }
  });

  it('keeps termination unconfirmed when the native owner emits no exit receipt', async () => {
    setPlatform('win32');
    const child = new MockUtilityChild(4321);
    const { terminateOwnedGatewayProcess } = await import('@electron/gateway/supervisor');
    vi.useFakeTimers();
    try {
      const stopped = terminateOwnedGatewayProcess(child as unknown as Electron.UtilityProcess);
      void stopped.catch(() => undefined);
      await vi.advanceTimersByTimeAsync(10000);
      await expect(stopped).rejects.toThrow('did not exit');
    } finally { vi.useRealTimers(); }
  });

  beforeEach(() => {
    vi.resetModules();
    vi.clearAllMocks();
    mockProcessKill.mockReturnValue(true);
    vi.spyOn(process, 'kill').mockImplementation(mockProcessKill);

    mockExec.mockImplementation((_cmd: string, _opts: object, cb: (err: Error | null, stdout: string) => void) => {
      cb(null, '');
      return {} as never;
    });
    mockExecFile.mockImplementation((_file: string, _args: string[], _opts: object, cb: (err: Error | null) => void) => {
      cb(null);
      return {} as never;
    });

    mockCreateServer.mockImplementation(() => {
      const handlers = new Map<string, (...args: unknown[]) => void>();
      return {
        once(event: string, callback: (...args: unknown[]) => void) {
          handlers.set(event, callback);
          return this;
        },
        listen() {
          queueMicrotask(() => handlers.get('listening')?.());
          return this;
        },
        close(callback?: () => void) {
          callback?.();
        },
      };
    });
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
    Object.defineProperty(process, 'platform', { value: originalPlatform, writable: true });
    vi.restoreAllMocks();
  });

  it('force-kills the owned Windows pid when process enumeration and the utility kill path stall', async () => {
    setPlatform('win32');
    const child = new MockUtilityChild(4321);
    // Neither the helper callback nor UtilityProcess.kill produces an exit.
    mockExec.mockImplementation(() => ({}));
    mockExecFile.mockImplementation(() => ({}));
    const kill = vi.spyOn(process, 'kill').mockImplementation(() => {
      queueMicrotask(() => child.emit('exit', 1));
      return true;
    });
    const { terminateOwnedGatewayProcess } = await import('@electron/gateway/supervisor');
    vi.useFakeTimers();
    const stopped = terminateOwnedGatewayProcess(child as unknown as Electron.UtilityProcess)
      .then(() => 'exited', () => 'timeout');
    await vi.advanceTimersByTimeAsync(10_001);
    expect(await stopped).toBe('exited');
    expect(kill).toHaveBeenCalledWith(4321, 'SIGKILL');
    expect(child.listenerCount('exit')).toBe(0);
  });

  it('uses taskkill tree strategy for owned process on Windows', async () => {
    setPlatform('win32');
    const child = new MockUtilityChild(4321);
    const { terminateOwnedGatewayProcess } = await import('@electron/gateway/supervisor');

    const stopPromise = terminateOwnedGatewayProcess(child as unknown as Electron.UtilityProcess);
    child.emit('exit', 0);
    await stopPromise;

    await vi.waitFor(() => {
      expect(mockExecFile).toHaveBeenCalledWith(
        'taskkill.exe', ['/F', '/PID', '4321', '/T'],
        expect.objectContaining({ timeout: 5000, windowsHide: true }),
        expect.any(Function),
      );
    });
    expect(child.kill).not.toHaveBeenCalled();
  });

  it('uses the owned UtilityProcess handle when Windows tree termination stalls', async () => {
    setPlatform('win32');
    const child = new MockUtilityChild(4321);
    mockExecFile.mockImplementation(() => ({}));
    const directKill = vi.spyOn(process, 'kill').mockReturnValue(true);
    child.kill.mockImplementation(() => {
      queueMicrotask(() => child.emit('exit', 0));
      return true;
    });
    const { terminateOwnedGatewayProcess } = await import('@electron/gateway/supervisor');
    vi.useFakeTimers();
    const stopped = terminateOwnedGatewayProcess(child as unknown as Electron.UtilityProcess)
      .then(() => 'exited', () => 'timeout');
    await vi.advanceTimersByTimeAsync(10_001);
    expect(await stopped).toBe('exited');
    expect(child.kill).toHaveBeenCalledOnce();
    expect(directKill).not.toHaveBeenCalled();
  });
  it('waits for the owned exit event when the pid disappears before Electron delivers it', async () => {
    setPlatform('win32');
    const child = new MockUtilityChild(4321);
    mockExecFile.mockImplementation(() => ({}));
    vi.spyOn(process, 'kill').mockImplementation(() => { throw Object.assign(new Error('kill ESRCH'), { code: 'ESRCH' }); });
    const { terminateOwnedGatewayProcess } = await import('@electron/gateway/supervisor');
    vi.useFakeTimers();
    let state = 'pending';
    const stopped = terminateOwnedGatewayProcess(child as unknown as Electron.UtilityProcess)
      .then(() => { state = 'exited'; }, () => { state = 'rejected'; });
    await vi.advanceTimersByTimeAsync(5000);
    expect(state).toBe('pending');
    child.emit('exit', 0);
    await stopped;
    expect(state).toBe('exited');
  });

  it('uses direct child.kill for owned process on non-Windows', async () => {
    setPlatform('linux');
    const child = new MockUtilityChild(9876);
    const { terminateOwnedGatewayProcess } = await import('@electron/gateway/supervisor');

    const stopPromise = terminateOwnedGatewayProcess(child as unknown as Electron.UtilityProcess);
    child.emit('exit', 0);
    await stopPromise;

    expect(child.kill).toHaveBeenCalledTimes(1);
  });

  it('still force-kills a POSIX gateway that ignores graceful termination', async () => {
    setPlatform('linux');
    const child = new MockUtilityChild(9876);
    child.kill.mockReturnValue(true);
    const kill = vi.spyOn(process, 'kill').mockImplementation(() => {
      queueMicrotask(() => child.emit('exit', 1));
      return true;
    });
    const { terminateOwnedGatewayProcess } = await import('@electron/gateway/supervisor');
    vi.useFakeTimers();
    const stopped = terminateOwnedGatewayProcess(child as unknown as Electron.UtilityProcess)
      .then(() => 'exited', () => 'timeout');
    await vi.advanceTimersByTimeAsync(10_001);
    expect(await stopped).toBe('exited');
    expect(kill).toHaveBeenCalledWith(9876, 'SIGKILL');
    expect(child.kill).toHaveBeenCalledOnce();
  });

  it('uses the owned pid when Windows taskkill fails and waits for exit', async () => {
    setPlatform('win32');
    const child = new MockUtilityChild(4321);
    const kill = vi.spyOn(process, 'kill').mockReturnValue(true);
    mockExecFile.mockImplementation((_file: string, _args: string[], _opts: object, cb: (error: Error) => void) => {
      cb(new Error('process enumeration timed out'));
      return {} as never;
    });
    const { terminateOwnedGatewayProcess } = await import('@electron/gateway/supervisor');
    let resolved = false;
    const stopped = terminateOwnedGatewayProcess(child as unknown as Electron.UtilityProcess).then(() => { resolved = true; });
    await vi.waitFor(() => expect(kill).toHaveBeenCalledWith(4321, 'SIGKILL'));
    expect(resolved).toBe(false);
    child.emit('exit', 0);
    await stopped;
    expect(resolved).toBe(true);
    expect(mockExecFile).toHaveBeenCalledOnce();
  });

  it('waits for the original exit receipt when the forced PID has already exited', async () => {
    setPlatform('win32');
    const child = new MockUtilityChild(4321);
    mockExecFile.mockImplementation((_file: string, _args: string[], _opts: object, cb: (error: Error) => void) => {
      cb(new Error('process enumeration timed out'));
      return {} as never;
    });
    mockProcessKill.mockImplementation(() => { throw Object.assign(new Error('process exited'), { code: 'ESRCH' }); });
    const { terminateOwnedGatewayProcess } = await import('@electron/gateway/supervisor');
    let resolved = false;
    const stopped = terminateOwnedGatewayProcess(child as unknown as Electron.UtilityProcess).then(() => { resolved = true; });
    try {
      await vi.waitFor(() => expect(mockProcessKill).toHaveBeenCalledWith(4321, 'SIGKILL'));
      expect(resolved).toBe(false);
    } finally { child.emit('exit', 0); await stopped; }
    expect(resolved).toBe(true);
  });

  // #98: a port listener is an observation, not ownership. The supervisor must fail closed and
  // report the conflict instead of granting itself implicit kill rights over a foreign process.
  it('fails closed on a foreign listener instead of killing it', async () => {
    setPlatform('win32');
    const { findExistingGatewayProcess, GatewayPortConflictError } = await import('@electron/gateway/supervisor');

    mockExec.mockImplementation((cmd: string, _opts: object, cb: (err: Error | null, stdout: string) => void) => {
      if (cmd.includes('netstat -ano')) {
        cb(null, '  TCP    127.0.0.1:18789    0.0.0.0:0    LISTENING    4321\n');
        return {} as never;
      }
      cb(null, '');
      return {} as never;
    });

    await expect(findExistingGatewayProcess({ port: 18789 })).rejects.toBeInstanceOf(GatewayPortConflictError);
    expect(mockExec).not.toHaveBeenCalledWith(
      expect.stringContaining('taskkill'),
      expect.anything(),
      expect.anything(),
    );
    expect(mockCreateServer).not.toHaveBeenCalled();
  });

  it('treats the owned gateway pid as its own listener and probes the port', async () => {
    setPlatform('win32');
    const { findExistingGatewayProcess } = await import('@electron/gateway/supervisor');

    mockExec.mockImplementation((cmd: string, _opts: object, cb: (err: Error | null, stdout: string) => void) => {
      if (cmd.includes('netstat -ano')) {
        cb(null, '  TCP    127.0.0.1:18789    0.0.0.0:0    LISTENING    4321\n');
        return {} as never;
      }
      cb(null, '');
      return {} as never;
    });

    // The listener is the gateway we own, so no conflict is raised: the call resolves through the
    // readiness probe (which has no live server in this unit environment) instead of failing closed.
    await expect(findExistingGatewayProcess({ port: 18789, ownedPid: 4321 })).resolves.toBeNull();
    expect(mockExec).not.toHaveBeenCalledWith(
      expect.stringContaining('taskkill'),
      expect.anything(),
      expect.anything(),
    );
  });
});
