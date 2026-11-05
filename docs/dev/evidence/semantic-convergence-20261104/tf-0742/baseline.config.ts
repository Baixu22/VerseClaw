import {execFileSync} from 'node:child_process';
import {createHash} from 'node:crypto';
import {writeFileSync} from 'node:fs';
import base from 'D:/ClawX-work/semantic-convergence-20261104/vitest.config.ts';
const root='D:/ClawX-work/semantic-convergence-20261104',ref='d8b5f93b9ac33b04b5d44c197e11a27b95d92dce',paths=["openclaw_runtime/src/runtime-core/memory-persistence.ts","openclaw_runtime/src/runtime-core/memory-proposal-shadow.ts","openclaw_runtime/src/runtime-core/memory-runtime-integration.ts","openclaw_runtime/src/runtime-core/memory-self-edit-tools.ts","openclaw_runtime/src/runtime-core/memory-store.ts"];
const originals=Object.fromEntries(paths.map(p=>[p,execFileSync('git',['show',ref+':'+p],{cwd:root,encoding:'utf8',windowsHide:true})]));
const loaded:Record<string,string>={};
export default {...base,cacheDir:'D:/tmp/tf0742-frozen-vite',test:{...base.test,include:['tests/unit/memory-atomic-update.test.ts']},plugins:[{name:'frozen-memory-source',enforce:'pre' as const,load(id:string){const normalized=id.split('?')[0].replaceAll('\\','/');const p=paths.find(p=>normalized.endsWith('/'+p));if(!p)return;const code=originals[p];loaded[p]=createHash('sha256').update(code).digest('hex');writeFileSync('D:/tmp/tf0742-frozen-loaded.json',JSON.stringify({ref,mappedPaths:paths,loaded},null,2));return code;}},...(base.plugins??[])]};
