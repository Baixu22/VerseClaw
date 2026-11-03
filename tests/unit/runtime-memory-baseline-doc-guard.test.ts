// @vitest-environment node
// Issue #146 guard: `docs/runtime-design/mem.md` must quote the tracked LoCoMo report
// fixture instead of hand-written numbers, and must keep disclosing the frozen judge
// version, its exemption rules, and whether the escalation field really exists.
//
// This guard fails closed. A missing marker block, a missing/unparsable `当前` row, a
// missing fixture, or a missing metric path is a failure - never a silent skip.
import { describe, expect, it } from "vitest";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { join } from "node:path";

import {
  FROZEN_JUDGE_CONFIG,
  FROZEN_JUDGE_INTERPRETATION,
} from "./helpers/runtime-memory-judge-freeze";

const DOC_LABEL = "docs/runtime-design/mem.md";
const FIXTURE_LABEL = "tests/fixtures/runtime-memory-eval/locomo-full-500-report.json";
const BASELINE_BEGIN = "<!-- BEGIN runtime-memory-baseline -->";
const BASELINE_END = "<!-- END runtime-memory-baseline -->";
const REQUIRED_METRIC_PATH = "metrics.overall.j_score";
const ESCALATION_PATH = "escalation.full_conversation_rate";
const CATEGORY_COLUMNS = ["temporal", "multi_hop", "single_hop", "open_domain"] as const;
const DOCUMENTED_EXEMPTION_RULE_COUNT = 5;

function readRepoFile(relativePath: string): string {
  try {
    return readFileSync(join(process.cwd(), relativePath), "utf8");
  } catch (error) {
    throw new Error(`${relativePath} is unreadable: ${(error as Error).message}`, { cause: error });
  }
}

function requireRecord(value: unknown, label: string): Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new Error(`${label} must be a JSON object`);
  }
  return value as Record<string, unknown>;
}

function requireStringField(record: Record<string, unknown>, key: string, label: string): string {
  const value = record[key];
  if (typeof value !== "string" || value.length === 0) {
    throw new Error(`${label}.${key} must be a non-empty string`);
  }
  return value;
}

function parseBaselineBlock(docText: string): Record<string, unknown> {
  const start = docText.indexOf(BASELINE_BEGIN);
  const end = docText.indexOf(BASELINE_END);
  if (start < 0 || end < 0 || end <= start) {
    throw new Error(
      `${DOC_LABEL} is missing the ${BASELINE_BEGIN} / ${BASELINE_END} machine-quoted baseline block`,
    );
  }
  const inner = docText.slice(start + BASELINE_BEGIN.length, end);
  const fenced = /```json\r?\n([\s\S]*?)```/.exec(inner);
  if (fenced === null || fenced[1] === undefined) {
    throw new Error(`${DOC_LABEL} baseline block has no fenced json payload`);
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(fenced[1]);
  } catch (error) {
    throw new Error(`${DOC_LABEL} baseline block is not valid JSON: ${(error as Error).message}`, { cause: error });
  }
  return requireRecord(parsed, `${DOC_LABEL} baseline block`);
}

function parseCurrentBaselineRow(docText: string): string[] {
  const line = docText.split(/\r?\n/).find((candidate) => candidate.startsWith("当前\t"));
  if (line === undefined) {
    throw new Error(`${DOC_LABEL} is missing the machine-quoted 当前 baseline row`);
  }
  const cells = line.split("\t").map((cell) => cell.trim());
  if (cells.length !== 6) {
    throw new Error(
      `${DOC_LABEL} 当前 row must have 6 tab-separated cells, found ${cells.length}: ${JSON.stringify(line)}`,
    );
  }
  return cells;
}

function resolvePath(root: unknown, path: string): { present: boolean; value: unknown } {
  let current: unknown = root;
  for (const segment of path.split(".")) {
    if (typeof current !== "object" || current === null || Array.isArray(current)) {
      return { present: false, value: undefined };
    }
    const record = current as Record<string, unknown>;
    if (!Object.prototype.hasOwnProperty.call(record, segment)) {
      return { present: false, value: undefined };
    }
    current = record[segment];
  }
  return { present: true, value: current };
}

