/**
 * find_business_flow API
 *
 * Locates business flows matching a query and returns
 * the entry point, service chain, and categorized participants.
 */
import { FindBusinessFlowInput, FindBusinessFlowOutput } from '../types';
import { QueryBuilder } from '../db/queries';
import { EntryPointDetector } from '../analysis/entrypoint-detector';
import { FlowDetector } from '../semantic/flow-detector';
export declare function findBusinessFlow(_queries: QueryBuilder, entryPointDetector: EntryPointDetector, flowDetector: FlowDetector, input: FindBusinessFlowInput): FindBusinessFlowOutput;
//# sourceMappingURL=find-business-flow.d.ts.map