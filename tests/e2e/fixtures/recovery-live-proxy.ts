import { createServer } from "node:http";

/** A disposable live-provider bridge. Credentials stay in this process only. */
export async function startRecoveryLiveProxy(resource: {
  baseUrl: string;
  apiKey: string;
  model: string;
  timeoutMs?: number;
}) {
  let calls = 0;
  let closing = false;
  let closePromise: Promise<void> | undefined;
  const active = new Set<AbortController>();
  const pending = new Set<Promise<void>>();
  const server = createServer((req, res) => {
    if (closing) {
      res.writeHead(503);
      res.end();
      return;
    }
    if (req.url?.includes("/models")) {
      res.setHeader("content-type", "application/json");
      res.end(JSON.stringify({ data: [{ id: resource.model }] }));
      return;
    }
    if (!req.url?.includes("/chat/completions")) {
      res.writeHead(404);
      res.end();
      return;
    }
    let body = "";
    req.on("data", (chunk) => {
      body += String(chunk);
    });
    req.on("end", () => {
      const controller = new AbortController();
      const disconnect = () => controller.abort(new Error("proxy caller disconnected"));
      active.add(controller);
      res.on("close", disconnect);
      calls++;
      const task = (async () => {
        try {
          const response = await fetch(resource.baseUrl.replace(/\/$/, "") + "/chat/completions", {
            method: "POST",
            headers: {
              "content-type": "application/json",
              authorization: `Bearer ${resource.apiKey}`,
            },
            body,
            signal: AbortSignal.any([
              controller.signal,
              AbortSignal.timeout(resource.timeoutMs ?? 180_000),
            ]),
          });
          if (res.destroyed) return;
          res.writeHead(response.status, {
            "content-type": response.headers.get("content-type") ?? "application/json",
          });
          if (response.body) for await (const chunk of response.body) res.write(chunk);
          res.end();
        } catch (error) {
          if (!res.destroyed) {
            if (res.headersSent) res.destroy();
            else {
              res.writeHead(502);
              res.end(JSON.stringify({ error: { message: String(error) } }));
            }
          }
        } finally {
          res.off("close", disconnect);
          active.delete(controller);
        }
      })();
      pending.add(task);
      void task.finally(() => pending.delete(task));
    });
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("proxy port unavailable");
  return {
    port: address.port,
    calls: () => calls,
    close: () =>
      (closePromise ??= (async () => {
        closing = true;
        const stopped = new Promise<void>((resolve, reject) =>
          server.close((error) => (error ? reject(error) : resolve())),
        );
        for (const controller of active) controller.abort(new Error("proxy closing"));
        server.closeAllConnections();
        await Promise.allSettled([...pending]);
        await stopped;
      })()),
  };
}
