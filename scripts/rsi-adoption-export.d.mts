import type { SekbAttributionReceipt } from '../openclaw_runtime/src/knowledge/sekb/types.js';

export type RsiAdoptionExport = {
  schemaVersion: 'RsiAdoptionExport/v1';
  generatedAt: string;
  driven_by: 'agent';
  actor: string;
  source: { dbPath: string; state: 'present' | 'absent' | 'schema-absent' | 'unreadable'; totalRows: number; exportedRows: number; truncated: boolean };
  records: (SekbAttributionReceipt & { runKey: string; payloadDigest: string })[];
  diagnostics: { missingTaskIdentity: number; missingExperimentIdentity: number; unknownOutcomes: number; rejected: number; duplicates: number; conflicts: number; rejections: number };
  errors: { code: string; eventId?: string }[];
};
export function exportAdoptionEvents(options?: { dbPath?: string; maxRows?: number }): RsiAdoptionExport;
export function validateAdoptionExport(report: RsiAdoptionExport): { passed: boolean; errors: { code: string; eventId?: string }[] };
