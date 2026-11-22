import type { ElectronApplication, Page } from '@playwright/test';
import { closeElectronApp, expect, getStableWindow, installIpcMocks, test } from './fixtures/electron';

const key=(module:string,action:string)=>JSON.stringify([module,action,null]);
const session='agent:main:main';
const root='D:/workspace/git-style';
const workspace={id:'git-style',name:'Git workspace',rootPath:root,agentId:'main',selectedAgentId:'main',activeSessionKey:session,
  agentBindings:{main:{workspaceId:'git-style',agentId:'main',sessionKey:session}},permissionMode:'acceptEdits',createdAt:1,updatedAt:1,state:{},sessionStates:{[session]:{}}};
const longPath='src/components/workspace/version-control/ReviewChanges.tsx';
const trees=[
  {path:root,branch:'main',head:'abc123def456',protection:'primary'},
  {path:'D:/workspace/git-style-feature-layout',branch:'codex/consistent-workspace-layout',head:'def456abcdef',protection:null},
  {path:'D:/workspace/git-style-active',branch:'codex/active-review',head:'dfe123abcdef',locked:true,protection:'locked'},
];
async function seed(app:ElectronApplication){
 const messages=[{id:'git-user',role:'user',content:'Review the workspace changes and the pending permissions.',timestamp:Date.now()/1000-20},
 {id:'git-answer',role:'assistant',content:'The review updates are ready.\n\n[Review pull request](https://github.com/example/desktop-workspace/pull/42)\n\n[Commit details](https://github.com/example/desktop-workspace/commit/abc123def456)',timestamp:Date.now()/1000}];
 await installIpcMocks(app,{gatewayStatus:{state:'running',gatewayReady:true,port:18789},gatewayRpcByMethod:{'sessions.list':{sessions:[{key:session,sessionId:'git-style',displayName:'Git UI review'}]},'chat.history':{messages}},hostApi:{
  [key('sessions','history')]:{success:true,messages,hasMore:false},
  [key('agents','list')]:{agents:[{id:'main',name:'Main',workspace:root}],defaultAgentId:'main'},
  [key('workspaces','list')]:{profiles:[workspace],activeWorkspaceId:workspace.id,activeWorkspace:workspace},
  [key('workspaces','getActive')]:{success:true,activeWorkspaceId:workspace.id,activeWorkspace:workspace},
  [key('workspaces','listSessionFolders')]:{folders:[],assignments:{}},
  [key('workspaces','saveState')]:{success:true},
  [key('taskLedger','sessionTask')]:{success:true,task:null,children:[]},
  [key('runtimeApprovals','list')]:{pending:[]},
  [key('git','status')]:{success:true,status:{isRepository:true,workspaceRoot:root,repoRoot:root,branch:'codex/consistent-workspace-layout',upstream:'origin/main',ahead:2,behind:1,clean:false,detached:false,hasConflicts:false,stagedCount:1,unstagedCount:1,untrackedCount:0,conflictedCount:0,changes:[
   {path:longPath,absolutePath:root+'/'+longPath,status:'M',staged:false,unstaged:true,untracked:false,conflicted:false,bucket:'unstaged',additions:18,deletions:4},
   {path:'docs/interaction-guidelines.md',absolutePath:root+'/docs/interaction-guidelines.md',status:'A',staged:true,unstaged:false,untracked:false,conflicted:false,bucket:'staged',additions:12,deletions:0},
  ]}},
  [key('git','branches')]:{success:true,branches:[{name:'codex/consistent-workspace-layout',current:true,commit:'abc123def456'},{name:'main',current:false,commit:'def456abcdef'}]},
  [key('git','log')]:{success:true,ref:'main',commits:[{hash:'abc123def456',shortHash:'abc123d',subject:'Keep workspace decisions visible beside the composer',author:'UI review',date:Date.now()-60000}]},
  [key('git','worktrees')]:{success:true,worktrees:trees},
  [key('git','stashList')]:{success:true,stashes:[]},
  [key('git','githubAuthStatus')]:{available:true,authenticated:false,hosts:[]},
  [key('git','fileDiff')]:{success:true,path:longPath,mode:'unstaged',patch:'diff --git a/'+longPath+' b/'+longPath+'\n-const placement = "timeline";\n+const placement = "composer";\n',original:'const placement = "timeline";\n',modified:'const placement = "composer";\n'},
  [key('git','reflog')]:{success:true,entries:[{hash:'abc123def4567890',shortHash:'abc123d',selector:'HEAD@{0}',subject:'commit: unify workspace review with the conversation decision surface',date:Date.now()}]},
  [key('permissions','approvals')]:{approvals:[
   {id:'audit-pending',workspaceId:workspace.id,sessionKey:'agent:main:previous',source:'git',risk:'dangerous',status:'pending',mode:'acceptEdits',command:'git push origin codex/consistent-workspace-layout',cwd:root,reason:'Confirm publishing the reviewed branch.',requestedAt:Date.now()-30000},
   {id:'audit-done',workspaceId:workspace.id,sessionKey:'agent:main:previous',source:'terminal',risk:'write',status:'approved',mode:'acceptEdits',command:'node --test tests/workspace-layout.test.mjs',cwd:root,requestedAt:Date.now()-90000},
  ]},
  [key('sessionStorage','snapshot')]:{success:true,measuredAt:new Date().toISOString(),applicationMemoryBytes:240*1024*1024,sessions:[],worktrees:trees.map((tree,index)=>({...tree,repositoryWorkspaceId:workspace.id,repositoryName:'Desktop workspace',workspaceIds:[workspace.id],disk:{bytes:(index+1)*16*1024*1024,partial:false}}))},
  [key('sessionStorage','removeWorktree')]:{success:false,approvalRequired:true,approval:{id:'remove-fixture',workspaceId:workspace.id,source:'git',risk:'dangerous',status:'pending',mode:'acceptEdits',requestedAt:Date.now()}},
  [JSON.stringify(['sessionStorage','removeWorktree',{approvalId:'remove-fixture',path:trees[1].path,workspaceId:workspace.id}])]:{success:false,reason:'The checkout is in use. Close its resources and retry.'},
  [key('permissions','decideApproval')]:{success:true},
 }});
}
async function settle(page:Page){await page.evaluate(()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve))));}

