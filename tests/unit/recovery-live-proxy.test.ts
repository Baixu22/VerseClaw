// @vitest-environment node
import { createServer } from "node:http";
import { expect, it } from "vitest";
import { startRecoveryLiveProxy } from "../e2e/fixtures/recovery-live-proxy";

async function bounded<T>(promise: Promise<T>) {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      promise,
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(new Error("upstream did not close")), 2000);
      }),
    ]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

it.each(["disconnect", "close"])("releases pending upstream I/O on %s", async (method) => {
  let received!: () => void, closed!: () => void;
  const requestReceived = new Promise<void>((resolve) => {
    received = resolve;
  });
  const upstreamClosed = new Promise<void>((resolve) => {
    closed = resolve;
  });
  const upstream = createServer((req, res) => {
    req.resume();
    req.on("end", received);
    res.on("close", closed);
  });
  await new Promise<void>((resolve) => upstream.listen(0, "127.0.0.1", resolve));
  const address = upstream.address();
  if (!address || typeof address === "string") throw new Error("port unavailable");
  const proxy = await startRecoveryLiveProxy({
    baseUrl: `http://127.0.0.1:${address.port}/v1`,
    apiKey: "fixture-key",
    model: "fixture",
  });
  const controller = new AbortController();
  const request = fetch(`http://127.0.0.1:${proxy.port}/v1/chat/completions`, {
    method: "POST",
    body: "{}",
    signal: controller.signal,
  });
  const outcome = request.then(
    () => null,
    (error) => error,
  );
  try {
    await bounded(requestReceived);
    if (method === "disconnect") controller.abort();
    else await bounded(proxy.close());
    expect(await bounded(outcome)).toBeInstanceOf(Error);
    await bounded(upstreamClosed);
    expect(proxy.calls()).toBe(1);
  } finally {
    await proxy.close();
    upstream.closeAllConnections();
    await new Promise<void>((resolve) => upstream.close(() => resolve()));
  }
});
