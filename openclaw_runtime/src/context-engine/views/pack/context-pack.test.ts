import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createContextPackContextProvider, CONTEXT_PACK_CONTEXT_PROVIDER_ID } from "../../context-pack-provider.js";
import { closeAllFactStores, FactStore } from "../../factstore/store.js";
import { createMaterializer, type Materializer } from "../../factstore/materialize.js";
import { buildContextPack } from "./context-pack-view.js";
import { formatContextPackMarkdown } from "./markdown.js";

const AUTH_CONFIG_TS = `export interface AuthSettings {
  tokenTtlSeconds: number;
  providerUrl: string;
}

export const DEFAULT_AUTH_CONFIG: AuthSettings = {
  tokenTtlSeconds: 3600,
  providerUrl: "https://auth.example.com",
};

export function loadAuthConfig(env: Record<string, string | undefined>): AuthSettings {
  const config = { ...DEFAULT_AUTH_CONFIG };
  if (env.AUTH_TOKEN_TTL) config.tokenTtlSeconds = Number(env.AUTH_TOKEN_TTL);
  if (env.AUTH_PROVIDER_URL) config.providerUrl = env.AUTH_PROVIDER_URL;
  return config;
}
`;

const PAYMENTS_TS = `export function chargeCard(amountCents: number): string {
  return \`charged \${amountCents}\`;
}
`;

const SESSION_TS = `import { loadAuthConfig } from "./auth-config.js";

export function createSession(env: Record<string, string | undefined>): string {
  const config = loadAuthConfig(env);
  return \`session ttl=\${config.tokenTtlSeconds}\`;
}
`;

const PACK_FIELD_ORDER = [
  "brief",
  "freshness",
  "ownerChain",
  "topology",
  "snippets",
  "missingEvidence",
  "nextQueries",
];

const MARKDOWN_SECTION_ORDER = [
  "## Brief",
  "## Freshness",
  "## Owner chain",
  "## Topology",
  "## Snippets",
  "## Missing evidence",
  "## Next queries",
];

describe("context pack view (gate E)", () => {
  let repoRoot: string;
  let store: FactStore;
  let materializer: Materializer;
  const files = ["src/auth/auth-config.ts", "src/auth/session.ts", "src/payments.ts"];

  beforeEach(() => {
    repoRoot = mkdtempSync(path.join(tmpdir(), "context-pack-test-"));
    writeRepoFile(repoRoot, "src/auth/auth-config.ts", AUTH_CONFIG_TS);
    writeRepoFile(repoRoot, "src/auth/session.ts", SESSION_TS);
    writeRepoFile(repoRoot, "src/payments.ts", PAYMENTS_TS);
    store = new FactStore(path.join(repoRoot, "factstore.sqlite"));
    materializer = createMaterializer(store, repoRoot);
  });

  afterEach(() => {
    store.close();
    rmSync(repoRoot, { recursive: true, force: true });
  });

  it("emits a valid ContextPack with the frozen field order (gate E-1)", async () => {
    const pack = await buildContextPack(store, materializer, {
      query: "loadAuthConfig",
      activeFiles: files,
    });

    expect(pack.query).toBe("loadAuthConfig");
    expect(pack.projectId).toBe(materializer.projectId);
    expect(pack.answerable).toBe(true);
    expect(pack.snippets.length).toBeGreaterThan(0);
    for (const snippet of pack.snippets) {
      expect(snippet.originalLineCount).toBeGreaterThanOrEqual(snippet.returnedLineCount);
      expect(snippet.elidedLineCount).toBe(Math.max(0, snippet.originalLineCount - snippet.returnedLineCount));
    }

    // JSON key order carries the contract order.
    const keys = Object.keys(pack);
    const positions = PACK_FIELD_ORDER.map((field) => keys.indexOf(field));
    expect(positions.every((position) => position >= 0)).toBe(true);
    expect([...positions].sort((a, b) => a - b)).toEqual(positions);

    // Markdown section order is the §6.1 iron rule.
    const markdown = formatContextPackMarkdown(pack);
    const sectionPositions = MARKDOWN_SECTION_ORDER.map((heading) => markdown.indexOf(heading));
    expect(sectionPositions.every((position) => position >= 0)).toBe(true);
    expect([...sectionPositions].sort((a, b) => a - b)).toEqual(sectionPositions);
  });

  it("reproduces the edit-readiness tri-state (gate E-2)", async () => {
    // State 1: full evidence, everything fresh → safe_to_edit_after_reading.
    const safe = await buildContextPack(store, materializer, {
      query: "loadAuthConfig",
      activeFiles: files,
    });
    expect(safe.answerable).toBe(true);
    expect(safe.missingEvidence).toEqual([]);
    expect(safe.editReadiness).toBe("safe_to_edit_after_reading");

    // State 2: evidence exists but provenance is stale → investigate_only.
    store.observeContentHash(repoRoot, "src/auth/auth-config.ts", "d3adbeefd3adbeef");
    const investigate = await buildContextPack(store, materializer, {
      query: "loadAuthConfig",
      activeFiles: [],
    });
    expect(investigate.answerable).toBe(true);
    expect(investigate.freshness.stale).toContain("src/auth/auth-config.ts");
    expect(investigate.editReadiness).toBe("investigate_only");

    // State 3: nothing matches → not_enough_context.
    const notEnough = await buildContextPack(store, materializer, {
      query: "zz_totally_unknown_symbol_qq",
      activeFiles: [],
    });
    expect(notEnough.answerable).toBe(false);
    expect(notEnough.snippets).toEqual([]);
    expect(notEnough.editReadiness).toBe("not_enough_context");
    expect(notEnough.missingEvidence.some((entry) => entry.includes("No indexed evidence matched"))).toBe(true);
  });

  it("declares a ripgrep fallback failure instead of silently reporting an index miss", async () => {
    const failingMaterializer: Materializer = {
      ...materializer,
      ensureTextFacts: async () => ({
        chunks: [],
        backfilled: [],
        truncated: false,
        error: "ripgrep emitted unparseable output",
      }),
    };

    const pack = await buildContextPack(store, failingMaterializer, {
      query: "zz_totally_unknown_symbol_qq",
    });

    expect(pack.answerable).toBe(false);
    expect(pack.missingEvidence).toContain(
      "ripgrep fallback failed: ripgrep emitted unparseable output",
    );
  });

  it("truncates to budget and declares it via context_budget_truncated (gate E-3)", async () => {
    const pack = await buildContextPack(store, materializer, {
      query: "auth config full source 完整",
      activeFiles: files,
      budgetChars: 900,
    });

    expect(pack.budgetTrace?.truncated).toBe(true);
    expect(pack.usedChars).toBeLessThanOrEqual(pack.budgetChars);
    const hintCodes = (pack.missingEvidenceHints ?? []).map((hint) => hint.code);
    expect(hintCodes).toContain("context_budget_truncated");
    expect(pack.missingEvidence.some((entry) => entry.startsWith("Results truncated to fit"))).toBe(true);
  });

  it("lands a Chinese query on the English implementation file (gate E-4)", async () => {
    const pack = await buildContextPack(store, materializer, {
      query: "鉴权在哪配置",
      activeFiles: files,
    });

    expect(pack.answerable).toBe(true);
    const evidenceFiles = new Set([
      ...pack.ownerChain.map((owner) => owner.filePath),
      ...pack.snippets.map((snippet) => snippet.filePath),
    ]);
    expect(evidenceFiles.has("src/auth/auth-config.ts")).toBe(true);
    // The payments file must not outrank the auth config evidence.
    expect(pack.ownerChain[0]?.filePath).toBe("src/auth/auth-config.ts");
  });
});

