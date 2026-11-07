export const TASK_INPUT_BINDINGS: string;
export const PUBLIC_INPUT_PROTOCOL: 'RsiCodingTaskInputs/v1';
export const PUBLIC_BEHAVIOR_SOURCE: string;
export type PublicInputSource = { path: string; revision: string; sourceSha256: string | null };
export type PublicTaskBinding = {
  identity: { id: string; base: string; reference: string; sourceRecord: string;
    sourceRecordSha256: string; targetScope: string[]; oracleDigest: string };
  kind: 'module-implementation' | 'specification-verification';
  publicSources: Array<PublicInputSource & { declaration: string; declarationSha256: string }>;
  baseSources: Array<PublicInputSource & { missing: boolean; required: boolean; reconstructed: boolean }>;
  locatorSources: Array<PublicInputSource & { projection: string }>;
  behaviorContract: null | { content: string; source: PublicInputSource & { projection: string } };
  documentContract: { format: string; taskSpecFields: string[]; lifecycleStates: string[]; sourceOfTruth: string };
};
export type TaskInputBindings = { schemaVersion: 'RsiCodingTaskInputBindings/v1'; protocol: string;
  compilerVersion: string; driven_by: 'agent'; actor: string; tasks: PublicTaskBinding[] };
export type CodingSubjectInput = { prompt: string; acceptanceCriteria: string[]; targetScope: string[];
  responseSchema?: Record<string, unknown>; taskKind: PublicTaskBinding['kind'];
  publicContract: { protocol: string; declarations: Array<{ path: string; content: string }>; behavior?: string;
    document: PublicTaskBinding['documentContract'] };
  baseFiles: Array<{ path: string; content: string | null; missing?: boolean; reconstructed?: boolean }>;
  omittedContext: Array<{ path: string; reason: string }> };
export function assertDeclarationOnly(content: string): true;
export function publicDeclarations(source: string, path: string): string;
export function buildTaskInputBindings(root: string): TaskInputBindings;
export function verifyTaskInputBindings(root: string, bindings: TaskInputBindings): true;
export function buildPublicTaskInputs(root: string, taskId: string, options?: { maxContextChars?: number;
  maxContextFiles?: number; responseSchema?: Record<string, unknown> }): {
  input: CodingSubjectInput; inputDigest: string; sources: PublicInputSource[]; omitted: CodingSubjectInput['omittedContext'] };
