import { useEffect, useState } from 'react';
import { ArrowRightLeft, Loader2 } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { hostApi } from '@/lib/host-api';
import { useWorkspacesStore } from '@/stores/workspaces';
import { useChatStore } from '@/stores/chat';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogTitle } from '@/components/ui/dialog';
import type { ExecutionMigrationOperation } from '@shared/types/execution-migration';

export function ExecutionMigrationControl({ workspaceId, sessionKey, generation }: {
  workspaceId?: string; sessionKey: string; generation?: string;
}) {
  const { t }=useTranslation('chat');
  const profiles=useWorkspacesStore(state=>state.profiles);
  const [open,setOpen]=useState(false),[target,setTarget]=useState(''),[busy,setBusy]=useState(false),[error,setError]=useState('');
  const [operation,setOperation]=useState<ExecutionMigrationOperation|null>(null);
  const workspace=profiles.find(profile=>profile.id===workspaceId);
  const binding=workspace?.coordinatorBindings?.[sessionKey];
  const unfinished=(entry:ExecutionMigrationOperation)=>entry.phase!=='confirmed'||!entry.reservationReleased;
  const pending=profiles.flatMap(profile=>Object.values(profile.executionMigrations??{}))
    .filter(entry=>entry.sessionKey===sessionKey&&unfinished(entry)).sort((a,b)=>b.updatedAt.localeCompare(a.updatedAt))[0];
  const current=operation?.sessionKey===sessionKey&&unfinished(operation)?operation:pending;
  const retainedError=error||current?.error;
  const targets=profiles.filter(profile=>profile.id!==workspaceId||profile.id===current?.targetWorkspaceId);
  useEffect(()=>{setOpen(false);setError('');setOperation(null);setTarget('');},[workspaceId,sessionKey]);
  const start=async()=>{
    if(!workspaceId||(!current&&(!generation||!binding))||busy)return;
    setBusy(true);setError('');
    const source=current?.workspaceId??workspaceId;
    const id=current?.id??crypto.randomUUID();
    const visit=useChatStore.getState().viewRevision;
    try{
      const result=await hostApi.workspaces.migrateExecution({workspaceId:source,targetWorkspaceId:current?.targetWorkspaceId??target,
        sessionKey,operationId:id,expectedSessionGeneration:current?.sourceGeneration??generation!,
        expectedBindingRevision:current?.sourceBindingRevision??binding!.bindingRevision});
      setOperation(result.operation);
      await useWorkspacesStore.getState().fetchWorkspaces();
      await useChatStore.getState().loadSessions();
      if(useChatStore.getState().viewRevision===visit&&useChatStore.getState().currentSessionKey===sessionKey)
        useChatStore.getState().resetSessionView(sessionKey);
      setOpen(false);
    }catch(cause){
      setError(String(cause instanceof Error?cause.message:cause));
      const read=await hostApi.workspaces.executionMigration({workspaceId:source,sessionKey,operationId:id}).catch(()=>null);
      if(read?.operation)setOperation(read.operation);
      await useWorkspacesStore.getState().fetchWorkspaces();
    }finally{setBusy(false);}
  };
  if(!workspaceId)return null;
  return <>
    <button type="button" data-testid="execution-migration-open" className="rounded p-1 text-muted-foreground hover:bg-black/5 dark:hover:bg-white/10"
      aria-label={t(current?'migration.resume':'migration.open')} title={t(current?'migration.resume':'migration.open')}
      disabled={!current&&(!binding?.activeTaskNodeId||!generation||targets.length===0)}
      onClick={()=>{setTarget(current?.targetWorkspaceId??targets[0]?.id??'');setOpen(true);}}>
      <ArrowRightLeft className="size-4"/>
    </button>
    <Dialog open={open} onOpenChange={value=>{if(!busy)setOpen(value);}}>
      <DialogContent data-testid="execution-migration-dialog" className="max-w-xl space-y-4 rounded-lg border border-black/10 bg-surface-modal p-5 shadow-xl dark:border-white/10">
        <DialogTitle className="font-serif text-xl font-normal tracking-tight text-foreground">{t('migration.title')}</DialogTitle>
        <DialogDescription className="text-sm text-muted-foreground">{t('migration.description')}</DialogDescription>
        <label className="block space-y-2 text-sm">{t('migration.target')}
          <select data-testid="execution-migration-target" className="w-full rounded border border-border bg-surface-input p-2"
            value={current?.targetWorkspaceId??target} disabled={busy||Boolean(current)} onChange={event=>setTarget(event.target.value)}>
            {targets.map(profile=><option key={profile.id} value={profile.id}>{profile.name}</option>)}
          </select>
        </label>
        {current&&<p role="status" data-testid="execution-migration-phase" className="text-sm text-muted-foreground">{t(`migration.phase.${current.phase}`)}</p>}
        {retainedError&&<p role="alert" className="text-sm text-red-700 dark:text-red-400">{t('migration.retained')} {retainedError.includes('MIGRATION_ARTIFACT_CHANGED')?t('migration.artifactChanged'):retainedError}</p>}
        <div className="flex justify-end gap-2">
          <Button variant="outline" disabled={busy} onClick={()=>setOpen(false)}>{t('migration.cancel')}</Button>
          <Button data-testid="execution-migration-start" disabled={busy||(!target&&!current)} onClick={()=>void start()}>
            {busy&&<Loader2 className="mr-2 size-4 animate-spin"/>}{t(current?'migration.resume':'migration.start')}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  </>;
}
