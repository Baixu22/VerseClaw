#!/usr/bin/env node
/**
 * `vb` CLI — plug surface #2 (shell / pi harnesses).
 * Live browser commands lazy-load the engine; explain / evidence work offline.
 */
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { Command } from 'commander';
import { explainError } from './mcp/explain-error.ts';
import { writeEvidencePackToolResult } from './evidence/writer.ts';
import { formatEvidencePackSummary, readEvidencePack } from './evidence/reader.ts';
import { getWorkspaceEvidenceRoot } from './host/workspace-paths.ts';
import { VERSION } from './version.ts';
import type { AgentBrowserFacade } from './engine/facade.ts';
import type { ToolResult } from './contracts/index.ts';

function printResult(result: ToolResult): void {
  process.stdout.write(JSON.stringify(result, null, 2) + '\n');
  if (!result.ok) process.exitCode = 1;
}

/**
 * Exit code for `vb verify`: the verdict drives the code, not just call
 * success. A FAIL/UNKNOWN verdict must fail a CI step (TF-0094).
 */
export function verifyExitCode(result: ToolResult): number {
  if (!result.ok) return 1;
  const outcome = (result.data as { outcome?: unknown } | undefined)?.outcome;
  if (outcome === undefined) return 0; // not a verify report (e.g. open failure passthrough)
  return outcome === 'pass' ? 0 : 1;
}

async function readErrorText(source: string | undefined): Promise<string> {
  if (!source || source === '-') {
    return await readStdin();
  }
  return await readFile(source, 'utf8');
}

async function readStdin(): Promise<string> {
  const chunks: Buffer[] = [];
  for await (const chunk of process.stdin) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  }
  return Buffer.concat(chunks).toString('utf8');
}

/**
 * Lazy facade: playwright-core auto-start (TF-0020); host api only under Electron.
 *
 * Live commands use **persistent sessions** (TF-0097): the browser is started
 * detached and recorded under `<workspace>/.ae/sessions/<id>/`, so `vb open` can
 * be followed by `vb nav --session <id>` from a *later* process.
 */
async function loadFacade(
  options: { evidenceRoot?: string; persistent?: boolean } = {},
): Promise<AgentBrowserFacade> {
  const { createStandaloneFacade } = await import('./engine/standalone.ts');
  const result = await createStandaloneFacade({
    ...(options.evidenceRoot ? { evidenceRoot: options.evidenceRoot } : {}),
    persistentSessions: options.persistent !== false,
  });
  return result.facade;
}

/**
 * A persistent session holds a CDP socket open, which would keep the event loop
 * alive after the result is printed. Flush stdout, then exit deliberately.
 */
function exitAfterFlush(code: number): void {
  process.exitCode = code;
  const done = (): void => process.exit(code);
  process.stdout.write('', done);
  setTimeout(done, 2000).unref();
}

