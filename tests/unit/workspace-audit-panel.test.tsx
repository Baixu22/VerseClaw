import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { WorkspaceAuditPanel } from '@/components/file-preview/WorkspaceAuditPanel';

const mocks = vi.hoisted(() => ({
  workspace: { id: 'one', name: 'Workspace one' }, approvals: vi.fn(), status: vi.fn(), reflog: vi.fn(), copy: vi.fn(),
}));
vi.mock('@/stores/workspaces', () => ({ useWorkspacesStore: Object.assign((selector: (state: unknown) => unknown) => selector({activeWorkspace:mocks.workspace}), {getState:()=>({activeWorkspace:mocks.workspace})}) }));
vi.mock('@/lib/host-api', () => ({hostApi:{permissions:{approvals:mocks.approvals},git:{status:mocks.status,reflog:mocks.reflog}}}));
vi.mock('@/components/tool-ui/shared/use-copy-to-clipboard',()=>({useCopyToClipboard:()=>({copiedId:null,copy:mocks.copy})}));
vi.mock('react-i18next', () => ({useTranslation:()=>({t:(key:string)=>key,i18n:{language:'en'}})}));

beforeEach(()=>{
  vi.clearAllMocks();mocks.workspace={id:'one',name:'Workspace one'};
  mocks.status.mockResolvedValue({status:{isRepository:true,branch:'main',clean:true,changes:[]}});
  mocks.reflog.mockResolvedValue({entries:[]});mocks.approvals.mockResolvedValue({approvals:[]});
});

describe('Workspace audit',()=>{
  it('keeps the panel usable when an audit source returns an incomplete payload',async()=>{
    mocks.reflog.mockResolvedValue({success:false});
    render(<WorkspaceAuditPanel />);
    await screen.findByText(/approvals.reflogUnavailable/);
    expect(screen.getByTestId('workspace-audit-search')).toBeVisible();
  });
  it('searches visible details, copies full commands and excludes redacted external writes',async()=>{
    mocks.approvals.mockResolvedValue({approvals:[
      {id:'visible',source:'git',risk:'write',status:'approved',mode:'acceptEdits',requestedAt:1,command:'git status --porcelain',cwd:'D:/workspace/long-path'},
      {id:'external',source:'terminal',risk:'external-write',status:'pending',mode:'acceptEdits',requestedAt:2,command:'secret-command',cwd:'secret-directory'},
    ]});
    render(<WorkspaceAuditPanel />);
    await waitFor(()=>expect(screen.getAllByTestId('workspace-audit-approval-row')).toHaveLength(2));
    const search=screen.getByTestId('workspace-audit-search');
    fireEvent.change(search,{target:{value:'long-path'}});
    expect(screen.getAllByTestId('workspace-audit-approval-row')).toHaveLength(1);
    fireEvent.click(screen.getByTestId('workspace-audit-approval-row').querySelector('summary')!);
    fireEvent.click(screen.getByRole('button',{name:'gitSurface.copyDetails'}));
    expect(mocks.copy).toHaveBeenCalledWith(expect.stringContaining('git status --porcelain'),'approval:visible');
    fireEvent.change(search,{target:{value:'secret'}});
    expect(screen.queryAllByTestId('workspace-audit-approval-row')).toHaveLength(0);
    fireEvent.change(search,{target:{value:''}});
    fireEvent.click(screen.getByTestId('workspace-audit-filter-pending'));
    expect(screen.getAllByTestId('workspace-audit-approval-row')).toHaveLength(1);
    expect(screen.queryByText('secret-command')).toBeNull();
  });

  it('ignores an old workspace response that arrives after switching',async()=>{
    let resolveOld!: (value: unknown)=>void;
    mocks.reflog.mockReturnValueOnce(new Promise(resolve=>{resolveOld=resolve;}));
    const view=render(<WorkspaceAuditPanel />);
    await waitFor(()=>expect(mocks.reflog).toHaveBeenCalledTimes(1));
    mocks.workspace={id:'two',name:'Workspace two'};
    mocks.reflog.mockResolvedValue({entries:[{hash:'new-hash',shortHash:'new',selector:'HEAD@{0}',subject:'Current workspace commit',date:2}]});
    view.rerender(<WorkspaceAuditPanel />);
    await screen.findAllByText('Current workspace commit');
    await act(async()=>resolveOld({entries:[{hash:'old',shortHash:'old',selector:'HEAD@{0}',subject:'Obsolete commit',date:1}]}));
    expect(screen.queryByText('Obsolete commit')).toBeNull();
    expect(screen.getAllByTestId('workspace-audit-git-row')).toHaveLength(1);
  });
});
