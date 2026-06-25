export type InputMode = "interrupt" | "guide" | "queue" | "revise-goal";
export type InputIntent = InputMode | "question" | "correction";

export type InputIntentClassification = {
  intent: InputIntent;
  confidence: number;
  reasons: string[];
};

const GUIDE_PATTERNS = [/\bbtw\b/i, /顺便/, /顺手/, /考虑一下/, /补充/, /提醒/];
const QUEUE_PATTERNS = [/等(下|会|当前).*(再|之后)/, /later/i, /after this/i, /排队/, /做完.*再/];
const INTERRUPT_PATTERNS = [/停下/, /停止/, /先别/, /打断/, /interrupt/i, /stop/i, /先做/];
const QUESTION_PATTERNS = [/\?\s*$/, /？\s*$/, /^why\b/i, /^what\b/i, /^how\b/i, /为什么/, /是什么/];
const CORRECTION_PATTERNS = [/刚才/, /上一/, /修正/, /改成/, /不对/, /correction/i];

const REVISE_GOAL_PATTERNS = [/revise goal/i, /change goal/i, /new goal/i, /update objective/i, /change objective/i];

function matchAny(input: string, patterns: readonly RegExp[]): RegExp | undefined {
  return patterns.find((pattern) => pattern.test(input));
}

export function classifyInputIntent(input: string): InputIntentClassification {
  const text = input.trim();
  const checks: Array<[InputIntent, readonly RegExp[], number]> = [
    ["interrupt", INTERRUPT_PATTERNS, 0.9],
    ["revise-goal", REVISE_GOAL_PATTERNS, 0.88],
    ["queue", QUEUE_PATTERNS, 0.85],
    ["guide", GUIDE_PATTERNS, 0.8],
    ["correction", CORRECTION_PATTERNS, 0.75],
    ["question", QUESTION_PATTERNS, 0.7],
  ];
  for (const [intent, patterns, confidence] of checks) {
    const matched = matchAny(text, patterns);
    if (matched) {
      return { intent, confidence, reasons: [`matched:${matched.source}`] };
    }
  }
  return { intent: "guide", confidence: 0.45, reasons: ["default-noninterrupting-guide"] };
}

export function resolveInputMode(input: string, explicitMode?: InputMode): InputMode {
  if (explicitMode) {
    return explicitMode;
  }
  const classification = classifyInputIntent(input);
  if (classification.intent === "interrupt" || classification.intent === "queue" || classification.intent === "revise-goal") {
    return classification.intent;
  }
  return "guide";
}
