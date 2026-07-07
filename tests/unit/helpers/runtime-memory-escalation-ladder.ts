import {
  EVIDENCE_INSUFFICIENT_SIGNAL,
  stripEvidenceInsufficientSignal,
} from "./runtime-memory-generation-scaffolds";

export type EscalationLevel = 0 | 1 | 2;

export type EscalationAttempt = {
  level: EscalationLevel;
  context: string;
  rawAnswer: string;
};

export type EscalationResult = {
  answer: string;
  rawAnswer: string;
  escalationLevel: EscalationLevel;
  attempts: EscalationAttempt[];
};

export type EscalationStats = {
  totalQuestions: number;
  level0: number;
  level1: number;
  level2: number;
  capped: number;
  fullConversationCapped: number;
  maxEscalations: number;
  maxFullConversationEscalations: number;
  escalationRate: number;
  fullConversationRate: number;
};

export class EscalationBudget {
  private used = 0;
  private cappedCount = 0;

  constructor(
    readonly totalQuestions: number,
    readonly maxRate = 0.4,
  ) {}

  tryUse(): boolean {
    if (this.used >= this.maxEscalations) {
      this.cappedCount += 1;
      return false;
    }
    this.used += 1;
    return true;
  }

  get maxEscalations(): number {
    return Math.floor(this.totalQuestions * this.maxRate);
  }

  get usedEscalations(): number {
    return this.used;
  }

  get capped(): number {
    return this.cappedCount;
  }
}

export async function runEscalationLadder(args: {
  generate: (context: string, level: EscalationLevel) => Promise<string>;
  fragmentContext: string;
  sessionContext: () => Promise<string>;
  fullConversationContext: () => Promise<string>;
  budget: EscalationBudget;
  fullConversationBudget?: EscalationBudget;
}): Promise<EscalationResult> {
  const attempts: EscalationAttempt[] = [];

  const level0 = await args.generate(args.fragmentContext, 0);
  attempts.push({ level: 0, context: args.fragmentContext, rawAnswer: level0 });
  let stripped = stripEvidenceInsufficientSignal(level0);
  if (!stripped.insufficient) {
    return {
      answer: stripped.answer,
      rawAnswer: level0,
      escalationLevel: 0,
      attempts,
    };
  }

  if (!args.budget.tryUse()) {
    return {
      answer: stripped.answer,
      rawAnswer: level0,
      escalationLevel: 0,
      attempts,
    };
  }

  const level1Context = `${await args.sessionContext()}\n\n${args.fragmentContext}`.trim();
  const level1 = await args.generate(level1Context, 1);
  attempts.push({ level: 1, context: level1Context, rawAnswer: level1 });
  stripped = stripEvidenceInsufficientSignal(level1);
  if (!stripped.insufficient) {
    return {
      answer: stripped.answer,
      rawAnswer: level1,
      escalationLevel: 1,
      attempts,
    };
  }

  const fullConversationBudget = args.fullConversationBudget ?? args.budget;
  if (!fullConversationBudget.tryUse()) {
    return {
      answer: stripped.answer,
      rawAnswer: level1,
      escalationLevel: 1,
      attempts,
    };
  }

  const level2Context = await args.fullConversationContext();
  const level2 = await args.generate(level2Context, 2);
  attempts.push({ level: 2, context: level2Context, rawAnswer: level2 });
  stripped = stripEvidenceInsufficientSignal(level2);
  return {
    answer: stripped.answer,
    rawAnswer: level2,
    escalationLevel: 2,
    attempts,
  };
}

export function summarizeEscalationStats(
  results: readonly Pick<EscalationResult, "escalationLevel">[],
  budget: EscalationBudget,
  fullConversationBudget: EscalationBudget = budget,
): EscalationStats {
  const level0 = results.filter((result) => result.escalationLevel === 0).length;
  const level1 = results.filter((result) => result.escalationLevel === 1).length;
  const level2 = results.filter((result) => result.escalationLevel === 2).length;
  return {
    totalQuestions: results.length,
    level0,
    level1,
    level2,
    capped: budget.capped,
    fullConversationCapped: fullConversationBudget.capped,
    maxEscalations: budget.maxEscalations,
    maxFullConversationEscalations: fullConversationBudget.maxEscalations,
    escalationRate: results.length > 0 ? (level1 + level2) / results.length : 0,
    fullConversationRate: results.length > 0 ? level2 / results.length : 0,
  };
}

export { EVIDENCE_INSUFFICIENT_SIGNAL };
