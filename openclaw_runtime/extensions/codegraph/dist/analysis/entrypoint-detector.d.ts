/**
 * Entry Point Detector
 *
 * Automatically identifies application entry points:
 * - HTTP API entries (route nodes + annotated controllers)
 * - CLI entries (main functions, CLI command registrations)
 * - Scheduled tasks (cron/scheduled annotations)
 * - Message queue consumers
 * - WebSocket handlers
 * - RPC service methods
 */
import { EntryPoint, EntryPointType, EntryPointDetectionResult } from '../types';
import { QueryBuilder } from '../db/queries';
export declare class EntryPointDetector {
    private queries;
    constructor(queries: QueryBuilder);
    detectAll(): EntryPointDetectionResult;
    getEntryPointsByType(type: EntryPointType): EntryPoint[];
    getEntryPointsForSymbol(symbolName: string): EntryPoint[];
    getEntryPointIds(): Set<string>;
    private detectRouteEntries;
    private detectAnnotationEntries;
    private detectConventionEntries;
    private detectCLIEntries;
    private buildServiceChain;
    private hasCLISignal;
    private deduplicate;
}
//# sourceMappingURL=entrypoint-detector.d.ts.map