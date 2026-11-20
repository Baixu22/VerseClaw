// @vitest-environment node
import { spawn } from 'node:child_process';
import { createServer } from 'node:net';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { admitManagedProcess, configureManagedProcessCapacity, resetManagedProcessCapacity } from '../../openclaw_runtime/src/agents/verseshell/managed-process-capacity';
import { assertManagedPortsBindable, managedProcessReservations, reconcileManagedProcessReservations } from '../../openclaw_runtime/src/agents/verseshell/managed-process-reservation';
import { closeOpenClawStateDatabaseForTest } from '../../openclaw_runtime/src/state/openclaw-state-db';

describe('host shared managed process reservations',()=>{
 let root:string;
 beforeEach(()=>{root=mkdtempSync(path.join(tmpdir(),'terminal-resources-'));vi.stubEnv('OPENCLAW_STATE_DIR',root);});
 afterEach(()=>{resetManagedProcessCapacity();closeOpenClawStateDatabaseForTest();vi.unstubAllEnvs();rmSync(root,{recursive:true,force:true});});
 function worker(input:{limit:number;owner:string;port?:number}) {
  const child=spawn(process.execPath,['--import','tsx',path.resolve('tests/unit/fixtures/terminal-resource-worker.mts'),Buffer.from(JSON.stringify(input)).toString('base64')],{cwd:path.resolve('openclaw_runtime'),env:process.env,windowsHide:true,stdio:['pipe','pipe','pipe']});
  let stdout='',stderr='';child.stderr.on('data',b=>stderr+=String(b));
  const exit=new Promise<number|null>((resolve,reject)=>{child.once('exit',resolve);child.once('error',reject);});
  const ready=new Promise<Record<string,unknown>>((resolve,reject)=>{child.stdout.on('data',b=>{stdout+=String(b);if(stdout.includes('\n'))resolve(JSON.parse(stdout.slice(0,stdout.indexOf('\n'))));});child.once('error',reject);child.once('exit',()=>{if(!stdout.includes('\n'))reject(new Error(stderr));});});
  return {child,exit,ready};
 }
 it('shares the declared cap across independent runtime processes and releases only on owner completion',async()=>{
  const a=worker({limit:1,owner:'workspace-a'});const first=await a.ready;
  try{
   expect(first.ok).toBe(true);
   const b=worker({limit:1,owner:'workspace-b'});expect(await b.ready).toMatchObject({ok:false,reason:'capacity',live:1,limit:1});expect(await b.exit).toBe(0);
   a.child.stdin.end('release\n');expect(await a.exit).toBe(0);
   const c=worker({limit:1,owner:'workspace-c'});expect(await c.ready).toMatchObject({ok:true,live:1});c.child.stdin.end('release\n');expect(await c.exit).toBe(0);
   expect(managedProcessReservations()).toHaveLength(0);
  }finally{if(a.child.exitCode===null)a.child.kill();await a.exit;}
 });
 it('retains unknown occupancy and its port across runtime crash and restart',async()=>{
  const a=worker({limit:1,owner:'old-owner',port:29871});expect((await a.ready).ok).toBe(true);a.child.stdin.end('crash\n');expect(await a.exit).toBe(23);
  closeOpenClawStateDatabaseForTest();
  expect(managedProcessReservations()).toMatchObject([{owner:'old-owner',phase:'observed',ports:[29871]}]);
  const b=worker({limit:1,owner:'new-owner'});expect(await b.ready).toMatchObject({ok:false,reason:'capacity'});expect(await b.exit).toBe(0);
 });
 it('claims declared ports atomically without releasing another owner',()=>{
  configureManagedProcessCapacity({maxLiveProcesses:3});
  const a=admitManagedProcess({ports:[29872],owner:'a'});expect(a.ok).toBe(true);
  expect(()=>admitManagedProcess({ports:[29872],owner:'b'})).toThrow('E_PROCESS_PORT_RESERVED');
  expect(managedProcessReservations()).toHaveLength(1);
  if(a.ok)a.lease.release();
  const b=admitManagedProcess({ports:[29872],owner:'b'});expect(b.ok).toBe(true);if(b.ok)b.lease.release();
 });
 it('reconciles a durable native terminal receipt while retaining unknown dispatches',async()=>{
  configureManagedProcessCapacity({maxLiveProcesses:2});
  const ended=admitManagedProcess({owner:'ended'}),unknown=admitManagedProcess({owner:'unknown'});
  if(!ended.ok||!unknown.ok)throw new Error('Expected two reservations');
  ended.lease.markDispatched();ended.lease.markTerminal();unknown.lease.markDispatched();unknown.lease.markUnknown('lost receipt');
  const result=await reconcileManagedProcessReservations();
  expect(result).toEqual(expect.arrayContaining([{id:ended.lease.reservationId,outcome:'released',reason:'confirmed-terminal-or-never-dispatched'}]));
  expect(managedProcessReservations()).toHaveLength(1);expect(managedProcessReservations()[0].phase).toBe('unknown');
 });
 it('diagnoses an externally occupied TCP port without taking its process',async()=>{
  const server=createServer();await new Promise<void>(resolve=>server.listen(0,'127.0.0.1',resolve));
  const port=(server.address() as {port:number}).port;
  try{await expect(assertManagedPortsBindable([port])).rejects.toThrow('E_PROCESS_PORT_UNAVAILABLE');expect(server.listening).toBe(true);}
  finally{await new Promise<void>(resolve=>server.close(()=>resolve()));}
  await expect(assertManagedPortsBindable([port])).resolves.toBeUndefined();
 });
});