export function createCli(): Command {
  const program = new Command();
  program
    .name('vb')
    .description('versebrowser — Agent Browser control plane CLI')
    .version(VERSION);

  program
    .command('ping')
    .description('Health check')
    .action(() => {
      process.stdout.write(JSON.stringify({ ok: true }) + '\n');
    });

  program
    .command('mcp')
    .description('Start the MCP stdio server')
    .option('--groups <groups>', 'tool groups, e.g. core,debug,network')
    .option('--caps <caps>', 'capability list (comma separated)')
    .action(async (opts: { groups?: string; caps?: string }) => {
      const serverMod = await import('./mcp/server.ts');
      const policyMod = await import('./mcp/capability-policy.ts');
      const policy = policyMod.resolveMcpPolicy({
        ...(opts.groups !== undefined ? { groups: opts.groups } : {}),
        ...(opts.caps !== undefined ? { caps: opts.caps } : {}),
      });
      await serverMod.startMcpServer({ policy });
    });

  program
    .command('explain')
    .description('Map a console error stack to original source locations')
    .argument('[file]', 'error text file, or - for stdin')
    .option('--out <dir>', 'write an evidence pack under this root (default for other evidence cmds: <workspace>/.ae/evidence)')
    .option('--map <path>', 'local .js.map file (repeatable)', collect, [] as string[])
    .option('--map-dir <dir>', 'directory to search for *.js.map (repeatable)', collect, [] as string[])
    .action(async (file: string | undefined, opts: { out?: string; map?: string[]; mapDir?: string[] }) => {
      const text = await readErrorText(file);
      const mapPaths = opts.map?.length ? opts.map : undefined;
      const searchDirs = opts.mapDir?.length ? opts.mapDir.map((d) => resolve(d)) : [process.cwd(), resolve('dist'), resolve('public')];
      const { createFsSourceMapResolver } = await import('./mcp/explain-error.ts');
      const explained = await explainError(text, {
        resolve: createFsSourceMapResolver({
          ...(mapPaths ? { mapPaths: mapPaths.map((d) => resolve(d)) } : {}),
          searchDirs,
        }),
      });
      if (opts.out) {
        const pack = await writeEvidencePackToolResult({
          rootDir: resolve(opts.out),
          label: 'explain_error',
          summaryMarkdown: explained.content,
          explain: explained,
        });
        printResult({
          ok: explained.frames.length > 0 || pack.ok,
          content: explained.content,
          data: { explain: explained, pack: pack.data },
          evidence: pack.evidence,
        });
        return;
      }
      printResult({
        ok: true,
        content: explained.content,
        data: explained,
      });
    });

  const live = (name: string): Command => program.command(name);

  live('open')
    .description(
      'Open a session backed by a detached browser (survives this process); ' +
        'follow up with `vb nav --session <id>`, finish with `vb close --session <id>`',
    )
    .option('--url <url>', 'initial URL')
    .option('--profile <profile>', 'profile name')
    .option('--mode <mode>', 'headless|visible')
    .option('--cdp <endpoint>', 'attach to an existing CDP endpoint instead of launching')
    .action(async (opts: { url?: string; profile?: string; mode?: string; cdp?: string }) => {
      const facade = await loadFacade();
      const opened = await facade.open({
        ...(opts.url ? { url: opts.url } : {}),
        ...(opts.profile ? { profile: opts.profile } : {}),
        ...(opts.mode === 'headless' || opts.mode === 'visible' ? { mode: opts.mode } : {}),
        ...(opts.cdp ? { cdpEndpoint: opts.cdp, connectionMode: 'cdp' as const } : {}),
      });
      printResult(opened);
      const sessionId = (opened.data as { session?: { id?: string } } | undefined)?.session?.id;
      if (opened.ok && sessionId) {
        // The browser now outlives this command on purpose.
        process.stderr.write(
          `session ${sessionId} is recorded under .ae/sessions/ — drive it from another command:\n` +
            `  vb nav --session ${sessionId} --url <url>\n` +
            '  vb snapshot|screenshot|console|verify --session <id>\n' +
            `  vb close --session ${sessionId}   # terminates the browser\n`,
        );
      }
    });

  live('nav')
    .description('Navigate a session')
    .requiredOption('--session <id>', 'session id')
    .requiredOption('--url <url>', 'target URL')
    .action(async (opts: { session: string; url: string }) => {
      const facade = await loadFacade();
      printResult(await facade.nav(opts.session, opts.url));
    });

  live('snapshot')
    .description('Accessibility snapshot')
    .requiredOption('--session <id>', 'session id')
    .action(async (opts: { session: string }) => {
      const facade = await loadFacade();
      printResult(await facade.snapshot(opts.session));
    });

  live('screenshot')
    .description('Screenshot to disk (returns path)')
    .requiredOption('--session <id>', 'session id')
    .option('--full-page', 'capture full page')
    .option('--name <file>', 'file name under shots/')
    .action(async (opts: { session: string; fullPage?: boolean; name?: string }) => {
      const facade = await loadFacade();
      printResult(
        await facade.screenshotToDisk(opts.session, {
          ...(opts.fullPage ? { fullPage: true } : {}),
          ...(opts.name ? { fileName: opts.name } : {}),
        }),
      );
    });

  live('console')
    .description('Console / exception summary')
    .requiredOption('--session <id>', 'session id')
    .action(async (opts: { session: string }) => {
      const facade = await loadFacade();
      printResult(await facade.console(opts.session));
    });

  live('verify')
    .description(
      'One-shot acceptance pack (selectors + console + network + shot). ' +
        'Pass --url to run the whole loop in one process (open → verify → close), or ' +
        '--session <id> to reattach from any process to a detached session opened earlier ' +
        '(the verdict window follows the current page).',
    )
    .option('--session <id>', 'persistent session id recorded under .ae/sessions/')
    .option('--url <url>', 'self-contained run: open the URL, verify, then close')
    .option('--mode <mode>', 'headless|visible (with --url)', 'headless')
    .option('--selector <css>', 'selector to assert (repeatable)', collect, [] as string[])
    .option('--no-screenshot', 'skip screenshot')
    .option('--out <dir>', 'evidence root (default under userData)')
    .action(
      async (opts: {
        session?: string;
        url?: string;
        mode?: string;
        selector: string[];
        screenshot?: boolean;
        out?: string;
      }) => {
        if (!opts.session && !opts.url) {
          process.stderr.write('verify requires --session <id> or --url <url>\n');
          process.exitCode = 1;
          return;
        }
        if (opts.session && opts.url) {
          process.stderr.write('verify takes either --session <id> or --url <url>, not both\n');
          process.exitCode = 1;
          return;
        }
        const facade = await loadFacade(opts.out ? { evidenceRoot: resolve(opts.out) } : {});
        if (opts.url) {
          const { verifyUrlOneShot } = await import('./engine/oneshot-verify.ts');
          const outcome = await verifyUrlOneShot({
            facade,
            url: opts.url,
            mode: opts.mode === 'visible' ? 'visible' : 'headless',
            selectors: opts.selector,
            screenshot: opts.screenshot !== false,
          });
          printResult(outcome.result);
          if (verifyExitCode(outcome.result) !== 0) process.exitCode = 1;
          return;
        }
        const verified = await facade.verifyFlow({
          sessionId: opts.session as string,
          selectors: opts.selector,
          screenshot: opts.screenshot !== false,
        });
        printResult(verified);
        if (verifyExitCode(verified) !== 0) process.exitCode = 1;
      },
    );

  live('close')
    .description('Close a session (terminates the detached browser it owns)')
    .requiredOption('--session <id>', 'session id')
    .action(async (opts: { session: string }) => {
      const facade = await loadFacade();
      printResult(await facade.close(opts.session));
    });

  program
    .command('sessions')
    .description('List persistent browser sessions recorded under <workspace>/.ae/sessions')
    .option('--clean', 'remove records whose browser process is already gone')
    .action(async (opts: { clean?: boolean }) => {
      const { listSessionRecords, sweepDeadSessions, probeEndpoint } = await import(
        './engine/persistent-sessions.ts'
      );
      const { getWorkspaceRoot } = await import('./host/workspace-paths.ts');
      // TF-0167: pass the active workspace explicitly. Without it these calls fell back to
      // the process default, so listing or cleaning one workspace could report, or delete,
      // another workspace's profile-backed session directories.
      const workspaceRoot = getWorkspaceRoot();
      const removed = opts.clean ? await sweepDeadSessions(workspaceRoot) : [];
      const records = await listSessionRecords(workspaceRoot);
      const sessions = await Promise.all(
        records.map(async (record) => ({
          id: record.id,
          // Probe CDP rather than the pid: on Windows the spawned launcher pid
          // can be gone while the real browser process is still serving.
          alive: await probeEndpoint(record.endpoint),
          pid: record.pid,
          endpoint: record.endpoint,
          mode: record.mode,
          ...(record.external ? { external: true } : {}),
          ...(record.url ? { url: record.url } : {}),
          createdAt: record.createdAt,
        })),
      );
      process.stdout.write(
        `${JSON.stringify({ ok: true, content: `${sessions.length} session(s)`, data: { sessions, removed } }, null, 2)}\n`,
      );
    });

  const evidence = program.command('evidence').description('Evidence Pack utilities');

  evidence
    .command('read')
    .description('Read a pack and print a compact summary')
    .argument('<packDir>', 'pack directory containing manifest.json')
    .action(async (packDir: string) => {
      const pack = await readEvidencePack(packDir);
      process.stdout.write(formatEvidencePackSummary(pack) + '\n');
    });

  evidence
    .command('write')
    .description('Write a minimal pack from summary/stdin (smoke / packaging)')
    .option('--root <dir>', 'parent directory for packs (default: <workspace>/.ae/evidence)')
    .requiredOption('--label <label>', 'pack label')
    .option('--summary <file>', 'summary.md source, or - for stdin')
    .action(async (opts: { root?: string; label: string; summary?: string }) => {
      const summaryMarkdown = opts.summary
        ? await readErrorText(opts.summary)
        : `# ${opts.label}\n`;
      printResult(
        await writeEvidencePackToolResult({
          rootDir: opts.root ? resolve(opts.root) : getWorkspaceEvidenceRoot(),
          label: opts.label,
          summaryMarkdown,
        }),
      );
    });

  evidence
    .command('pr-comment')
    .description('Export a GitHub PR/CI comment from an Evidence Pack')
    .argument('<packDir>', 'pack directory containing manifest.json')
    .option('--stdout', 'print markdown to stdout instead of writing pr-comment.md')
    .action(async (packDir: string, opts: { stdout?: boolean }) => {
      const { formatPrComment } = await import('./evidence/pr-comment.ts');
      const pack = await readEvidencePack(packDir);
      const comment = formatPrComment({
        label: pack.manifest.label,
        packDir,
        ...(pack.verify ? { verify: pack.verify } : {}),
        ...(pack.diagnosis ? { diagnosis: pack.diagnosis } : {}),
        ...(pack.explain ? { explain: pack.explain } : {}),
        ...(pack.networkFailures ? { networkFailures: pack.networkFailures } : {}),
        ...(pack.consoleDiff ? { consoleDiff: pack.consoleDiff } : {}),
        ...(pack.summaryMarkdown ? { summaryMarkdown: pack.summaryMarkdown } : {}),
        screenshotCount: pack.screenshots.length,
      });
      if (opts.stdout) {
        process.stdout.write(comment + '\n');
        return;
      }
      const { writeFile } = await import('node:fs/promises');
      const { join } = await import('node:path');
      const outPath = join(resolve(packDir), 'pr-comment.md');
      await writeFile(outPath, comment, 'utf8');
      process.stdout.write(outPath + '\n');
    });

  evidence
    .command('viewer')
    .description('Generate a local read-only HTML trajectory viewer from an Evidence Pack')
    .argument('<packDir>', 'pack directory containing manifest.json')
    .option('--out <file>', 'output HTML path (default: <packDir>/viewer.html)')
    .option('--stdout', 'print HTML to stdout instead of writing viewer.html')
    .action(async (packDir: string, opts: { out?: string; stdout?: boolean }) => {
      const { renderTrajectoryViewer, writeTrajectoryViewer } = await import('./evidence/viewer.ts');
      const pack = await readEvidencePack(packDir);
      if (opts.stdout) {
        process.stdout.write(renderTrajectoryViewer({ pack, packDir: resolve(packDir) }) + '\n');
        return;
      }
      const { outPath } = await writeTrajectoryViewer(resolve(packDir), {
        pack,
        ...(opts.out ? { outFile: resolve(opts.out) } : {}),
      });
      process.stdout.write(outPath + '\n');
    });

  const record = program.command('record').description('Flight Recorder controls');

  record
    .command('start')
    .description('Start Flight Recorder for a session')
    .requiredOption('--session <id>', 'session id')
    .option('--name <dirName>', 'evidence dir name under record/')
    .action(async (opts: { session: string; name?: string }) => {
      const facade = await loadFacade();
      printResult(
        await facade.recordStart(opts.session, {
          ...(opts.name ? { dirName: opts.name } : {}),
        }),
      );
    });

  record
    .command('stop')
    .description('Stop Flight Recorder and flush timeline.json')
    .requiredOption('--session <id>', 'session id')
    .action(async (opts: { session: string }) => {
      const facade = await loadFacade();
      printResult(await facade.recordStop(opts.session));
    });

  program
    .command('diagnose')
    .description('Trajectory diagnosis from a timeline (session recording or pack dir)')
    .option('--session <id>', 'active recording session id')
    .option('--dir <dir>', 'directory containing timeline.json')
    .action(async (opts: { session?: string; dir?: string }) => {
      if (!opts.session && !opts.dir) {
        process.stderr.write('diagnose requires --session or --dir\n');
        process.exitCode = 1;
        return;
      }
      // Offline path: diagnose from dir without loading the live facade.
      if (!opts.session && opts.dir) {
        const { readTimeline } = await import('./evidence/timeline.ts');
        const { diagnoseTimeline, writeDiagnosisPack } = await import('./evidence/diagnosis.ts');
        const timeline = await readTimeline(opts.dir);
        if (!timeline) {
          process.stderr.write(`no timeline.json under ${opts.dir}\n`);
          process.exitCode = 1;
          return;
        }
        const report = diagnoseTimeline({ dir: opts.dir, timeline });
        await writeDiagnosisPack(opts.dir, report);
        const { writeTrajectoryViewer } = await import('./evidence/viewer.ts');
        const { outPath: viewerPath } = await writeTrajectoryViewer(opts.dir);
        printResult({
          ok: report.ok,
          content: report.summaryMarkdown,
          data: report,
          evidence: [
            {
              id: 'ev-diagnosis',
              kind: 'summary' as const,
              label: 'diagnosis',
              path: `${opts.dir}/diagnosis.md`,
              mimeType: 'text/markdown',
              createdAt: new Date().toISOString(),
            },
            {
              id: 'ev-viewer',
              kind: 'summary' as const,
              label: 'trajectory viewer',
              path: viewerPath,
              mimeType: 'text/html',
              createdAt: new Date().toISOString(),
            },
          ],
        });
        return;
      }
      const facade = await loadFacade();
      printResult(
        await facade.diagnose({
          ...(opts.session ? { sessionId: opts.session } : {}),
          ...(opts.dir ? { dir: opts.dir } : {}),
        }),
      );
    });

  return program;
}

function collect(value: string, previous: string[]): string[] {
  return previous.concat([value]);
}

const isDirectRun =
  typeof process !== 'undefined' &&
  process.argv[1] &&
  /(^|[/\\])cli\.(ts|js|mjs)$/u.test(process.argv[1]);

if (isDirectRun) {
  createCli()
    .parseAsync(process.argv)
    .then(() => {
      // A persistent session leaves a CDP socket open; exit deliberately once
      // the result has been flushed instead of appearing to hang.
      exitAfterFlush(typeof process.exitCode === 'number' ? process.exitCode : 0);
    })
    .catch((error: unknown) => {
      console.error(error);
      process.exit(1);
    });
}
