import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import {
  buildPluginSdkDtsRootFiles,
  resolveStagedDeclarationPath,
  stagePluginSdkDeclarations,
} from "./build-plugin-sdk-source-dts.mjs";

test("maps common-root declaration output into the retained source-shaped layout", () => {
  assert.equal(
    resolveStagedDeclarationPath("openclaw_runtime/src/plugin-sdk/health.d.ts"),
    "dist/plugin-sdk/src/plugin-sdk/health.d.ts",
  );
  assert.equal(
    resolveStagedDeclarationPath("openclaw_runtime/packages/llm-core/src/index.d.ts"),
    "dist/plugin-sdk/packages/llm-core/src/index.d.ts",
  );
  assert.equal(
    resolveStagedDeclarationPath("shared/types/context-family.d.ts"),
    "dist/shared/types/context-family.d.ts",
  );
});

test("rejects declaration output outside the owned Runtime and shared roots", () => {
  assert.throws(
    () => resolveStagedDeclarationPath("../outside.d.ts"),
    /outside the declaration staging roots/u,
  );
  assert.throws(
    () => resolveStagedDeclarationPath("other-package/index.d.ts"),
    /outside the declaration staging roots/u,
  );
});

test("uses the canonical public entrypoint set unless private QA declarations are requested", () => {
  const publicRoots = buildPluginSdkDtsRootFiles({ includePrivateQa: false });
  const privateQaRoots = buildPluginSdkDtsRootFiles({ includePrivateQa: true });

  assert.ok(publicRoots.includes("../src/plugin-sdk/health.ts"));
  assert.equal(publicRoots.includes("../src/plugin-sdk/testing.ts"), false);
  assert.ok(privateQaRoots.includes("../src/plugin-sdk/testing.ts"));
  assert.ok(privateQaRoots.length > publicRoots.length);
  assert.equal(new Set(publicRoots).size, publicRoots.length);
  assert.equal(new Set(privateQaRoots).size, privateQaRoots.length);
});

test("stages declarations without writing generated files beside shared sources", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "openclaw-plugin-sdk-source-dts-"));
  const emittedRoot = path.join(root, "emitted");
  const runtimeRoot = path.join(root, "openclaw_runtime");
  const files = {
    "openclaw_runtime/src/plugin-sdk/health.d.ts": "export declare const health: true;\n",
    "openclaw_runtime/packages/llm-core/src/index.d.ts": "export type Model = string;\n",
    "shared/types/context-family.d.ts": "export type ContextFamily = string;\n",
  };

  try {
    for (const [relativePath, contents] of Object.entries(files)) {
      const outputPath = path.join(emittedRoot, relativePath);
      fs.mkdirSync(path.dirname(outputPath), { recursive: true });
      fs.writeFileSync(outputPath, contents, "utf8");
    }

    const staged = stagePluginSdkDeclarations({ emittedRoot, runtimeRoot });

    assert.deepEqual(staged, [
      "dist/plugin-sdk/packages/llm-core/src/index.d.ts",
      "dist/plugin-sdk/src/plugin-sdk/health.d.ts",
      "dist/shared/types/context-family.d.ts",
    ]);
    assert.equal(
      fs.readFileSync(
        path.join(runtimeRoot, "dist/plugin-sdk/src/plugin-sdk/health.d.ts"),
        "utf8",
      ),
      files["openclaw_runtime/src/plugin-sdk/health.d.ts"],
    );
    assert.equal(
      fs.readFileSync(path.join(runtimeRoot, "dist/shared/types/context-family.d.ts"), "utf8"),
      files["shared/types/context-family.d.ts"],
    );
    assert.equal(fs.existsSync(path.join(root, "shared/types/context-family.d.ts")), false);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});
