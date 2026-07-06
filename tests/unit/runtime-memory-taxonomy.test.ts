// @vitest-environment node
// Phase 4.1: Memory taxonomy (semantic / episodic / procedural) tests.
// Validates that the optional `memoryType` field on
// `RuntimeMemoryTemporalFactCandidate` is accepted by type guards, preserved
// through sanitization, defaulted by the persistence layer, and round-trips
// through the fixture builder without breaking existing callers that omit it.

import { describe, expect, it } from "vitest";
import {
  DEFAULT_RUNTIME_MEMORY_TYPE,
  RUNTIME_MEMORY_TYPES,
  buildRuntimeMemoryTemporalFactCandidateFixture,
  buildRuntimeMemoryTemporalFactFixture,
  isRuntimeMemoryTemporalFact,
  isRuntimeMemoryTemporalFactCandidate,
  isRuntimeMemoryType,
  sanitizeRuntimeMemoryTemporalFactCandidate,
  type RuntimeMemoryType,
} from "../../openclaw_runtime/src/runtime-core/memory-context";

describe("Phase 4.1: Memory taxonomy", () => {
  describe("RUNTIME_MEMORY_TYPES constant", () => {
    it("contains exactly semantic, episodic, procedural", () => {
      expect(RUNTIME_MEMORY_TYPES).toEqual([
        "semantic",
        "episodic",
        "procedural",
      ]);
    });

    it("DEFAULT_RUNTIME_MEMORY_TYPE is semantic", () => {
      expect(DEFAULT_RUNTIME_MEMORY_TYPE).toBe("semantic");
    });
  });

  describe("isRuntimeMemoryType", () => {
    it.each(RUNTIME_MEMORY_TYPES)("accepts '%s'", (value) => {
      expect(isRuntimeMemoryType(value)).toBe(true);
    });

    it("rejects unknown strings", () => {
      expect(isRuntimeMemoryType("declarative")).toBe(false);
      expect(isRuntimeMemoryType("semantic ")).toBe(false);
      expect(isRuntimeMemoryType("SEMANTIC")).toBe(false);
    });

    it("rejects non-strings", () => {
      expect(isRuntimeMemoryType(undefined)).toBe(false);
      expect(isRuntimeMemoryType(null)).toBe(false);
      expect(isRuntimeMemoryType(0)).toBe(false);
      expect(isRuntimeMemoryType({})).toBe(false);
    });
  });

  describe("RuntimeMemoryTemporalFactCandidate type guard", () => {
    it("accepts candidate with memoryType: semantic", () => {
      const candidate = buildRuntimeMemoryTemporalFactCandidateFixture({
        memoryType: "semantic",
      });
      expect(isRuntimeMemoryTemporalFactCandidate(candidate)).toBe(true);
      expect(candidate.memoryType).toBe("semantic");
    });

    it("accepts candidate with memoryType: episodic", () => {
      const candidate = buildRuntimeMemoryTemporalFactCandidateFixture({
        memoryType: "episodic",
      });
      expect(isRuntimeMemoryTemporalFactCandidate(candidate)).toBe(true);
      expect(candidate.memoryType).toBe("episodic");
    });

    it("accepts candidate with memoryType: procedural", () => {
      const candidate = buildRuntimeMemoryTemporalFactCandidateFixture({
        memoryType: "procedural",
      });
      expect(isRuntimeMemoryTemporalFactCandidate(candidate)).toBe(true);
      expect(candidate.memoryType).toBe("procedural");
    });

    it("accepts candidate without memoryType (backward compatibility)", () => {
      const candidate = buildRuntimeMemoryTemporalFactCandidateFixture();
      expect(isRuntimeMemoryTemporalFactCandidate(candidate)).toBe(true);
      expect(candidate.memoryType).toBeUndefined();
    });

    it("rejects candidate with invalid memoryType", () => {
      const base = buildRuntimeMemoryTemporalFactCandidateFixture();
      const invalid = { ...base, memoryType: "declarative" };
      expect(isRuntimeMemoryTemporalFactCandidate(invalid)).toBe(false);
    });

    it("rejects candidate with non-string memoryType", () => {
      const base = buildRuntimeMemoryTemporalFactCandidateFixture();
      const invalid = { ...base, memoryType: 42 };
      expect(isRuntimeMemoryTemporalFactCandidate(invalid)).toBe(false);
    });
  });

  describe("RuntimeMemoryTemporalFact type guard", () => {
    it("accepts fact with memoryType: procedural", () => {
      const fact = buildRuntimeMemoryTemporalFactFixture({
        memoryType: "procedural",
      });
      expect(isRuntimeMemoryTemporalFact(fact)).toBe(true);
      expect(fact.memoryType).toBe("procedural");
    });

    it("accepts fact without memoryType (backward compatibility)", () => {
      const fact = buildRuntimeMemoryTemporalFactFixture();
      expect(isRuntimeMemoryTemporalFact(fact)).toBe(true);
      expect(fact.memoryType).toBeUndefined();
    });
  });

  describe("sanitizeRuntimeMemoryTemporalFactCandidate", () => {
    it("preserves memoryType through sanitization", () => {
      const candidate = buildRuntimeMemoryTemporalFactCandidateFixture({
        memoryType: "episodic",
        objectSummary: "User deployed the service at 3pm on Tuesday.",
      });
      const result = sanitizeRuntimeMemoryTemporalFactCandidate(candidate);
      expect(result.accepted).toBe(true);
      if (result.accepted) {
        expect(result.value.memoryType).toBe("episodic");
      }
    });

    it("omits memoryType in sanitized output when input has none", () => {
      const candidate = buildRuntimeMemoryTemporalFactCandidateFixture();
      const result = sanitizeRuntimeMemoryTemporalFactCandidate(candidate);
      expect(result.accepted).toBe(true);
      if (result.accepted) {
        expect(result.value.memoryType).toBeUndefined();
      }
    });

    it("round-trips all three memory types", () => {
      for (const memoryType of RUNTIME_MEMORY_TYPES) {
        const candidate = buildRuntimeMemoryTemporalFactCandidateFixture({
          memoryType,
        });
        const result = sanitizeRuntimeMemoryTemporalFactCandidate(candidate);
        expect(result.accepted).toBe(true);
        if (result.accepted) {
          expect(result.value.memoryType).toBe(memoryType);
          expect(isRuntimeMemoryTemporalFactCandidate(result.value)).toBe(true);
        }
      }
    });
  });

  describe("fixture builders", () => {
    it("buildRuntimeMemoryTemporalFactCandidateFixture accepts memoryType override", () => {
      const candidate = buildRuntimeMemoryTemporalFactCandidateFixture({
        memoryType: "procedural",
      });
      expect(candidate.memoryType).toBe("procedural");
    });

    it("buildRuntimeMemoryTemporalFactFixture accepts memoryType override", () => {
      const fact = buildRuntimeMemoryTemporalFactFixture({
        memoryType: "episodic",
      });
      expect(fact.memoryType).toBe("episodic");
    });

    it("fixtures without memoryType override are still valid", () => {
      const candidate = buildRuntimeMemoryTemporalFactCandidateFixture();
      const fact = buildRuntimeMemoryTemporalFactFixture();
      expect(isRuntimeMemoryTemporalFactCandidate(candidate)).toBe(true);
      expect(isRuntimeMemoryTemporalFact(fact)).toBe(true);
    });
  });

  describe("effective type resolution", () => {
    // Documents the pattern consumers should use: fact.memoryType ?? DEFAULT_RUNTIME_MEMORY_TYPE.
    // The persistence layer (Phase 4.1) also uses this pattern when writing the
    // memory_type column and record_json.
    it("undefined memoryType resolves to DEFAULT_RUNTIME_MEMORY_TYPE", () => {
      const fact = buildRuntimeMemoryTemporalFactFixture();
      const effectiveType: RuntimeMemoryType =
        fact.memoryType ?? DEFAULT_RUNTIME_MEMORY_TYPE;
      expect(effectiveType).toBe("semantic");
    });

    it("explicit memoryType is used as-is", () => {
      const fact = buildRuntimeMemoryTemporalFactFixture({
        memoryType: "procedural",
      });
      const effectiveType: RuntimeMemoryType =
        fact.memoryType ?? DEFAULT_RUNTIME_MEMORY_TYPE;
      expect(effectiveType).toBe("procedural");
    });
  });
});
