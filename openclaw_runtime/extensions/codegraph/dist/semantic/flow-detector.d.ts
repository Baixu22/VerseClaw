/**
 * Business Flow Detector
 *
 * Detects sequential business flows from the call graph.
 * Starting from entry points, traces call chains and identifies
 * recognized business patterns (CRUD, notification, validation, etc.).
 */
import { BusinessFlow, EntryPoint } from '../types';
import { QueryBuilder } from '../db/queries';
import { EntryPointDetector } from '../analysis/entrypoint-detector';
export interface FlowDetectorOptions {
    maxDepth?: number;
    maxFlows?: number;
    minConfidence?: number;
}
export declare class FlowDetector {
    private queries;
    private entryPointDetector;
    constructor(queries: QueryBuilder, entryPointDetector: EntryPointDetector);
    detectAllFlows(options?: FlowDetectorOptions): BusinessFlow[];
    detectFlowFromEntry(ep: EntryPoint, maxDepth: number): BusinessFlow | null;
    detectFlowByName(flowName: string, options?: FlowDetectorOptions): BusinessFlow[];
    private traceCallChain;
    private determineActionRole;
    private scoreBusinessRelevance;
    private nameFlow;
    private describeFlow;
    private estimateConfidence;
}
//# sourceMappingURL=flow-detector.d.ts.map