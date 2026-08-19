import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import type { RuntimeEmbeddingProvider } from "../runtime-core/memory-embedding-provider.js";
import {
  packSourceSetForDcs,
  resolveSourceSetCitation,
  retrieveSourceSet,
  type SourceSetCandidate,
  type SourceSetEvidenceStatus,
  type SourceSetQuery,
} from "./source-set.js";

export const SOURCE_SET_QUALITY_REPORT_SCHEMA = "SourceSetQualityReport/v1" as const;

export type SourceSetQualityFixtureQuery = SourceSetQuery & {
  id: string;
  relevantSourceIds: string[];
  expectedConflicts: string[];
};

export type SourceSetQualityFixture = {
  version: 1;
  corpusId: string;
  kind: string;
  notes?: string[];
  sources: SourceSetCandidate[];
  queries: SourceSetQualityFixtureQuery[];
};

export type SourceSetQualityQueryReport = {
  queryId: string;
  evidenceStatus: SourceSetEvidenceStatus;
  retrievedRefIds: string[];
  rejectedRefIds: string[];
  conflictKeys: string[];
  expectedConflicts: string[];
  conflictDisclosure: number;
  relevantSourceIds: string[];
  recallAt5: number;
  precisionAt5: number;
  citationCount: number;
  validCitationCount: number;
  citationValidity: number;
  staleInclusion: {
    retrieved: number;
    groundedClaims: number;
  };
  latencyMs: number;
  tokenCost: {
    chars: number;
    estimatedTokens: number;
  };
};

export type SourceSetQualityMetrics = {
  recallAt5: number;
  precisionAt5: number;
  citationValidity: number;
  staleInclusion: {
    retrieved: number;
    groundedClaims: number;
  };
  conflictDisclosure: number;
  latencyMs: {
    total: number;
    avg: number;
    max: number;
  };
  tokenCost: {
    chars: number;
    estimatedTokens: number;
  };
};

