import { spawnSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { describe, expect, it } from "vitest";

const runtimeRoot = fileURLToPath(new URL("../..", import.meta.url));
const generatorUrl = pathToFileURL(
  path.join(runtimeRoot, "scripts", "generate-npm-shrinkwrap.mjs"),
).href;

function normalize(packageJson: unknown, overrides: unknown) {
  const source = [
    `import { packageJsonForShrinkwrap } from ${JSON.stringify(generatorUrl)};`,
    `const packageJson = ${JSON.stringify(packageJson)};`,
    `const overrides = ${JSON.stringify(overrides)};`,
    "console.log(JSON.stringify({ normalized: packageJsonForShrinkwrap(packageJson, overrides), source: packageJson }));",
  ].join("\n");
  const result = spawnSync(process.execPath, ["--input-type=module", "--eval", source], {
    cwd: runtimeRoot,
    encoding: "utf8",
  });
  expect(result.status, result.stderr).toBe(0);
  return JSON.parse(result.stdout) as {
    normalized: Record<string, unknown>;
    source: { dependencies?: Record<string, string> };
  };
}

describe("generate-npm-shrinkwrap", () => {
  it("pins direct ranges to an exact nested override in the temporary npm manifest", () => {
    const source = {
      dependencies: {
        "tree-sitter": "^0.21.1",
        untouched: "^1.0.0",
      },
    };

    const result = normalize(source, {
      "tree-sitter": {
        ".": "0.21.1",
        "node-addon-api": "8.8.0",
      },
    });

    expect(result.normalized.dependencies).toEqual({
      "tree-sitter": "0.21.1",
      untouched: "^1.0.0",
    });
    expect(result.normalized.overrides).toMatchObject({
      "tree-sitter": {
        ".": "0.21.1",
        "node-addon-api": "8.8.0",
      },
    });
    expect(result.source.dependencies?.["tree-sitter"]).toBe("^0.21.1");
  });

  it("pins optional and peer direct dependencies without changing non-exact overrides", () => {
    const result = normalize(
      {
        optionalDependencies: { optional: "^2.0.0" },
        peerDependencies: { peer: "^3.0.0" },
      },
      {
        optional: "2.0.1",
        peer: "workspace:*",
      },
    );

    expect(result.normalized.optionalDependencies).toEqual({ optional: "2.0.1" });
    expect(result.normalized.peerDependencies).toEqual({ peer: "^3.0.0" });
  });
});
