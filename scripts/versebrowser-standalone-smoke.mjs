import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { parseArgs } from 'node:util';
import { createStandaloneFacade } from '@verse-claw/versebrowser/engine/standalone';
const { values } = parseArgs({ options: { output: { type: 'string' } }, allowPositionals: false });
const workspaceRoot = await mkdtemp(join(tmpdir(), 'versebrowser-hygiene-sdk-'));
const server = createServer((_req,res) => { res.writeHead(200, {'content-type':'text/html'}); res.end('<!doctype html><title>VB hygiene fixture</title><h1>Fixture</h1><input id="name" aria-label="Name"><button id="save" onclick="document.querySelector(\'#result\').textContent=\'Saved \'+document.querySelector(\'#name\').value">Save</button><p id="result">Pending</p>'); });
await new Promise(r=>server.listen(0,'127.0.0.1',r));
const url = `http://127.0.0.1:${server.address().port}`;
const receipt = {driven_by:'agent',actor:'codex',scope:'built package standalone upstream driver, NOT ClawX Main/Gateway/model',workspaceRoot,node:process.version,uv:process.versions.uv,calls:[]};
let facade;
async function check(action,pending) { const result=await pending; receipt.calls.push({action,result}); assert.equal(result.ok,true,JSON.stringify(result)); return result; }
try {
  const created=await createStandaloneFacade({backend:'upstream',workspaceRoot,allowedOrigins:[url]}); facade=created.facade; receipt.driver=created.driver;
  const opened=await check('open',facade.open({url,mode:'headless'}));
  const sessionId=opened.data.session.id;
  await check('snapshot',facade.snapshot(sessionId,{includeText:true}));
  await check('type',facade.type(sessionId,'#name','Agent proof'));
  await check('snapshot-after-type',facade.snapshot(sessionId));
  await check('click',facade.click(sessionId,'#save'));
  const snapshot=await check('snapshot-result',facade.snapshot(sessionId,{includeText:true}));
  assert.match(snapshot.content,/Saved Agent proof/);
  const verify=await check('verifyFlow',facade.verifyFlow({sessionId,expect:[{type:'text',selector:'#result',equals:'Saved Agent proof'}],screenshot:false}));
  assert.match(verify.content,/PASS/);
  await check('close',facade.close(sessionId));
  receipt.status='pass';
} catch(error) {receipt.status='fail';receipt.error=String(error.stack??error);process.exitCode=1;}
finally {
  if (facade) {
    receipt.dispose = await facade.dispose();
    if (!receipt.dispose.ok) { receipt.status = 'fail'; process.exitCode = 1; }
  }
  await new Promise(r => server.close(r));
  await writeFile(values.output ?? join(workspaceRoot, 'receipt.json'), JSON.stringify(receipt, null, 2));
}
console.log(JSON.stringify({status:receipt.status,driver:receipt.driver,workspaceRoot,error:receipt.error,calls:receipt.calls.map(x=>({action:x.action,ok:x.result.ok}))}));
