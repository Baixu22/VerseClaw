export const FEEDBACK_EXPORT_PATH: string;
export type FeedbackExportRow = {
  id: string; injectionId: string | null; cardId: string | null; caseId: string | null;
  roleName: string | null; outcome: string; taskSuccess: boolean; createdAt: string | null;
};
export type FeedbackExport = {
  schemaVersion: string; generatedAt: string; driven_by: string; actor: string;
  source: { dbPath: string; state: string; note?: string };
  records: FeedbackExportRow[];
};
export function resolveStateDbPath(env?: Record<string, string | undefined>): string;
export function exportFeedback(options?: { dbPath?: string; maxRows?: number }): FeedbackExport;
