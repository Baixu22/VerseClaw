export const MEASUREMENT_ARCHIVE_DIR: string;
export function projectMeasurementTrials(original: unknown): unknown;
export function recomputeMeasurementArchive(root?: string): Record<string, unknown>;
export function validateMeasurementArchive(root?: string): { passed: boolean; errors: string[]; [key: string]: unknown };
export function writeMeasurementVerification(root?: string): { passed: boolean; errors: string[]; [key: string]: unknown };
