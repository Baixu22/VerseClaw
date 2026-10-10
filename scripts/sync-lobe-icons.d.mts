export const ROOT: string;
export const PACKAGE_NAME: string;
export const SOURCE_DIR: string;
export const DEFAULT_TARGET_DIR: string;
export const PROVENANCE_FILE: string;

export interface LobeIconDependencyIdentity {
  name: string;
  version: string;
  license: string;
  homepage: string | null;
  repository: string | null;
}

export interface LobeIconDrift {
  missing: string[];
  differing: string[];
  extra: string[];
  iconCount: number;
}

export interface LobeIconSyncReport extends LobeIconDependencyIdentity {
  targetDir: string;
  iconCount: number;
  aggregateDigest: string;
  drift: Pick<LobeIconDrift, 'missing' | 'differing' | 'extra'>;
  written: boolean;
  copied: number;
  unchanged: number;
  removed: string[];
}

export function resolveTargetDir(override?: string): string;
export function readDependencyIdentity(): LobeIconDependencyIdentity;
export function listSourceIcons(): string[];
export function sha256(buffer: Buffer | Uint8Array | string): string;
export function aggregateDigest(names: string[], digestFor: (name: string) => string): string;
export function readSourceIcons(): { names: string[]; buffers: Map<string, Buffer> };
export function collectDrift(targetDir?: string): LobeIconDrift;
export function syncLobeIcons(options?: { targetDir?: string; check?: boolean }): LobeIconSyncReport;
