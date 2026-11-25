import { EventEmitter } from "node:events";
import type { IncomingMessage } from "node:http";
import type { WebSocketServer } from "ws";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import type { GatewayRequestContext } from "../server-methods/types.js";
import { createSubsystemLogger } from "../../logging/subsystem.js";
import { attachGatewayWsConnectionHandler } from "./ws-connection.js";
import type { GatewayWsMessageHandlerParams } from "./ws-connection/message-handler.js";

const state = vi.hoisted(() => ({
  loaded: 0,
  process: vi.fn<(data: Buffer) => Promise<void>>(),
  create: vi.fn<(params: GatewayWsMessageHandlerParams) => (data: Buffer) => Promise<void>>(),
  attach: vi.fn<(params: GatewayWsMessageHandlerParams) => void>(),
}));
vi.mock("./ws-connection/message-handler.js", () => {
  state.loaded++;
  return {
    createGatewayWsMessageProcessor: state.create,
    runGatewayWsMessageProcessor: (handle: (data: Buffer) => Promise<void>, data: Buffer) =>
      handle(data),
    attachGatewayWsMessageHandler: state.attach,
  };
});

const sockets: FakeSocket[] = [];
class FakeSocket extends EventEmitter {
  bufferedAmount = 0;
  _socket = {
    remoteAddress: "127.0.0.1",
    remotePort: 12345,
    localAddress: "127.0.0.1",
    localPort: 18789,
  };
  send = vi.fn<(data: string) => void>();
  ping = vi.fn();
  close = vi.fn((code = 1000, reason = "") => this.emit("close", code, Buffer.from(reason)));
}

function connect(startupPending = false) {
  const wss = new EventEmitter();
  const socket = new FakeSocket();
  sockets.push(socket);
  const log = createSubsystemLogger("ws-lazy-test");
  const context = { unsubscribeAllSessionEvents: vi.fn() };
  const release = vi.fn();
  attachGatewayWsConnectionHandler({
    wss: wss as WebSocketServer,
    port: 18789,
    clients: new Set(),
    resolvedAuth: { mode: "token", token: "test-token", allowTailscale: false },
    preauthConnectionBudget: { acquire: () => true, release },
    isStartupPending: () => startupPending,
    gatewayMethods: ["health"],
    events: [],
    extraHandlers: {},
    logGateway: log,
    logHealth: log,
    logWsControl: log,
    broadcast: vi.fn(),
    buildRequestContext: () => context as unknown as GatewayRequestContext,
    refreshHealthSnapshot: async () => {
      throw new Error("Unexpected health refresh");
    },
  });
  wss.emit("connection", socket, {
    headers: { host: "127.0.0.1:18789" },
    socket: socket._socket,
  } as IncomingMessage);
  return { socket, release, context };
}

beforeEach(() => {
  vi.useFakeTimers();
  vi.clearAllMocks();
  state.process.mockResolvedValue(undefined);
  state.create.mockImplementation(() => state.process);
  state.attach.mockImplementation(({ socket }) => {
    socket.on("message", state.process);
  });
});
afterEach(() => {
  for (const socket of sockets.splice(0)) socket.close();
  vi.clearAllTimers();
  vi.useRealTimers();
});

it("answers pending and ready probes without importing the RPC handler", async () => {
  for (const pending of [true, false]) {
    const { socket, release } = connect(pending);
    const challenge = JSON.parse(socket.send.mock.calls[0][0]);
    expect(challenge).toMatchObject({ type: "event", event: "connect.challenge" });
    expect(challenge.payload.startupPending === true).toBe(pending);
    socket.close();
    expect(release).toHaveBeenCalledOnce();
  }
  await vi.dynamicImportSettled();
  expect(state.loaded).toBe(0);
  expect(state.create).not.toHaveBeenCalled();
});

it("loads on the first frame and drains queued frames serially before live attachment", async () => {
  let finishFirst!: () => void;
  state.process.mockImplementationOnce(
    () =>
      new Promise<void>((resolve) => {
        finishFirst = resolve;
      }),
  );
  const { socket } = connect();
  const frames = ["connect", "first-rpc", "next-rpc", "live-rpc"].map((name) => Buffer.from(name));
  socket.emit("message", frames[0]);
  socket.emit("message", frames[1]);
  await vi.waitFor(() => expect(state.process).toHaveBeenCalledOnce());
  socket.emit("message", frames[2]);
  expect(state.attach).not.toHaveBeenCalled();
  finishFirst();
  await vi.dynamicImportSettled();
  expect(state.create).toHaveBeenCalledOnce();
  expect(state.attach).toHaveBeenCalledOnce();
  expect(state.process.mock.calls.map(([data]) => data)).toEqual(frames.slice(0, 3));
  expect(socket.listenerCount("message")).toBe(1);
  socket.emit("message", frames[3]);
  expect(state.process).toHaveBeenLastCalledWith(frames[3]);
});

it("keeps the pre-handler frame limit and discards closed connections before dispatch", async () => {
  const { socket } = connect();
  for (let frame = 0; frame < 17; frame++) socket.emit("message", Buffer.from(String(frame)));
  expect(socket.close).toHaveBeenCalledWith(1008, "gateway message handler loading");
  await vi.dynamicImportSettled();
  expect(state.create).not.toHaveBeenCalled();
  expect(state.process).not.toHaveBeenCalled();
  expect(state.attach).not.toHaveBeenCalled();
  expect(socket.listenerCount("message")).toBe(0);
});

it("drops queued frames when the socket closes during the first dispatch", async () => {
  let finishFirst!: () => void;
  state.process.mockImplementationOnce(
    () =>
      new Promise<void>((resolve) => {
        finishFirst = resolve;
      }),
  );
  const { socket } = connect();
  socket.emit("message", Buffer.from("connect"));
  socket.emit("message", Buffer.from("queued"));
  await vi.waitFor(() => expect(state.process).toHaveBeenCalledOnce());
  socket.close();
  finishFirst();
  await vi.dynamicImportSettled();
  expect(state.process).toHaveBeenCalledOnce();
  expect(state.attach).not.toHaveBeenCalled();
  expect(socket.listenerCount("message")).toBe(0);
});

it("keeps processing queued frames after a request handler rejects", async () => {
  state.process.mockRejectedValueOnce(new Error("request failed"));
  const { socket } = connect();
  socket.emit("message", Buffer.from("failed"));
  socket.emit("message", Buffer.from("next"));
  await vi.dynamicImportSettled();
  expect(state.process).toHaveBeenCalledTimes(2);
  expect(state.attach).toHaveBeenCalledOnce();
});

it("retains the handshake timeout for a connection that sends no request", async () => {
  const { socket, release } = connect();
  await vi.advanceTimersByTimeAsync(60_000);
  expect(socket.close).toHaveBeenCalled();
  expect(release).toHaveBeenCalledOnce();
  expect(state.create).not.toHaveBeenCalled();
});
