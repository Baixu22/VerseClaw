import { describe, expect, it } from "vitest";
import {
  RUNTIME_SYMBOL_READONLY_OPERATIONS,
  buildRuntimeSymbolOverview,
  createLspUnavailableSymbolResult,
  createRuntimeSymbolFallback,
  isRuntimeSymbolContractDiagnostic,
  isRuntimeSymbolFallback,
  isRuntimeSymbolNode,
  isRuntimeSymbolOverview,
  runtimeSymbolFailure,
  runtimeSymbolSuccess,
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

describe("runtime symbol readonly contracts", () => {
  it("exposes only readonly operations", () => {
    expect([...RUNTIME_SYMBOL_READONLY_OPERATIONS]).toEqual([
      "overview",
      "find",
      "references",
      "diagnostics",
      "checkpoint",
    ]);
  });

  it("normalizes document symbols into stable contract nodes", () => {
    const documentSymbols: RuntimeLspDocumentSymbol[] = [
      {
        name: "Panel",
        kind: "Class",
        range: range(0, 0, 12, 1),
        selectionRange: range(0, 6, 0, 11),
        children: [
          {
            name: "render",
            kind: "Method",
            detail: "render(): JSX.Element",
            range: range(2, 2, 6, 3),
            selectionRange: range(2, 8, 2, 14),
          },
        ],
      },
    ];

    const overview = buildRuntimeSymbolOverview({
      file: "src/Panel.tsx",
      symbols: documentSymbols,
    });

    expect(isRuntimeSymbolOverview(overview)).toBe(true);
    expect(overview.symbols[0]).toMatchObject({
      symbolId: "src/Panel.tsx#Panel@1",
      namePath: ["Panel"],
      bodyRange: range(0, 0, 12, 1),
    });
    expect(overview.symbols[0].children[0]).toMatchObject({
      symbolId: "src/Panel.tsx#Panel/render@1.1",
      namePath: ["Panel", "render"],
      signature: "render(): JSX.Element",
    });
    expect(isRuntimeSymbolNode(overview.symbols[0].children[0])).toBe(true);
  });

  it("validates structured fallback and result envelopes", () => {
    const fallback = createRuntimeSymbolFallback({
      operation: "references",
      reason: "lsp_unavailable",
      message: "No session-scoped language server is available.",
      retryable: true,
    });
    const failed = runtimeSymbolFailure(fallback, [
      {
        code: "symbol.lsp_unavailable",
        severity: "warning",
        message: fallback.message,
      },
    ]);
    const successful = runtimeSymbolSuccess("diagnostics", []);

    expect(isRuntimeSymbolFallback(fallback)).toBe(true);
    expect(failed).toMatchObject({
      ok: false,
      operation: "references",
      fallback: { reason: "lsp_unavailable", retryable: true },
    });
    expect(failed.diagnostics.every(isRuntimeSymbolContractDiagnostic)).toBe(true);
    expect(successful).toEqual({
      ok: true,
      operation: "diagnostics",
      data: [],
      diagnostics: [],
    });
  });

  it("returns structured LSP-unavailable fallback for readonly calls", () => {
    const result = createLspUnavailableSymbolResult("overview");

    expect(result).toMatchObject({
      ok: false,
      operation: "overview",
      fallback: {
        operation: "overview",
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
});
