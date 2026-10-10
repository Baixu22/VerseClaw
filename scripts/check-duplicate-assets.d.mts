export const DUPLICATE_MIN_BYTES: number;
export const ALLOWLIST_PATH: string;
export type DuplicateGroup = { sha256: string; paths: string[]; bytes?: number | null; reason?: string };
export function findDuplicateGroups(minBytes?: number): Promise<DuplicateGroup[]>;
export function compareDuplicateGroups(actualGroups: DuplicateGroup[], allowlist: { groups?: DuplicateGroup[] }): { unexpected: DuplicateGroup[]; stale: DuplicateGroup[]; malformed: DuplicateGroup[] };
export function buildAllowlist(groups: DuplicateGroup[]): Promise<{ version: number; minBytes: number; groups: DuplicateGroup[] }>;