import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { pathToFileURL } from 'node:url';
import ts from 'typescript';

const PROBE_TIMEOUT_MS = 15000;
const forbiddenIdentifiers = new Set(['process', 'globalThis', 'global', 'require', 'eval', 'Function']);
const pathMethods = new Set(['join', 'resolve', 'dirname', 'basename', 'extname', 'normalize', 'relative', 'isAbsolute', 'parse', 'format', 'toNamespacedPath']);

/** The oracle executes the actual pinned declaration, with controlled I/O where
 * its owner normally supplies workspace/RPC/page state. No participant output
 * is used to derive expected results. */
export function codeDeclaration(source, symbol) {
  const file = ts.createSourceFile('subject.ts', source, ts.ScriptTarget.Latest, true);
  assert.equal(file.parseDiagnostics.length, 0, 'task source cannot be parsed');
  for (const statement of file.statements) {
    if ((ts.isFunctionDeclaration(statement) || ts.isClassDeclaration(statement)) && statement.name?.text === symbol) {
      return { text: statement.getText(file), start: statement.getStart(file), end: statement.end };
    }
    if (ts.isVariableStatement(statement) && statement.declarationList.declarations.some(d => ts.isIdentifier(d.name) && d.name.text === symbol)) {
      return { text: statement.getText(file), start: statement.getStart(file), end: statement.end };
    }
  }
  throw new Error(`Pinned declaration missing: ${symbol}`);
}

function assertParticipantAuthorityFree(text) {
  const file = ts.createSourceFile('participant.ts', text, ts.ScriptTarget.Latest, true);
  const forbidden = node => {
    if (ts.isCallExpression(node) && node.expression.kind === ts.SyntaxKind.ImportKeyword) return 'dynamic import';
    if (ts.isIdentifier(node) && forbiddenIdentifiers.has(node.text)) return node.text;
    if (ts.isPropertyAccessExpression(node) && node.name.text === 'constructor') return 'constructor';
    if (ts.isElementAccessExpression(node) && ts.isStringLiteralLike(node.argumentExpression)
      && node.argumentExpression.text === 'constructor') return 'constructor';
    return undefined;
  };
  const visit = node => {
    const authority = forbidden(node);
    assert(!authority, `participant introduced forbidden executable authority: ${authority}`);
    ts.forEachChild(node, visit);
  };
  visit(file);
}

const controlledOwners = {
  scope: `const fixture=()=>globalThis.__ragProbeCase;
const realpath=async value=>value, expandPath=value=>value;
const getActiveWorkspaceProfile=async()=>fixture().workspace;
const getPersistedCoordinatorBinding=async()=>fixture().binding??null;`,
  bounded: `const fixture=()=>globalThis.__ragProbeCase;
const record=v=>v!==null&&typeof v==='object'&&!Array.isArray(v);
const isOwnerReadSnapshotV1=()=>false;
const lexicalOverlapScore=(q,text)=>text.toLowerCase().includes(q.toLowerCase())?1:0;
const retrieveSelectedSourceSetEvidence=async input=>{const first=await input.readPage();return{sources:first.status==='active'?[{readRange:{truncated:first.truncated}}]:[]};};`,
};

function projection(source, spec, supportingSources) {
  const target = codeDeclaration(source, spec.symbol);
  const declarations = [target.text];
  for (const name of spec.helpers ?? []) declarations.push(codeDeclaration(source, name).text);
  for (const support of spec.support ?? []) {
    assert(supportingSources?.[support.path], `pinned supporting source missing: ${support.path}`);
    for (const name of support.symbols) declarations.push(codeDeclaration(supportingSources[support.path], name).text);
  }
  assertParticipantAuthorityFree(declarations.join('\n'));
  const transpiled = ts.transpileModule([...declarations, controlledOwners[spec.mode] ?? ''].join('\n'), {
    compilerOptions: { target: ts.ScriptTarget.ES2023, module: ts.ModuleKind.CommonJS, verbatimModuleSyntax: false }, reportDiagnostics: true,
  });
  assert(!transpiled.diagnostics?.some(d => d.category === ts.DiagnosticCategory.Error), 'task declaration cannot be transpiled');
  let yamlPath;
  if (spec.builtins?.includes('yaml')) {
    const require = createRequire(import.meta.url);
    yamlPath = require.resolve('yaml');
  }
  return { code: transpiled.outputText, builtins: new Set(spec.builtins ?? []), yamlPath };
}

