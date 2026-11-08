import { createHash } from "node:crypto";
import { spawn, execFileSync } from "node:child_process";
import { mkdtemp, readFile, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it, vi } from "vitest";
import { VerseShellProcessManager } from "./process-manager.js";
import { startGovernedVerseShellProcess, executeGovernedVerseShellProcessObserved } from "./governed-process.js";
import { queryGovernedVerseShellResult, createReadonlyVerseShellProcessConfig } from "./governed-exec.js";
import type { VerseShellAciClient } from "./aci-client.js";

const binary = process.env.VERSESHELL_CONTROL_BINARY;
const live = process.platform === "win32" && Boolean(binary);
const alive = (pid: number) => { try { process.kill(pid, 0); return true; } catch { return false; } };
async function setup() {
  const manifest = JSON.parse(await readFile(path.resolve("../resources/verseshell/manifest.json"), "utf8"));
  const hash = createHash("sha256").update(await readFile(binary!)).digest("hex");
  expect(hash).toBe(manifest.artifacts["win32-x64"].sha256);
  const root = await mkdtemp(path.join(process.env.PROCESS_CONTROL_NATIVE_ROOT ?? tmpdir(), "tf0836-native-"));
  const pids: number[] = [];
  const executorDiagnostics: Array<{ pid?: number; stderr: string; code?: number | null; signal?: string | null; environmentKeys: string[] }> = [];
  const manager = new VerseShellProcessManager({ resolveBinary: () => ({ path: binary!, source: "verified-bundled", verified: true }),
    spawnProcess: (bin, args, options) => {
      const child = spawn(bin, args, options); pids.push(child.pid!);
      const diagnostics: typeof executorDiagnostics[number] = { pid: child.pid, stderr: "", environmentKeys: Object.keys(options.env ?? {}).filter(k=>/^(systemroot|systemdrive|comspec|windir|path|pathext|appdata|localappdata|userprofile|temp|tmp)$/i.test(k)) };
      executorDiagnostics.push(diagnostics); child.stderr?.on("data", chunk => { diagnostics.stderr = (diagnostics.stderr + String(chunk)).slice(-4096); });
      child.once("exit", (code, signal) => { diagnostics.code=code; diagnostics.signal=signal; });
      return child as never;
    } });
  const clients = new Map<string, VerseShellAciClient>(); const getClient = manager.getClient.bind(manager);
  const timeline: Array<Record<string, unknown>> = [];
  manager.getClient = async config => {
    const client = await getClient(config); const execute = client.execute.bind(client);
    client.execute = async (op,args,options) => {
      const startedAt = Date.now();
      try { const result = await execute(op,args,options); timeline.push({op,startedAt,endedAt:Date.now(),state:result.data?.state,error:result.error?.code,processId:result.data?.process_id,key:client.processKey}); return result; }
      catch(error) {timeline.push({op,startedAt,endedAt:Date.now(),error:String(error),key:client.processKey});throw error;}
    };
    clients.set(client.processKey, client); return client;
  };
  const env = { VERSESHELL_RUNTIME_VERSION: manifest.crate.version, VERSESHELL_SERVER_PROTOCOL: manifest.protocol.expected_server_protocol,
    VERSESHELL_OPERATION_CATALOG_DIGEST: manifest.protocol.operation_catalog_digest, VERSESHELL_OPERATION_CATALOG_COUNT: String(manifest.protocol.operation_catalog_count),
    VERSESHELL_AE_SHA256: hash, VERSESHELL_OS_SHELL: "powershell" };
  // Python launches normalize Windows environment keys to uppercase; Vitest's
  // worker environment may then be case-sensitive. Preserve OS inputs by name.
  const hostEnv = new Map(Object.entries(process.env).map(([key,value]) => [key.toUpperCase(),value]));
  const processEnv = Object.fromEntries(["PATH","SystemRoot","SystemDrive","ComSpec","PATHEXT","TEMP","TMP","APPDATA","LOCALAPPDATA","USERPROFILE","windir"]
    .flatMap(key => { const value = hostEnv.get(key.toUpperCase()); return value ? [[key,value]] : []; }));
  expect(processEnv.SystemRoot).toBeTruthy(); expect(processEnv.ComSpec).toBeTruthy();
  return { root, pids, manager, env, processEnv, hash, clients, timeline, executorDiagnostics };
}
async function report(name: string, value: unknown) {
  if (process.env.PROCESS_CONTROL_REPORT_DIR) await writeFile(path.join(process.env.PROCESS_CONTROL_REPORT_DIR, name + ".json"), JSON.stringify({ driven_by: "agent", actor: "codex", value }, null, 2));
}

