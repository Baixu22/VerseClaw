import { describe, expect, it } from "vitest";
import type {
  RuntimeMemoryFactRelation,
  RuntimeMemoryQueryableFact,
} from "../runtime-core/index.js";
import { buildRuntimeMemoryTemporalFactFixture } from "../runtime-core/index.js";
import {
  createRuntimeMemoryContextProvider,
  createRuntimeMemoryProviderResult,
} from "./memory-context-provider.js";

function fact(factId: string, subject: string): RuntimeMemoryQueryableFact {
  return buildRuntimeMemoryTemporalFactFixture({
    factId,
    subject,
    objectSummary: `${subject} summary`,
    valid_at: 1,
    reference_time: 1,
  });
}

function relation(
  relationId: string,
  targetFactId: string,
  relationType: RuntimeMemoryFactRelation["relationType"],
): RuntimeMemoryFactRelation {
  return {
    relationId,
    sourceFactId: "base",
    targetFactId,
    relationType,
    confidence: 1,
    createdAt: 1,
  };
}

describe("runtime memory context provider", () => {
  it("uses canonical causal edge weights for one-hop relation expansion", async () => {
    const relations = [
      relation("related", "related", "related_to"),
      relation("prevents", "prevents", "prevents"),
      relation("causes", "causes", "causes"),
    ];
    const result = await createRuntimeMemoryProviderResult(
      {
        facts: [
          fact("base", "base"),
          fact("related", "related"),
          fact("prevents", "prevents"),
          fact("causes", "causes"),
        ],
        queryRelations: () => relations,
      },
      {
        metadata: {
          memoryQuery: {
            subject: "base",
          },
        },
      },
    );

    expect(result.summary.items.map((item) => item.factId)).toEqual([
      "base",
      "causes",
      "prevents",
    ]);
  });

  it("serializes grounding query filters as JSON-safe diagnostics metadata", async () => {
    const provider = createRuntimeMemoryContextProvider({
      config: {
        runtime: {
          memory: {
            provider: true,
          },
        },
      },
      groundingDiagnostics: {
        enabled: true,
        query: {
          readonly: true,
          kind: ["memory", "tool"],
          trust: ["verified", "supplied"],
        },
      },
    });

    const result = await provider.getContext({});
    const groundingDiagnostics = result.metadata?.groundingDiagnostics;

    expect(groundingDiagnostics).toMatchObject({
      query: {
        readonly: true,
        kind: ["memory", "tool"],
        trust: ["verified", "supplied"],
        includeRaw: false,
        includeUntrusted: false,
      },
    });
  });
});
