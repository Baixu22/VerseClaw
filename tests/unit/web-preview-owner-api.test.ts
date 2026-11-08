import { afterEach, expect, it, vi } from 'vitest';
import { createWebPreviewApi } from '../../electron/services/web-preview-api';
import { WebPreviewManager } from '../../electron/services/web-preview-manager';
import type { GatewayManager } from '../../electron/gateway/manager';
import type { WorkspaceProfile } from '../../shared/types/workspace';
const state=vi.hoisted(()=>({fenced:false,workspace:{id:'trusted-project',name:'Trusted',rootPath:'D:/trusted',agentId:'main',activeSessionKey:'agent:main:trusted',permissionMode:'fullAccess',createdAt:1,updatedAt:1,lastOpenedAt:1,state:{}}}));
vi.mock('../../electron/services/workspaces-api',()=>({getActiveWorkspaceProfile:async()=>state.workspace}));
vi.mock('../../electron/services/session-delete-gate',()=>({findSessionDeleteGateBySession:async()=>state.fenced,tryWithSessionDeleteGateLock:(_key:string,run:()=>unknown)=>run()}));
vi.mock('../../electron/services/permissions-api',()=>({consumeApprovedPermissionApproval:vi.fn(),createPermissionApproval:vi.fn(),recordPermissionAudit:vi.fn()}));
afterEach(()=>{vi.restoreAllMocks();state.fenced=false;});
it.each(['valid','missing','fenced'] as const)('binds preview launch to the real owner generation: %s',async mode=>{
 const manager=new WebPreviewManager();const start=vi.spyOn(manager,'start').mockResolvedValue({success:true,status:'running'});
 const rpc=vi.fn(async()=>({session:mode==='missing'?{}:{sessionId:'current-generation'}}));state.fenced=mode==='fenced';
 const api=createWebPreviewApi({webPreviewManager:manager,gatewayManager:{rpc} as unknown as GatewayManager});
 const request={mode:'devServer' as const,launchConfig:{mode:'devServer' as const,name:'server',command:'node server.cjs'},workspace:{...state.workspace,id:'forged'} as WorkspaceProfile};
 const result=await api.start(request);
 if(mode==='valid'){
  expect(start).toHaveBeenCalledWith(expect.objectContaining({workspace:state.workspace,expectedSessionId:'current-generation'}));
  expect(result.success).toBe(true);
 }else{expect(start).not.toHaveBeenCalled();expect(result).toMatchObject({success:false,blocked:true});}
});