function metricNumber(root: unknown, path: string): number {
  const resolved = resolvePath(root, path);
  if (!resolved.present || typeof resolved.value !== "number" || !Number.isFinite(resolved.value)) {
    throw new Error(`${FIXTURE_LABEL} has no numeric metric at ${path}`);
  }
  return resolved.value;
}

function readFixtureJson(): unknown {
  const raw = readRepoFile(FIXTURE_LABEL);
  try {
    return JSON.parse(raw);
  } catch (error) {
    throw new Error(`${FIXTURE_LABEL} is not valid JSON: ${(error as Error).message}`, { cause: error });
  }
}

function canonicalTextBytes(text: string): Buffer {
  // This guard binds semantic fixture fields, not the platform checkout's line
  // endings. Raw-byte integrity belongs to repository attributes/manifests.
  return Buffer.from(text.replace(/\r\n/g, "\n"), "utf8");
}

function percentCell(value: number): string {
  return `${(value * 100).toFixed(1)}%`;
}

describe("docs/runtime-design/mem.md baseline guard (issue #146)", () => {
  it("binds the machine-quoted block to the tracked fixture bytes and metadata", () => {
    const block = parseBaselineBlock(readRepoFile(DOC_LABEL));
    const fixtureRaw = readRepoFile(FIXTURE_LABEL);
    const fixture = requireRecord(readFixtureJson(), FIXTURE_LABEL);

    expect(block.sourceArtifact).toBe(FIXTURE_LABEL);
    expect(block.sha256).toBe(
      createHash("sha256").update(canonicalTextBytes(fixtureRaw)).digest("hex"),
    );
    expect(block.reportVersion).toBe(fixture.version);
    expect(block.generatedAt).toBe(fixture.generatedAt);
    expect(block.totalQuestions).toBe(fixture.totalQuestions);
  });

  it("quotes every metric path in the block at its exact fixture value", () => {
    const block = parseBaselineBlock(readRepoFile(DOC_LABEL));
    const fixture = readFixtureJson();
    const metricPaths = requireRecord(block.metricPaths, `${DOC_LABEL} baseline block metricPaths`);

    if (!Object.prototype.hasOwnProperty.call(metricPaths, REQUIRED_METRIC_PATH)) {
      throw new Error(`${DOC_LABEL} baseline block must quote ${REQUIRED_METRIC_PATH}`);
    }
    expect(Object.keys(metricPaths).length).toBeGreaterThan(0);

    for (const [path, quoted] of Object.entries(metricPaths)) {
      if (typeof quoted !== "number" || !Number.isFinite(quoted)) {
        throw new Error(`${DOC_LABEL} quotes a non-numeric value for ${path}: ${JSON.stringify(quoted)}`);
      }
      const resolved = resolvePath(fixture, path);
      if (!resolved.present || typeof resolved.value !== "number") {
        throw new Error(`${FIXTURE_LABEL} has no numeric metric at ${path}; the doc quote cannot be verified`);
      }
      expect({ path, value: quoted }).toEqual({ path, value: resolved.value });
    }
  });

  it("keeps the §三 当前 row derived from the same fixture metrics", () => {
    const cells = parseCurrentBaselineRow(readRepoFile(DOC_LABEL));
    const fixture = readFixtureJson();

    expect(cells[0]).toBe("当前");
    const expected = [
      ...CATEGORY_COLUMNS.map((category) =>
        percentCell(metricNumber(fixture, `metrics.byCategory.${category}.j_score`)),
      ),
      percentCell(metricNumber(fixture, REQUIRED_METRIC_PATH)),
    ];
    expect(cells.slice(1)).toEqual(expected);
  });

  it("pins the frozen judge id and its exemption rules to the code constants", () => {
    const block = parseBaselineBlock(readRepoFile(DOC_LABEL));
    const judge = requireRecord(block.judge, `${DOC_LABEL} baseline block judge`);

    expect(requireStringField(judge, "promptVersion", "judge")).toBe(FROZEN_JUDGE_CONFIG.promptVersion);

    const rules = judge.exemptionRules;
    if (!Array.isArray(rules)) {
      throw new Error(`${DOC_LABEL} baseline block judge.exemptionRules must be an array`);
    }
    expect(rules).toEqual([...FROZEN_JUDGE_INTERPRETATION.limitations]);
    expect(FROZEN_JUDGE_INTERPRETATION.limitations.length).toBe(DOCUMENTED_EXEMPTION_RULE_COUNT);
    expect(rules.length).toBe(DOCUMENTED_EXEMPTION_RULE_COUNT);
  });

  it("records the real availability of the escalation share instead of inventing a number", () => {
    const docText = readRepoFile(DOC_LABEL);
    const block = parseBaselineBlock(docText);
    const fixture = readFixtureJson();
    const escalation = requireRecord(block.escalation, `${DOC_LABEL} baseline block escalation`);

    expect(requireStringField(escalation, "path", "escalation")).toBe(ESCALATION_PATH);
    const present = escalation.present;
    if (typeof present !== "boolean") {
      throw new Error(`${DOC_LABEL} baseline block escalation.present must be a boolean`);
    }
    const resolved = resolvePath(fixture, ESCALATION_PATH);

    if (!present) {
      expect(escalation.value).toBeNull();
      if (resolved.present) {
        throw new Error(
          `${DOC_LABEL} claims ${ESCALATION_PATH} is absent but ${FIXTURE_LABEL} now carries it; `
            + "quote the real value and update the disclosure instead of leaving a stale denial",
        );
      }
    } else {
      if (typeof escalation.value !== "number" || !Number.isFinite(escalation.value)) {
        throw new Error(`${DOC_LABEL} claims ${ESCALATION_PATH} is present but quotes no finite number`);
      }
      if (!resolved.present || typeof resolved.value !== "number") {
        throw new Error(
          `${DOC_LABEL} quotes ${ESCALATION_PATH}=${escalation.value} but ${FIXTURE_LABEL} has no such numeric metric`,
        );
      }
      expect(escalation.value).toBe(resolved.value);
    }

    // A score produced with degradation fallbacks is not a pure memory score.
    expect(docText).toMatch(/不是纯记忆分/);
  });
});

