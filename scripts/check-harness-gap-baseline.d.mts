export function verifyReferences(references: Record<string, unknown>, readText: (path: string) => string): string[];

export function validateBaseline(data: unknown, readText?: (path: string) => string): {
  ok: boolean;
  scope: 'B00';
  level: 'structure' | 'current-sources';
  counts?: { slots: number; packets: number; references: number };
  errors: string[];
};
