import { createHash } from "node:crypto";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it } from "vitest";
import {
  resolveManagedCodexAppServerPaths,
  resolveManagedCodexAppServerStartOptions,
} from "../../openclaw_runtime/extensions/codex/src/app-server/managed-binary.js";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..");
const FIXTURE = "harness/specs/fixtures/harness-codex-managed-runtime";
const probe = JSON.parse(readFileSync(resolve(ROOT, FIXTURE, "runtime-probe-20261026.json"), "utf8"));
const acceptance = JSON.parse(readFileSync(resolve(ROOT, FIXTURE, "acceptance.json"), "utf8"));
const roots: string[] = [];
afterEach(() => roots.splice(0).forEach((root) => rmSync(root, { recursive: true, force: true })));

function writePackage(directory: string, name: string, dependencies: Record<string, string> = {}) {
  mkdirSync(directory, { recursive: true });
  writeFileSync(join(directory, "package.json"), JSON.stringify({ name, version: "1", dependencies }));
}

describe("Codex managed runtime evidence", () => {
  it("retains the historical packaged-unavailable probe", () => {
    expect(probe.driven_by).toBe("agent");
    expect(probe.sourceRuntime.pinnedVersion).toBe("0.137.0");
    expect(probe.sourceRuntime.versionOutput).toContain("0.137.0");
    expect(probe.sourceRuntime.binarySha256).toMatch(/^[a-f0-9]{64}$/);
    expect(probe.packagedRuntime.managedDependencyPresent).toBe(false);
    expect(probe.packagedRuntime.codexBinaryPresent).toBe(false);
    expect(probe.packagedRuntime.verdict).toBe("packaged-unavailable");
    expect(probe.productBoundary.packagedAvailable).toBe(false);
    expect(probe.productBoundary.realHumanEvidence).toBe(false);
  });
  it("records a fail-closed authentication boundary", () => {
    expect(probe.sourceRuntime.authProbe.status).toBe("isolated-home-unauthenticated");
    expect(probe.sourceRuntime.authProbe.error).toBe("Not logged in");
    expect(probe.limitations.join(" ")).toContain("did not execute a Codex turn");
  });
  it("does not mistake the host runtime for the packaged runtime", () => {
    expect(probe.hostRuntimeProbe.healthz).toBe(200);
    expect(probe.hostRuntimeProbe.readyz).toBe(200);
    expect(probe.hostRuntimeProbe.versionOutput).not.toContain("0.137.0");
    expect(probe.limitations.join(" ")).toContain("not the packaged");
  });
  it("accepts current receipts only after packaged relocation", () => {
    expect(acceptance.schemaVersion).toBe("HarnessCodexManagedRuntimeAcceptance/v1");
    expect(acceptance.driven_by).toBe("agent");
    expect(acceptance.node).toBe("TF-0566");
    expect(acceptance.productBoundary.packagedAvailable).toBe(true);
    expect(acceptance.packagedBuild.exitCode).toBe(0);
    const packaged = JSON.parse(readFileSync(resolve(ROOT, FIXTURE, "packaged-runtime.json"), "utf8"));
    const source = JSON.parse(readFileSync(resolve(ROOT, FIXTURE, "source-runtime.json"), "utf8"));
    expect(packaged.command).toContain("release");
    expect(packaged.version).toContain("0.137.0");
    expect(packaged.binary.sha256).toBe(source.binary.sha256);
    expect(packaged.usedSystemPath).toBe(false);
    expect(packaged.processCleanup).toBe(true);
  });
  it("keeps the human-readable report aligned with current acceptance", () => {
    const report = readFileSync(resolve(ROOT, FIXTURE, "REPORT.md"), "utf8");
    expect(report).toContain("packagedRuntime | available");
    expect(report).toContain("packagedLaunch | pass");
    expect(report).toContain("managedTurn | not-run");
  });
  it("hashes the retained probe", () => {
    const file = resolve(ROOT, FIXTURE, "runtime-probe-20261026.json");
    expect(existsSync(file)).toBe(true);
    const digest = createHash("sha256").update(readFileSync(file)).digest("hex");
    const manifest = readFileSync(resolve(ROOT, FIXTURE, "SHA256SUMS"), "utf8");
    expect(manifest).toContain(`${digest}  runtime-probe-20261026.json`);
    for (const name of ["acceptance.json", "source-runtime.json", "packaged-runtime.json", "REPORT.md"]) {
      expect(manifest).toContain(`  ${name}`);
    }
  });
});

describe.skipIf(process.platform !== "win32")("managed Codex runtime from a bundled plugin tree", () => {
  it("resolves the plugin-local native codex.exe before spawn", async () => {
    const root = mkdtempSync(join(tmpdir(), "codex-managed-runtime-"));
    roots.push(root);
    const pluginRoot = join(root, "plugin");
    writePackage(pluginRoot, "@openclaw/codex");
    const codexRoot = join(pluginRoot, "node_modules", "@openai", "codex");
    writePackage(codexRoot, "@openai/codex");
    mkdirSync(join(codexRoot, "bin"), { recursive: true });
    writeFileSync(join(codexRoot, "bin", "codex.js"), "module.exports = {};\n");
    const nativeRoot = join(codexRoot, "node_modules", "@openai", "codex-win32-x64");
    writePackage(nativeRoot, "@openai/codex", {});
    const exe = join(nativeRoot, "vendor", "x86_64-pc-windows-msvc", "bin", "codex.exe");
    mkdirSync(join(nativeRoot, "vendor", "x86_64-pc-windows-msvc", "bin"), { recursive: true });
    writeFileSync(exe, "stub");

    const paths = resolveManagedCodexAppServerPaths({ pluginRoot, platform: "win32" });
    expect(paths.candidateCommandPaths).toContain(exe);
    expect(paths.candidateCommandPaths.indexOf(exe)).toBeLessThan(
      paths.candidateCommandPaths.length,
    );

    const resolved = await resolveManagedCodexAppServerStartOptions(
      {
        transport: "stdio",
        command: "codex",
        commandSource: "managed",
        args: ["app-server", "--listen", "stdio://"],
        headers: {},
      },
      { pluginRoot, platform: "win32" },
    );
    expect(resolved.command).toBe(exe);
    expect(resolved.commandSource).toBe("resolved-managed");
  });
  it("fails closed when no managed command candidate exists", async () => {
    const root = mkdtempSync(join(tmpdir(), "codex-managed-runtime-missing-"));
    roots.push(root);
    const pluginRoot = join(root, "plugin");
    writePackage(pluginRoot, "@openclaw/codex");
    await expect(
      resolveManagedCodexAppServerStartOptions(
        {
          transport: "stdio",
          command: "codex",
          commandSource: "managed",
          args: ["app-server", "--listen", "stdio://"],
          headers: {},
        },
        { pluginRoot, platform: "win32", pathExists: async () => false },
      ),
    ).rejects.toThrow(/Managed Codex app-server binary was not found/u);
  });
});