describe("runtime-memory baseline guard fails closed on missing/unparsable input", () => {
  it("rejects a doc without the marker block", () => {
    expect(() => parseBaselineBlock("当前\t80.7%\t61.5%\t78.0%\t82.0%\t75.2%\n")).toThrow(
      /machine-quoted baseline block/,
    );
  });

  it("rejects a block whose json payload is broken or unfenced", () => {
    const brokenJson = `${BASELINE_BEGIN}\n\`\`\`json\n{"sourceArtifact": "x",}\n\`\`\`\n${BASELINE_END}`;
    expect(() => parseBaselineBlock(brokenJson)).toThrow(/not valid JSON/);

    const unfenced = `${BASELINE_BEGIN}\n{"sourceArtifact": "x"}\n${BASELINE_END}`;
    expect(() => parseBaselineBlock(unfenced)).toThrow(/no fenced json payload/);
  });

  it("rejects a doc whose 当前 row is missing or malformed", () => {
    expect(() => parseCurrentBaselineRow("no baseline row here")).toThrow(/missing the machine-quoted/);
    expect(() => parseCurrentBaselineRow("当前\t80.7%\t61.5%")).toThrow(/6 tab-separated cells/);
  });

  it("rejects a metric path that the fixture no longer carries", () => {
    const drifted = { metrics: { overall: {} } };
    expect(resolvePath(drifted, REQUIRED_METRIC_PATH).present).toBe(false);
    expect(() => metricNumber(drifted, REQUIRED_METRIC_PATH)).toThrow(/has no numeric metric/);
  });
});
