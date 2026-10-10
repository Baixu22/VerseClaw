// @vitest-environment node
/**
 * Executable drift guard for `SENSITIVE_SINK_CLASSIFICATION`.
 *
 * The taxonomy in `shared/security/content-provenance.ts` states how far
 * provenance enforcement is actually wired for each sensitive sink. That claim
 * is only worth anything if it is checked against the code it points at, so
 * every entry is resolved here: the policy module must exist, the exported
 * symbol must really be exported, the production call site must really invoke
 * it, and the declared denial style must match what the code does.
 *
 * The sweep at the bottom closes the other direction: every module in the
 * runtime that gates on the shared provenance helper must be referenced by the
 * taxonomy, so a new gate cannot be added without updating the table.
 *
 * Limits (deliberate): this guard proves the *existence and wiring* of each
 * declared point. It does not prove that coverage is complete, nor that a
 * policy module is free of unreachable branches.
 */
import { readdirSync, readFileSync, statSync } from "node:fs";
import { dirname, join, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import {
  SENSITIVE_SINK_CLASSIFICATION,
  SENSITIVE_SINK_KINDS,
  type SensitiveSinkClassification,
  type SensitiveSinkEnforcementPoint,
} from "../../shared/security/content-provenance";

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..");
const RUNTIME_SRC = "openclaw_runtime/src";
/** Shared helper every sink policy module imports to read provenance risk. */
const PROVENANCE_GATE_MARKER = "isExternalOrUnknownProvenance";

function isFile(repoPath: string): boolean {
  return statSync(join(REPO_ROOT, repoPath), { throwIfNoEntry: false })?.isFile() === true;
}

function readRepoFile(repoPath: string): string {
  return readFileSync(join(REPO_ROOT, repoPath), "utf8");
}

/** Enforcement points for one entry; empty exactly when it is classification-only. */
function pointsOf(classification: SensitiveSinkClassification): readonly SensitiveSinkEnforcementPoint[] {
  return classification.enforcement === "classification-only" ? [] : classification.enforcedAt;
}

function declaredPolicyFiles(): string[] {
  const files = new Set<string>();
  for (const kind of SENSITIVE_SINK_KINDS) {
    for (const point of pointsOf(SENSITIVE_SINK_CLASSIFICATION[kind])) files.add(point.policyFile);
  }
  return [...files].sort();
}

/** Modules under `openclaw_runtime/src` that import the shared provenance helper. */
function collectProvenanceGateModules(): string[] {
  const found: string[] = [];
  const walk = (absoluteDir: string): void => {
    for (const entry of readdirSync(absoluteDir, { withFileTypes: true })) {
      const absolute = join(absoluteDir, entry.name);
      if (entry.isDirectory()) {
        if (entry.name === "node_modules" || entry.name === "__snapshots__") continue;
        walk(absolute);
        continue;
      }
      if (!entry.name.endsWith(".ts") || entry.name.includes(".test.")) continue;
      if (readFileSync(absolute, "utf8").includes(PROVENANCE_GATE_MARKER)) {
        found.push(relative(REPO_ROOT, absolute).split(sep).join("/"));
      }
    }
  };
  walk(join(REPO_ROOT, RUNTIME_SRC));
  return found.sort();
}

describe("sensitive sink enforcement drift guard", () => {
  it("classifies every declared sink kind and nothing else", () => {
    expect(Object.keys(SENSITIVE_SINK_CLASSIFICATION).sort()).toEqual([...SENSITIVE_SINK_KINDS].sort());
  });

  it("requires an enforcement point exactly when a sink is not classification-only", () => {
    for (const kind of SENSITIVE_SINK_KINDS) {
      const classification = SENSITIVE_SINK_CLASSIFICATION[kind];
      if (classification.enforcement === "classification-only") {
        expect(
          classification.enforcedAt,
          `${kind} is classification-only but still declares enforcedAt`,
        ).toBeUndefined();
        continue;
      }
      expect(
        pointsOf(classification).length,
        `${kind} is "${classification.enforcement}" but declares no enforcement point`,
      ).toBeGreaterThan(0);
    }
  });

  it("only calls a sink narrow when its declared points really reject", () => {
    for (const kind of SENSITIVE_SINK_KINDS) {
      const classification = SENSITIVE_SINK_CLASSIFICATION[kind];
      const points = pointsOf(classification);
      if (classification.enforcement === "narrow") {
        for (const point of points) {
          expect(
            point.rejectsWith,
            `${kind} is "narrow" but ${point.exportedSymbol} only constrains`,
          ).not.toBe("constrain");
        }
      }
      if (classification.enforcement === "source-dependent") {
        expect(
          points.some((point) => point.rejectsWith === "constrain"),
          `${kind} is "source-dependent" but no declared point constrains an existing decision`,
        ).toBe(true);
      }
    }
  });

  it("resolves every declared enforcement point against the working tree", () => {
    for (const kind of SENSITIVE_SINK_KINDS) {
      for (const point of pointsOf(SENSITIVE_SINK_CLASSIFICATION[kind])) {
        const label = `${kind} -> ${point.exportedSymbol}`;
        expect(isFile(point.policyFile), `${label}: missing policy file ${point.policyFile}`).toBe(true);
        expect(isFile(point.callSite), `${label}: missing call site ${point.callSite}`).toBe(true);

        const policyText = readRepoFile(point.policyFile);
        const callSiteText = readRepoFile(point.callSite);

        const escapedSymbol = point.exportedSymbol.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
        expect(
          new RegExp(`export\\s+(?:async\\s+)?(?:function|const|let|class)\\s+${escapedSymbol}\\b`).test(
            policyText,
          ),
          `${label}: ${point.policyFile} does not export ${point.exportedSymbol}`,
        ).toBe(true);
        expect(
          callSiteText.includes(point.exportedSymbol),
          `${label}: ${point.callSite} never references ${point.exportedSymbol}`,
        ).toBe(true);
        expect(
          /provenance/i.test(callSiteText),
          `${label}: ${point.callSite} shows no provenance wiring`,
        ).toBe(true);

        // The declared denial style must match the code it points at.
        if (point.rejectsWith === "policy-throw") {
          expect(
            /\bthrow\b/.test(policyText),
            `${label}: declared policy-throw but ${point.policyFile} never throws`,
          ).toBe(true);
        }
        if (point.rejectsWith === "call-site-throw") {
          expect(
            policyText.includes("allowed: false"),
            `${label}: declared call-site-throw but ${point.policyFile} returns no denial`,
          ).toBe(true);
          expect(
            /\bthrow\b/.test(callSiteText),
            `${label}: declared call-site-throw but ${point.callSite} never throws`,
          ).toBe(true);
        }
        if (point.rejectsWith === "constrain") {
          expect(
            /\bthrow\b/.test(policyText),
            `${label}: declared constrain but ${point.policyFile} throws`,
          ).toBe(false);
        }
      }
    }
  });

  it("references every provenance gate module, so a new gate cannot land unclassified", () => {
    expect(collectProvenanceGateModules()).toEqual(declaredPolicyFiles());
  });
});
