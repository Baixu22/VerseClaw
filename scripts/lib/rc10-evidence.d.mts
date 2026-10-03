export type Rc10Decision = { result: 'pass' | 'fail' | 'blocked'; errors: string[]; provesDelivery?: boolean };
export function summarizeRc10Receipts(rows: Record<string, unknown>[], runId: string | null): {
  available: boolean;
  total: number;
  kinds: unknown[];
  context: Record<string, unknown>[];
  wire: Record<string, unknown>[];
  pairs: number;
};
export function evaluateRc10H01(options: Record<string, unknown>): Rc10Decision;
export function evaluateRc10ChannelProbe(options: Record<string, unknown>): Rc10Decision;
export function sealRc10Evidence(evidenceDir: string, secrets?: (string | undefined)[]): Promise<{
  algorithm: string;
  driven_by: string;
  credentialScanHits: string[];
  files: Record<string, { bytes: number; sha256: string }>;
}>;
export function verifyRc10Evidence(evidenceDir: string): Promise<{ ok: boolean; errors: string[]; checkedFiles: number }>;
