import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import {
  evaluateSourceSetQualityCorpus,
  loadSourceSetQualityFixture,
  SOURCE_SET_QUALITY_REPORT_SCHEMA,
} from "./source-set-quality.js";

const here = path.dirname(fileURLToPath(import.meta.url));
const fixturePath = path.join(here, "fixtures", "source-set-ks07-corpus.json");

describe("KS-07 committed SourceSet corpus", () => {
  it("loads and validates the committed fixture", () => {
    const fixture = loadSourceSetQualityFixture(fixturePath);
    expect(fixture.corpusId).toBe("ks07-source-set-committed-corpus");
    expect(fixture.sources.length).toBeGreaterThanOrEqual(10);
    expect(fixture.queries.length).toBeGreaterThanOrEqual(5);
    for (const source of fixture.sources) {
      expect(source.ref.owner).toBeTruthy();
      expect(source.ref.revision).toBeTruthy();
      expect(source.status).toBeTruthy();
      expect(source.ref.contentDigest.startsWith("sha256:")).toBe(true);
    }
  });

  it("computes real Recall@5 / Precision@5 / citation validity / stale inclusion / conflict disclosure", async () => {
    const report = await evaluateSourceSetQualityCorpus({
      fixturePath,
      now: () => new Date("2026-08-18T12:00:00.000Z"),
    });
    expect(report.schema).toBe(SOURCE_SET_QUALITY_REPORT_SCHEMA);
    expect(report.metrics.recallAt5).toBe(1);
    expect(report.metrics.precisionAt5).toBe(1);
    expect(report.metrics.citationValidity).toBe(1);
    expect(report.metrics.staleInclusion.retrieved).toBe(0);
    expect(report.metrics.staleInclusion.groundedClaims).toBe(0);
    expect(report.metrics.conflictDisclosure).toBe(1);
    expect(report.metrics.latencyMs.total).toBeGreaterThanOrEqual(0);
    expect(report.metrics.tokenCost.estimatedTokens).toBeGreaterThan(0);
    expect(report.humanUsefulness).toBe("not-evaluated (E4 missing)");
    expect(report.semanticAvailability).toBe(false);
    expect(report.queryReports.length).toBe(fixtureQueriesCount(fixturePath));
  });
});

function fixtureQueriesCount(filePath: string): number {
  return loadSourceSetQualityFixture(filePath).queries.length;
}
