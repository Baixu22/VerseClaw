import {spawnSync} from 'node:child_process';
const root='D:/ClawX-work/worktrees/long-session-program-r2';
const files=[
  'electron/services/session-activity-api.ts',
  'src/components/chat/ResourceChip.tsx',
  'src/pages/Chat/index.tsx',
  'tests/e2e/long-session-coordination.spec.ts',
  'tests/unit/session-activity-background-read.test.ts',
];
const r=spawnSync(process.execPath,['C:/Users/27933/AppData/Roaming/npm/node_modules/pnpm/bin/pnpm.cjs','exec','eslint','--quiet','--',...files],{cwd:root,stdio:'inherit',windowsHide:true,env:{...process.env,TEMP:'D:/tmp',TMP:'D:/tmp'}}); process.exit(r.status??1);