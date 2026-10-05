import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { testProjectsArgs } from "../../scripts/test-projects.mjs";
import { assertExplicitTargetsSelected } from "../../scripts/explicit-test-targets.mjs";
import {
  resolveAbsoluteTestFileArgs,
  resolveExplicitTestFileNoPassArgs,
  resolveMissingExplicitTestFiles,
  resolveTestProjectsDelegationArgs,
  resolveExplicitVitestMode,
} from "../../scripts/run-vitest.mjs";
import { narrowIncludePatternsForCli } from "../vitest/vitest.pattern-file.js";

const root = fs.realpathSync(fileURLToPath(new URL("../../", import.meta.url)));
const targets = [
  "src/context-engine/source-set.test.ts",
  "extensions/memory-core/src/memory/manager-reindex-state.test.ts",
];

describe("default project runner", () => {
  it("preserves explicit configurations and native contract project selection", () => {
    for (const args of [["--config", "custom.ts"], ["-c", "custom.ts"], ["--config=custom.ts"]]) {
      expect(testProjectsArgs(args)).toEqual(["run", ...args]);
    }
    const command = JSON.parse(fs.readFileSync(path.join(root, "package.json"), "utf8")).scripts["test:contracts:channels"];
    expect(command).not.toContain(".config.ts");
    expect(command.match(/--project=contracts-channel-/g)).toHaveLength(4);
  });

  it("rejects a partially selected request before running the selected tests", () => {
    const requested = targets.map((file) => path.join(root, file));
    expect(() => assertExplicitTargetsSelected(requested, [{ moduleId: requested[0] }])).toThrow("not selected");
    expect(() => assertExplicitTargetsSelected(requested, requested.map((moduleId) => ({ moduleId })))).not.toThrow();
    expect(resolveAbsoluteTestFileArgs(["run", "extensions"], root)).toEqual(["run", path.join(root, "extensions").replaceAll("\\", "/")]);
    expect(resolveExplicitVitestMode([...targets, "--watch"])).toBe("watch");
    expect(() => assertExplicitTargetsSelected(["memory-core/src/memory/manager-reindex-state.test.ts"], [{
      moduleId: requested[1], project: { config: { root, dir: path.join(root, "extensions") } },
    }])).not.toThrow();
  });
  it("delegates an explicit run without recursion and preserves watch mode", () => {
    const delegated = resolveTestProjectsDelegationArgs(["run", ...targets]);
    expect(delegated).toEqual(targets);
    const args = testProjectsArgs(delegated!);
    expect(args).toEqual(["run", "--config", "vitest.config.ts", ...targets]);
    expect(resolveTestProjectsDelegationArgs(args)).toBeNull();
    expect(testProjectsArgs(["--watch", ...targets])).not.toContain("run");
  });

  it("uses absolute CLI filters while narrowing each project's include relative to the repo", () => {
    const args = resolveAbsoluteTestFileArgs(["run", ...targets, "--outputFile", "report.json"], root);
    expect(args.slice(1, 3)).toEqual(targets.map((file) => path.join(root, file).replaceAll("\\", "/")));
    expect(args.slice(-2)).toEqual(["--outputFile", "report.json"]);
    const argv = ["node", "vitest", ...args];
    expect(narrowIncludePatternsForCli(["src/context-engine/**/*.test.ts"], argv)).toEqual([targets[0]]);
    expect(narrowIncludePatternsForCli(["extensions/memory-core/**/*.test.ts"], argv, { scopedDir: "extensions" })).toEqual([targets[1]]);
  });

  it("rejects missing targets and disables passWithNoTests for explicit files", () => {
    expect(resolveMissingExplicitTestFiles(["run", ...targets, "src/missing-tf0253.test.ts"], root))
      .toEqual(["src/missing-tf0253.test.ts"]);
    expect(resolveExplicitTestFileNoPassArgs(["run", targets[0], "--passWithNoTests"]))
      .toContain("--passWithNoTests=false");
  });
});
