import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, expect, it, vi } from 'vitest';
import { WebPreviewManager } from '../../electron/services/web-preview-manager';
import { TerminalSessionManager } from '../../electron/services/terminal-session-manager';
import type { WorkspaceProfile } from '../../shared/types/workspace';

const roots: string[]=[];
afterEach(()=>{vi.restoreAllMocks();for(const root of roots.splice(0))rmSync(root,{recursive:true,force:true});});
it.each([false,true])('closes an owned PTY after proxy startup fails and retains failed cleanup=%s', async failedCleanup=>{
 const root=mkdtempSync(path.join(tmpdir(),'preview-recovery-'));roots.push(root);writeFileSync(path.join(root,'package.json'),'{}');
 const workspace:WorkspaceProfile={id:'preview-owner',name:'Preview',rootPath:root,agentId:'main',activeSessionKey:'agent:main:preview',permissionMode:'fullAccess',createdAt:1,updatedAt:1,lastOpenedAt:1,state:{}};
 const terminal=new TerminalSessionManager();
 vi.spyOn(terminal,'open').mockReturnValue({sessionId:'owned-terminal',workspaceId:workspace.id,sessionKey:workspace.activeSessionKey,cwd:root,pid:123,status:'running',exitCode:null});
 const close=vi.spyOn(terminal,'close').mockResolvedValue({sessionId:null,workspaceId:null,sessionKey:null,cwd:null,pid:null,status:'idle',exitCode:null});
 if(failedCleanup)close.mockRejectedValueOnce(new Error('native owner has not confirmed exit'));
 const manager=new WebPreviewManager({terminalManager:terminal});
 vi.spyOn(manager as unknown as {startProxy:()=>Promise<never>},'startProxy').mockRejectedValue(new Error('proxy bind failed'));
 await expect(manager.start({workspace,expectedSessionId:'preview-generation',mode:'devServer',launchConfig:{mode:'devServer',name:'Manual server',command:'node server.cjs',cwd:root,source:'manual'}})).rejects.toThrow('proxy bind failed');
 expect(close).toHaveBeenCalledWith('owned-terminal','user-close',{workspaceId:workspace.id,sessionKey:workspace.activeSessionKey,expectedSessionId:'preview-generation'});
 expect(manager.status(workspace.id)).toMatchObject(failedCleanup?{status:'error',processSessionId:'owned-terminal'}:{status:'idle'});
 if(failedCleanup){await manager.stopForWorkspace(workspace.id,'user-close');expect(manager.status(workspace.id).status).toBe('idle');}
});
