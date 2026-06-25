"use strict";
/**
 * find_symbol API
 *
 * Locates a symbol and returns its location, references, callers, callees, and importance.
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.findSymbol = findSymbol;
function findSymbol(queries, traverser, symbolScorer, input) {
    const maxCallers = input.maxCallers ?? 20;
    const maxCallees = input.maxCallees ?? 20;
    const searchResults = queries.searchNodes(input.symbol, { limit: 3 });
    if (searchResults.length === 0)
        return null;
    const target = searchResults[0].node;
    const importance = symbolScorer.computeSymbolImportance(target.id);
    // Location
    const location = {
        filePath: target.filePath,
        startLine: target.startLine,
        endLine: target.endLine,
        startColumn: target.startColumn,
        endColumn: target.endColumn,
    };
    // References
    const incomingEdges = queries.getIncomingEdges(target.id);
    const references = incomingEdges
        .filter((e) => e.kind !== 'contains')
        .slice(0, 30)
        .map((e) => {
        const node = queries.getNodeById(e.source);
        return {
            symbol: node?.name ?? 'unknown',
            qualifiedName: node?.qualifiedName ?? 'unknown',
            file: node?.filePath ?? 'unknown',
            line: e.line ?? node?.startLine ?? 0,
            kind: (node?.kind ?? 'function'),
        };
    });
    // Callers
    const callersResult = traverser.getCallers(target.id, 1);
    const callers = callersResult.slice(0, maxCallers).map((c) => ({
        symbol: c.node.name,
        qualifiedName: c.node.qualifiedName,
        file: c.node.filePath,
        line: c.node.startLine,
        kind: c.node.kind,
    }));
    // Callees
    const calleesResult = traverser.getCallees(target.id, 1);
    const callees = calleesResult.slice(0, maxCallees).map((c) => ({
        symbol: c.node.name,
        qualifiedName: c.node.qualifiedName,
        file: c.node.filePath,
        line: c.node.startLine,
        kind: c.node.kind,
    }));
    return {
        symbol: target.qualifiedName,
        location,
        kind: target.kind,
        references,
        callers,
        callees,
        importance: importance.importance,
        documentation: target.docstring,
        signature: target.signature,
    };
}
//# sourceMappingURL=find-symbol.js.map