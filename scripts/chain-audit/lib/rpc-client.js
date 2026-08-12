#!/usr/bin/env node
/**
 * chain-audit WS RPC 客户端库
 * 封装真实 gateway 的 JSON-RPC 调用：connect 握手 + 请求/响应 + 事件流忽略。
 * 复用三轮验证沉淀的协议细节（protocol v4 + token + scopes + 枚举 client）。
 */
import WebSocket from "ws";

export class RpcClient {
  /**
   * @param {object} opts
   * @param {number} opts.port
   * @param {string} opts.token
   * @param {string} [opts.clientId]  枚举 GATEWAY_CLIENT_IDS
   * @param {string} [opts.clientMode] 枚举 GATEWAY_CLIENT_MODES
   * @param {string[]} [opts.scopes]
   */
  constructor({ port = 18799, token = "", clientId = "gateway-client", clientMode = "backend", scopes = ["operator.read", "operator.write"] }) {
    this.port = port;
    this.token = token;
    this.clientId = clientId;
    this.clientMode = clientMode;
    this.scopes = scopes;
    this.ws = null;
    this.seq = 0;
    this.pending = new Map();
    this.events = [];
  }

  /** 建立连接并完成握手。 */
  async connect() {
    const url = `ws://127.0.0.1:${this.port}/`;
    this.ws = new WebSocket(url);
    await new Promise((resolve, reject) => {
      this.ws.once("open", resolve);
      this.ws.once("error", reject);
    });
    this.ws.on("message", (data) => this._onMessage(data));
    // connect hello
    const connected = await this._request("connect", {
      minProtocol: 4,
      maxProtocol: 4,
      client: {
        id: this.clientId,
        version: "1.0.0",
        platform: "win32",
        mode: this.clientMode,
      },
      ...(this.token ? { auth: { token: this.token } } : {}),
      ...(this.scopes.length ? { scopes: this.scopes } : {}),
    }, 10_000);
    if (!connected.ok) {
      throw new Error(`connect failed: ${JSON.stringify(connected.error)}`);
    }
    return connected.payload;
  }

  /** 调用一个 RPC 方法，返回 {ok, payload, error, elapsedMs}。 */
  async call(method, params = {}, timeoutMs = 120_000) {
    return this._request(method, params, timeoutMs);
  }

  /** 关闭连接。 */
  close() {
    try { this.ws?.close(); } catch { /* ignore */ }
  }

  /** 已接收的事件（用于链路分析）。 */
  eventLog() {
    return this.events;
  }

  _request(method, params, timeoutMs) {
    const id = `audit-${Date.now()}-${++this.seq}`;
    return new Promise((resolve) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        resolve({ ok: false, error: { message: `timeout after ${timeoutMs}ms` }, elapsedMs: timeoutMs });
      }, timeoutMs);
      this.pending.set(id, (frame) => {
        clearTimeout(timer);
        resolve({
          ok: frame.ok,
          payload: frame.ok ? frame.payload : undefined,
          error: frame.error,
          elapsedMs: Date.now() - start,
        });
      });
      const start = Date.now();
      this.ws.send(JSON.stringify({ type: "req", id, method, params }));
    });
  }

  _onMessage(data) {
    let frame;
    try { frame = JSON.parse(data.toString()); } catch { return; }
    if (frame.type === "res") {
      const handler = this.pending.get(frame.id);
      if (handler) { this.pending.delete(frame.id); handler(frame); }
    } else if (frame.type === "event") {
      this.events.push(frame);
    }
  }
}

/** 便捷单次调用（不需要持连接）。 */
export async function rpcOnce(opts, method, params = {}, timeoutMs = 120_000) {
  const client = new RpcClient(opts);
  try {
    await client.connect();
    return await client.call(method, params, timeoutMs);
  } finally {
    client.close();
  }
}