describe("context pack shadow provider (gate E registration)", () => {
  let repoRoot: string;

  beforeEach(() => {
    repoRoot = mkdtempSync(path.join(tmpdir(), "context-pack-provider-"));
    writeRepoFile(repoRoot, "src/auth/auth-config.ts", AUTH_CONFIG_TS);
    writeRepoFile(repoRoot, "src/payments.ts", PAYMENTS_TS);
  });

  afterEach(() => {
    closeAllFactStores();
    rmSync(repoRoot, { recursive: true, force: true });
  });

  it("registers shadowOnly with the context.understand capability", async () => {
    const provider = createContextPackContextProvider();
    expect(provider.manifest.id).toBe(CONTEXT_PACK_CONTEXT_PROVIDER_ID);
    expect(provider.manifest.shadowOnly).toBe(true);
    expect(provider.manifest.enabledByDefault).toBe(false);
    expect(provider.manifest.capabilities).toContain("context.understand");

    const result = await provider.getContext({
      goal: "loadAuthConfig",
      workspace: repoRoot,
      activeFiles: ["src/auth/auth-config.ts", "src/payments.ts"],
    });
    if (Array.isArray(result)) throw new Error("expected full provider result");
    expect(result.status).toBe("success");
    expect(result.metadata?.shadowOnly).toBe(true);
    expect(result.contextItems[0]?.kind).toBe("summary");
    expect(String(result.contextItems[0]?.text)).toContain("## Brief");
    expect(result.diagnostics.some((entry) => entry.reason === "legacy_authoritative")).toBe(true);
  });

  it("falls back when no workspace or goal is available", async () => {
    const provider = createContextPackContextProvider();
    const result = await provider.getContext({ goal: "anything" });
    if (Array.isArray(result)) throw new Error("expected full provider result");
    expect(result.status).toBe("fallback");
    expect(result.contextItems).toEqual([]);
  });
});

function writeRepoFile(repoRoot: string, relPath: string, content: string): void {
  const absolutePath = path.join(repoRoot, relPath);
  mkdirSync(path.dirname(absolutePath), { recursive: true });
  writeFileSync(absolutePath, content);
}
