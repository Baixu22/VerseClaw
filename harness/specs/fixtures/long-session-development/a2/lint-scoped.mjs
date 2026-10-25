import fs from 'node:fs';
import { execFileSync, spawnSync } from 'node:child_process';
const root='D:/ClawX-work/worktrees/long-session-program-r2';
const base='f95530a0b';
const files=execFileSync('C:/Program Files/Git/cmd/git.exe',['diff','--name-only',base,'HEAD'],{cwd:root,encoding:'utf8'}).trim().split(/\r?\n/).filter(Boolean).filter(file=>/\.(ts|tsx|mjs|js)$/.test(file));
if(files.length===0){console.log('no changed lint targets');process.exit(0);}
const pnpm='C:/Users/27933/AppData/Roaming/npm/node_modules/pnpm/bin/pnpm.cjs';
const result=spawnSync(process.execPath,[pnpm,'exec','eslint','--quiet','--',...files],{cwd:root,encoding:'utf8',windowsHide:true,maxBuffer:20_000_000});
if(result.stdout)process.stdout.write(result.stdout);
if(result.stderr)process.stderr.write(result.stderr);
process.exit(result.status??1);
