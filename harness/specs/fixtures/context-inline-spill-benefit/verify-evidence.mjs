import {readFileSync,readdirSync} from 'node:fs';
import {dirname,join,relative,resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {createHash} from 'node:crypto';
import {gunzipSync} from 'node:zlib';
import assert from 'node:assert/strict';
const root=resolve(process.argv[2]??dirname(fileURLToPath(import.meta.url)));
const hash=b=>createHash('sha256').update(b).digest('hex');
// Archives may store text-block arrays; mirror stableStringifyContextFamily's
// sorted JSON encoding from shared/types/context-item.ts for parsed JSON values.
const stable=v=>Array.isArray(v)?v.map(stable):v&&typeof v==='object'?Object.fromEntries(Object.keys(v).sort().map(k=>[k,stable(v[k])])):v;
const walk=p=>readdirSync(p,{withFileTypes:true}).flatMap(e=>e.isDirectory()?walk(join(p,e.name)):[join(p,e.name)]);
const files=walk(root).filter(p=>!p.endsWith('SHA256SUMS')).map(p=>relative(root,p).replaceAll('\\','/')).sort();
const lines=readFileSync(join(root,'SHA256SUMS'),'utf8').trim().split(/\r?\n/);
const listed=lines.map(line=>{const [digest,path]=line.split('  ');assert.equal(hash(readFileSync(join(root,path))),digest,path);return path}).sort();
assert.deepEqual(listed,files,'manifest must cover every file except SHA256SUMS');
let credentialHits=0,archiveCount=0;
const archiveMaps={};
for(const file of files){
 const bytes=readFileSync(join(root,file));
 const txt=(file.endsWith('.gz')?gunzipSync(bytes):bytes).toString('utf8');
 credentialHits+=(txt.match(/\bsk-[A-Za-z0-9_-]{16,}\b/g)??[]).length;
 if(file.endsWith('archives.jsonl.gz')){
  const mode=file.split('/')[0];archiveMaps[mode]=new Map();
  for(const line of txt.trim().split('\n')){
   const entry=JSON.parse(line),archive=JSON.parse(entry.content);
   const payload=typeof archive.payload==='string'?archive.payload:JSON.stringify(stable(archive.payload));
   assert.equal(archive.handle.checksum,'sha256:'+hash(Buffer.from(payload)),entry.file);
   assert.equal(archive.handle.byteLength,Buffer.byteLength(payload),entry.file);
   archiveMaps[mode].set(archive.handle.uri,archive.handle);archiveCount++;
  }
 }
}
for(const mode of ['deterministic','live']){
 const rows=JSON.parse(readFileSync(join(root,mode,'runs.json'),'utf8')).records;
 for(const row of rows){const h=archiveMaps[mode].get(row.archive.uri);assert(h,row.archive.uri);assert.equal(h.checksum,row.archive.checksum);assert.equal(h.byteLength,row.archive.byteLength)}
 const scan=JSON.parse(readFileSync(join(root,mode,'credential-scan.json'),'utf8'));assert.equal(scan.hits,0);
}
assert.equal(credentialHits,0,'credential scan');
const scan=JSON.parse(readFileSync(join(root,'credential-scan.json'),'utf8'));assert.equal(scan.hits,0);assert.equal(scan.passed,true);
console.log(JSON.stringify({driven_by:'agent',actor:'codex-inline-spill-benefit-r2',files:files.length,archiveCount,sha256Mismatches:0,credentialHits,b7_evidence:true}));
