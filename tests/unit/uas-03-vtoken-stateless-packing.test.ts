import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

function read(path: string): string {
  return readFileSync(path, "utf8");
}

describe("UAS-03 VerseToken stateless production boundary", () => {
  const client = read("openclaw_runtime/src/context-engine/vtoken-rpc-client.ts");
  const production = read("openclaw_runtime/src/context-engine/chat-turn-vtoken-injection.ts");
  const worker = read("packages/vtoken/src/vtoken/host_rpc.py");

  it("uses one versioned pack request without a global exclusive transaction", () => {
    expect(client).toContain('VTOKEN_PACK_REQUEST_SCHEMA = "VtokenPackRequest/v1"');
    expect(client).toContain('"vt.pack"');
    expect(client).not.toContain("runExclusive");
    expect(production).toContain("client.pack({");
    expect(production).not.toContain("client.open(");
    expect(production).not.toContain("sessionDir");
    expect(production).not.toContain("resolveDefaultVtokenSessionDir");
  });

  it("labels estimates and keeps stateless requests off the shared store", () => {
    expect(client).toContain('VTOKEN_PACK_ESTIMATE_METHOD = "chars_div_4"');
    expect(production).toContain("estimated_tokens=");
    expect(production).toContain("estimate_method=");
    expect(worker).toContain('if method == "vt.pack"');
    expect(worker).toContain('store = UnifiedStore(doc_graph=SIRGraph("doc"), mem_store=None)');
    expect(worker).toContain("ThreadPoolExecutor");
  });
});
