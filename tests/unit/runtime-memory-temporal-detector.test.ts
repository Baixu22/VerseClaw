import { describe, expect, it } from "vitest";
import {
  detectQueryTemporalMode,
  isMultiHopQuestion,
  isOpenDomainQuestion,
} from "../../openclaw_runtime/src/runtime-core/memory-temporal-detector";

describe("memory-temporal-detector", () => {
  describe("detectQueryTemporalMode", () => {
    it("returns strict for 'when did' questions", () => {
      expect(detectQueryTemporalMode("When did Alice start her job?")).toBe("strict");
    });

    it("returns strict for 'what date' questions", () => {
      expect(detectQueryTemporalMode("What date did they get married?")).toBe("strict");
    });

    it("returns strict for year references", () => {
      expect(detectQueryTemporalMode("Did they meet in 2021?")).toBe("strict");
    });

    it("returns strict for 'before/after' temporal comparisons", () => {
      expect(detectQueryTemporalMode("What was his job before he moved?")).toBe("strict");
      expect(detectQueryTemporalMode("What did she do after she quit?")).toBe("strict");
    });

    it("returns strict for 'what year' questions", () => {
      expect(detectQueryTemporalMode("What year did they graduate?")).toBe("strict");
    });

    it("returns filter for 'currently' questions", () => {
      expect(detectQueryTemporalMode("What is Alice currently doing?")).toBe("filter");
    });

    it("returns filter for 'now' questions", () => {
      expect(detectQueryTemporalMode("Where does Bob work now?")).toBe("filter");
    });

    it("returns filter for 'still' questions", () => {
      expect(detectQueryTemporalMode("Is Alice still working at the hospital?")).toBe("filter");
    });

    it("returns filter for 'recently' questions", () => {
      expect(detectQueryTemporalMode("What has changed recently?")).toBe("filter");
    });

    it("returns boost for non-temporal questions", () => {
      expect(detectQueryTemporalMode("What is Alice's favorite color?")).toBe("boost");
    });

    it("returns boost for empty string", () => {
      expect(detectQueryTemporalMode("")).toBe("boost");
    });

    it("returns strict when both strict and filter patterns match (strict wins)", () => {
      expect(detectQueryTemporalMode("When did Alice currently work?")).toBe("strict");
    });
  });

  describe("isMultiHopQuestion", () => {
    it("detects 'how long' questions", () => {
      expect(isMultiHopQuestion("How long has Alice worked at the hospital?")).toBe(true);
    });

    it("detects 'compare' questions", () => {
      expect(isMultiHopQuestion("Compare Alice's and Bob's jobs")).toBe(true);
    });

    it("detects 'relationship between' questions", () => {
      expect(isMultiHopQuestion("What is the relationship between Alice and Bob?")).toBe(true);
    });

    it("detects 'both ... and' questions", () => {
      expect(isMultiHopQuestion("What do both Alice and Bob like?")).toBe(true);
    });

    it("returns false for single-hop questions", () => {
      expect(isMultiHopQuestion("What is Alice's job?")).toBe(false);
    });

    it("returns false for empty string", () => {
      expect(isMultiHopQuestion("")).toBe(false);
    });
  });

  describe("isOpenDomainQuestion", () => {
    it("detects 'tell me about' questions", () => {
      expect(isOpenDomainQuestion("Tell me about Alice's background")).toBe(true);
    });

    it("detects 'what can you tell me' questions", () => {
      expect(isOpenDomainQuestion("What can you tell me about Bob?")).toBe(true);
    });

    it("detects 'describe' questions", () => {
      expect(isOpenDomainQuestion("Describe Alice's career")).toBe(true);
    });

    it("detects 'summarize' questions", () => {
      expect(isOpenDomainQuestion("Summarize Alice's career")).toBe(true);
    });

    it("returns false for specific questions", () => {
      expect(isOpenDomainQuestion("When did Alice start her job?")).toBe(false);
    });

    it("returns false for 'who is' questions (too broad for open-domain)", () => {
      expect(isOpenDomainQuestion("Who is Alice?")).toBe(false);
    });

    it("returns false for empty string", () => {
      expect(isOpenDomainQuestion("")).toBe(false);
    });
  });
});
