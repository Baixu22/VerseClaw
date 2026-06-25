/**
 * impact_analysis API
 *
 * Analyzes the blast radius of changing a symbol.
 * Returns upstream, downstream, affected files, APIs, and tests.
 */
import { ImpactAnalysisInput, ImpactAnalysisOutput } from '../types';
import { ImpactAnalyzer } from '../analysis/impact-analyzer';
export declare function analyzeImpact(impactAnalyzer: ImpactAnalyzer, input: ImpactAnalysisInput): ImpactAnalysisOutput | null;
//# sourceMappingURL=impact-analysis.d.ts.map