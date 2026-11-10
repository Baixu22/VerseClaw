export type JudgeGrade = { verdict: 'pass' | 'fail' | 'unknown'; valid: boolean; reason: string };
export function parseJudgeResponse(response: unknown): JudgeGrade;
export function gradeJudgeVotes(receipts: Array<{ httpStatus: number | null; response: unknown; error?: string | null }>, expectedModel?: string): {
  valid: boolean; verdict: 'pass' | 'fail' | 'unknown'; votes: JudgeGrade[]; counts: Record<string, number>;
};
export function gradeReviewSample(sample: unknown, receipts: Parameters<typeof gradeJudgeVotes>[0], expectedModel?: string): ReturnType<typeof gradeJudgeVotes> & {
  modelVerdict: 'pass' | 'fail' | 'unknown'; evidenceAvailable: boolean;
};
export function main(argv?: string[]): Promise<number>;