function probeDriver(selected, spec, cases, platform) {
  const needsPath = selected.builtins.has('path'), needsCrypto = selected.builtins.has('crypto'), yamlUrl = selected.yamlPath
    ? pathToFileURL(selected.yamlPath).href : null;
  return `const vm=await import('node:vm');
const nativePath=(await import('node:path')).default;
const pathModule=Object.assign({},${platform === 'win32' ? 'nativePath.win32' : 'nativePath.posix'}, {win32:nativePath.win32,posix:nativePath.posix});
const {createHash}=await import('node:crypto');
const permissionFs=process.getBuiltinModule('node:fs');
const denied=operation=>{try{operation();return false}catch(error){return error?.code==='ERR_ACCESS_DENIED'}};
if(!denied(()=>permissionFs.readFileSync(process.execPath)))throw new Error('probe filesystem reads are not permission denied');
if(!denied(()=>permissionFs.writeFileSync(${JSON.stringify(join(tmpdir(), `project-rag-probe-${process.pid}-${Date.now()}`))},'forbidden')))throw new Error('probe filesystem writes are not permission denied');
if(process.permission.has('child')||process.permission.has('worker'))throw new Error('probe spawned with executable permissions');
if(process.env.RAG_ORACLE_CANARY!==undefined)throw new Error('probe inherited the parent environment');
${yamlUrl ? `const YAML=(await import(${JSON.stringify(yamlUrl)})).default;` : 'const YAML=null;'}
const cases=${JSON.stringify(cases)};
const selected=${JSON.stringify(selected.code)};
const mode=${JSON.stringify(spec.mode)};
const symbol=${JSON.stringify(spec.symbol)};
const outputs=[];
for(const item of cases){
 const hashes=new Map();let nextHash=1;
 const send=value=>JSON.stringify(value===undefined?{__ragUndefined:true}:value);
 const bridge=(name,args)=>{try{
  let result;
  if(name==='path'){
   const implementation=args[0]==='win32'?pathModule.win32:args[0]==='posix'?pathModule.posix:pathModule;
   if(!${JSON.stringify([...pathMethods])}.includes(args[1]))throw new Error('path method denied');
   result=implementation[args[1]](...args[2]);
  }else if(name==='path.sep'){
   result=args[0]==='win32'?pathModule.win32.sep:args[0]==='posix'?pathModule.posix.sep:pathModule.sep;
  }else if(name==='crypto.create'){
   const token=nextHash++;hashes.set(token,createHash(String(args[0])));result=token;
  }else if(name==='crypto.update'){
   const value=args[1];hashes.get(args[0]).update(typeof value==='string'?value:Buffer.from(value));result=true;
  }else if(name==='crypto.digest'){
   const hash=hashes.get(args[0]);hashes.delete(args[0]);result=hash.digest(args[1]);
  }else if(name==='yaml.parse'){
   result=YAML.parse(String(args[0]));
  }else throw new Error('controlled dependency denied');
  return send(result);
 }catch{throw new Error('controlled dependency denied');}};
 const sandbox=Object.create(null);
 sandbox.__ragBridge=bridge;
 const context=vm.createContext(sandbox,{codeGeneration:{strings:false,wasm:false}});
 const bootstrap=\`'use strict';(()=>{
  const bridge=globalThis.__ragBridge;
  const call=(name,args)=>{try{const value=JSON.parse(bridge(name,args));return value?.__ragUndefined===true?undefined:value}catch{throw new Error('controlled dependency denied')}};
  delete globalThis.__ragBridge;
  const makePath=implementation=>Object.freeze({
  ${[...pathMethods].map(method => `${method}:(...args)=>call('path',[implementation,${JSON.stringify(method)},args])`).join(',\n  ')}
  });
  ${needsPath ? `const nativePath=makePath('native');const win32Path=makePath('win32');const posixPath=makePath('posix');
  globalThis.path=Object.freeze({...nativePath,sep:call('path.sep',['native']),win32:win32Path,posix:posixPath});
  globalThis.resolve=nativePath.resolve;globalThis.relative=nativePath.relative;globalThis.isAbsolute=nativePath.isAbsolute;
  globalThis.sep=globalThis.path.sep;globalThis.win32=win32Path;` : ''}
  ${needsCrypto ? `globalThis.createHash=algorithm=>{const token=call('crypto.create',[String(algorithm)]);const hash={};
  hash.update=function(value){call('crypto.update',[token,typeof value==='string'?value:Array.from(new Uint8Array(value.buffer,value.byteOffset,value.byteLength))]);return hash};
  hash.digest=encoding=>call('crypto.digest',[token,encoding]);return hash;};` : ''}
  ${yamlUrl ? `globalThis.YAML=Object.freeze({parse:value=>call('yaml.parse',[String(value)])});` : ''}
  globalThis.module={exports:{}};globalThis.exports=globalThis.module.exports;
 })();\`;
 vm.runInContext(bootstrap,context,{filename:'probe-bootstrap.js',timeout:${PROBE_TIMEOUT_MS}});
 vm.runInContext(selected+'\\nglobalThis.__ragSubject=globalThis.exports['+JSON.stringify(symbol)+'];if(globalThis.__ragSubject===undefined)globalThis.__ragSubject='+symbol+';',context,{filename:'subject.cjs',timeout:${PROBE_TIMEOUT_MS}});
 const invocation=mode==='deadline'?'__ragSubject(__ragProbeCase.local,__ragProbeCase.deadline,()=>__ragProbeCase.now)'
  :mode==='scope'?'__ragSubject({rpc:async method=>{if(method===\\'sessions.describe\\')return{session:__ragProbeCase.session};throw Error(\\'Unexpected method \\'+method);}},__ragProbeCase.selection??{})'
  :mode==='bounded'?'__ragSubject({ref:{id:\\'probe\\',path:\\'probe.md\\'},question:__ragProbeCase.question,read:async range=>__ragProbeCase.pages.find(p=>p.fromLine===(range.fromLine??1))})'
  :mode==='value'?'__ragSubject':'__ragSubject(...__ragProbeCase.args)';
 const script=\`(async()=>{const stringify=JSON.stringify;const normalize=value=>value===undefined?{undefined:true}:typeof value==='number'&&!Number.isFinite(value)?{nonfinite:String(value)}:JSON.parse(stringify(value));try{
  globalThis.__ragProbeCase=\${JSON.stringify(item)};
  const value=await (\${invocation});return stringify({value:normalize(value)});
 }catch(error){let name='Error',message='Probe failed',code=null;try{name=String(error.name);message=String(error.message);code=error.code??null}catch{}return stringify({error:{name,message,code}});}})()\`;
 const serialized=await vm.runInContext(script,context,{filename:'probe-case.js',timeout:${PROBE_TIMEOUT_MS}});
 outputs.push(JSON.parse(serialized));
}
console.log(JSON.stringify(outputs));`;
}
/** Execute one independent probe process. The fixed case inputs and reference
 * outputs live only in the evaluator directory. */
