export const ISOLATED_PYTHON_VERSION: 'RsiStdioIsolatedPython/v1';
export function validateIsolatedPython(descriptor: Record<string, any>, reference?: string | null): Record<string, any>;
export function verifyIsolatedPythonEvidence(report: Record<string, any>, item: Record<string, any>, workspace: string): true;
export function runIsolatedPythonCase(item: Record<string, any>, source: string, options?: { timeoutMs?: number }): Record<string, any>;
