import { fireEvent, render, screen, waitFor, cleanup } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import type { ExecutionMigrationOperation } from '../../shared/types/execution-migration';
const fixture=vi.hoisted(()=>({profiles:[] as unknown[],migrate:vi.fn(),fetch:vi.fn(),load:vi.fn(),reset:vi.fn()}));
vi.mock('react-i18next',()=>({useTranslation:()=>({t:(key:string)=>key})}));
vi.mock('@/lib/host-api',()=>({hostApi:{workspaces:{migrateExecution:fixture.migrate,executionMigration:vi.fn()}}}));
vi.mock('@/stores/workspaces',()=>({useWorkspacesStore:Object.assign(
  (select:(state:unknown)=>unknown)=>select({profiles:fixture.profiles}),
  {getState:()=>({fetchWorkspaces:fixture.fetch})},
)}));
vi.mock('@/stores/chat',()=>({useChatStore:{getState:()=>({viewRevision:1,currentSessionKey:'agent:main:moving',
  loadSessions:fixture.load,resetSessionView:fixture.reset})}}));
import { ExecutionMigrationControl } from '../../src/pages/Chat/ExecutionMigrationControl';
afterEach(()=>{cleanup();vi.clearAllMocks();});

it.each(['binding-committed','confirmed'] as const)('reopens durable %s from the target even before generation hydration',async phase=>{
  const operation={id:'same-operation',workspaceId:'source',targetWorkspaceId:'target',sessionKey:'agent:main:moving',
    sourceGeneration:'old-generation',sourceBindingRevision:4,phase,updatedAt:'2026-11-09T00:00:00Z',
    error:phase==='confirmed'?undefined:'MIGRATION_ARTIFACT_CHANGED'} as ExecutionMigrationOperation;
  fixture.profiles=[{id:'source',name:'Source',executionMigrations:{[operation.id]:operation}},{id:'target',name:'Target'}];
  fixture.migrate.mockResolvedValue({operation:{...operation,phase:'confirmed',reservationReleased:true}});
  const view=render(<ExecutionMigrationControl workspaceId="target" sessionKey={operation.sessionKey}/>);
  expect(screen.getByTestId('execution-migration-open')).toHaveAttribute('aria-label','migration.resume');
  fireEvent.click(screen.getByTestId('execution-migration-open'));
  expect(screen.getByTestId('execution-migration-target')).toHaveValue('target');
  view.rerender(<ExecutionMigrationControl workspaceId="target" sessionKey={operation.sessionKey} generation="new-generation"/>);
  expect(screen.getByTestId('execution-migration-dialog')).toBeInTheDocument();
  if(operation.error)expect(screen.getByRole('alert')).toHaveTextContent('migration.artifactChanged');
  fireEvent.click(screen.getByTestId('execution-migration-start'));
  await waitFor(()=>expect(fixture.migrate).toHaveBeenCalledWith({workspaceId:'source',targetWorkspaceId:'target',sessionKey:operation.sessionKey,
    operationId:'same-operation',expectedSessionGeneration:'old-generation',expectedBindingRevision:4}));
  await waitFor(()=>expect(screen.queryByTestId('execution-migration-dialog')).not.toBeInTheDocument());
});
