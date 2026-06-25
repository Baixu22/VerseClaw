/**
 * Enhanced Impact Analyzer
 *
 * Analyzes the blast radius of a symbol change.
 * Returns upstream (who depends on this), downstream (what this depends on),
 * affected files, APIs, and tests.
 */
import { ImpactAnalysis } from '../types';
import { QueryBuilder } from '../db/queries';
export interface ImpactAnalyzerOptions {
    maxDepth?: number;
    maxNodes?: number;
    includeTests?: boolean;
}
export declare class ImpactAnalyzer {
    private queries;
    constructor(queries: QueryBuilder);
    analyze(symbolName: string, options?: ImpactAnalyzerOptions): ImpactAnalysis | null;
    private traceUpstream;
    private traceDownstream;
    private findConnectingEdge;
    private findAffectedAPIs;
    private findAffectedTests;
    private isTestFile;
    private assessRisk;
}
//# sourceMappingURL=impact-analyzer.d.ts.map