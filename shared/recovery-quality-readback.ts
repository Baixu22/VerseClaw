export const RECOVERY_READBACK_JUDGE_VERSION = "recovery-readback/v3";

/** Judge fresh assistant fields; JSON shape compliance is separate from factual fidelity. */
export function scoreRecoveryReadback(
  text: string,
  expected: {
    mustPreserve: readonly string[];
    expectedNextAction: string;
    forbiddenCompletionClaims: readonly string[];
    forbiddenFacts: readonly string[];
  },
) {
  const normalize = (value: string) => value.toLowerCase().replace(/\s+/g, " ").trim();
  let parsed: Record<string, unknown> = {};
  const blocks = [...text.matchAll(/```(?:json)?\s*([\s\S]*?)```/g)];
  const json = blocks.length === 1 ? blocks[0][1] : text;
  try {
    parsed = JSON.parse(json.trim());
  } catch {
    /* A malformed readback fails the schema gate. */
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) parsed = {};
  const fields = ["objective", "constraint", "decision", "nextAction"] as const;
  const factObject =
    parsed.facts && typeof parsed.facts === "object" && !Array.isArray(parsed.facts)
      ? (parsed.facts as Record<string, unknown>)
      : parsed;
  const facts = Array.isArray(parsed.facts)
    ? parsed.facts.flatMap((item) =>
        typeof item === "string"
          ? [item]
          : item && typeof item === "object" && typeof item.statement === "string"
            ? [item.statement]
            : [],
      )
    : fields.flatMap((key) =>
        typeof factObject[key] === "string" ? [factObject[key] as string] : [],
      );
  const schemaValid =
    Array.isArray(parsed.facts) &&
    parsed.facts.every((item) => typeof item === "string") &&
    typeof parsed.nextAction === "string" &&
    typeof parsed.complete === "boolean";
  const matches = (got: string, fact: string) => {
    let value = normalize(got);
    const gold = normalize(fact).replace(/[.!?。]+$/, "");
    const label = gold.match(/^(objective|constraint|decision|next action)\s+\S+/)?.[0];
    if (label && value.startsWith(`${label}: ${gold}`)) value = value.slice(label.length + 2);
    if (value === gold) return true;
    const suffix = value.slice(gold.length);
    return (
      value.startsWith(gold) &&
      /^[.。:]/.test(suffix) &&
      !/\b(?:false|incorrect|revoked|cancelled|replaced|except|unless|but|however|no longer)\b/.test(
        suffix,
      )
    );
  };
  const forbiddenFactLeak = expected.forbiddenFacts.some((fact) =>
    normalize(text).includes(normalize(fact)),
  );
  return {
    schemaValid,
    forbiddenFactLeak,
    mustPreserveMatched: forbiddenFactLeak
      ? 0
      : expected.mustPreserve.filter((fact) => facts.some((got) => matches(got, fact))).length,
    nextActionCorrect:
      !forbiddenFactLeak &&
      typeof parsed.nextAction === "string" &&
      matches(parsed.nextAction, expected.expectedNextAction),
    falseCompletionClaim:
      parsed.complete === true ||
      expected.forbiddenCompletionClaims.some((claim) =>
        normalize(text).includes(normalize(claim)),
      ),
  };
}
