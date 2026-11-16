import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { writeFileSync } from 'node:fs';
import base from 'D:/ClawX-work/semantic-convergence-20261104/openclaw_runtime/test/vitest/vitest.agents-embedded-agent.config.ts';
const root='D:/ClawX-work/semantic-convergence-20261104';
const ref='7abbf58a3e1d4404f26076c54fd7ea00d75e26a3';
const paths=[
  'openclaw_runtime/src/context-engine/context-orchestrator.ts',
  'openclaw_runtime/src/context-engine/turn-injection-budget.ts',
  'openclaw_runtime/src/context-engine/context-final-snapshot.ts',
  'openclaw_runtime/src/agents/embedded-agent-runner/run/attempt.ts',
];
const originals=Object.fromEntries(paths.map(path=>[path,execFileSync('git',['show',`${ref}:${path}`],{cwd:root,encoding:'utf8',windowsHide:true})]));
const loaded: Record<string,string>={};
export default {...base,cacheDir:'D:/tmp/tf0738-baseline-vite',plugins:[{
  name:'frozen-node-baseline',enforce:'pre' as const,
  load(id:string){
    const normalized=id.split('?')[0].replaceAll('\\','/');
    const path=paths.find(path=>normalized.endsWith('/'+path));
    if(!path)return;
    const code=originals[path];
    loaded[path]=createHash('sha256').update(code).digest('hex');
    writeFileSync('D:/tmp/tf0738-baseline-loaded.json',JSON.stringify({ref,mappedPaths:paths,loaded},null,2));
    return code;
  },
},...(base.plugins??[])]};
