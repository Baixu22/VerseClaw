import { describe, expect, it } from "vitest";
import {
  buildRuntimeSymbolOverview,
  createLspUnavailableSymbolResult,
  createRuntimeSymbolCheckpoint,
  findRuntimeSymbols,
  groupRuntimeSymbolReferences,
  resolveRuntimeSymbolCheckpoint,
  type RuntimeLspDocumentSymbol,
  type RuntimeSymbolRange,
} from "../../openclaw_runtime/src/runtime-core";

const range = (
  startLine: number,
  startCharacter: number,
  endLine: number,
  endCharacter: number,
): RuntimeSymbolRange => ({
  start: { line: startLine, character: startCharacter },
  end: { line: endLine, character: endCharacter },
});

const dashboardSymbols: RuntimeLspDocumentSymbol[] = [
  {
    name: "Dashboard",
    kind: "Function",
    detail: "Dashboard(): JSX.Element",
    range: range(0, 0, 14, 1),
    selectionRange: range(0, 16, 0, 25),
    children: [
      {
        name: "useData",
        kind: "Function",
        detail: "useData(): Data",
        range: range(2, 2, 4, 3),
        selectionRange: range(2, 11, 2, 18),
      },
      {
        name: "render",
        kind: "Function",
        range: range(6, 2, 12, 3),
        selectionRange: range(6, 11, 6, 17),
      },
    ],
  },
  {
    name: "Sidebar",
    kind: "Function",
    range: range(16, 0, 22, 1),
    selectionRange: range(16, 16, 16, 23),
    children: [
      {
        name: "render",
        kind: "Function",
        range: range(18, 2, 20, 3),
        selectionRange: range(18, 11, 18, 17),
      },
    ],
  },
];

describe("runtime symbol readonly behavior", () => {
  it("requires namePath when same-name symbols are ambiguous", () => {
    const overview = buildRuntimeSymbolOverview({
      file: "src/ui/Dashboard.tsx",
      symbols: dashboardSymbols,
    });

    const ambiguous = findRuntimeSymbols([overview], { name: "render" });
    const resolved = findRuntimeSymbols([overview], { namePath: ["Dashboard", "render"] });

    expect(ambiguous).toMatchObject({
      ok: false,
      operation: "find",
      fallback: {
        reason: "ambiguous",
        metadata: {
          matches: expect.arrayContaining([
            expect.objectContaining({ namePath: ["Dashboard", "render"] }),
            expect.objectContaining({ namePath: ["Sidebar", "render"] }),
          ]),
        },
      },
    });
    expect(resolved).toMatchObject({
      ok: true,
      data: [
        expect.objectContaining({
          name: "render",
          namePath: ["Dashboard", "render"],
          file: "src/ui/Dashboard.tsx",
        }),
      ],
    });
  });

  it("groups cross-file references with snippets", () => {
    const groups = groupRuntimeSymbolReferences({
      locations: [
        {
          uri: "file:///C:/repo/src/ui/Dashboard.tsx",
          range: range(8, 12, 8, 19),
        },
        {
          uri: "file:///C:/repo/src/hooks/useData.ts",
          range: range(2, 16, 2, 23),
        },
        {
          uri: "file:///C:/repo/src/ui/Dashboard.tsx",
          range: range(10, 4, 10, 11),
        },
      ],
      snippets: {
        "C:/repo/src/ui/Dashboard.tsx": [
          "",
          "",
          "",
          "",
          "",
          "",
          "",
          "",
          "const rows = useData();",
          "",
          "useData.refresh();",
        ],
        "C:/repo/src/hooks/useData.ts": ["", "", "export function useData() {"],
      },
      evidence: [{ type: "tool", ref: "lsp.references", label: "LSP references" }],
    });

    expect(groups).toEqual([
      {
        file: "C:/repo/src/hooks/useData.ts",
        references: [
          expect.objectContaining({
            snippet: "export function useData() {",
            range: range(2, 16, 2, 23),
          }),
        ],
      },
      {
        file: "C:/repo/src/ui/Dashboard.tsx",
        references: [
          expect.objectContaining({ snippet: "const rows = useData();" }),
          expect.objectContaining({ snippet: "useData.refresh();" }),
        ],
      },
    ]);
  });

  it("uses structured diagnostics fallback when no LSP session is available", () => {
    const diagnostics = createLspUnavailableSymbolResult("diagnostics");

    expect(diagnostics).toMatchObject({
      ok: false,
      operation: "diagnostics",
      fallback: {
        reason: "lsp_unavailable",
        retryable: true,
      },
      diagnostics: [
        {
          code: "symbol.lsp_unavailable",
          severity: "warning",
        },
      ],
    });
  });

  it("relocates checkpoints by namePath and reports drift on content mismatch", () => {
    const overview = buildRuntimeSymbolOverview({
      file: "src/ui/Dashboard.tsx",
      symbols: dashboardSymbols,
    });
    const found = findRuntimeSymbols([overview], { namePath: ["Dashboard", "useData"] });
    expect(found.ok).toBe(true);
    if (!found.ok) {
      return;
    }

    const checkpoint = createRuntimeSymbolCheckpoint({
      symbol: found.data[0],
      contentHash: "hash-a",
      createdAt: 100,
    });
    const movedOverview = buildRuntimeSymbolOverview({
      file: "src/ui/Dashboard.tsx",
      symbols: [
        {
          ...dashboardSymbols[0],
          children: [
            {
              ...dashboardSymbols[0].children![0],
              range: range(4, 2, 6, 3),
              selectionRange: range(4, 11, 4, 18),
            },
            dashboardSymbols[0].children![1],
          ],
        },
      ],
    });

    const relocated = resolveRuntimeSymbolCheckpoint({
      checkpoint,
      overviews: [movedOverview],
      contentHash: "hash-a",
    });
    const drifted = resolveRuntimeSymbolCheckpoint({
      checkpoint,
      overviews: [movedOverview],
      contentHash: "hash-b",
    });

    expect(relocated).toMatchObject({
      status: "relocated",
      symbol: {
        namePath: ["Dashboard", "useData"],
        range: range(4, 2, 6, 3),
      },
      diagnostics: [
        {
          code: "symbol.checkpoint_relocated",
          severity: "info",
        },
      ],
    });
    expect(drifted).toMatchObject({
      status: "drifted",
      fallback: {
        operation: "checkpoint",
        reason: "checkpoint_drift",
        retryable: true,
      },
      diagnostics: [
        {
          code: "symbol.checkpoint_drift",
          severity: "warning",
        },
      ],
    });
  });
});
