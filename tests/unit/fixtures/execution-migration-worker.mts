/*
 * TF-0866 process-isolation worker.
 *
 * This worker contains no assertions. It runs the production Main migration
 * composition or the production Runtime SessionExecutionMigration owner against
 * real TaskSystemStore, session journal/store, transcript files and checkout
 * writer state. The parent Vitest terminates this OS process at a durable
 * signal, then launches a fresh worker to continue the same operation.
 */
import { appendFileSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { migrateExecutionEnvironment, type MigrationRuntimeOwner, type MigrationWorkspaceOwner } from '../../../electron/services/execution-migration.js';
import type {
  ExecutionMigrationOperation,
  SessionExecutionMigrationRequest,
} from '../../../shared/types/execution-migration.js';
import type { WorkspaceCoordinatorBinding, WorkspaceProfile } from '../../../shared/types/workspace.js';
import { getSessionEntry } from '../../../openclaw_runtime/src/config/sessions/store.js';
import {
  createSessionExecutionMigrationOwner,
  type SessionExecutionMigrationFaultPoint,
} from '../../../openclaw_runtime/src/gateway/session-execution-migration.js';
import {
  sessionAdmissionRegistry,
  type SessionAdmissionIdentity,
} from '../../../openclaw_runtime/src/sessions/session-admission-registry.js';

type MainBreakPoint =
  | 'intent'
  | 'fenced'
  | 'drained'
  | 'reserved'
  | 'session-committed'
  | 'task-committed'
  | 'binding-committed'
  | 'publication-before-tail';

type WorkerMode = 'main' | 'runtime-prepare' | 'runtime-confirm';

type Scenario = {
  schema: 1;
  mode: WorkerMode;
  breakPoint?: MainBreakPoint | SessionExecutionMigrationFaultPoint;
  root: string;
  sourceRoot: string;
  targetRoot: string;
  stateDir: string;
  sessionStorePath: string;
  sessionKey: string;
  agentId: string;
  sourceGeneration: string;
  targetGeneration: string;
  operationId: string;
  taskNodeId: string;
  contractRevision: number;
  contractDigest: string;
};

type WorkspaceDocument = {
  activeWorkspaceId: string;
  profiles: WorkspaceProfile[];
};

type WorkerResult = {
  operationId: string;
  phase?: string;
  state?: string;
  sessionKey: string;
  sourceGeneration: string;
  targetGeneration: string;
  taskNodeId: string;
  pid: number;
  driven_by: 'agent';
  requested_route: 'DeepSeek v4.1 flash';
};

const scenarioPath = process.argv[2];
if (!scenarioPath) throw new Error('execution-migration-worker: scenario path is required');
const scenario = JSON.parse(readFileSync(scenarioPath, 'utf8')) as Scenario;
if (scenario.schema !== 1) throw new Error('execution-migration-worker: unsupported scenario schema');

const workspacePath = path.join(scenario.root, 'workspace.json');
const signalPath = path.join(scenario.root, 'break.signal.json');
const resultPath = path.join(scenario.root, 'worker-result.json');
const eventPath = path.join(scenario.root, 'worker-events.jsonl');

function event(kind: string, detail: Record<string, unknown> = {}): void {
  appendFileSync(eventPath, `${JSON.stringify({
    at: new Date().toISOString(),
    pid: process.pid,
    kind,
    driven_by: 'agent',
    requested_route: 'DeepSeek v4.1 flash',
    ...detail,
  })}\n`);
}

function atomicJson(filePath: string, value: unknown): void {
  const temporary = `${filePath}.${process.pid}.tmp`;
  writeFileSync(temporary, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
  renameSync(temporary, filePath);
}

function persistDurableSignal(point: string, detail: Record<string, unknown>): Promise<never> {
  atomicJson(signalPath, {
    pid: process.pid,
    point,
    at: new Date().toISOString(),
    driven_by: 'agent',
    requested_route: 'DeepSeek v4.1 flash',
    ...detail,
  });
  event('durable-break-signal', { point, ...detail });
  return new Promise<never>(() => {
    setInterval(() => undefined, 60_000);
  });
}

function profileById(document: WorkspaceDocument, id: string): WorkspaceProfile {
  const profile = document.profiles.find((candidate) => candidate.id === id);
  if (!profile) throw new Error(`workspace profile missing: ${id}`);
  return profile;
}

function readWorkspace(): WorkspaceDocument {
  return JSON.parse(readFileSync(workspacePath, 'utf8')) as WorkspaceDocument;
}

function saveWorkspace(document: WorkspaceDocument): void {
  atomicJson(workspacePath, document);
}

function operationFrom(document: WorkspaceDocument): ExecutionMigrationOperation | null {
  return profileById(document, 'source').executionMigrations?.[scenario.operationId] ?? null;
}

async function maybeBreakAfterSave(operation: ExecutionMigrationOperation): Promise<void> {
  if (scenario.breakPoint !== operation.phase) return;
  await persistDurableSignal(operation.phase, {
    stage: 'main-workspace-save-committed',
    operationPhase: operation.phase,
    targetGeneration: operation.targetGeneration,
  });
}

function mainOwner(): MigrationWorkspaceOwner {
  return {
    async read() {
      const document = readWorkspace();
      return {
        source: profileById(document, 'source'),
        target: profileById(document, 'target'),
        operation: operationFrom(document),
      };
    },

    async save(operation) {
      const document = readWorkspace();
      const source = profileById(document, 'source');
      const sourceIndex = document.profiles.findIndex((profile) => profile.id === source.id);
      document.profiles[sourceIndex] = {
        ...source,
        executionMigrations: {
          ...source.executionMigrations,
          [operation.id]: structuredClone(operation),
        },
        updatedAt: Date.now(),
      };
      saveWorkspace(document);
      await maybeBreakAfterSave(operation);
    },

    async fence(operation) {
      const document = readWorkspace();
      const source = profileById(document, 'source');
      const binding = source.coordinatorBindings?.[operation.sessionKey];
      if (!binding || binding.sessionGeneration !== operation.sourceGeneration) {
        throw new Error('MIGRATION_SOURCE_BINDING_STALE');
      }
      if (binding.invalidationReason !== `execution-migration:${operation.id}`) {
        const index = document.profiles.findIndex((profile) => profile.id === source.id);
        document.profiles[index] = {
          ...source,
          coordinatorBindings: {
            ...source.coordinatorBindings,
            [operation.sessionKey]: {
              ...binding,
              state: 'invalid',
              bindingRevision: binding.bindingRevision + 1,
              invalidationReason: `execution-migration:${operation.id}`,
              updatedAt: new Date().toISOString(),
            },
          },
          updatedAt: Date.now(),
        };
        saveWorkspace(document);
      }
    },

    async bind(operation, active): Promise<WorkspaceCoordinatorBinding> {
      const document = readWorkspace();
      const source = profileById(document, 'source');
      const target = profileById(document, 'target');
      const existing = target.coordinatorBindings?.[operation.sessionKey];
      const expectedRevision = operation.targetBindingRevision ?? (existing?.bindingRevision ?? operation.sourceBindingRevision) + 1;
      const binding: WorkspaceCoordinatorBinding = {
        schemaVersion: 1,
        workspaceId: target.id,
        agentId: operation.agentId,
        sessionKey: operation.sessionKey,
        sessionGeneration: operation.targetGeneration,
        activeTaskNodeId: operation.task.credential.taskNodeId,
        taskLedgerReferences: [],
        environment: {
          ...bindingEnvironment(source),
          canonicalRoot: scenario.targetRoot,
        },
        state: active ? 'active' : 'paused',
        bindingRevision: expectedRevision,
        invalidationReason: active ? null : `execution-migration:${operation.id}`,
        archiveRestorePolicy: 'restore',
        createdAt: existing?.createdAt ?? new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      };

      const sourceIndex = document.profiles.findIndex((profile) => profile.id === source.id);
      const targetIndex = document.profiles.findIndex((profile) => profile.id === target.id);
      if (!active) {
        document.profiles[targetIndex] = {
          ...target,
          coordinatorBindings: {
            ...target.coordinatorBindings,
            [operation.sessionKey]: binding,
          },
          updatedAt: Date.now(),
        };
        saveWorkspace(document);
        return binding;
      }

      // Mirrors the Workspaces API owner: the active binding and confirmed
      // operation become visible in one document replacement.
      const confirmed = { ...operation, phase: 'confirmed' as const };
      const sourceBindings = { ...source.coordinatorBindings };
      delete sourceBindings[operation.sessionKey];
      document.profiles[sourceIndex] = {
        ...source,
        coordinatorBindings: sourceBindings,
        executionMigrations: {
          ...source.executionMigrations,
          [operation.id]: confirmed,
        },
        activeSessionKey: `agent:${operation.agentId}:session-migrated-${operation.id}`,
        updatedAt: Date.now(),
      };
      document.profiles[targetIndex] = {
        ...target,
        activeSessionKey: operation.sessionKey,
        agentId: operation.agentId,
        selectedAgentId: operation.agentId,
        coordinatorBindings: {
          ...target.coordinatorBindings,
          [operation.sessionKey]: binding,
        },
        executionMigrations: {
          ...target.executionMigrations,
          [operation.id]: confirmed,
        },
        updatedAt: Date.now(),
      };
      document.activeWorkspaceId = target.id;
      saveWorkspace(document);

      if (scenario.breakPoint === 'publication-before-tail') {
        await persistDurableSignal('publication-before-tail', {
          stage: 'main-active-and-confirmed-publication-committed',
          operationPhase: confirmed.phase,
          targetGeneration: operation.targetGeneration,
        });
      }
      return binding;
    },
  };
}

function bindingEnvironment(profile: WorkspaceProfile) {
  return Object.values(profile.coordinatorBindings ?? {})[0]?.environment ?? {
    kind: 'local' as const,
    backend: 'git' as const,
    canonicalRoot: scenario.sourceRoot,
    branch: 'main',
    detachedHead: false,
    setupProfile: null,
  };
}

function identity(generation: string): SessionAdmissionIdentity {
  return {
    agentId: scenario.agentId,
    canonicalSessionKey: scenario.sessionKey,
    expectedSessionId: generation,
  };
}

function primeAdmissionEntries(): void {
  sessionAdmissionRegistry.clearForTests();
  for (const generation of [scenario.sourceGeneration, scenario.targetGeneration]) {
    const release = sessionAdmissionRegistry.acquirePermit(identity(generation), 'reply-turn');
    release();
  }
}

function runtimeRequest(): SessionExecutionMigrationRequest {
  return {
    operationId: scenario.operationId,
    sessionKey: scenario.sessionKey,
    agentId: scenario.agentId,
    sourceGeneration: scenario.sourceGeneration,
    targetGeneration: scenario.targetGeneration,
    sourceRoot: scenario.sourceRoot,
    targetRoot: scenario.targetRoot,
    taskNodeId: scenario.taskNodeId,
    contractRevision: scenario.contractRevision,
    contractDigest: scenario.contractDigest,
  };
}

function runtimeOwner() {
  primeAdmissionEntries();
  return createSessionExecutionMigrationOwner({
    now: Date.now,
    fault: async (point) => {
      if (scenario.breakPoint !== point) return;
      await persistDurableSignal(point, {
        stage: `runtime-${point}`,
        sessionKey: scenario.sessionKey,
        operationId: scenario.operationId,
      });
    },
  });
}

function runtimeConfig() {
  return { session: { store: scenario.sessionStorePath } };
}

function runtimeAdapter(owner: ReturnType<typeof runtimeOwner>): MigrationRuntimeOwner {
  return {
    async rpc<T>(method: string, params: Record<string, unknown>): Promise<T> {
      if (method === 'sessions.describe') {
        const entry = getSessionEntry({ storePath: scenario.sessionStorePath, sessionKey: scenario.sessionKey });
        return {
          session: {
            sessionId: entry?.sessionId,
            hasActiveRun: false,
          },
        } as T;
      }
      if (method === 'taskScope.runState') return { quiescent: true } as T;
      const request = params as unknown as SessionExecutionMigrationRequest;
      if (method === 'taskScope.migration.prepare') {
        return await owner.prepare(runtimeConfig(), request) as T;
      }
      if (method === 'taskScope.migration.confirm') {
        return await owner.confirm(runtimeConfig(), request) as T;
      }
      throw new Error(`execution-migration-worker: unsupported runtime method ${method}`);
    },
  };
}

function resultFor(operationId: string, phase: string | undefined, state: string | undefined, targetGeneration = scenario.targetGeneration): WorkerResult {
  return {
    operationId,
    ...(phase ? { phase } : {}),
    ...(state ? { state } : {}),
    sessionKey: scenario.sessionKey,
    sourceGeneration: scenario.sourceGeneration,
    targetGeneration,
    taskNodeId: scenario.taskNodeId,
    pid: process.pid,
    driven_by: 'agent',
    requested_route: 'DeepSeek v4.1 flash',
  };
}

async function runMain(): Promise<void> {
  event('main-worker-start', { operationId: scenario.operationId, breakPoint: scenario.breakPoint });
  const owner = mainOwner();
  const runtime = runtimeOwner();
  const result = await migrateExecutionEnvironment({
    workspaceId: 'source',
    targetWorkspaceId: 'target',
    sessionKey: scenario.sessionKey,
    operationId: scenario.operationId,
    expectedSessionGeneration: scenario.sourceGeneration,
    expectedBindingRevision: 1,
  }, owner, runtimeAdapter(runtime));
  atomicJson(resultPath, resultFor(result.id, result.phase, undefined, result.targetGeneration));
  event('main-worker-complete', { operationId: result.id, phase: result.phase });
}

async function runRuntimePrepare(): Promise<void> {
  event('runtime-prepare-start', { operationId: scenario.operationId, breakPoint: scenario.breakPoint });
  const receipt = await runtimeOwner().prepare(runtimeConfig(), runtimeRequest());
  atomicJson(resultPath, resultFor(receipt.operationId, undefined, receipt.state));
  event('runtime-prepare-complete', { operationId: receipt.operationId, state: receipt.state });
}

async function runRuntimeConfirm(): Promise<void> {
  event('runtime-confirm-start', { operationId: scenario.operationId, breakPoint: scenario.breakPoint });
  const receipt = await runtimeOwner().confirm(runtimeConfig(), runtimeRequest());
  atomicJson(resultPath, resultFor(receipt.operationId, undefined, receipt.state));
  event('runtime-confirm-complete', { operationId: receipt.operationId, state: receipt.state });
}

try {
  if (scenario.mode === 'main') await runMain();
  else if (scenario.mode === 'runtime-prepare') await runRuntimePrepare();
  else if (scenario.mode === 'runtime-confirm') await runRuntimeConfirm();
  else throw new Error(`execution-migration-worker: unsupported mode ${String(scenario.mode)}`);
  process.exit(0);
} catch (error) {
  const failure = {
    error: error instanceof Error ? error.message : String(error),
    stack: error instanceof Error ? error.stack : undefined,
    pid: process.pid,
    driven_by: 'agent',
    requested_route: 'DeepSeek v4.1 flash',
  };
  atomicJson(path.join(scenario.root, 'worker-error.json'), failure);
  event('worker-error', { error: failure.error });
  process.stderr.write(`${failure.error}\n`);
  process.exit(2);
}
