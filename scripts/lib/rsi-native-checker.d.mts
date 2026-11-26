export const NATIVE_CHECKER_VERSION: 'RsiStdioNativeChecker/v1';
export const NATIVE_CHECKER_JAIL: string;
export const NATIVE_CHECKER_PROFILE: Readonly<Record<string, any>>;
export function validateNativeChecker(checker: Record<string, any>, reference?: string | null): Record<string, any>;
export function materializeNativeChecker(item: Record<string, any>, writeFile: (path: string, content: string) => void): Record<string, any>;
export function runNativeCheckerCase(item: Record<string, any>, source: string, options?: { timeoutMs?: number }): Record<string, any>;
export function verifyNativeCheckerEvidence(report: Record<string, any>, item: Record<string, any>, workspace: string): true;
