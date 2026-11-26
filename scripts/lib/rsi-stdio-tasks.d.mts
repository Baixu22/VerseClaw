export const STDIO_COLLECTOR_VERSION: 'RsiCodingCollector/v7';
export const CXX_INCLUDE_SHIM: string;
export function stdioOutputMatches(actual: string, expected: string, comparison?: 'json'): boolean;
export function stdioOutputMatches(actual: string, expected: string, comparison?: 'json'): boolean;
export type StdioCppToolchain = 'clang-libc++' | 'gcc-libstdc++';
export function stdioPublicProjection(item: { prompt: string; target?: string; runtime: 'python3' | 'cpp'; declaration: string;
  cppToolchain?: StdioCppToolchain; compilerVersion?: string }): Record<string, unknown>;
export function createStdioTasks(directory: string, pack: Record<string, any>): Record<string, any>;
export function verifyStdioTasks(registry: Record<string, any>, pack: Record<string, any>): true;
export function runStdioCase(item: { id: string; runtime: 'python3' | 'cpp'; vectors: Array<Record<string, any>> }, source: string,
  options?: { timeoutMs?: number; python?: string; cxx?: string }): Record<string, any>;
export function stdioCppToolchain(source: string): StdioCppToolchain;
export function runStdioCaseWsl(item: { id: string; runtime: 'cpp'; vectors: Array<Record<string, any>>;
  cppToolchain?: StdioCppToolchain; compilerVersion?: string; nativeChecker?: Record<string, any> }, source: string,
  options?: { timeoutMs?: number }): Record<string, any>;
