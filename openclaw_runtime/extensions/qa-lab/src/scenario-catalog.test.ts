import fs from "node:fs";
import fsp from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const fixture = vi.hoisted(() => ({ root: "" }));

vi.mock("node:fs", async (importOriginal) => {
  const actual = await importOriginal<typeof import("node:fs")>();
  const nodePath = await import("node:path");
  const remap = (target: unknown) => {
    const normalized = String(target).replaceAll("\\", "/");
    const offset = normalized.lastIndexOf("/qa/");
    return fixture.root && offset >= 0
      ? nodePath.join(fixture.root, "qa", normalized.slice(offset + 4))
      : target;
  };
  return {
    ...actual,
    default: {
      ...actual,
      existsSync: (target: fs.PathLike) => actual.existsSync(remap(target) as fs.PathLike),
      statSync: (target: fs.PathLike) => actual.statSync(remap(target) as fs.PathLike),
      readFileSync: (target: fs.PathOrFileDescriptor, options: never) =>
        actual.readFileSync(remap(target) as fs.PathOrFileDescriptor, options),
      readdirSync: (target: fs.PathLike, options: never) =>
        actual.readdirSync(remap(target) as fs.PathLike, options),
    },
  };
});

const sourceRoot = path.resolve(import.meta.dirname, "../../../qa/scenarios");

describe("personal-agent scenario catalog", () => {
  beforeEach(async () => {
    fixture.root = await fsp.mkdtemp(path.join(os.tmpdir(), "qa-pack-catalog-"));
    await fsp.cp(sourceRoot, path.join(fixture.root, "qa/scenarios"), { recursive: true });
    vi.resetModules();
  });

  afterEach(async () => {
    const root = fixture.root;
    fixture.root = "";
    await fsp.rm(root, { recursive: true, force: true });
    vi.resetModules();
  });

  it("loads exactly the ten canonical IDs with executable flows", async () => {
    const catalog = await import("./scenario-catalog.js");
    const pack = catalog.readQaScenarioPack();
    expect(pack.scenarios.map((scenario) => scenario.id).toSorted()).toEqual(
      [...catalog.QA_PERSONAL_AGENT_SCENARIO_IDS].toSorted(),
    );
    for (const scenario of pack.scenarios) {
      expect(scenario.execution.flow?.steps.length).toBeGreaterThan(0);
      expect(scenario.sourcePath).toBe(`qa/scenarios/${scenario.id}.md`);
    }
  });

  it("fails explicit selection when one fixture is absent", async () => {
    const { QA_PERSONAL_AGENT_SCENARIO_IDS } = await import("./scenario-packs.js");
    await fsp.unlink(
      path.join(fixture.root, "qa/scenarios", `${QA_PERSONAL_AGENT_SCENARIO_IDS[0]}.md`),
    );
    const { readQaBootstrapScenarioCatalog } = await import("./scenario-catalog.js");
    const { selectQaSuiteScenarios } = await import("./suite-planning.js");
    expect(() =>
      selectQaSuiteScenarios({
        scenarios: readQaBootstrapScenarioCatalog().scenarios,
        scenarioIds: [...QA_PERSONAL_AGENT_SCENARIO_IDS],
        providerMode: "mock-openai",
        primaryModel: "mock-openai/gpt-5.5",
      }),
    ).toThrow(QA_PERSONAL_AGENT_SCENARIO_IDS[0]);
  });

  it("rejects duplicate IDs across files", async () => {
    const { QA_PERSONAL_AGENT_SCENARIO_IDS } = await import("./scenario-packs.js");
    await fsp.copyFile(
      path.join(fixture.root, "qa/scenarios", `${QA_PERSONAL_AGENT_SCENARIO_IDS[0]}.md`),
      path.join(fixture.root, "qa/scenarios/duplicate.md"),
    );
    const { readQaScenarioPack } = await import("./scenario-catalog.js");
    expect(readQaScenarioPack).toThrow("duplicate qa scenario id");
  });

  it("rejects malformed YAML", async () => {
    await fsp.writeFile(
      path.join(fixture.root, "qa/scenarios/broken.md"),
      "```yaml qa-scenario\nid: [unterminated\n```\n",
      "utf8",
    );
    const { readQaScenarioPack } = await import("./scenario-catalog.js");
    expect(readQaScenarioPack).toThrow();
  });

  it("rejects a scenario without its flow", async () => {
    const { QA_PERSONAL_AGENT_SCENARIO_IDS } = await import("./scenario-packs.js");
    const target = path.join(
      fixture.root,
      "qa/scenarios",
      `${QA_PERSONAL_AGENT_SCENARIO_IDS[0]}.md`,
    );
    const markdown = await fsp.readFile(target, "utf8");
    await fsp.writeFile(target, markdown.split("```yaml qa-flow")[0], "utf8");
    const { readQaScenarioPack } = await import("./scenario-catalog.js");
    expect(readQaScenarioPack).toThrow("qa-flow fence");
  });

  it("rejects an existing but empty index", async () => {
    await fsp.writeFile(path.join(fixture.root, "qa/scenarios/index.md"), "\n", "utf8");
    const { readQaScenarioPack } = await import("./scenario-catalog.js");
    expect(readQaScenarioPack).toThrow("empty qa scenario pack index");
  });

  it("keeps the optional distribution fallback while empty execution is rejected", async () => {
    await fsp.rm(path.join(fixture.root, "qa"), { recursive: true, force: true });
    const { hasQaScenarioPack, readQaBootstrapScenarioCatalog } =
      await import("./scenario-catalog.js");
    const { selectQaSuiteScenarios } = await import("./suite-planning.js");
    expect(hasQaScenarioPack()).toBe(false);
    const catalog = readQaBootstrapScenarioCatalog();
    expect(catalog.scenarios).toEqual([]);
    expect(() =>
      selectQaSuiteScenarios({
        scenarios: catalog.scenarios,
        providerMode: "mock-openai",
        primaryModel: "mock-openai/gpt-5.5",
      }),
    ).toThrow("selected no scenarios");
  });
});