export function executeCodeProbe(source, spec, supportingSources, cases, platform = process.platform) {
  assert(['win32', 'darwin', 'linux'].includes(platform), 'Unknown pinned code-oracle platform');
  const selected = projection(source, spec, supportingSources);
  const driver = probeDriver(selected, spec, cases, platform);
  const permissions = ['--permission', '--disallow-code-generation-from-strings', '--disable-proto=throw'];
  if (selected.yamlPath) permissions.push(`--allow-fs-read=${dirname(selected.yamlPath)}`);
  const out = execFileSync(process.execPath, [...permissions, '--input-type=module', '-e', driver], {
    encoding: 'utf8', windowsHide: true, timeout: PROBE_TIMEOUT_MS, maxBuffer: 4 * 1024 * 1024,
    cwd: tmpdir(), env: {},
  });
  return JSON.parse(out);
}

export function stageCodeDefect(original, spec) {
  const selected = codeDeclaration(original, spec.symbol);
  assert.equal(selected.text.split(spec.defect.before).length, 2, 'ambiguous defect insertion');
  const changed = selected.text.replace(spec.defect.before, spec.defect.after);
  return original.slice(0, selected.start) + changed + original.slice(selected.end);
}

export function gradeCodeProbe(candidateSource, oracle) {
  const original = oracle.referenceSource;
  const expected = codeDeclaration(original, oracle.spec.symbol), actual = codeDeclaration(candidateSource, oracle.spec.symbol);
  assert.equal(candidateSource.slice(0, actual.start), original.slice(0, expected.start), 'out-of-scope code changed before declaration');
  assert.equal(candidateSource.slice(actual.end), original.slice(expected.end), 'out-of-scope code changed after declaration');
  const results = executeCodeProbe(candidateSource, oracle.spec, oracle.supportingSources, oracle.cases, oracle.platform);
  return { passed: JSON.stringify(results) === JSON.stringify(oracle.expected), caseCount: results.length, results,
    probeMode: oracle.spec.mode === 'scope' || oracle.spec.mode === 'bounded' ? 'pinned-function-with-controlled-owner-io' : 'pinned-runtime-declaration' };
}
