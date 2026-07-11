import { type TaskLedgerReference } from './types/task-ledger-reference';
import type { WorkspacePermissionMode } from './types/workspace';
export type { TaskLedgerReference } from './types/task-ledger-reference';
export { PRODUCT_SEMANTIC_UNSAFE_CLAIMS, type ProductSemanticUnsafeClaim, } from './product-semantic-unsafe-claims';
export type ProductSemanticConceptId = 'chat' | 'plan-mode' | 'chat-plan' | 'task-ledger' | 'workboard' | 'task-loop' | 'routing-memo';
export type ProductSemanticConcept = {
    id: ProductSemanticConceptId;
    positioning: string;
    sourceOfTruth: string;
    allowedReferences: string[];
    forbiddenClaims: string[];
};
export declare const PRODUCT_SEMANTIC_CONCEPTS: readonly [{
    readonly id: 'chat';
    readonly positioning: 'Immediate user/agent collaboration surface';
    readonly sourceOfTruth: 'conversation transcript';
    readonly allowedReferences: ["Task Loop upgrade suggestion", "bounded Chat Plan projection/edit draft"];
    readonly forbiddenClaims: ["ordinary Chat is an automatic project manager", "ordinary Chat automatically enters Task Loop"];
}, {
    readonly id: 'plan-mode';
    readonly positioning: 'Permission-gated planning posture';
    readonly sourceOfTruth: 'workspace permission decision';
    readonly allowedReferences: ["system metadata exception boundary", "permission decision audit event"];
    readonly forbiddenClaims: ["strict no-diff guarantee for every file or metadata write", "full workflow state machine"];
}, {
    readonly id: 'chat-plan';
    readonly positioning: 'Projection of orchestration intent plus lightweight edit draft';
    readonly sourceOfTruth: 'orchestrator plan output plus Task Ledger projectionEdit metadata';
    readonly allowedReferences: ["Task Ledger read-only node projection", "lightweight reorder/disable/note edit draft"];
    readonly forbiddenClaims: ["editable Chat DAG", "drag-and-drop dependency editor", "transactional task edit rollback"];
}, {
    readonly id: 'task-ledger';
    readonly positioning: 'App/user-visible task fact ledger';
    readonly sourceOfTruth: 'user-visible task facts';
    readonly allowedReferences: ["Chat Plan projection", "Task Loop root/checkpoint evidence"];
    readonly forbiddenClaims: ["execution scheduler", "plugin dispatch queue", "Workboard mirror with automatic two-way sync"];
}, {
    readonly id: 'workboard';
    readonly positioning: 'Runtime/plugin scheduling and dispatch board';
    readonly sourceOfTruth: 'runtime/plugin scheduling';
    readonly allowedReferences: ["Task Ledger node id"];
    readonly forbiddenClaims: ["user-visible task fact source of truth", "two-way sync back into Task Ledger"];
}, {
    readonly id: 'task-loop';
    readonly positioning: 'Explicit high-constraint execution loop';
    readonly sourceOfTruth: 'Task Ledger root plus loop run/checkpoint state';
    readonly allowedReferences: ["Task Ledger root", "checkpoint", "repair", "blocked state"];
    readonly forbiddenClaims: ["ordinary Chat failure semantics", "implicit automatic start from every complex prompt"];
}, {
    readonly id: 'routing-memo';
    readonly positioning: 'Routing observation memo, shadow until scorecard-backed';
    readonly sourceOfTruth: 'observed routing outcome and quality state';
    readonly allowedReferences: ["shadow observation", "active scorecard-backed routing input"];
    readonly forbiddenClaims: ["default active learning", "automatic role elimination without scorecard input"];
}];
export type ProductSemanticTaskId = `P0-${string}` | `P1-${string}`;
export type ProductSemanticImplementationStatus = 'done' | 'todo' | 'defer';
export type ProductSemanticTaskLane = 'architecture-drift' | 'claim-governance' | 'runtime-evidence' | 'observability' | 'chat-history' | 'execution-graph' | 'permission-boundary' | 'backend-boundary' | 'provider-config' | 'chat-plan' | 'task-ledger-workboard' | 'orchestration-quality' | 'orchestration-diagnostics' | 'routing-memo' | 'chat-to-task-loop' | 'task-loop' | 'sensitive-boundary';
export type ProductSemanticTaskBoundary = {
    id: ProductSemanticTaskId;
    title: string;
    implementationStatus: ProductSemanticImplementationStatus;
    semanticStatus: 'positioned';
    lane: ProductSemanticTaskLane;
    sourceOfTruth: string;
    safeClaim: string;
    forbiddenClaim: string;
    nextAction: string;
    boundaryRefs: string[];
};
export declare const PRODUCT_SEMANTIC_TASK_BOUNDARIES: readonly [ProductSemanticTaskBoundary, ProductSemanticTaskBoundary, ProductSemanticTaskBoundary, ProductSemanticTaskBoundary, ProductSemanticTaskBoundary, ProductSemanticTaskBoundary, ProductSemanticTaskBoundary, ProductSemanticTaskBoundary, ProductSemanticTaskBoundary, ProductSemanticTaskBoundary, ProductSemanticTaskBoundary, ProductSemanticTaskBoundary, ProductSemanticTaskBoundary, ProductSemanticTaskBoundary, ProductSemanticTaskBoundary, ProductSemanticTaskBoundary, ProductSemanticTaskBoundary, ProductSemanticTaskBoundary, ProductSemanticTaskBoundary, ProductSemanticTaskBoundary, ProductSemanticTaskBoundary, ProductSemanticTaskBoundary, ProductSemanticTaskBoundary, ProductSemanticTaskBoundary, ProductSemanticTaskBoundary, ProductSemanticTaskBoundary, ProductSemanticTaskBoundary, ProductSemanticTaskBoundary, ProductSemanticTaskBoundary, ProductSemanticTaskBoundary, ProductSemanticTaskBoundary, ProductSemanticTaskBoundary];
export type OrchestrationQualityState = null | 'shadow' | 'active';
export declare function normalizeOrchestrationQualityState(value: unknown): OrchestrationQualityState;
export declare function orchestrationQualityAffectsRouting(state: OrchestrationQualityState): boolean;
export type PermissionDecisionBoundary = 'user-file' | 'system-metadata' | 'workspace-command' | 'gateway-rpc' | 'role-tool' | 'provider-call' | 'unknown';
export type PermissionDecisionEvent = {
    kind: 'permission-decision';
    workspaceMode: WorkspacePermissionMode | 'unknown';
    role: string | null;
    tool: string | null;
    boundary: PermissionDecisionBoundary;
    decision: 'allow' | 'deny' | 'approval-required';
    reason: string;
    requestId: string | null;
};
export declare function createPermissionDecisionEvent(input: {
    workspaceMode?: WorkspacePermissionMode | null;
    role?: string | null;
    tool?: string | null;
    boundary?: PermissionDecisionBoundary | null;
    decision: PermissionDecisionEvent['decision'];
    reason?: string | null;
    requestId?: string | null;
}): PermissionDecisionEvent;
export declare function createTaskLedgerReference(input: {
    taskLedgerNodeId: string;
    workboardCardId?: string | null;
    source?: TaskLedgerReference['source'];
}): TaskLedgerReference;
export type TaskLoopUpgradeSuggestion = {
    kind: 'task-loop-upgrade-suggestion';
    sessionId: string;
    taskTitle: string;
    reason: string;
    requiresUserConfirmation: true;
    createsTaskLedgerRoot: true;
    startsRun: 'after-user-confirmation';
};
export declare function createTaskLoopUpgradeSuggestion(input: {
    sessionId: string;
    taskTitle: string;
    reason: string;
}): TaskLoopUpgradeSuggestion;