for(const theme of ['light','dark'] as const){
 test(`Git surfaces retain complete content and clear actions in ${theme}`,async({launchElectronApp},info)=>{
  const app=await launchElectronApp({skipSetup:true,visualMode:true,theme});
  try{
   await seed(app);const page=await getStableWindow(app);await page.emulateMedia({reducedMotion:'reduce'});await page.reload();await page.setViewportSize({width:1440,height:900});
   await expect(page.locator('.git-link-card')).toHaveCount(2);await settle(page);
   await page.screenshot({path:info.outputPath(`conversation-${theme}.png`)});
   await page.getByTestId('composer-git-review').click();const panel=page.getByTestId('workspace-git-panel');
   await expect(panel.getByTestId('monaco-diff-viewer')).toBeVisible();await settle(page);
   await expect(panel.getByTestId('workspace-git-diff')).toBeInViewport();
   await expect(panel.getByRole('button',{name:'Stage',exact:true})).toBeInViewport();
   await page.screenshot({path:info.outputPath(`review-${theme}.png`)});
   await panel.getByTestId('workspace-git-history').locator('summary').click();
   await expect(panel.getByTestId('workspace-git-commit-row')).toContainText('Keep workspace decisions');
   await panel.getByTestId('workspace-git-history').locator('summary').click();
   await panel.getByTestId('workspace-git-tool-drawer').locator(':scope > summary').click();
   const tabs=panel.getByTestId('workspace-git-tool-tabs');
   const protectedRow=panel.getByTestId('workspace-git-worktree-row').filter({hasText:'codex/active-review'});
   await expect(protectedRow.getByRole('button',{name:'Remove',exact:true})).toBeDisabled();
   await panel.getByTestId('workspace-git-create-worktree').locator('summary').click();
   await panel.getByPlaceholder('Branch for worktree').fill('codex/new-review');
   await expect(panel.getByTestId('workspace-git-worktree-target')).toContainText('git-style-codex-new-review');
   await settle(page);await page.screenshot({path:info.outputPath(`worktree-tools-${theme}.png`)});
   await tabs.getByRole('button',{name:'Commit',exact:true}).click();
   await panel.getByPlaceholder('Commit message').fill('Unify workspace review surfaces');await settle(page);
   await page.screenshot({path:info.outputPath(`commit-${theme}.png`)});
   await panel.getByTestId('workspace-git-tool-drawer').locator(':scope > summary').click();
   await page.setViewportSize({width:640,height:800});await settle(page);
   expect(await panel.evaluate(el=>el.scrollWidth<=el.clientWidth+1)).toBe(true);
   await expect(panel.getByRole('button',{name:'Stage',exact:true})).toBeInViewport();
   await page.screenshot({path:info.outputPath(`review-narrow-${theme}.png`)});
   await page.setViewportSize({width:1440,height:900});
   await page.getByTestId('artifact-panel-new-tab').click();await page.getByTestId('artifact-panel-new-tab-audit').click();
   const audit=page.getByTestId('workspace-audit-panel');await expect(audit.getByTestId('workspace-audit-git-row')).toBeVisible();
   await audit.getByTestId('workspace-audit-search').fill('publishing');
   await expect(audit.getByTestId('workspace-audit-approval-row')).toHaveCount(1);
   const summary=audit.getByTestId('workspace-audit-approval-row').locator('summary');await summary.focus();await page.keyboard.press('Enter');
   await audit.getByRole('button',{name:'Copy details',exact:true}).click();
   expect(await app.evaluate(({clipboard})=>clipboard.readText())).toContain('git push origin codex/consistent-workspace-layout');
   await settle(page);await page.screenshot({path:info.outputPath(`audit-search-${theme}.png`)});
   await audit.getByRole('button',{name:'Clear search',exact:true}).click();
   await audit.getByTestId('workspace-audit-filter-pending').click();await expect(audit.getByTestId('workspace-audit-approval-row')).toHaveCount(1);
   await audit.getByTestId('workspace-audit-filter-all').click();await settle(page);
   await page.screenshot({path:info.outputPath(`audit-${theme}.png`)});
   await page.evaluate(()=>{location.hash='#/settings/storage';});
   const storage=page.getByTestId('storage-page');await expect(storage.getByTestId('storage-worktrees')).toBeVisible();
   await storage.getByTestId('storage-worktree-filter-removable').click();
   await expect(storage.getByTestId('storage-worktrees').locator('.sp-row')).toHaveCount(1);
   await storage.getByRole('button',{name:'Remove',exact:true}).click();await expect(page.getByTestId('storage-confirm')).toBeVisible();await settle(page);
   await page.screenshot({path:info.outputPath(`worktree-remove-${theme}.png`)});
   await page.getByTestId('storage-confirm').click();
   await expect(page.getByRole('dialog').getByRole('alert')).toContainText('The checkout is in use');
   await expect(page.getByTestId('storage-confirm')).toBeVisible();
   await page.screenshot({path:info.outputPath(`worktree-retry-${theme}.png`)});
   await page.getByRole('button',{name:'Cancel',exact:true}).click();
   await storage.getByTestId('storage-worktree-filter-protected').click();await expect(storage.getByTestId('storage-worktrees').locator('.sp-row')).toHaveCount(2);
   await storage.getByTestId('storage-worktree-filter-all').click();await settle(page);
   await storage.getByTestId('storage-worktrees').scrollIntoViewIfNeeded();
   await page.screenshot({path:info.outputPath(`worktree-management-${theme}.png`)});
   await page.setViewportSize({width:640,height:800});await settle(page);
   await storage.getByTestId('storage-worktrees').scrollIntoViewIfNeeded();
   expect(await storage.evaluate(el=>el.scrollWidth<=el.clientWidth+1)).toBe(true);
   await page.screenshot({path:info.outputPath(`worktree-management-narrow-${theme}.png`)});
   await info.attach('journey',{body:JSON.stringify({driven_by:'agent',theme,source:'Real Electron with controlled host responses',checks:['GitHub cards','review and diff','history disclosure','protected worktree','create path preview','commit form','audit search/copy/filter','storage filter/cancel','narrow layout']}),contentType:'application/json'});
  }finally{await closeElectronApp(app);}
 });
}
