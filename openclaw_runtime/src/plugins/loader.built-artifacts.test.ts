import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { testing } from "./loader.js";

const tempRoots: string[] = [];

function makePluginPackage(params: { staticAssets?: unknown[] } = {}) {
  const rootDir = fs.mkdtempSync(path.join(os.tmpdir(), "openclaw-plugin-artifact-"));
  tempRoots.push(rootDir);
  fs.mkdirSync(path.join(rootDir, "dist"), { recursive: true });
  fs.writeFileSync(path.join(rootDir, "index.ts"), "export default { register() {} };\n");
  fs.writeFileSync(path.join(rootDir, "dist", "index.js"), "module.exports = class NotAPlugin {};\n");
  fs.writeFileSync(
    path.join(rootDir, "package.json"),
    JSON.stringify(
      {
        name: "fixture-plugin",
        type: "module",
        openclaw: {
          extensions: ["./index.ts"],
          build: {
            staticAssets: params.staticAssets ?? [],
          },
        },
      },
      null,
      2,
    ),
  );
  return rootDir;
}

afterEach(() => {
  for (const root of tempRoots.splice(0)) {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

describe("plugin built artifact resolution", () => {
  it("does not treat declared static assets as compiled plugin entrypoints", () => {
    const rootDir = makePluginPackage({
      staticAssets: [{ source: "dist/index.js", output: "dist/index.js" }],
    });

    expect(
      testing.isPackageLocalStaticAsset({
        rootDir,
        artifactRelativePath: path.join("dist", "index.js"),
      }),
    ).toBe(true);
    expect(
      testing.resolvePackageLocalDistRuntimeArtifact({
        rootDir,
        source: path.join(rootDir, "index.ts"),
      }),
    ).toBeNull();
  });

  it("still prefers package-local dist artifacts when they are not declared static assets", () => {
    const rootDir = makePluginPackage();

    expect(
      testing.resolvePackageLocalDistRuntimeArtifact({
        rootDir,
        source: path.join(rootDir, "index.ts"),
      }),
    ).toBe(path.join(rootDir, "dist", "index.js"));
  });
});
