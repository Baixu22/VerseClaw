#!/usr/bin/env node
// 轻量 WS RPC 客户端 — 验证真实 gateway 链路（测试用，不入库）
// 用法: node scripts/ws-rpc-client.mjs <method> [json-params]
import WebSocket from "ws";

const WS_URL = process.env.OPENCLAW_WS_URL ?? "ws://127.0.0.1:18799/ws";
const method = process.argv[2];
const rawParams = process.argv[3];
const params = rawParams ? JSON.parse(rawParams) : {};

const ws = new WebSocket(WS_URL);
const startedAt = Date.now();

ws.on("open", async () => {
  // 1. connect hello — 格式: {type:"req", id, method:"connect", params: ConnectParams}
  const token = process.env.OPENCLAW_GATEWAY_TOKEN;
  const clientId = process.env.OPENCLAW_CLIENT_ID ?? "gateway-client";
  const clientMode = process.env.OPENCLAW_CLIENT_MODE ?? "backend";
  const scopes = (process.env.OPENCLAW_SCOPES ?? "operator.read,operator.write")
    .split(",").map((s) => s.trim()).filter(Boolean);
  ws.send(JSON.stringify({
    type: "req",
    id: "connect-1",
    method: "connect",
    params: {
      minProtocol: 4,
      maxProtocol: 4,
      client: {
        id: clientId,
        version: "0.1.0",
        platform: "win32",
        mode: clientMode,
      },
      ...(token ? { auth: { token } } : {}),
      ...(scopes.length ? { scopes } : {}),
    },
  }));
  // 2. 稍后发请求
  setTimeout(() => {
    ws.send(JSON.stringify({
      type: "req",
      id: `probe-${Date.now()}`,
      method,
      params,
    }));
  }, 300);
});

ws.on("message", (data) => {
  const frame = JSON.parse(data.toString());
  if (frame.type === "res") {
    // 跳过 connect 握手响应，只处理目标方法响应
    if (frame.id === "connect-1") return;
    const elapsed = Date.now() - startedAt;
    console.log(JSON.stringify({
      method,
      ok: frame.ok,
      elapsedMs: elapsed,
      payload: frame.ok ? frame.payload : undefined,
      error: frame.error,
    }, null, 2));
    ws.close();
    process.exit(frame.ok ? 0 : 1);
  } else if (frame.type === "event") {
    // 忽略事件流，只看响应
  }
});

ws.on("error", (err) => {
  console.error("WS error:", err.message);
  process.exit(1);
});

setTimeout(() => {
  console.error("TIMEOUT: no response in 30s");
  process.exit(2);
}, 30000);