export type SourceSetQualityReport = {
  schema: typeof SOURCE_SET_QUALITY_REPORT_SCHEMA;
  fixturePath: string;
  fixtureSha256: string;
  generatedAt: string;
  semanticAvailability: boolean;
  metrics: SourceSetQualityMetrics;
  queryReports: SourceSetQualityQueryReport[];
  humanUsefulness: "not-evaluated (E4 missing)";
  evidenceLevel: "E1-E2 fixture evaluation only; not E4/E5";
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function assertString(value: unknown, path: string): string {
  if (typeof value !== "string" || value.trim() === "") {
    throw new Error(`${path}: expected non-empty string`);
  }
  return value;
}

function assertStringArray(value: unknown, path: string): string[] {
  if (!Array.isArray(value) || value.some((entry) => typeof entry !== "string")) {
    throw new Error(`${path}: expected string array`);
  }
  return value as string[];
}

export function loadSourceSetQualityFixture(filePath: string): SourceSetQualityFixture {
  let text: string;
  try {
    text = readFileSync(filePath, "utf8");
  } catch (error) {
    throw new Error(`failed to read fixture ${filePath}: ${error instanceof Error ? error.message : String(error)}`, { cause: error });
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(text) as unknown;
  } catch (error) {
    throw new Error(`invalid fixture JSON ${filePath}: ${error instanceof Error ? error.message : String(error)}`, { cause: error });
  }
  if (!isRecord(parsed)) throw new Error(`${filePath}: expected object`);
  if (parsed.version !== 1) throw new Error(`${filePath}: expected version 1`);
  if (!Array.isArray(parsed.sources) || parsed.sources.length === 0) {
    throw new Error(`${filePath}: expected non-empty sources array`);
  }
  if (!Array.isArray(parsed.queries) || parsed.queries.length === 0) {
    throw new Error(`${filePath}: expected non-empty queries array`);
  }
  return {
    version: 1,
    corpusId: assertString(parsed.corpusId, `${filePath}.corpusId`),
    kind: assertString(parsed.kind, `${filePath}.kind`),
    ...(Array.isArray(parsed.notes)
      ? { notes: assertStringArray(parsed.notes, `${filePath}.notes`) }
      : {}),
    sources: (parsed.sources as unknown[]).map((entry, index) => {
      if (!isRecord(entry)) throw new Error(`${filePath}.sources[${index}]: expected object`);
      const ref = {
        refId: assertString(entry.refId, `${filePath}.sources[${index}].refId`),
        owner: assertString(entry.owner, `${filePath}.sources[${index}].owner`),
        subjectKind: assertString(entry.subjectKind, `${filePath}.sources[${index}].subjectKind`),
        subjectId: assertString(entry.subjectId, `${filePath}.sources[${index}].subjectId`),
        revision: assertString(entry.revision, `${filePath}.sources[${index}].revision`),
        contentDigest: assertString(entry.contentDigest, `${filePath}.sources[${index}].contentDigest`),
        ...(isRecord(entry.scope) ? { scope: entry.scope } : {}),
        trust: assertString(entry.trust, `${filePath}.sources[${index}].trust`),
        sensitivity: assertString(entry.sensitivity, `${filePath}.sources[${index}].sensitivity`),
        acl: isRecord(entry.acl)
          ? entry.acl
          : { read: [] },
        ...(isRecord(entry.provenance) ? { provenance: entry.provenance } : {}),
      } as SourceSetCandidate["ref"];
      const source: SourceSetCandidate = {
        ref,
        content: assertString(entry.content, `${filePath}.sources[${index}].content`),
        status: assertString(entry.status, `${filePath}.sources[${index}].status`) as SourceSetCandidate["status"],
        indexedAt: assertString(entry.indexedAt, `${filePath}.sources[${index}].indexedAt`),
        ...(typeof entry.statusReason === "string"
          ? { statusReason: entry.statusReason }
          : {}),
        ...(Array.isArray(entry.claims)
          ? { claims: entry.claims as SourceSetCandidate["claims"] }
          : {}),
        ...(Array.isArray(entry.conflictKeys)
          ? { conflictKeys: entry.conflictKeys as string[] }
          : {}),
      };
      return source;
    }),
    queries: (parsed.queries as unknown[]).map((entry, index) => {
      if (!isRecord(entry)) throw new Error(`${filePath}.queries[${index}]: expected object`);
      return {
        ...(entry as unknown as SourceSetQualityFixtureQuery),
        id: assertString(entry.id, `${filePath}.queries[${index}].id`),
        relevantSourceIds: assertStringArray(
          entry.relevantSourceIds,
          `${filePath}.queries[${index}].relevantSourceIds`,
        ),
        expectedConflicts: assertStringArray(
          entry.expectedConflicts,
          `${filePath}.queries[${index}].expectedConflicts`,
        ),
      };
    }),
  };
}

function sha256File(filePath: string): string {
  return createHash("sha256").update(readFileSync(filePath)).digest("hex");
}

function estimateTokensFromChars(chars: number): number {
  return Math.max(0, Math.ceil(chars / 4));
}

function ratio(numerator: number, denominator: number): number {
  if (denominator === 0) return 0;
  return numerator / denominator;
}

export async function evaluateSourceSetQualityCorpus(options: {
  fixturePath: string;
  now?: () => Date;
  embeddingProvider?: RuntimeEmbeddingProvider;
}): Promise<SourceSetQualityReport> {
  const fixture = loadSourceSetQualityFixture(options.fixturePath);
  const queryReports: SourceSetQualityQueryReport[] = [];
  let relevantQueryCount = 0;
  let recallSum = 0;
  let precisionSum = 0;
  let validCitations = 0;
  let totalCitations = 0;
  let staleRetrieved = 0;
  let staleGroundedClaims = 0;
  let expectedConflictCount = 0;
  let disclosedConflictCount = 0;
  let latencyTotal = 0;
  let latencyMax = 0;
  let tokenChars = 0;
  let semanticAvailable = false;

  for (const query of fixture.queries) {
    const startedAt = Date.now();
    const result = await retrieveSourceSet({
      query,
      sources: fixture.sources,
      ...(options.embeddingProvider ? { embeddingProvider: options.embeddingProvider } : {}),
      ...(options.now ? { now: options.now } : {}),
    });
    const latencyMs = Date.now() - startedAt;
    latencyTotal += latencyMs;
    latencyMax = Math.max(latencyMax, latencyMs);
    if (result.semanticLane.status === "available") semanticAvailable = true;

    const top5 = result.retrieved.slice(0, 5);
    const relevant = new Set(query.relevantSourceIds);
    const relevantFound = top5.filter((entry) => relevant.has(entry.ref.refId)).length;
    const recallAt5 = ratio(relevantFound, relevant.size);
    const precisionAt5 = ratio(relevantFound, Math.min(5, top5.length));
    if (relevant.size > 0) {
      relevantQueryCount += 1;
      recallSum += recallAt5;
      precisionSum += precisionAt5;
    }

    const citationCount = result.claims.reduce(
      (total, claim) => total + claim.citations.length,
      0,
    );
    const validCitationCount = result.claims.reduce(
      (total, claim) =>
        total +
        claim.citations.filter(
          (citation) => resolveSourceSetCitation(result, citation) !== undefined,
        ).length,
      0,
    );
    validCitations += validCitationCount;
    totalCitations += citationCount;

    const staleRetrievedForQuery = top5.filter(
      (entry) => entry.status === "stale",
    ).length;
    const staleGroundedForQuery = result.claims.filter((claim) =>
      claim.citations.some((citation) => {
        const source = resolveSourceSetCitation(result, citation);
        return source?.status === "stale";
      }),
    ).length;
    staleRetrieved += staleRetrievedForQuery;
    staleGroundedClaims += staleGroundedForQuery;

    const conflictKeys = result.conflictSet.map((entry) => entry.key);
    const expected = query.expectedConflicts;
    const disclosed = expected.filter((key) => conflictKeys.includes(key)).length;
    expectedConflictCount += expected.length;
    disclosedConflictCount += disclosed;

    const packed = packSourceSetForDcs(result);
    tokenChars += packed.length;

    queryReports.push({
      queryId: query.id,
      evidenceStatus: result.evidenceStatus,
      retrievedRefIds: top5.map((entry) => entry.ref.refId),
      rejectedRefIds: result.rejections.map((entry) => entry.refId),
      conflictKeys,
      expectedConflicts: expected,
      conflictDisclosure: ratio(disclosed, expected.length),
      relevantSourceIds: query.relevantSourceIds,
      recallAt5,
      precisionAt5,
      citationCount,
      validCitationCount,
      citationValidity: citationCount === 0 ? 1 : ratio(validCitationCount, citationCount),
      staleInclusion: {
        retrieved: staleRetrievedForQuery,
        groundedClaims: staleGroundedForQuery,
      },
      latencyMs,
      tokenCost: {
        chars: packed.length,
        estimatedTokens: estimateTokensFromChars(packed.length),
      },
    });
  }

  return {
    schema: SOURCE_SET_QUALITY_REPORT_SCHEMA,
    fixturePath: options.fixturePath,
    fixtureSha256: sha256File(options.fixturePath),
    generatedAt: new Date().toISOString(),
    semanticAvailability: semanticAvailable,
    metrics: {
      recallAt5: relevantQueryCount === 0 ? 0 : recallSum / relevantQueryCount,
      precisionAt5: relevantQueryCount === 0 ? 0 : precisionSum / relevantQueryCount,
      citationValidity: totalCitations === 0 ? 1 : ratio(validCitations, totalCitations),
      staleInclusion: {
        retrieved: staleRetrieved,
        groundedClaims: staleGroundedClaims,
      },
      conflictDisclosure:
        expectedConflictCount === 0
          ? 1
          : ratio(disclosedConflictCount, expectedConflictCount),
      latencyMs: {
        total: latencyTotal,
        avg: queryReports.length === 0 ? 0 : latencyTotal / queryReports.length,
        max: latencyMax,
      },
      tokenCost: {
        chars: tokenChars,
        estimatedTokens: estimateTokensFromChars(tokenChars),
      },
    },
    queryReports,
    humanUsefulness: "not-evaluated (E4 missing)",
    evidenceLevel: "E1-E2 fixture evaluation only; not E4/E5",
  };
}