describe.runIf(live)("verified native process control", () => {
  it("controls two live processes during polls and reads bounded artifacts after exit", async () => {
    const f = await setup(); const script = path.join(f.root, "child.cjs"); const grandchildren = path.join(f.root, "grandchildren.txt");
    await writeFile(script, `const fs=require('node:fs');const {spawn}=require('node:child_process');const child=spawn(process.execPath,['-e','setInterval(()=>{},1000)'],{windowsHide:true});fs.appendFileSync(${JSON.stringify(grandchildren)},child.pid+String.fromCharCode(10));console.log('READY');process.stdin.on('data',b=>{if(b.toString().includes('exit')){child.kill();process.exit(0)}else console.log('INPUT:'+b)});setInterval(()=>{},1000);`);
    const options = { command: "native-control", argv: [process.execPath, script], cwd: f.root, processEnv: f.processEnv,
      timeoutMs: 20000, maxOutputBytes: 16384, usePty: false, agentId: "control-agent", sessionId: "control-session",
      hostPolicyApproved: true, runtimeEnv: f.env, manager: f.manager };
    let output = ""; const controls: Array<{ kind: string; ms: number }> = [];
    try {
      const first = await startGovernedVerseShellProcess({ ...options, onStdout: chunk => { output += chunk; } });
      const second = await startGovernedVerseShellProcess({ ...options, onStdout: chunk => { output += chunk; } });
      await vi.waitFor(() => expect(output.match(/READY/g)).toHaveLength(2), { timeout: 5000 });
      expect(alive(first.pid)).toBe(true); expect(alive(second.pid)).toBe(true);
      const pressure = async (handle: typeof first) => {
        const client = f.clients.get(handle.executorKey)!;
        const owner = { process_id: handle.processId, runtime_id: handle.runtimeId, agent_id: options.agentId, session_id: options.sessionId };
        const current = await client.execute("process.poll", { ...owner, cursor: 0, max_bytes: 65536, wait_ms: 0 });
        const cursor = (current.data?.output as { next_cursor: number }).next_cursor;
        const release = f.manager.retainProcess(handle.executorKey);
        return { release, requests: Array.from({ length: 8 }, () => client.execute("process.poll", { ...owner, cursor, max_bytes: 65536, wait_ms: 1000 }, { timeoutMs: 5000 })) };
      };
      const firstPressure = await pressure(first), secondPressure = await pressure(second);
      const writeAt = performance.now(); await new Promise<void>((resolve,reject) => second.stdin.write("ping\n", error => error ? reject(error) : resolve()));
      controls.push({ kind: "stdin", ms: performance.now()-writeAt });
      const killAt = performance.now(); await first.kill("agent_abort"); controls.push({ kind:"kill", ms:performance.now()-killAt });
      await first.wait(); expect(alive(second.pid)).toBe(true);
      expect((await Promise.all(firstPressure.requests)).every(row => row.ok)).toBe(true); await firstPressure.release();
      expect((await Promise.all(secondPressure.requests)).every(row => row.ok)).toBe(true); await secondPressure.release();
      await new Promise<void>((resolve,reject) => second.stdin.write("exit\n", error => error ? reject(error) : resolve())); await second.wait();
      expect(controls.every(c=>c.ms<5000)).toBe(true); expect(output).toContain("INPUT:ping");
      const flood = path.join(f.root, "flood.cjs"); await writeFile(flood, `process.stdout.write(Array.from({length:20000},(_,i)=>'line-'+i+':'+ 'x'.repeat(24)).join(String.fromCharCode(10)),()=>setTimeout(()=>process.stderr.write('end-marker'),100));`);
      const result = await executeGovernedVerseShellProcessObserved({ ...options, argv:[process.execPath,flood], maxOutputBytes:32768 });
      expect(Buffer.byteLength(result.stdout)+Buffer.byteLength(result.stderr)).toBeLessThanOrEqual(32768);
      expect(result.stderr).toContain("end-marker");
      const artifacts = result.observation.data?.artifacts as string[]; expect(artifacts.length).toBeGreaterThan(0);
      const reads = [];
      for (const handle of artifacts) {
        const query = { cwd:f.root, agentId:options.agentId, env:f.env, manager:f.manager, handle };
        const head = await queryGovernedVerseShellResult({ ...query, mode:"head", lines:10 });
        const slice = await queryGovernedVerseShellResult({ ...query, mode:"slice", startLine:2, endLine:3 });
        const lines = String(head.data?.text ?? "").split("\n");
        if (lines.length >= 3) expect(String(slice.data?.text)).toContain(lines[1]);
        reads.push({ head, slice });
      }
      expect(reads.every(row=>row.head.ok && row.slice.ok)).toBe(true);
      await f.manager.shutdownAll();
      const children = (await readFile(grandchildren,"utf8")).trim().split(/\s+/).map(Number); expect(children.every(pid=>!alive(pid))).toBe(true);
      expect(f.pids.every(pid=>!alive(pid))).toBe(true);
      await report("native-control", { binarySha256:f.hash, controls, pollRequests:16, output, result:{exitCode:result.exitCode,stdoutBytes:Buffer.byteLength(result.stdout),stderrBytes:Buffer.byteLength(result.stderr),artifacts,counts:result.observation.data?.output_bytes},artifactReads:reads,ownedPids:f.pids,grandchildren:children,remaining:0 });
    } finally { await f.manager.shutdownAll(); await report("native-workspace",{root:f.root,pids:f.pids,timeline:f.timeline,output,executorDiagnostics:f.executorDiagnostics,preservedEnvironmentKeys:Object.keys(f.processEnv)}); }
  },120000);

  it("compares CLI, batch, persistent server and native reads on the same file", async () => {
    const f=await setup();const target=path.join(f.root,"fixture.txt");await writeFile(target,"same-work\n".repeat(100));
    const child=path.join(f.root,"read.cjs");await writeFile(child,`const fs=require('node:fs');const n=Number(process.argv[3]);let value;for(let i=0;i<n;i++)value=fs.readFileSync(process.argv[2],'utf8');console.log(JSON.stringify({value,rss:process.memoryUsage().rss}));`);
    const results:Array<Record<string,unknown>>=[];
    try {
      const config=createReadonlyVerseShellProcessConfig({cwd:f.root,agentId:"read-agent",env:f.env,timeoutMs:5000});
      const startupAt = performance.now();
      const client=await f.manager.getClient(config);
      const startupMs = performance.now() - startupAt;
      for (const order of [["cli","batch","server","native"],["native","server","batch","cli"],["native","server","batch","cli"],["cli","batch","server","native"]]) {
        for (const mode of order) {
          const start=performance.now();let spawned=0;let rss=process.memoryUsage().rss;let text="";
          if (mode==="cli" || mode==="batch") {
            const iterations=mode==="cli"?8:1;
            for(let i=0;i<iterations;i++){ const row=JSON.parse(execFileSync(process.execPath,[child,target,mode==="cli"?"1":"8"],{encoding:"utf8",windowsHide:true}));text=row.value;rss=row.rss;spawned++; }
          } else if(mode==="server") {
            for(let i=0;i<8;i++){ const row=await client.execute("file.view",{path:"fixture.txt"});expect(row.ok).toBe(true);text=JSON.stringify(row.data); }
          } else for(let i=0;i<8;i++)text=await readFile(target,"utf8");
          const durationMs = performance.now()-start;
          expect(text).toContain("same-work");
          const executorMemory = mode === "server" ? JSON.parse(execFileSync("powershell.exe", ["-NoProfile", "-NonInteractive", "-Command",
            `Get-Process -Id ${f.pids.join(",")} | Select-Object Id,WorkingSet64,PrivateMemorySize64 | ConvertTo-Json -Compress`],
            { encoding: "utf8", windowsHide: true, timeout: 10000 })) : undefined;
          results.push({mode,reads:8,durationMs,spawned,rssBytes:rss,executorMemory,
            memoryScope:mode==="cli"||mode==="batch"?"child self-reported RSS":"host process RSS",persistentExecutorPids:mode==="server"?[...f.pids]:[]});
        }
      }
      await f.manager.shutdownAll();expect(f.pids.every(pid=>!alive(pid))).toBe(true);
      await report("read-comparison",{binarySha256:f.hash,serverStartupMs:startupMs,serverSpawns:f.pids.length,results,
        decision:"Use existing native file reads for local reads; retain the existing typed server for governed operations. Do not add a generic resident CLI proxy.",remaining:0});
    } finally {await f.manager.shutdownAll();await rm(f.root,{recursive:true,force:true});}
  },120000);
});
