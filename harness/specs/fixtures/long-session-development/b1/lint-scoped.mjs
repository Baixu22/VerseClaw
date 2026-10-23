import fs from 'node:fs';import {execFileSync,spawnSync} from 'node:child_process';
const root='D:/ClawX-work/worktrees/long-session-program-r2';const base='3f7fda333';
const files=execFileSync('C:/Program Files/Git/cmd/git.exe',['diff','--name-only',base,'HEAD'],{cwd:root,encoding:'utf8'}).trim().split(/\r?\n/).filter(Boolean).filter(f=>/\.(ts|tsx|mjs|js)$/.test(f));
if(!files.length){console.log('no changed lint targets');process.exit(0)}
const pnpm='C:/Users/27933/AppData/Roaming/npm/node_modules/pnpm/bin/pnpm.cjs';const r=spawnSync(process.execPath,[pnpm,'exec','eslint','--quiet','--',...files],{cwd:root,encoding:'utf8',windowsHide:true,maxBuffer:20_000_000});if(r.stdout)process.stdout.write(r.stdout);if(r.stderr)process.stderr.write(r.stderr);process.exit(r.status??1);