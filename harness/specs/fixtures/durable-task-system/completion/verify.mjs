import {readFileSync,existsSync} from 'node:fs';
import {dirname,resolve,join} from 'node:path';
import {fileURLToPath} from 'node:url';
import {execFileSync} from 'node:child_process';
import {createHash} from 'node:crypto';
import assert from 'node:assert/strict';
const directory=dirname(fileURLToPath(import.meta.url));
const root=resolve(directory,'../../../../..');
const sha=data=>createHash('sha256').update(data).digest('hex');
const json=name=>JSON.parse(readFileSync(join(directory,name),'utf8'));
for(const row of readFileSync(join(directory,'SHA256SUMS'),'utf8').trim().split('\n')){
  const match=/^([a-f0-9]{64})  (.+)$/.exec(row);assert.ok(match,'Malformed checksum line');
  assert.equal(sha(readFileSync(join(directory,match[2]))),match[1],match[2]);
}
const source=json('source-manifest.json'),report=json('report.json'),checks=json('commands.json');
assert.equal(report.sourceCandidate,source.candidate);assert.equal(checks.candidate,source.candidate);
assert.ok(checks.records.length>=13&&checks.records.every(x=>x.status==='finished'&&x.exitCode===0));
for(const file of source.files){
  assert.equal(sha(execFileSync('git',['show',source.candidate+':'+file.path],{cwd:root,windowsHide:true,maxBuffer:32*1024*1024})),file.sha256,file.path);
  if(process.argv.includes('--working-tree'))assert.equal(sha(readFileSync(join(root,file.path))),file.sha256,file.path+' working tree');
}
for(const name of ['task-tests.json','gateway-tests.json','runtime-delegation.json','owner-regressions.json']){const tests=json(name);assert.equal(tests.numFailedTests,0,name);assert.equal(tests.numPassedTests,tests.numTotalTests,name);}
assert.equal(report.implementationAccepted,true);assert.equal(json('runtime-build.json').exitCode,0);assert.equal(json('types.json').success,true);
assert.equal(json('electron.json').stats.expected,3);assert.equal(json('electron.json').stats.unexpected,0);assert.equal(json('electron.json').stats.flaky,0);
const performance=json('concurrency-performance.json');assert.equal(performance.granted,1);assert.equal(performance.denied,15);assert.equal(performance.crashRecovery.exitCode,23);assert.equal(performance.crashRecovery.partialArtifactPreserved,true);
const live=json('live-continuity.json');assert.equal(live.results.protected.completed,6);assert.equal(live.results.protected.allFieldsPreserved,6);assert.equal(live.results.protected.schemaConformant,6);
const equivalent=json('evidence-source-equivalence.json');assert.equal(equivalent.targetCandidate,source.candidate);assert.ok(equivalent.records.every(x=>x.identical===true));
const page=json('pagination-readback.json');assert.deepEqual(page.pages,[50,55]);assert.deepEqual(page.renderedLanguages,['en','zh','ja','ru']);assert.ok(page.corruptDatabase);
assert.ok(json('acceptance-map.json').requirements.every(x=>x.status==='passed'&&x.evidence.every(file=>existsSync(join(directory,file))||existsSync(join(root,file)))));
console.log(JSON.stringify({passed:true,candidate:source.candidate,sourceFiles:source.files.length,tests:report.totalTests,electronJourneys:3,locales:4,checks:checks.records.length}));
