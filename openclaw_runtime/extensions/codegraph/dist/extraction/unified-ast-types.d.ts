/**
 * Unified AST Types for AgentGraph
 *
 * Language-agnostic AST node types for statement/expression-level
 * code analysis. Complements the existing graph-level Node type.
 */
import type { Language } from '../types';
export type UnifiedAstNodeKind = 'function_declaration' | 'class_declaration' | 'interface_declaration' | 'enum_declaration' | 'variable_declaration' | 'import_declaration' | 'export_declaration' | 'block_statement' | 'if_statement' | 'for_statement' | 'while_statement' | 'do_while_statement' | 'switch_statement' | 'try_statement' | 'return_statement' | 'throw_statement' | 'expression_statement' | 'call_expression' | 'binary_expression' | 'unary_expression' | 'assignment_expression' | 'member_expression' | 'new_expression' | 'await_expression' | 'string_literal' | 'number_literal' | 'boolean_literal' | 'null_literal' | 'array_literal' | 'object_literal';
export interface UnifiedAstNode {
    id: string;
    kind: UnifiedAstNodeKind;
    name?: string;
    filePath: string;
    language: Language;
    startLine: number;
    endLine: number;
    startColumn: number;
    endColumn: number;
    children: UnifiedAstNode[];
    parent?: string;
    metadata?: Record<string, unknown>;
}
export interface StatementInfo {
    kind: string;
    name?: string;
    signature?: string;
    startLine: number;
    endLine: number;
    startColumn: number;
    endColumn: number;
    parentNode?: string;
}
export interface ExpressionInfo {
    kind: string;
    value?: string;
    target?: string;
    startLine: number;
    startColumn: number;
    endColumn: number;
}
export interface StatementExtractionResult {
    statements: StatementInfo[];
    expressions: ExpressionInfo[];
    durationMs: number;
}
//# sourceMappingURL=unified-ast-types.d.ts.map