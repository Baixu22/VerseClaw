/**
 * ast-grep Integration Module
 *
 * Provides AST-level search, replace, and refactoring capabilities.
 * Designed to be backed by ast-grep (https://ast-grep.github.io/)
 * via subprocess or WASM binding.
 *
 * Current implementation: subprocess-based with native ast-grep CLI.
 * All operations are AST-aware — never string-level patching.
 */
import { Language } from '../types';
export interface AstMatchLocation {
    file: string;
    startLine: number;
    endLine: number;
    startColumn: number;
    endColumn: number;
    text: string;
    matches: string[];
}
export interface AstSearchResult {
    pattern: string;
    language: string;
    matches: AstMatchLocation[];
    totalFound: number;
    durationMs: number;
    error?: string;
}
export interface AstReplaceResult {
    file: string;
    applied: boolean;
    changes: number;
    diff?: string;
    error?: string;
}
export interface AstRefactorRule {
    id: string;
    pattern: string;
    replacement: string;
    files?: string[];
    excludeFiles?: string[];
    language: Language;
}
export interface AstRefactorResult {
    rule: AstRefactorRule;
    dryRun: boolean;
    filesAffected: number;
    changes: AstReplaceResult[];
    summary: string;
    durationMs: number;
}
export interface AstGrepOptions {
    /** Path to ast-grep binary (default: 'sg' or 'ast-grep') */
    binary?: string;
    /** Timeout per operation in ms */
    timeoutMs?: number;
    /** Working directory for relative paths */
    cwd?: string;
}
export declare class AstGrepClient {
    private binary;
    private timeoutMs;
    private cwd;
    private available;
    constructor(options?: AstGrepOptions);
    isAvailable(): boolean;
    search(pattern: string, language: Language, filePatterns?: string[]): AstSearchResult;
    replace(pattern: string, replacement: string, filePath: string, language: Language): AstReplaceResult;
    refactor(rule: AstRefactorRule, dryRun?: boolean): AstRefactorResult;
    private mapLanguage;
    private collectFiles;
}
export declare const defaultAstGrepClient: AstGrepClient;
//# sourceMappingURL=client.d.ts.map