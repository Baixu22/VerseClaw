import { type CvkChecksum, type ResourceId, type Selector } from './context-runtime-kit';
type Brand<T, Name extends string> = T & {
    readonly __brand: Name;
};
export type ContextItemId = Brand<string, 'ContextItemId'>;
export type LifecycleEventId = Brand<string, 'LifecycleEventId'>;
export type ContextItemKind = 'instruction' | 'observation' | 'reasoning' | 'user_intent' | 'ledger' | 'derived';
export type LifecycleState = 'ingested' | 'active' | 'masked' | 'archived' | 'compacted' | 'evicted';
export type ProjectionMode = 'verbatim' | 'masked' | 'summary' | 'index_only' | 'omitted';
export type SourceRefType = 'transcript' | 'tool_call' | 'bootstrap_file' | 'system_prompt' | 'compaction' | 'compression_artifact' | 'resume_checkpoint' | 'cvk' | 'task_ledger' | 'clawgraph' | 'observability' | 'memory' | 'knowledge' | 'context_pack' | 'archive' | 'other';
export type SourceRangeRef = {
    start?: number;
    end?: number;
    startLine?: number;
    endLine?: number;
};
export type SourceRef = {
    type: SourceRefType;
    sessionId?: string;
    turnId?: string;
    entryId?: string;
    toolCallId?: string;
    path?: string;
    resourceId?: ResourceId;
    selector?: Selector;
    checksum?: CvkChecksum;
    range?: SourceRangeRef;
    ownerId?: string;
    label?: string;
};
export type ArchiveHandle = {
    uri: string;
    checksum: CvkChecksum;
    byteLength: number;
    source?: SourceRef;
    createdAt?: string;
};
export type CvkReference = {
    resourceId: ResourceId;
    selector: Selector;
    checksum?: CvkChecksum;
};
export type ProjectionSpec = {
    mode: ProjectionMode;
    tokenEstimate?: number;
    archiveHandle?: ArchiveHandle;
    cvk?: CvkReference;
    metadata?: Record<string, unknown>;
};
export type ProvenanceEvidenceRef = ({
    type: 'cvk';
} & CvkReference) | {
    type: Exclude<SourceRefType, 'cvk'>;
    source: SourceRef;
    checksum?: CvkChecksum;
};
export type Provenance = {
    createdAt?: string;
    producer?: string;
    derivedFrom?: ContextItemId[];
    evidence?: ProvenanceEvidenceRef[];
    reason?: string;
};
export type LifecycleEvent = {
    id: LifecycleEventId;
    itemId: ContextItemId;
    from?: LifecycleState;
    to: LifecycleState;
    reason: string;
    occurredAt?: string;
    actor?: string;
    source?: SourceRef;
    metadata?: Record<string, unknown>;
};
export type ContextItem = {
    id: ContextItemId;
    schemaVersion: 1;
    kind: ContextItemKind;
    lifecycleState: LifecycleState;
    source: SourceRef;
    projection: ProjectionSpec;
    provenance: Provenance;
    archiveHandle?: ArchiveHandle;
    contentHash?: CvkChecksum;
    metadata?: Record<string, unknown>;
};
export type ContextStatusSnapshot = {
    schemaVersion: 1;
    generatedAt?: string;
    totalItems: number;
    countsByKind: Partial<Record<ContextItemKind, number>>;
    countsByLifecycleState: Partial<Record<LifecycleState, number>>;
    archiveAvailable: boolean;
    recoveryAvailable: boolean;
    warnings: string[];
};
export type ContextFamilyValidationIssue = {
    code: string;
    message: string;
    path?: string;
};
export declare class ContextFamilyValidationError extends Error {
    readonly issues: ContextFamilyValidationIssue[];
    constructor(message: string, issues?: ContextFamilyValidationIssue[]);
}
export declare function normalizeContextItemId(value: unknown): ContextItemId;
export declare function normalizeLifecycleEventId(value: unknown): LifecycleEventId;
export declare function normalizeContextItemKind(value: unknown): ContextItemKind;
export declare function normalizeLifecycleState(value: unknown): LifecycleState;
export declare function normalizeProjectionMode(value: unknown): ProjectionMode;
export declare function canTransitionLifecycle(from: LifecycleState, to: LifecycleState): boolean;
export declare function normalizeSourceRef(value: unknown): SourceRef;
export declare function normalizeArchiveHandle(value: unknown): ArchiveHandle;
export declare function normalizeCvkReference(value: unknown): CvkReference;
export declare function normalizeProjectionSpec(value: unknown): ProjectionSpec;
export declare function normalizeProvenance(value: unknown): Provenance;
export declare function normalizeLifecycleEvent(value: unknown): LifecycleEvent;
export declare function normalizeContextItem(value: unknown): ContextItem;
export declare function normalizeStatusSnapshot(value: unknown): ContextStatusSnapshot;
export declare function stableStringifyContextFamily(value: unknown): string;
export {};
