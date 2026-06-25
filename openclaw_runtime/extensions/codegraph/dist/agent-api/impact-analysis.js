"use strict";
/**
 * impact_analysis API
 *
 * Analyzes the blast radius of changing a symbol.
 * Returns upstream, downstream, affected files, APIs, and tests.
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.analyzeImpact = analyzeImpact;
function analyzeImpact(impactAnalyzer, input) {
    const analysis = impactAnalyzer.analyze(input.symbol, {
        maxDepth: input.depth ?? 3,
    });
    if (!analysis)
        return null;
    return {
        symbol: analysis.symbol,
        upstream: analysis.upstream,
        downstream: analysis.downstream,
        affectedFiles: analysis.affectedFiles,
        affectedAPIs: analysis.affectedAPIs,
        affectedTests: analysis.affectedTests,
        riskLevel: analysis.riskLevel,
        totalAffected: analysis.totalAffectedNodes,
    };
}
//# sourceMappingURL=impact-analysis.js.map