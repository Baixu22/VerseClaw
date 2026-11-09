import { createHash, randomUUID } from 'node:crypto';
import { readFile, realpath } from 'node:fs/promises';
import { resolve } from 'node:path';
import type { ExecutionMigrationOperation, SessionExecutionMigrationRequest, SessionExecutionMigrationReceipt, WorkspaceExecutionMigrationPayload } from '../../shared/types/execution-migration';
import type { WorkspaceCoordinatorBinding, WorkspaceProfile } from '../../shared/types/workspace';
import { normalizeRunScope } from '../../shared/types/identity-scope';
import { createExecutionTaskAccess, openExecutionTaskStore } from '../../openclaw_runtime/src/agents/execution-task-authority';
import { createWorktreeService, resolveExecutionCheckout, reconcileTaskCheckoutWrites } from '../../openclaw_runtime/src/agents/worktree-service';
import { canonicalPath } from '../../shared/task-system/identity';

export type MigrationWorkspaceOwner = {
  read(): Promise<{ source: WorkspaceProfile; target: WorkspaceProfile; operation: ExecutionMigrationOperation | null }>;
  save(operation: ExecutionMigrationOperation): Promise<void>;
  fence(operation: ExecutionMigrationOperation): Promise<void>;
  bind(operation: ExecutionMigrationOperation, active: boolean): Promise<WorkspaceCoordinatorBinding>;
};
export type MigrationRuntimeOwner = { rpc<T>(method: string, params: Record<string, unknown>, timeoutMs?: number): Promise<T> };
const order = ['intent','fenced','drained','reserved','session-committed','task-committed','binding-committed','confirmed'] as const;
const before = (operation: ExecutionMigrationOperation, phase: ExecutionMigrationOperation['phase']) => order.indexOf(operation.phase) < order.indexOf(phase);
const credentialEquals = (a: ExecutionMigrationOperation['task']['credential'], b: ExecutionMigrationOperation['task']['credential']) =>
  a.taskNodeId === b.taskNodeId && a.sessionKey === b.sessionKey && a.generation === b.generation && a.epoch === b.epoch;
const sourceCheckpoint = (checkpoint: ExecutionMigrationOperation['task']['checkpoint'], root: string) => checkpoint && {
  ...checkpoint, artifacts: checkpoint.artifacts.map(artifact => ({ ...artifact, path: resolve(root, artifact.path) })),
};

function releasePublishedReservation(operation: ExecutionMigrationOperation): void {
  if (!operation.reservation) return;
  const { baseRoot, worktreeId, credential } = operation.reservation;
  const service = createWorktreeService(baseRoot), writer = service.writer(worktreeId);
  if (!writer || writer.state === 'released' || writer.epoch !== credential.epoch || writer.token !== credential.token) return;
  service.releaseUnusedWriter(credential);
}

async function finishPublishedMigration(operation: ExecutionMigrationOperation, owner: MigrationWorkspaceOwner) {
  if (!operation.reservationReleased) {
    releasePublishedReservation(operation);
    operation.reservationReleased=true;operation.updatedAt=new Date().toISOString();delete operation.error;
    await owner.save(operation);
  }
  return operation;
}

