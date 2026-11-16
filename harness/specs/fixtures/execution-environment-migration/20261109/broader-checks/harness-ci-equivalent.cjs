const cp=require('node:child_process');
const fs=require('node:fs');
const path=require('node:path');
const root='D:/ClawX-work/session-task-unified-relay-20261109';
const steps=[
 ['harness-list','.', ['harness/src/cli.mjs','list']],
 ['harness-scenario','.', ['harness/src/cli.mjs','validate','--spec','harness/specs/scenarios/gateway-backend-communication.md']],
 ['harness-example','.', ['harness/src/cli.mjs','validate','--spec','harness/specs/tasks/fix-chat-history-gateway-timeout.example.md','--no-diff']],
 ['harness-plan','.', ['harness/src/cli.mjs','run','--spec','harness/specs/scenarios/gateway-backend-communication.md','--dry-run']],
 ['harness-units','.', ['node_modules/vitest/vitest.mjs','run','tests/unit/harness-specs.test.ts','tests/unit/harness-git.test.ts','tests/unit/harness-spec-lifecycle.test.ts','tests/unit/docs-index.test.ts','tests/unit/runtime-source-policy.test.ts','--maxWorkers=1']],
 ['spec-lifecycle','.', ['scripts/check-spec-lifecycle.mjs']],
 ['duplicates','.', ['scripts/check-duplicate-assets.mjs']],
 ['policy-docs','.', ['scripts/validate-policy-docs.mjs']],
 ['catalogs','openclaw_runtime', ['node_modules/tsx/dist/cli.mjs','../scripts/generate-catalogs.mjs','--check']],
 ['agent-dev-audit','.', ['scripts/agent-dev-audit.mjs']],
 ['evidence-refs','.', ['scripts/check-evidence-refs.mjs']],
 ['coverage-baseline','.', ['scripts/check-test-coverage-baseline.mjs']],
];
const report={driven_by:'agent',actor:'codex',script:JSON.parse(fs.readFileSync(path.join(root,'package.json'),'utf8')).scripts['harness:ci'],
 execution:'Direct installed Node entry points preserve the harness:ci sequence without dependency installation.',steps:[]};
for(const [name,cwd,args] of steps){
 console.log(JSON.stringify({step:name,command:[process.execPath,...args]}));
 const run=cp.spawnSync(process.execPath,args,{cwd:path.resolve(root,cwd),env:process.env,windowsHide:true,stdio:'inherit'});
 report.steps.push({name,command:[process.execPath,...args],exitCode:run.status,error:run.error?.message});
 fs.writeFileSync(path.join(__dirname,'harness-ci.steps.json'),JSON.stringify(report,null,2));
 if(run.status!==0){process.exitCode=run.status??1;break;}
}
