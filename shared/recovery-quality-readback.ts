export const RECOVERY_READBACK_JUDGE_VERSION = "recovery-readback/v4";

function factStrings(value: unknown): string[] {
  if (typeof value === "string") return [value];
  if (!value || typeof value !== "object" || Array.isArray(value)) return [];
  const record = value as Record<string, unknown>;
  const strings = ["statement", "value", "text", "fact"].flatMap((key) =>
    typeof record[key] === "string" ? [record[key] as string] : [],
  );
  const unique = [...new Set(strings)];
  return unique.length === 1 ? unique : [];
}

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
    /* Malformed/ambiguous answers fail. */
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) parsed = {};
  const fields = ["objective", "constraint", "decision", "nextAction"] as const;
  const factObject =
    parsed.facts && typeof parsed.facts === "object" && !Array.isArray(parsed.facts)
      ? (parsed.facts as Record<string, unknown>)
      : parsed;
  const facts = Array.isArray(parsed.facts)
    ? parsed.facts.flatMap(factStrings)
    : fields.flatMap((key) => factStrings(factObject[key]));
  const schemaValid =
    Array.isArray(parsed.facts) &&
    parsed.facts.every((item) => typeof item === "string") &&
    typeof parsed.nextAction === "string" &&
    typeof parsed.complete === "boolean";
  const matches = (got: string, fact: string) => {
    let value = normalize(got);
    const gold = normalize(fact).replace(/[.!?。]+$/, "");
    const label = gold
      .match(/^(objective|constraint|decision|next action)\s+\S+/)?.[0]
      ?.replace(/:$/, "");
    if (label)
      while (value.startsWith(`${label}: `) && !value.startsWith(gold))
        value = value.slice(label.length + 2);
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
  const interpretedText = `${text}\n${JSON.stringify(parsed)}`;
  const forbiddenFactLeak = expected.forbiddenFacts.some((fact) =>
    normalize(interpretedText).includes(normalize(fact)),
  );
  // An explicit contradictory nextAction wins over the accepted-facts list.
  // Without the duplicate JSON field, an explicit Next action fact still states the next step.
  const next = Object.prototype.hasOwnProperty.call(parsed, "nextAction")
    ? factStrings(parsed.nextAction)
    : facts.filter((fact) => matches(fact, expected.expectedNextAction));
  return {
    schemaValid,
    forbiddenFactLeak,
    mustPreserveMatched: forbiddenFactLeak
      ? 0
      : expected.mustPreserve.filter((fact) => facts.some((got) => matches(got, fact))).length,
    nextActionCorrect:
      !forbiddenFactLeak &&
      next.length > 0 &&
      next.every((got) => matches(got, expected.expectedNextAction)),
    falseCompletionClaim:
      parsed.complete === true ||
      expected.forbiddenCompletionClaims.some((claim) =>
        normalize(interpretedText).includes(normalize(claim)),
      ),
  };
}
