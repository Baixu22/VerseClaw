import type { BlackboardEntryType } from '../../openclaw_runtime/src/agents/orchestration-blackboard.js';
import type { ScopedRunId, TaskId } from './identity-scope.js';

export const SESSION_COLLABORATION_MATERIAL_KINDS = [
  'fact', 'claim', 'decision', 'artifact', 'conflict', 'handoff',
] as const satisfies readonly BlackboardEntryType[];

export type SessionCollaborationMaterialInput = {
  id: string;
  kind: (typeof SESSION_COLLABORATION_MATERIAL_KINDS)[number];
  summary: string;
  evidenceRefs: string[];
  sensitivity: 'internal' | 'restricted';
  applicability?: string[];
  expiresAt?: number;
  artifactRefs?: Array<{ path: string; sha256: string }>;
};

export type SessionCollaborationMaterial = SessionCollaborationMaterialInput & {
  version: number;
  authorityId: string;
  taskNodeId: TaskId;
  taskRevision: number;
  taskDigest: string;
  sourceGeneration: string;
  sourceRun: ScopedRunId;
  contentDigest: string;
  state: 'claim' | 'evidence-backed';
  createdAt: number;
};

export function parseSessionCollaborationMaterial(value: unknown): SessionCollaborationMaterialInput {
  const invalid = () => new TypeError('MATERIAL_INPUT_INVALID');
  const record = (input: unknown, keys: string[]) => {
    if (!input || typeof input !== 'object' || Array.isArray(input) ||
        (Object.getPrototypeOf(input) !== Object.prototype && Object.getPrototypeOf(input) !== null) ||
        Object.keys(input).some(key => !keys.includes(key))) throw invalid();
    return input as Record<string, unknown>;
  };
  const text = (input: unknown, max: number) => {
    if (typeof input !== 'string' || !input.trim() || input.length > max) throw invalid();
    return input;
  };
  const list = (input: unknown) => {
    if (!Array.isArray(input) || input.length > 16) throw invalid();
    return input as unknown[];
  };
  const input = record(value, ['id', 'kind', 'summary', 'evidenceRefs', 'sensitivity', 'applicability', 'expiresAt', 'artifactRefs']);
  const kind = input.kind as SessionCollaborationMaterialInput['kind'];
  const { sensitivity, expiresAt } = input;
  if (!SESSION_COLLABORATION_MATERIAL_KINDS.includes(kind) ||
      (sensitivity !== 'internal' && sensitivity !== 'restricted') ||
      (expiresAt !== undefined && (typeof expiresAt !== 'number' || !Number.isSafeInteger(expiresAt) || expiresAt < 1))) throw invalid();
  const evidenceRefs = [...new Set(list(input.evidenceRefs).map(ref => text(ref, 160).trim()))];
  const applicability = input.applicability === undefined ? [] : list(input.applicability).map(condition => text(condition, 300));
  const artifactRefs = input.artifactRefs === undefined ? [] : list(input.artifactRefs).map(ref => {
    const artifact = record(ref, ['path', 'sha256']);
    const sha256 = text(artifact.sha256, 64);
    if (!/^[a-f0-9]{64}$/.test(sha256)) throw invalid();
    return { path: text(artifact.path, 1024), sha256 };
  });
  if (kind === 'artifact' && !artifactRefs.length) throw invalid();
  return {
    id: text(input.id, 160).trim(), kind, summary: text(input.summary, 2048), sensitivity, evidenceRefs,
    ...(applicability.length ? { applicability } : {}),
    ...(artifactRefs.length ? { artifactRefs } : {}),
    ...(expiresAt !== undefined ? { expiresAt } : {}),
  };
}
