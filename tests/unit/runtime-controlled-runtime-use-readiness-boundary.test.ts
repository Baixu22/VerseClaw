import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import * as astPlannerExports from "../../openclaw_runtime/src/runtime-core/ast-patch-planner";
import * as runtimeCoreExports from "../../openclaw_runtime/src/runtime-core";
import {
  collectRuntimeRegistryDiagnostics,
  isolateRuntimeRegistryError,
  resolveRuntimeAstPatchPlannerFlags,
  resolveRuntimeRegistryFeatureFlags,
  scanAstPatchPlannerReadonly,
} from "../../openclaw_runtime/src/runtime-core";

const AST_SENTINEL = "AST_READINESS_SENTINEL_NOT_COMPLETION_EVIDENCE";

describe("controlled runtime-use readiness boundary sentinels", () => {
  it("keeps AST planner exports readonly and non-authoritative", () => {
    const astExportNames = Object.keys(astPlannerExports);
    const runtimeAstExportNames = Object.keys(runtimeCoreExports).filter((name) =>
      /astPatchPlanner/i.test(name)
    );
    const forbiddenExportPattern =
      /(apply|write|workspaceEdit|workspaceMutation|symbolMutation|rename|replaceBody|insertBefore|insertAfter|safeDelete|taskLoop|gateway|providerTransport|completionAuthority|persist|service|listener)/i;

    expectNoForbiddenExports(astExportNames, forbiddenExportPattern);
    expectNoForbiddenExports(runtimeAstExportNames, forbiddenExportPattern);
    expect(astExportNames).toEqual(expect.arrayContaining([
      "resolveRuntimeAstPatchPlannerFlags",
      "validateAstPatchPlannerRule",
      "scanAstPatchPlannerReadonly",
      "checkAstPatchPlannerResumeDrift",
    ]));
  });

  it("keeps AST planner source free of mutation, transport, and runtime invocation APIs", () => {
    const source = readRepoFile("openclaw_runtime/src/runtime-core/ast-patch-planner.ts");
    const forbidden = [
      /\bwriteFile(?:Sync)?\b/u,
      /\bappendFile(?:Sync)?\b/u,
      /\bcreateWriteStream\b/u,
      /\bunlink(?:Sync)?\b/u,
      /\bworkspaceEdit\b/u,
      /\bapplyPatch\b/u,
      /\brename\b/u,
      /\breplaceBody\b/u,
      /\binsertBefore\b/u,
      /\binsertAfter\b/u,
      /\bsafeDelete\b/u,
      /\bTaskLoopController\b/u,
      /task-loop-controller/u,
      /\bipcRenderer\b/u,
      /127\.0\.0\.1:18789/u,
      /localhost:18789/u,
      /\bfetch\s*\(/u,
      /\bnew\s+WebSocket\s*\(/u,
      /\bcreateServer\s*\(/u,
      /\.listen\s*\(/u,
      /gateway:httpProxy/u,
      /hostapi:fetch/u,
    ];

    expectNoPatternMatches(source, forbidden);
  });

  it("keeps AST candidate generation explicit, readonly, and outside completion evidence", () => {
    expect(resolveRuntimeAstPatchPlannerFlags({})).toEqual({
      readonlyScan: false,
      previewDiff: false,
    });

    const skipped = scanAstPatchPlannerReadonly({
      rule: {
        language: "typescript",
        pattern: "legacy($VALUE)",
        fix: "modern($VALUE)",
      },
      targetFiles: [{
        filePath: "sentinel.ts",
        content: `const value = legacy("${AST_SENTINEL}");`,
      }],
      config: {},
    });

    expect(skipped.status).toBe("skipped");
    expect(skipped.matches).toEqual([]);
    expect(skipped.previewDiff).toBeUndefined();
    expect(skipped.authority).toMatchObject({
      diagnosticsOnly: true,
      readonly: true,
      noPatchApply: true,
      noWorkspaceMutation: true,
      noSymbolMutation: true,
      noTaskLoopInvocation: true,
      noGatewayIntegration: true,
      noProviderTransportChange: true,
      previewDiffOnly: true,
      previewDiffIsNotCompletionEvidence: true,
    });
  });

  it("keeps registry exports diagnostic-only and away from cutover helpers", () => {
    const registryExportNames = Object.keys(runtimeCoreExports).filter((name) =>
      /registry/i.test(name)
    );
    const forbiddenExportPattern =
      /(defaultProvider|providerOrdering|cutover|authority|taskLoopAuthority|toolAuthority|gateway|providerTransport|persist|database|sqlite|service|listener|daemon)/i;

    expectNoForbiddenExports(registryExportNames, forbiddenExportPattern);
    expect(registryExportNames).toEqual(expect.arrayContaining([
      "collectRuntimeRegistryDiagnostics",
      "resolveRuntimeRegistryFeatureFlags",
      "runtimeRegistryFlagEnabled",
      "RuntimeContextProviderRegistry",
      "ToolProviderRegistry",
    ]));
  });

  it("keeps registry collector default-off, bounded, and caller-owned", () => {
    expect(resolveRuntimeRegistryFeatureFlags({})).toMatchObject({
      registryPilotEnabled: false,
      providerRegistryShadow: false,
      contextProviderRegistryPilot: false,
      toolRegistryShadow: false,
      registryDiagnosticsCollector: false,
    });

    const diagnostic = isolateRuntimeRegistryError({
      surface: "tool",
      providerId: "mcp-compat",
      error: new Error("diagnostic only"),
      metadata: { shadowOnly: true, legacyAuthoritative: true },
    }).diagnostic;

    const disabled = collectRuntimeRegistryDiagnostics({
      toolDiagnostics: [diagnostic],
      metadata: { callerOwned: true },
    });
    const enabled = collectRuntimeRegistryDiagnostics({
      enabled: true,
      limit: 1,
      toolDiagnostics: [diagnostic, diagnostic],
      metadata: { callerOwned: true },
    });

    expect(disabled).toMatchObject({
      enabled: false,
      diagnostics: [],
      omittedDiagnosticCount: 1,
    });
    expect(enabled).toMatchObject({
      enabled: true,
      diagnostics: [expect.objectContaining({
        surface: "tool",
        providerId: "mcp-compat",
        status: "error",
      })],
      omittedDiagnosticCount: 1,
      metadata: { callerOwned: true },
    });
    expect(JSON.stringify(enabled)).not.toMatch(
      /providerOrdering|defaultProviderRegistration|toolAuthority|taskLoopAuthority|gatewayPayload|providerTransport/u,
    );
  });

  it("keeps TaskLoop registry diagnostics behind every explicit shadow gate", () => {
    const source = readRepoFile("openclaw_runtime/src/agents/task-loop-controller.ts");

    expect(source).toContain("function runtimeRegistryDiagnosticShadowEnabled");
    expect(source).toContain("if (!flags.registryDiagnosticsCollector) return false;");
    expect(source).toContain("flags.registryPilotEnabled");
    expect(source).toContain("flags.providerRegistryShadow");
    expect(source).toContain("flags.contextProviderRegistryPilot");
    expect(source).toContain("return flags.toolRegistryShadow;");
    expect(source).toContain("legacyDecisionUnaffected: true");
    expect(source).toContain("finalTaskStatusUnaffected: true");
  });

  it("keeps renderer pages and components from bypassing host-api and Gateway ownership", () => {
    const files = [
      ...collectSourceFiles("src/pages"),
      ...collectSourceFiles("src/components"),
    ];
    const forbidden = [
      /window\.electron\.ipcRenderer\.invoke/u,
      /\bipcRenderer\.invoke\s*\(/u,
      /127\.0\.0\.1:18789/u,
      /localhost:18789/u,
      /\bnew\s+WebSocket\s*\(/u,
    ];
    const violations = files.flatMap((file) => {
      const text = readFileSync(file, "utf8");
      return forbidden.flatMap((pattern) =>
        pattern.test(text) ? [`${repoRelative(file)} matched ${pattern.source}`] : []
      );
    });

    expect(violations).toEqual([]);
  });
});

function readRepoFile(filePath: string): string {
  return readFileSync(path.join(process.cwd(), filePath), "utf8");
}

function collectSourceFiles(dir: string): string[] {
  const root = path.join(process.cwd(), dir);
  const files: string[] = [];
  const collect = (current: string): void => {
    for (const entry of readdirSync(current)) {
      const fullPath = path.join(current, entry);
      const stat = statSync(fullPath);
      if (stat.isDirectory()) {
        collect(fullPath);
      } else if (/\.(ts|tsx)$/u.test(entry)) {
        files.push(fullPath);
      }
    }
  };
  collect(root);
  return files;
}

function repoRelative(filePath: string): string {
  return path.relative(process.cwd(), filePath).replace(/\\/gu, "/");
}

function expectNoPatternMatches(text: string, forbidden: readonly RegExp[]): void {
  const matches = forbidden.flatMap((pattern) =>
    pattern.test(text) ? [pattern.source] : []
  );
  expect(matches).toEqual([]);
}

function expectNoForbiddenExports(
  names: readonly string[],
  pattern: RegExp,
): void {
  expect(names.filter((name) => pattern.test(name))).toEqual([]);
}
