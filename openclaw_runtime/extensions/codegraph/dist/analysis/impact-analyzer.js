"use strict";
/**
 * Enhanced Impact Analyzer
 *
 * Analyzes the blast radius of a symbol change.
 * Returns upstream (who depends on this), downstream (what this depends on),
 * affected files, APIs, and tests.
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.ImpactAnalyzer = void 0;
class ImpactAnalyzer {
    queries;
    constructor(queries) {
        this.queries = queries;
    }
    analyze(symbolName, options = {}) {
        const startTime = Date.now();
        const opts = {
            maxDepth: options.maxDepth ?? 3,
            maxNodes: options.maxNodes ?? 500,
            includeTests: options.includeTests ?? true,
        };
        // Find the symbol
        const searchResults = this.queries.searchNodes(symbolName, {
            limit: 5,
            kinds: ['function', 'method', 'class', 'struct', 'interface', 'trait'],
        });
        if (searchResults.length === 0)
            return null;
        const target = searchResults[0].node;
        // Upstream: things that depend on this
        const upstream = this.traceUpstream(target.id, opts);
        // Downstream: things this depends on
        const downstream = this.traceDownstream(target.id, opts);
        // Collect affected files
        const affectedFiles = new Set();
        affectedFiles.add(target.filePath);
        for (const u of upstream)
            affectedFiles.add(u.filePath);
        for (const d of downstream)
            affectedFiles.add(d.filePath);
        // Affected APIs (route or entry_point nodes in blast radius)
        const affectedAPIs = this.findAffectedAPIs(affectedFiles);
        // Affected test files
        const affectedTests = opts.includeTests
            ? this.findAffectedTests(Array.from(affectedFiles))
            : [];
        const totalAffected = new Set([
            ...upstream.map((u) => u.id),
            ...downstream.map((d) => d.id),
        ]).size;
        const riskLevel = this.assessRisk(upstream.length, downstream.length, affectedAPIs.length);
        return {
            symbol: target.qualifiedName,
            symbolId: target.id,
            upstream,
            downstream,
            affectedFiles: Array.from(affectedFiles).slice(0, 200),
            affectedAPIs: affectedAPIs.slice(0, 50),
            affectedTests: affectedTests.slice(0, 50),
            riskLevel,
            totalAffectedNodes: totalAffected,
            analysisDepth: opts.maxDepth,
            durationMs: Date.now() - startTime,
        };
    }
    traceUpstream(symbolId, opts) {
        const results = [];
        const visited = new Set();
        const queue = [{ id: symbolId, depth: 0 }];
        while (queue.length > 0 && results.length < opts.maxNodes) {
            const current = queue.shift();
            if (current.depth > opts.maxDepth)
                continue;
            if (visited.has(current.id))
                continue;
            visited.add(current.id);
            if (current.id !== symbolId) {
                const node = this.queries.getNodeById(current.id);
                if (node) {
                    const edge = this.findConnectingEdge(current.id, symbolId, 'incoming');
                    results.push({
                        id: node.id,
                        name: node.name,
                        qualifiedName: node.qualifiedName,
                        filePath: node.filePath,
                        lineNumber: node.startLine,
                        distance: current.depth,
                        kind: node.kind,
                        edgeKind: edge?.kind ?? 'references',
                    });
                }
            }
            const callers = this.queries.getDirectCallers(current.id);
            for (const caller of callers) {
                if (!visited.has(caller.id)) {
                    queue.push({ id: caller.id, depth: current.depth + 1 });
                }
            }
        }
        return results;
    }
    traceDownstream(symbolId, opts) {
        const results = [];
        const visited = new Set();
        const queue = [{ id: symbolId, depth: 0 }];
        while (queue.length > 0 && results.length < opts.maxNodes) {
            const current = queue.shift();
            if (current.depth > opts.maxDepth)
                continue;
            if (visited.has(current.id))
                continue;
            visited.add(current.id);
            if (current.id !== symbolId) {
                const node = this.queries.getNodeById(current.id);
                if (node) {
                    const edge = this.findConnectingEdge(current.id, symbolId, 'outgoing');
                    results.push({
                        id: node.id,
                        name: node.name,
                        qualifiedName: node.qualifiedName,
                        filePath: node.filePath,
                        lineNumber: node.startLine,
                        distance: current.depth,
                        kind: node.kind,
                        edgeKind: edge?.kind ?? 'calls',
                    });
                }
            }
            const callees = this.queries.getDirectCallees(current.id);
            for (const callee of callees) {
                if (!visited.has(callee.id)) {
                    queue.push({ id: callee.id, depth: current.depth + 1 });
                }
            }
        }
        return results;
    }
    findConnectingEdge(nodeId, targetId, direction) {
        const edges = direction === 'incoming'
            ? this.queries.getIncomingEdges(nodeId)
            : this.queries.getOutgoingEdges(nodeId);
        return edges.find((e) => (direction === 'incoming' && e.source === targetId) ||
            (direction === 'outgoing' && e.target === targetId));
    }
    findAffectedAPIs(affectedFiles) {
        const apis = [];
        for (const file of affectedFiles) {
            const nodes = this.queries.getNodesByFile(file);
            for (const node of nodes) {
                if (node.kind === 'route' || node.kind === 'entry_point') {
                    apis.push(node.qualifiedName);
                }
            }
        }
        return apis;
    }
    findAffectedTests(affectedFiles) {
        const testFiles = new Set();
        const allFiles = this.queries.getAllFiles();
        for (const file of allFiles) {
            if (this.isTestFile(file.path)) {
                const deps = this.queries.getDependencyFilePaths(file.path);
                if (deps.some((dep) => affectedFiles.includes(dep))) {
                    testFiles.add(file.path);
                }
            }
        }
        return Array.from(testFiles);
    }
    isTestFile(filePath) {
        const lp = filePath.toLowerCase();
        return (/(?:^|\/)(tests?|__tests?__|spec)\//.test(lp) ||
            /\.(test|spec)\.[jt]sx?$/.test(lp) ||
            /_test\.go$/.test(lp) ||
            /_test\.py$/.test(lp) ||
            /_spec\.rb$/.test(lp) ||
            /_test\.dart$/.test(lp) ||
            /(test|spec|tests)\.(java|kt|scala)$/.test(lp) ||
            /(tests?|spec)\.cs$/.test(lp) ||
            /tests?\.swift$/.test(lp));
    }
    assessRisk(upstreamCount, downstreamCount, apiCount) {
        const score = upstreamCount * 1.5 + downstreamCount * 1.0 + apiCount * 3.0;
        if (score >= 50)
            return 'critical';
        if (score >= 20)
            return 'high';
        if (score >= 8)
            return 'medium';
        return 'low';
    }
}
exports.ImpactAnalyzer = ImpactAnalyzer;
//# sourceMappingURL=impact-analyzer.js.map