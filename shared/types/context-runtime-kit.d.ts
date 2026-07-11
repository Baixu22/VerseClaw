type Brand<T, Name extends string> = T & {
    readonly __brand: Name;
};
export type ResourceId = Brand<string, 'ResourceId'>;
export type Selector = Brand<string, 'Selector'>;
export type CvkChecksum = Brand<string, 'CvkChecksum'>;
export type CvkResourceKind = 'toolset' | 'skill' | 'project_rule' | 'document' | 'codebase' | 'trace' | 'memory' | 'other';
export type RetrievalReason = 'prefetch' | 'tool_call_gate' | 'hard_claim' | 'recovery' | 'user_requested' | 'model_requested';
export type VerificationGate = 'selector_resolution' | 'checksum' | 'hard_claim' | 'tool_call' | 'recovery' | 'compression_quality' | 'protocol';
export type VerificationSeverity = 'info' | 'warning' | 'error' | 'blocking';
export type ContextRuntimeKitValidationIssue = {
    code: string;
    message: string;
    path?: string;
};
export declare class ContextRuntimeKitValidationError extends Error {
    readonly issues: ContextRuntimeKitValidationIssue[];
    constructor(message: string, issues?: ContextRuntimeKitValidationIssue[]);
}
export type SourceRange = {
    startLine: number;
    endLine: number;
    startColumn?: number;
    endColumn?: number;
};
export type Chunk = {
    resourceId: ResourceId;
    selector: Selector;
    checksum: CvkChecksum;
    text: string;
    chunkId?: string;
    tokenCount?: number;
    sourceRange?: SourceRange;
    metadata?: Record<string, unknown>;
};
export type CompactView = {
    resourceId: ResourceId;
    selector?: Selector;
    checksum?: CvkChecksum;
    title: string;
    kind: CvkResourceKind;
    summary: string;
    navigationOnly: true;
    hardSelectors: Selector[];
    mustExpandBefore: Selector[];
    sourceSelectors: Selector[];
    tokenEstimate: number;
    metadata?: Record<string, unknown>;
};
export type CvkEvidenceRef = {
    resourceId: ResourceId;
    selector: Selector;
    checksum?: CvkChecksum;
    label?: string;
    kind?: CvkResourceKind;
    hardClaim?: boolean;
};
export type RetrievalTraceEntry = {
    resourceId: ResourceId;
    selector: Selector;
    checksum?: CvkChecksum;
    chunkId?: string;
    tokenCount?: number;
    reason: RetrievalReason;
};
export type PromptBundleResourceMapEntry = {
    resourceId: ResourceId;
    kind: CvkResourceKind;
    title: string;
    summary?: string;
    selectors: Selector[];
};
export type PromptBundle = {
    schemaVersion: 1;
    instructionKernel?: string;
    resourceMap: PromptBundleResourceMapEntry[];
    compactViews: CompactView[];
    compactRecoveryProjection?: string;
    selectedChunks: Chunk[];
    currentTask: string;
    tokenBudget?: {
        input: number;
        outputReserve: number;
    };
    retrievalPlan: CvkEvidenceRef[];
    retrievalTrace: RetrievalTraceEntry[];
    createdAt?: string;
};
export type VerificationDiagnostic = {
    code: string;
    message: string;
    resourceId?: ResourceId;
    selector?: Selector;
    checksum?: CvkChecksum;
    evidenceRef?: CvkEvidenceRef;
};
export type VerificationResult = {
    ok: boolean;
    gate: VerificationGate;
    severity: VerificationSeverity;
    diagnostics: VerificationDiagnostic[];
    checkedAt?: string;
};
export declare function normalizeResourceId(value: unknown): ResourceId;
export declare function normalizeSelector(value: unknown): Selector;
export declare function normalizeChecksum(value: unknown): CvkChecksum;
export declare function normalizeSourceRange(value: unknown): SourceRange | undefined;
export declare function normalizeChunk(value: unknown): Chunk;
export declare function normalizeCompactView(value: unknown): CompactView;
export declare function normalizeCvkEvidenceRef(value: unknown): CvkEvidenceRef;
export declare function normalizeRetrievalTraceEntry(value: unknown): RetrievalTraceEntry;
export declare function normalizePromptBundle(value: unknown): PromptBundle;
export declare function normalizeVerificationResult(value: unknown): VerificationResult;
export declare function stableStringifyContextRuntimeKit(value: unknown): string;
export {};
