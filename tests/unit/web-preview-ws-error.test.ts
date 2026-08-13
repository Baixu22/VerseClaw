// R0-1: web-preview WS proxy — client socket error + upstream timeout
// @vitest-environment node
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { Server } from 'node:http';
import { attachWebSocketProxyUpgrade } from '../../electron/services/web-preview-manager';

type Listener = (...args: unknown[]) => void;

function makeEmitter(extra: Record<string, unknown> = {}) {
  const listeners = new Map<string, Listener[]>();
  const onceListeners = new Map<string, Listener[]>();
  return {
    listeners,
    onceListeners,
    on(event: string, cb: Listener) {
      listeners.set(event, [...(listeners.get(event) ?? []), cb]);
      return this;
    },
    once(event: string, cb: Listener) {
      onceListeners.set(event, [...(onceListeners.get(event) ?? []), cb]);
      return this;
    },
    emit(event: string, ...args: unknown[]) {
      for (const cb of onceListeners.get(event) ?? []) cb(...args);
      for (const cb of listeners.get(event) ?? []) cb(...args);
      return true;
    },
    destroy: vi.fn(),
    write: vi.fn(),
    pipe: vi.fn(() => ({ on: vi.fn(), once: vi.fn() })),
    ...extra,
  };
}

function makeServer() {
  let upgradeHandler: Listener | null = null;
  const server = {
    on(event: string, cb: Listener) {
      if (event === 'upgrade') upgradeHandler = cb;
      return this;
    },
  };
  return {
    server: server as unknown as Server,
    fireUpgrade: (req: unknown, socket: unknown, head: unknown) => {
      if (!upgradeHandler) throw new Error('upgrade handler not registered');
      upgradeHandler(req, socket, head);
    },
  };
}

function makeRequest() {
  return {
    method: 'GET',
    httpVersion: '1.1',
    url: '/ws',
    headers: { host: '127.0.0.1:1', connection: 'Upgrade' },
  };
}

describe('web-preview WS proxy upgrade (R0-1)', () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it('registers a client-socket error listener and destroys the socket on error (no crash)', () => {
    const { server, fireUpgrade } = makeServer();
    const upstream = makeEmitter();
    const connect = vi.fn(() => upstream);
    attachWebSocketProxyUpgrade(server, new URL('http://127.0.0.1:1/'), connect as never);

    const clientSocket = makeEmitter();
    fireUpgrade(makeRequest(), clientSocket, Buffer.alloc(0));

    // The whole point of R0-1: an error listener is attached so an ECONNRESET
    // from a refresh/close is swallowed and the socket destroyed.
    expect(clientSocket.listeners.has('error')).toBe(true);
    clientSocket.emit('error', new Error('ECONNRESET'));
    expect(clientSocket.destroy).toHaveBeenCalledTimes(1);
  });

  it('destroys the client socket when the upstream errors before connect', () => {
    const { server, fireUpgrade } = makeServer();
    const upstream = makeEmitter();
    const connect = vi.fn(() => upstream);
    attachWebSocketProxyUpgrade(server, new URL('http://127.0.0.1:1/'), connect as never);

    const clientSocket = makeEmitter();
    fireUpgrade(makeRequest(), clientSocket, Buffer.alloc(0));

    upstream.emit('error', new Error('ECONNREFUSED'));
    expect(clientSocket.destroy).toHaveBeenCalledTimes(1);
  });

  it('times out a never-connecting upstream and destroys both sockets', () => {
    vi.useFakeTimers();
    const { server, fireUpgrade } = makeServer();
    const upstream = makeEmitter();
    const connect = vi.fn(() => upstream);
    attachWebSocketProxyUpgrade(server, new URL('http://127.0.0.1:1/'), connect as never);

    const clientSocket = makeEmitter();
    fireUpgrade(makeRequest(), clientSocket, Buffer.alloc(0));

    expect(upstream.destroy).not.toHaveBeenCalled();
    expect(clientSocket.destroy).not.toHaveBeenCalled();

    vi.advanceTimersByTime(30_000);

    expect(upstream.destroy).toHaveBeenCalledTimes(1);
    expect(clientSocket.destroy).toHaveBeenCalledTimes(1);
  });

  it('writes the upgrade request line and pipes both directions on connect', () => {
    const { server, fireUpgrade } = makeServer();
    const upstream = makeEmitter();
    const connect = vi.fn(() => upstream);
    attachWebSocketProxyUpgrade(server, new URL('http://127.0.0.1:1/'), connect as never);

    const clientSocket = makeEmitter();
    fireUpgrade(makeRequest(), clientSocket, Buffer.alloc(0));

    upstream.emit('connect');

    expect(upstream.write).toHaveBeenCalledWith('GET /ws HTTP/1.1\r\n');
    expect(upstream.pipe).toHaveBeenCalledWith(clientSocket);
    expect(clientSocket.pipe).toHaveBeenCalledWith(upstream);
  });
});