/** Forward-only composition of existing owners; the workspace stores the progress, never copied task data. */
export async function migrateExecutionEnvironment(
  request: WorkspaceExecutionMigrationPayload, owner: MigrationWorkspaceOwner, runtime: MigrationRuntimeOwner,
): Promise<ExecutionMigrationOperation> {
  for (const key of ['workspaceId','targetWorkspaceId','sessionKey','operationId','expectedSessionGeneration'] as const)
    if (typeof request[key] !== 'string' || !request[key].trim() || request[key].length > 2048) throw new Error('MIGRATION_INPUT_INVALID');
  if (!Number.isSafeInteger(request.expectedBindingRevision) || request.expectedBindingRevision < 1) throw new Error('MIGRATION_INPUT_INVALID');
  const requestDigest = createHash('sha256').update(JSON.stringify([request.workspaceId,request.targetWorkspaceId,request.sessionKey,
    request.operationId,request.expectedSessionGeneration,request.expectedBindingRevision])).digest('hex');
  const { source, target, operation: saved } = await owner.read();
  let operation = saved;
  if (operation && operation.requestDigest !== requestDigest) throw new Error('MIGRATION_REQUEST_CONFLICT');
  if (operation?.phase === 'confirmed') return finishPublishedMigration(operation,owner);
  if (!operation) {
    const binding = source.coordinatorBindings?.[request.sessionKey];
    if (!binding || binding.state !== 'active' || binding.bindingRevision !== request.expectedBindingRevision
      || binding.sessionGeneration !== request.expectedSessionGeneration) throw new Error('MIGRATION_SOURCE_BINDING_STALE');
    const sourceRoot = await realpath(binding.environment.canonicalRoot);
    const targetRoot = await realpath(target.rootPath);
    if(canonicalPath(sourceRoot)===canonicalPath(targetRoot))throw new Error('MIGRATION_TARGET_SAME_CHECKOUT');
    const access = createExecutionTaskAccess(sourceRoot), targetAccess = createExecutionTaskAccess(targetRoot);
    if (access.domain.id !== targetAccess.domain.id || access.domain.database !== targetAccess.domain.database) throw new Error('MIGRATION_TASK_AUTHORITY_MISMATCH');
    const store = openExecutionTaskStore(sourceRoot);
    try {
      const task = store.binding(request.sessionKey, request.expectedSessionGeneration);
      if (!task?.claim || task.referenceOnly || task.contract.taskNodeId !== binding.activeTaskNodeId) throw new Error('MIGRATION_TASK_OWNER_MISSING');
      store.assertOwner(task.claim,true);
      const now = new Date().toISOString();
      operation = { schema: 1, id: request.operationId, requestDigest, workspaceId: source.id, targetWorkspaceId: target.id,
        sessionKey: request.sessionKey, agentId: binding.agentId, sourceGeneration: request.expectedSessionGeneration,
        targetGeneration: randomUUID(), sourceRoot, targetRoot, sourceBindingRevision: binding.bindingRevision,
        task: { credential: task.claim, revision: task.contract.revision, digest: task.contract.digest, authority: access.basis,
          checkpoint: sourceCheckpoint(task.checkpoint,sourceRoot) },
        phase: 'intent', createdAt: now, updatedAt: now };
    } finally { store.close(); }
    await owner.save(operation);
  }
  const current = operation;
  const save = async (phase: ExecutionMigrationOperation['phase']) => {
    current.phase = phase; current.updatedAt = new Date().toISOString(); delete current.error; await owner.save(current);
  };
  const runtimeRequest: SessionExecutionMigrationRequest = { operationId: current.id, sessionKey: current.sessionKey, agentId: current.agentId,
    sourceGeneration: current.sourceGeneration, targetGeneration: current.targetGeneration, sourceRoot: current.sourceRoot,
    targetRoot: current.targetRoot, taskNodeId: current.task.credential.taskNodeId, contractRevision: current.task.revision, contractDigest: current.task.digest };
  try {
    createExecutionTaskAccess(current.sourceRoot, current.task.authority).assertCurrent();
    const targetAccess = createExecutionTaskAccess(current.targetRoot);
    if (targetAccess.domain.id !== current.task.authority.authorityId || targetAccess.domain.database !== current.task.authority.authorityDatabase)
      throw new Error('MIGRATION_TASK_AUTHORITY_MISMATCH');
    if (before(current,'fenced')) { await owner.fence(current); await save('fenced'); }
    if (before(current,'drained')) {
      const described = await runtime.rpc<{ session?: { sessionId?: string; hasActiveRun?: boolean } }>('sessions.describe',{key:current.sessionKey},15_000);
      if (described.session?.sessionId !== current.sourceGeneration) throw new Error('MIGRATION_SESSION_CHANGED');
      if (described.session.hasActiveRun) await runtime.rpc('sessions.stop',{key:current.sessionKey,expectedSessionId:current.sourceGeneration},30_000);
      const state = await runtime.rpc<{ quiescent?: boolean }>('taskScope.runState',{runId:`migration:${current.id}`,sessionKey:current.sessionKey,
        sessionGeneration:current.sourceGeneration,processScope:'session'},15_000);
      if (state.quiescent !== true) throw new Error('MIGRATION_RESOURCES_PENDING');
      const store = openExecutionTaskStore(current.sourceRoot,current.task.authority);
      try { const task=store.get(current.task.credential.taskNodeId);
        const claim=task.claim;
        const pausedReplay=claim?.state==='paused'&&claim.epoch===current.task.credential.epoch+1
          &&claim.sessionKey===current.sessionKey&&claim.generation===current.sourceGeneration;
        if(pausedReplay)store.assertOwner(claim!,true);
        else store.assertOwner(current.task.credential,true);
        if (task.pendingOperations) throw new Error('MIGRATION_EFFECTS_PENDING');
        if (task.contract.revision!==current.task.revision||task.contract.digest!==current.task.digest) throw new Error('MIGRATION_CONTRACT_CHANGED');
        current.task.checkpoint=sourceCheckpoint(task.checkpoint,current.sourceRoot);
        const sourceCheckout=resolveExecutionCheckout(current.sourceRoot), writer=sourceCheckout.service.writer(sourceCheckout.worktreeId);
        if(writer&&writer.state!=='released'){
          if(writer.owner.kind!=='run'||writer.owner.run.scope.sessionKey!==current.sessionKey||writer.owner.sessionGeneration!==current.sourceGeneration)
            throw new Error('MIGRATION_SOURCE_CHECKOUT_BUSY');
          reconcileTaskCheckoutWrites({...sourceCheckout,credential:writer});
          sourceCheckout.service.drainWriter(writer);sourceCheckout.service.releaseWriter(writer);
        }
        current.pausedCredential=pausedReplay?claim!:store.control(current.task.credential,'pause').claim!;
      } finally {store.close();}
      await save('drained');
    }
    if (before(current,'reserved')) {
      const checkout=resolveExecutionCheckout(current.targetRoot);
      const credential=checkout.service.claimWriter(checkout.worktreeId,checkout.basis.generation,{kind:'run',agentId:current.agentId,
        sessionGeneration:current.targetGeneration,bindingRevision:current.sourceBindingRevision+1,
        run:normalizeRunScope({runId:`migration:${current.id}`,scope:{workspaceId:current.targetWorkspaceId,sessionKey:current.sessionKey}})},`migration:${current.id}`);
      current.reservation={baseRoot:checkout.baseRoot,worktreeId:checkout.worktreeId,credential};await save('reserved');
    }
    if (before(current,'session-committed')) {
      const receipt=await runtime.rpc<SessionExecutionMigrationReceipt>('taskScope.migration.prepare',runtimeRequest,30_000);
      if(receipt.operationId!==current.id||receipt.sessionKey!==current.sessionKey||receipt.targetGeneration!==current.targetGeneration
        ||canonicalPath(receipt.targetRoot)!==canonicalPath(current.targetRoot)) throw new Error('MIGRATION_RUNTIME_RECEIPT_MISMATCH');
      current.runtimeReceipt=receipt;await save('session-committed');
    }
    if (before(current,'task-committed')) {
      const targetStore=openExecutionTaskStore(current.targetRoot);
      try {const task=targetStore.get(current.task.credential.taskNodeId);
        if(task.contract.revision!==current.task.revision||task.contract.digest!==current.task.digest)throw new Error('MIGRATION_CONTRACT_CHANGED');
        if(task.claim?.sessionKey===current.sessionKey&&task.claim.generation===current.targetGeneration&&task.claim.epoch===current.pausedCredential!.epoch+1)
          current.targetCredential=task.claim;
        else {
          const sourceStore=openExecutionTaskStore(current.sourceRoot,current.task.authority);
          try{current.targetCredential=sourceStore.handoff(current.pausedCredential!,current.sessionKey,current.targetGeneration,current.targetRoot).claim!;}
          finally{sourceStore.close();}
        }
        if(current.task.checkpoint&&JSON.stringify(targetStore.get(current.task.credential.taskNodeId).checkpoint)!==JSON.stringify(current.task.checkpoint))
          targetStore.checkpoint(current.targetCredential!,current.task.checkpoint);
      }finally{targetStore.close();}
      await save('task-committed');
    }
    if(before(current,'binding-committed')){
      const binding=await owner.bind(current,false);current.targetBindingRevision=binding.bindingRevision;await save('binding-committed');
    }
    const targetStore=openExecutionTaskStore(current.targetRoot);
    try {
      let task=targetStore.get(current.task.credential.taskNodeId);
      const claim=task.claim,expected=current.targetCredential!;
      if(!claim||claim.sessionKey!==current.sessionKey||claim.generation!==current.targetGeneration||claim.epoch<expected.epoch
        ||task.contract.revision!==current.task.revision||task.contract.digest!==current.task.digest||task.pendingOperations)
        throw new Error('MIGRATION_TARGET_NOT_READY');
      targetStore.assertOwner(claim,true);
      if(claim.state==='recovery_required'){
        const resources=await runtime.rpc<{quiescent?:boolean}>('taskScope.runState',{runId:`migration:${current.id}`,
          sessionKey:current.sessionKey,sessionGeneration:current.targetGeneration,processScope:'session'},15_000);
        if(resources.quiescent!==true)throw new Error('MIGRATION_RESOURCES_PENDING');
        task=targetStore.handoff(claim,current.sessionKey,current.targetGeneration,current.targetRoot);
      }
      if(!credentialEquals(task.claim!,expected)){current.targetCredential=task.claim!;await owner.save(current);}
      task=targetStore.assertOwner(current.targetCredential!);
      if(!credentialEquals(task.claim!,current.targetCredential!)||task.contract.revision!==current.task.revision
        ||task.contract.digest!==current.task.digest||task.pendingOperations)throw new Error('MIGRATION_TARGET_NOT_READY');
      const artifacts=current.task.checkpoint?.artifacts??[];
      for(const artifact of artifacts)if(createHash('sha256').update(await readFile(artifact.path)).digest('hex')!==artifact.sha256)
        throw new Error('MIGRATION_ARTIFACT_CHANGED');
      current.confirmation={targetDigest:task.contract.digest,candidateArtifacts:artifacts,pendingOperations:task.pendingOperations,at:new Date().toISOString()};
    } finally {targetStore.close();}
    const confirmed=await runtime.rpc<SessionExecutionMigrationReceipt>('taskScope.migration.confirm',runtimeRequest,30_000);
    if(confirmed.state!=='confirmed'||confirmed.operationId!==current.id||confirmed.targetGeneration!==current.targetGeneration)throw new Error('MIGRATION_CONFIRMATION_MISMATCH');
    current.runtimeReceipt=confirmed;
    await owner.bind(current,true);await save('confirmed');
    return await finishPublishedMigration(current,owner);
  } catch(error) {
    const persisted=(await owner.read()).operation;
    if(persisted?.phase==='confirmed') return finishPublishedMigration(persisted,owner);
    current.error=error instanceof Error?error.message:String(error);current.updatedAt=new Date().toISOString();await owner.save(current);throw error;
  }
}
