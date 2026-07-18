import { createHmac } from "node:crypto";
import { createServer, request } from "node:http";
import { afterEach, describe, expect, it } from "vitest";
import {
  createTaskFlowWebhookRequestHandler,
  type TaskFlowWebhookTarget,
} from "./http.js";

const secret = "webhook-integration-secret";
const body = JSON.stringify({ action: "list_flows" });

function signature(timestamp: string): string {
  return createHmac("sha256", secret).update(`${timestamp}.${body}`).digest("hex");
}

describe("task-flow webhook inbound trust", () => {
  const servers: Array<ReturnType<typeof createServer>> = [];
  afterEach(async () => {
    await Promise.all(servers.splice(0).map((server) => new Promise<void>((resolve) => server.close(() => resolve()))));
  });

  async function createPostClient(): Promise<(headers: Record<string, string>) => Promise<{ status: number; text: string }>> {
    const taskFlow = {
      list: () => [],
    } as unknown as TaskFlowWebhookTarget["taskFlow"];
    const target: TaskFlowWebhookTarget = {
      routeId: "integration",
      path: "/hooks/task-flow",
      secretInput: secret,
      secretConfigPath: "plugins.webhooks.secret",
      defaultControllerId: "main",
      taskFlow,
    };
    const handler = createTaskFlowWebhookRequestHandler({
      cfg: {},
      targetsByPath: new Map([[target.path, [target]]]),
    });
    const server = createServer((req, res) => void handler(req, res));
    servers.push(server);
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    const address = server.address();
    if (!address || typeof address === "string") throw new Error("missing test server address");
    return async (headers) => await new Promise((resolve, reject) => {
        const req = request({
          hostname: "127.0.0.1",
          port: address.port,
          path: target.path,
          method: "POST",
          headers: { "content-type": "application/json", "content-length": String(Buffer.byteLength(body)), ...headers },
        }, (res) => {
          const chunks: Buffer[] = [];
          res.on("data", (chunk: Buffer) => chunks.push(chunk));
          res.on("end", () => resolve({ status: res.statusCode ?? 0, text: Buffer.concat(chunks).toString("utf8") }));
        });
        req.on("error", reject);
        req.end(body);
      });
  }

  it("rejects missing and stale signatures, accepts once, then rejects replay", async () => {
    const post = await createPostClient();
    expect((await post({})).status).toBeGreaterThanOrEqual(400);

    const stale = String(Date.now() - 10 * 60_000);
    expect((await post({
      "x-openclaw-webhook-timestamp": stale,
      "x-openclaw-webhook-event-id": "evt-stale",
      "x-openclaw-webhook-signature": signature(stale),
    })).status).toBeGreaterThanOrEqual(400);

    const timestamp = String(Date.now());
    const trustedHeaders = {
      "x-openclaw-webhook-timestamp": timestamp,
      "x-openclaw-webhook-event-id": "evt-once",
      "x-openclaw-webhook-signature": signature(timestamp),
    };
    expect((await post(trustedHeaders)).status).toBe(200);
    expect((await post(trustedHeaders)).status).toBe(409);
  });
});
