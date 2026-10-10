export const TASK_SPEC_ROOT: string;
export const LIFECYCLE_STATUSES: readonly string[];
export function validateLifecycleStatus(data: Record<string, unknown> | undefined, specPath?: string): string[];
export function collectTaskSpecLifecycleErrors(): Promise<string[]>;