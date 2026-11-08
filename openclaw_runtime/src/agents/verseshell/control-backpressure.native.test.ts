import { createHash } from "node:crypto";
import { spawn, execFileSync } from "node:child_process";
import { mkdtemp, readFile, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { VerseShellProcessManager } from "./process-manager.js";
import { startGovernedVerseShellProcess, executeGovernedVerseShellProcessObserved } from "./governed-process.js";
import { queryGovernedVerseShellResult, createReadonlyVerseShellProcessConfig } from "./governed-exec.js";

const binary = process.env.VERSESHELL_CONTROL_BINARY;
const live = process.platform === "win32" && Boolean(binary);
const alive = (pid: number) => { try { process.kill(pid, 0); return true; } catch { return false; } };
async function setup() {
  const manifest = JSON.parse(await readFile(path.resolve("../resources/verseshell/manifest.json"), "utf8"));
  const hash = createHash("sha256").update(await readFile(binary!)).digest("hex");
  expect(hash).toBe(manifest.artifacts["win32-x64"].sha256);
  const root = await mkdtemp(path.join(process.env.PROCESS_CONTROL_NATIVE_ROOT ?? tmpdir(), "tf0836-native-"));
  const user = execFileSync("whoami", [], { encoding: "utf8", windowsHide: true }).trim();
  // The executor inherits a restricted token: the isolated fixture grants its
  // actual user Modify explicitly, matching the existing native-limit harness.
  execFileSync("icacls", [root, "/grant", `${user}:(OI)(CI)M`], { windowsHide: true });
  const pids: number[] = [];
  const manager = new VerseShellProcessManager({ resolveBinary: () => ({ path: binary!, source: "verified-bundled", verified: true }),
    spawnProcess: (bin, args, options) => { const child = spawn(bin, args, options); pids.push(child.pid!); return child as never; } });
  const env = { VERSESHELL_RUNTIME_VERSION: manifest.crate.version, VERSESHELL_SERVER_PROTOCOL: manifest.protocol.expected_server_protocol,
    VERSESHELL_OPERATION_CATALOG_DIGEST: manifest.protocol.operation_catalog_digest, VERSESHELL_OPERATION_CATALOG_COUNT: String(manifest.protocol.operation_catalog_count),
    VERSESHELL_AE_SHA256: hash, VERSESHELL_OS_SHELL: "powershell" };
  const processEnv = Object.fromEntries(["PATH","SystemRoot","SystemDrive","ComSpec","PATHEXT","TEMP","TMP","APPDATA","windir"].flatMap(k => process.env[k] ? [[k,process.env[k]!]] : []));
  return { root, pids, manager, env, processEnv, hash, fixtureAclUser: user };
}
async function report(name: string, value: unknown) {
  if (process.env.PROCESS_CONTROL_REPORT_DIR) await writeFile(path.join(process.env.PROCESS_CONTROL_REPORT_DIR, name + ".json"), JSON.stringify({ driven_by: "agent", actor: "codex", value }, null, 2));
}

describe.runIf(live)("verified native process control", () => {
  it("controls two live processes during polls and reads bounded artifacts after exit", async () => {
    const f = await setup(); const script = path.join(f.root, "child.cjs"); const grandchildren = path.join(f.root, "grandchildren.txt");
    await writeFile(script, `const fs=require('node:fs');const {spawn}=require('node:child_process');const child=spawn(process.execPath,['-e','setInterval(()=>{},1000)'],{windowsHide:true});fs.appendFileSync(${JSON.stringify(grandchildren)},child.pid+'\n');console.log('READY');process.stdin.on('data',b=>{if(b.toString().includes('exit')){child.kill();process.exit(0)}else console.log('INPUT:'+b)});setInterval(()=>{},1000);`);
    const options = { command: "native-control", argv: [process.execPath, script], cwd: f.root, processEnv: f.processEnv,
      timeoutMs: 20000, maxOutputBytes: 16384, usePty: false, agentId: "control-agent", sessionId: "control-session",
      hostPolicyApproved: true, runtimeEnv: f.env, manager: f.manager };
    let output = ""; const controls: Array<{ kind: string; ms: number }> = [];
    try {
      const first = await startGovernedVerseShellProcess({ ...options, onStdout: chunk => { output += chunk; } });
      const second = await startGovernedVerseShellProcess({ ...options, onStdout: chunk => { output += chunk; } });
      await new Promise(resolve => setTimeout(resolve, 500));
      const writeAt = performance.now(); await new Promise<void>((resolve,reject) => second.stdin.write("ping\n", error => error ? reject(error) : resolve()));
      controls.push({ kind: "stdin", ms: performance.now()-writeAt });
      const killAt = performance.now(); await first.kill("agent_abort"); controls.push({ kind:"kill", ms:performance.now()-killAt });
      await first.wait(); expect(alive(second.pid)).toBe(true);
      await new Promise<void>((resolve,reject) => second.stdin.write("exit\n", error => error ? reject(error) : resolve())); await second.wait();
      expect(controls.every(c=>c.ms<5000)).toBe(true); expect(output).toContain("INPUT:ping");
      const flood = path.join(f.root, "flood.cjs"); await writeFile(flood, `process.stdout.write('汉'.repeat(200000));process.stderr.write('end-marker');`);
      const result = await executeGovernedVerseShellProcessObserved({ ...options, argv:[process.execPath,flood], maxOutputBytes:32768 });
      expect(Buffer.byteLength(result.stdout)+Buffer.byteLength(result.stderr)).toBeLessThanOrEqual(32768);
      const artifacts = result.observation.data?.artifacts as string[]; expect(artifacts.length).toBeGreaterThan(0);
      const reads = [];
      for (const handle of artifacts) reads.push(await queryGovernedVerseShellResult({ cwd:f.root, agentId:options.agentId, env:f.env,
        manager:f.manager, handle, mode:"head", lines:2 }));
      expect(reads.every(row=>row.ok)).toBe(true);
      await f.manager.shutdownAll();
      const children = (await readFile(grandchildren,"utf8")).trim().split(/\s+/).map(Number); expect(children.every(pid=>!alive(pid))).toBe(true);
      expect(f.pids.every(pid=>!alive(pid))).toBe(true);
      await report("native-control", { binarySha256:f.hash, controls, output, result:{exitCode:result.exitCode,stdoutBytes:Buffer.byteLength(result.stdout),stderrBytes:Buffer.byteLength(result.stderr),artifacts,counts:result.observation.data?.output_bytes},artifactReads:reads,ownedPids:f.pids,grandchildren:children,remaining:0 });
    } finally { await f.manager.shutdownAll(); await report("native-workspace",{root:f.root,pids:f.pids}); }
  },120000);

  it("compares CLI, batch, persistent server and native reads on the same file", async () => {
    const f=await setup();const target=path.join(f.root,"fixture.txt");await writeFile(target,"same-work\n".repeat(100));
    const child=path.join(f.root,"read.cjs");await writeFile(child,`const fs=require('node:fs');const n=Number(process.argv[3]);let value;for(let i=0;i<n;i++)value=fs.readFileSync(process.argv[2],'utf8');console.log(JSON.stringify({value,rss:process.memoryUsage().rss}));`);
    const results:Array<Record<string,unknown>>=[];
    try {
      const config=createReadonlyVerseShellProcessConfig({cwd:f.root,agentId:"read-agent",env:f.env,timeoutMs:5000});
      const client=await f.manager.getClient(config);
      for (const order of [["cli","batch","server","native"],["native","server","batch","cli"],["native","server","batch","cli"],["cli","batch","server","native"]]) {
        for (const mode of order) {
          const start=performance.now();let spawned=0;let rss=process.memoryUsage().rss;let text="";
          if (mode==="cli" || mode==="batch") {
            const iterations=mode==="cli"?8:1;
            for(let i=0;i<iterations;i++){ const row=JSON.parse(execFileSync(process.execPath,[child,target,mode==="cli"?"1":"8"],{encoding:"utf8",windowsHide:true}));text=row.value;rss=row.rss;spawned++; }
          } else if(mode==="server") {
            for(let i=0;i<8;i++){ const row=await client.execute("file.view",{path:"fixture.txt"});expect(row.ok).toBe(true);text=JSON.stringify(row.data); }
          } else for(let i=0;i<8;i++)text=await readFile(target,"utf8");
          expect(text).toContain("same-work");results.push({mode,reads:8,durationMs:performance.now()-start,spawned,rssBytes:rss,
            memoryScope:mode==="cli"||mode==="batch"?"child self-reported RSS":"host process RSS",persistentExecutorPids:mode==="server"?[...f.pids]:[]});
        }
      }
      await f.manager.shutdownAll();expect(f.pids.every(pid=>!alive(pid))).toBe(true);
      await report("read-comparison",{binarySha256:f.hash,results,decision:"Retain existing typed executor and native filesystem paths; no new generic resident CLI proxy",remaining:0});
    } finally {await f.manager.shutdownAll();await rm(f.root,{recursive:true,force:true});}
  },120000);
});
