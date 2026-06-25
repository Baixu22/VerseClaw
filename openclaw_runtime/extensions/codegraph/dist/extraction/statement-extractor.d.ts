/**
 * Statement-Level Extractor
 *
 * Extends the existing tree-sitter extraction with finer granularity.
 * Extracts:
 * - Statement-level nodes (if, for, while, switch, try, return, etc.)
 * - Expression-level nodes (function calls, assignments, member accesses)
 * - Block structure (parent/child relationships)
 *
 * Supports: Python, TypeScript, JavaScript, Go, Rust, Java, C#, C, C++, PHP, Ruby
 */
import { StatementExtractionResult } from './unified-ast-types';
import type { Language } from '../types';
interface SimpleSyntaxNode {
    type: string;
    text?: string;
    startPosition?: {
        row: number;
        column: number;
    };
    endPosition?: {
        row: number;
        column: number;
    };
    children?: SimpleSyntaxNode[];
    namedChildren?: SimpleSyntaxNode[];
}
export declare class StatementExtractor {
    private configs;
    constructor();
    extractStatements(_source: string, language: Language, treeNode: SimpleSyntaxNode | null): StatementExtractionResult;
    getSupportedLanguages(): string[];
    isLanguageSupported(language: Language): boolean;
    private getConfigForLanguage;
    private walkNode;
}
export declare const statementExtractor: StatementExtractor;
export {};
//# sourceMappingURL=statement-extractor.d.ts.map