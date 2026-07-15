import { describe, expect, it } from "vitest";
import {
  defaultSekbTaskClassifier,
  SEKB_DEFAULT_TASK_INTENT_MAX_CHARS,
} from "./harness-integration.js";

describe("defaultSekbTaskClassifier", () => {
  it("is deterministic for identical inputs", () => {
    const input = {
      prompt: "Please refactor the TypeScript module and fix unit tests",
      systemPrompt: "You are a coding agent",
      resources: [],
    };
    expect(defaultSekbTaskClassifier(input)).toEqual(defaultSekbTaskClassifier(input));
  });

  it("classifies browser, code, debug, and ops buckets with stable tags", () => {
    expect(defaultSekbTaskClassifier({
      prompt: "Open the browser and navigate to https://example.com",
      systemPrompt: "",
      resources: [],
    })).toMatchObject({ task_type: "browser/task", context_tags: ["browser"] });

    expect(defaultSekbTaskClassifier({
      prompt: "Refactor this TypeScript function and update unit tests",
      systemPrompt: "",
      resources: [],
    })).toMatchObject({ task_type: "code/task", context_tags: ["code"] });

    expect(defaultSekbTaskClassifier({
      prompt: "Debug the failing stack trace and fix the runtime error",
      systemPrompt: "",
      resources: [],
    })).toMatchObject({ task_type: "debug/task", context_tags: ["debug"] });

    expect(defaultSekbTaskClassifier({
      prompt: "Deploy the docker pipeline to kubernetes",
      systemPrompt: "",
      resources: [],
    })).toMatchObject({ task_type: "ops/task", context_tags: ["ops"] });
  });

  it("caps task_intent length and keeps agent/task fallback", () => {
    const long = "x".repeat(SEKB_DEFAULT_TASK_INTENT_MAX_CHARS + 50);
    const result = defaultSekbTaskClassifier({
      prompt: long,
      systemPrompt: "",
      resources: [{ type: "file" }, { type: "secret-token" }],
    });
    expect(result.task_intent).toHaveLength(SEKB_DEFAULT_TASK_INTENT_MAX_CHARS);
    expect(result.task_type).toBe("agent/task");
    expect(result.context_tags).toContain("file");
    expect(result.context_tags.join(" ")).not.toContain("secret");
  });
});
