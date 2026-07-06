import { describe, expect, it } from "vitest";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import {
  FROZEN_JUDGE_CONFIG,
  buildJudgeSanityReport,
  buildFrozenJudgePrompt,
  type EvalReportSampleResult,
  computeJudgeFalseNegativeRate,
  parseFrozenJudgeVerdict,
} from "./helpers/runtime-memory-judge-freeze";

function loadLocomoQuestionById(): Map<string, { question: string; answer: string }> {
  const rawPath = join(
    process.cwd(),
    "tests",
    "fixtures",
    "locomo",
    "locomo10_raw.json",
  );
  const lookup = new Map<string, { question: string; answer: string }>();
  if (!existsSync(rawPath)) return lookup;

  const raw = JSON.parse(readFileSync(rawPath, "utf-8")) as Array<{
    sample_id: string;
    qa: Array<{ question?: string; answer?: string | number }>;
  }>;
  for (const sample of raw) {
    for (const [qaIndex, qa] of sample.qa.entries()) {
      if (typeof qa.question === "string") {
        lookup.set(`${sample.sample_id}_q${qaIndex}`, {
          question: qa.question,
          answer: String(qa.answer ?? ""),
        });
      }
    }
  }
  return lookup;
}

function hydrateSampleQuestions(samples: unknown[]): EvalReportSampleResult[] {
  const questionById = loadLocomoQuestionById();
  return samples.map((sample): EvalReportSampleResult => {
    if (!sample || typeof sample !== "object") return {};
    const result = sample as EvalReportSampleResult;
    const questionId = result.questionId;
    if (
      typeof questionId === "string" &&
      (typeof result.question !== "string" || result.question.length === 0)
    ) {
      const rawQuestion = questionById.get(questionId);
      const rawAnswerMatches =
        rawQuestion !== undefined &&
        typeof result.groundTruth === "string" &&
        rawQuestion.answer.trim() === result.groundTruth.trim();
      return {
        ...result,
        question: rawAnswerMatches
          ? rawQuestion.question
          : "[question unavailable: source report used legacy sampled-position question ids]",
      };
    }
    return result;
  });
}

function selectJudgeSanitySource(source: {
  sampleResults?: unknown[];
  judgeSanityCandidates?: unknown[];
}): unknown[] {
  return Array.isArray(source.judgeSanityCandidates)
    ? source.judgeSanityCandidates
    : Array.isArray(source.sampleResults)
      ? source.sampleResults
      : [];
}

describe("runtime memory judge freeze and sanity check", () => {
  it("builds a frozen judge prompt and parses verdicts", () => {
    const prompt = buildFrozenJudgePrompt("Where does Alice work?", "Acme", "Acme Corp");
    expect(prompt.system).toBe(FROZEN_JUDGE_CONFIG.promptTemplate);
    expect(parseFrozenJudgeVerdict("yes")).toBe(1);
    expect(parseFrozenJudgeVerdict("no")).toBe(0);
  });

  it("computes judge false-negative rate over reviewed samples", () => {
    const rate = computeJudgeFalseNegativeRate([
      {
        questionId: "q1",
        question: "Q1",
        groundTruth: "A",
        predictedAnswer: "A",
        manualVerdict: "actually_correct",
      },
      {
        questionId: "q2",
        question: "Q2",
        groundTruth: "B",
        predictedAnswer: "C",
        manualVerdict: "truly_wrong",
      },
      {
        questionId: "q3",
        question: "Q3",
        groundTruth: "D",
        predictedAnswer: "E",
        manualVerdict: "unreviewed",
      },
    ]);

    expect(rate).toBe(0.5);
  });

  it("builds a judge sanity report from wrong eval samples", () => {
    const report = buildJudgeSanityReport(
      [
        {
          questionId: "q1",
          category: "temporal",
          question: "When?",
          judgeScore: 0,
          predictedAnswer: "2018",
          groundTruth: "2018",
        },
        {
          questionId: "q2",
          category: "single_hop",
          judgeScore: 1,
          predictedAnswer: "Alice",
          groundTruth: "Alice",
        },
      ],
      {
        targetSampleSize: 50,
        sourceReport: "memory-report.json",
        now: () => new Date("2026-07-02T00:00:00.000Z"),
      },
    );

    expect(report.samples).toHaveLength(1);
    expect(report.samples[0].manualVerdict).toBe("unreviewed");
    expect(report.judgeConfig.promptVersion).toBe("frozen-v2-generous-2026-07-04");
  });

  it("prefers dedicated judge sanity candidates over display samples", () => {
    const selected = selectJudgeSanitySource({
      sampleResults: [{ questionId: "display" }],
      judgeSanityCandidates: [{ questionId: "candidate" }],
    }) as Array<{ questionId: string }>;

    expect(selected[0].questionId).toBe("candidate");
  });

  it("writes judge-sanity-check.json when an eval report is available", () => {
    const sourcePath = join(
      process.cwd(),
      "artifacts",
      "runtime-memory-eval",
      "locomo-full-500-report.json",
    );
    if (!existsSync(sourcePath)) {
      expect(existsSync(sourcePath)).toBe(false);
      return;
    }

    const source = JSON.parse(readFileSync(sourcePath, "utf-8")) as {
      sampleResults?: unknown[];
      judgeSanityCandidates?: unknown[];
    };
    const sampleResults = hydrateSampleQuestions(selectJudgeSanitySource(source));
    const report = buildJudgeSanityReport(
      sampleResults,
      { sourceReport: sourcePath },
    );
    const outputPath = join(
      process.cwd(),
      "artifacts",
      "runtime-memory-eval",
      "judge-sanity-check.json",
    );
    mkdirSync(dirname(outputPath), { recursive: true });
    writeFileSync(outputPath, JSON.stringify(report, null, 2) + "\n", "utf-8");

    expect(existsSync(outputPath)).toBe(true);
  });
});
