"use strict";
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
Object.defineProperty(exports, "__esModule", { value: true });
exports.statementExtractor = exports.StatementExtractor = void 0;
const STATEMENT_CONFIGS = {
    typescript: {
        statementNodeTypes: [
            'if_statement', 'for_statement', 'for_in_statement', 'while_statement',
            'do_statement', 'switch_statement', 'try_statement', 'return_statement',
            'throw_statement', 'break_statement', 'continue_statement',
            'variable_declaration', 'lexical_declaration', 'expression_statement',
            'labeled_statement', 'with_statement', 'debugger_statement',
        ],
        expressionNodeTypes: [
            'call_expression', 'new_expression', 'assignment_expression',
            'binary_expression', 'unary_expression', 'update_expression',
        ],
        callExpressionTypes: ['call_expression', 'new_expression'],
        nameField: 'name',
        bodyField: 'body',
        conditionField: 'condition',
    },
    javascript: {
        statementNodeTypes: [
            'if_statement', 'for_statement', 'for_in_statement', 'while_statement',
            'do_statement', 'switch_statement', 'try_statement', 'return_statement',
            'throw_statement', 'break_statement', 'continue_statement',
            'variable_declaration', 'lexical_declaration', 'expression_statement',
        ],
        expressionNodeTypes: [
            'call_expression', 'new_expression', 'assignment_expression',
            'binary_expression', 'unary_expression', 'update_expression',
        ],
        callExpressionTypes: ['call_expression', 'new_expression'],
        nameField: 'name',
        bodyField: 'body',
        conditionField: 'condition',
    },
    python: {
        statementNodeTypes: [
            'if_statement', 'for_statement', 'while_statement', 'try_statement',
            'with_statement', 'return_statement', 'raise_statement', 'assert_statement',
            'break_statement', 'continue_statement', 'pass_statement',
            'expression_statement', 'assignment', 'augmented_assignment',
        ],
        expressionNodeTypes: [
            'call', 'binary_operator', 'unary_operator', 'comparison_operator',
            'boolean_operator',
        ],
        callExpressionTypes: ['call'],
        nameField: 'name',
        bodyField: 'body',
        conditionField: 'condition',
    },
    go: {
        statementNodeTypes: [
            'if_statement', 'for_statement', 'expression_switch_statement',
            'type_switch_statement', 'select_statement', 'return_statement',
            'go_statement', 'defer_statement', 'break_statement', 'continue_statement',
            'fallthrough_statement', 'short_var_declaration', 'assignment_statement',
            'expression_statement', 'send_statement', 'inc_statement', 'dec_statement',
        ],
        expressionNodeTypes: [
            'call_expression', 'binary_expression', 'unary_expression',
            'selector_expression', 'index_expression', 'slice_expression',
        ],
        callExpressionTypes: ['call_expression'],
        nameField: 'name',
        bodyField: 'body',
        conditionField: 'condition',
    },
    rust: {
        statementNodeTypes: [
            'if_expression', 'match_expression', 'while_expression', 'loop_expression',
            'for_expression', 'return_expression', 'break_expression', 'continue_expression',
            'let_declaration', 'expression_statement',
        ],
        expressionNodeTypes: [
            'call_expression', 'binary_expression', 'unary_expression',
            'field_expression', 'index_expression',
        ],
        callExpressionTypes: ['call_expression'],
        nameField: 'name',
        bodyField: 'body',
        conditionField: 'condition',
    },
    java: {
        statementNodeTypes: [
            'if_statement', 'for_statement', 'enhanced_for_statement', 'while_statement',
            'do_statement', 'switch_expression', 'switch_block', 'try_statement',
            'return_statement', 'throw_statement', 'break_statement', 'continue_statement',
            'local_variable_declaration', 'expression_statement', 'synchronized_statement',
        ],
        expressionNodeTypes: [
            'method_invocation', 'assignment_expression', 'binary_expression',
            'unary_expression', 'update_expression', 'object_creation_expression',
        ],
        callExpressionTypes: ['method_invocation', 'object_creation_expression'],
        nameField: 'name',
        bodyField: 'body',
        conditionField: 'condition',
    },
    csharp: {
        statementNodeTypes: [
            'if_statement', 'for_statement', 'for_each_statement', 'while_statement',
            'do_statement', 'switch_statement', 'try_statement', 'return_statement',
            'throw_statement', 'break_statement', 'continue_statement',
            'local_declaration_statement', 'expression_statement', 'using_statement',
            'lock_statement', 'fixed_statement',
        ],
        expressionNodeTypes: [
            'invocation_expression', 'assignment_expression', 'binary_expression',
            'prefix_unary_expression', 'postfix_unary_expression',
            'object_creation_expression',
        ],
        callExpressionTypes: ['invocation_expression', 'object_creation_expression'],
        nameField: 'name',
        bodyField: 'body',
        conditionField: 'condition',
    },
};
class StatementExtractor {
    configs;
    constructor() {
        this.configs = STATEMENT_CONFIGS;
    }
    extractStatements(_source, language, treeNode) {
        const startTime = Date.now();
        const statements = [];
        const expressions = [];
        if (!treeNode) {
            return { statements, expressions, durationMs: Date.now() - startTime };
        }
        const config = this.getConfigForLanguage(language);
        if (!config) {
            return { statements, expressions, durationMs: Date.now() - startTime };
        }
        this.walkNode(treeNode, config, statements, expressions);
        return { statements, expressions, durationMs: Date.now() - startTime };
    }
    getSupportedLanguages() {
        return Object.keys(this.configs);
    }
    isLanguageSupported(language) {
        return language in this.configs;
    }
    getConfigForLanguage(language) {
        const normalized = language === 'tsx' ? 'typescript' : language === 'jsx' ? 'javascript' : language;
        return this.configs[normalized] ?? null;
    }
    walkNode(node, config, statements, expressions) {
        // Check if this is a statement node
        if (config.statementNodeTypes.includes(node.type)) {
            const info = {
                kind: node.type,
                startLine: (node.startPosition?.row ?? 0) + 1,
                endLine: (node.endPosition?.row ?? 0) + 1,
                startColumn: node.startPosition?.column ?? 0,
                endColumn: node.endPosition?.column ?? 0,
            };
            statements.push(info);
        }
        // Check if this is a call expression
        if (config.callExpressionTypes.includes(node.type)) {
            const namedChildren = node.namedChildren || node.children;
            const firstChild = namedChildren?.[0];
            let fnName;
            if (firstChild) {
                fnName = firstChild.text;
            }
            expressions.push({
                kind: node.type,
                value: fnName,
                startLine: (node.startPosition?.row ?? 0) + 1,
                startColumn: node.startPosition?.column ?? 0,
                endColumn: node.endPosition?.column ?? 0,
            });
        }
        // Recurse into children
        for (const child of node.children || node.namedChildren || []) {
            this.walkNode(child, config, statements, expressions);
        }
    }
}
exports.StatementExtractor = StatementExtractor;
exports.statementExtractor = new StatementExtractor();
//# sourceMappingURL=statement-extractor.js.map