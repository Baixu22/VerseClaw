import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { createHash, randomUUID } from 'node:crypto';
import { cp, mkdir, mkdtemp, readFile, readdir, rm, stat, writeFile } from 'node:fs/promises';
import { dirname, join, relative, resolve } from 'node:path';

export const MOYU_SOURCE = process.env.CLAWX_MOYU_SOURCE
  ? resolve(process.env.CLAWX_MOYU_SOURCE)
  : 'C:/Users/27933/Desktop/bad-shit/moyu';
export const MOYU_PYTHON = process.env.CLAWX_MOYU_PYTHON ?? join(MOYU_SOURCE, '.acceptance-venv', 'Scripts', 'python.exe');
export const MOYU_SUBPROJECT = 'demo/user_api_shitcode';
export const MOYU_ORACLE_PATH = 'tests/test_frozen_contract.py';
export const MOYU_ALLOWED_PATH = 'user_router.py';

export function moyuOpenClawEnv(homeDir: string) {
  const configDir = join(homeDir, '.openclaw');
  return { OPENCLAW_CONFIG_DIR: configDir, OPENCLAW_CONFIG_PATH: join(configDir, 'openclaw.json'), OPENCLAW_HOME: homeDir };
}

export type HashEntry = { path: string; sha256: string; bytes: number };

export function sha256(value: string | Buffer): string {
  return createHash('sha256').update(value).digest('hex');
}

export function run(argv: string[], options: { cwd?: string; env?: NodeJS.ProcessEnv; timeout?: number } = {}) {
  try {
    const stdout = execFileSync(argv[0]!, argv.slice(1), {
      cwd: options.cwd,
      env: options.env,
      encoding: 'utf8',
      windowsHide: true,
      timeout: options.timeout ?? 120_000,
      maxBuffer: 16 * 1024 * 1024,
    });
    return { exitCode: 0, stdout: String(stdout), stderr: '', argv };
  } catch (error) {
    const value = error as Error & { status?: number | null; stdout?: string | Buffer; stderr?: string | Buffer };
    return {
      exitCode: typeof value.status === 'number' ? value.status : 1,
      stdout: Buffer.isBuffer(value.stdout) ? value.stdout.toString('utf8') : String(value.stdout ?? ''),
      stderr: Buffer.isBuffer(value.stderr) ? value.stderr.toString('utf8') : String(value.stderr ?? value.message),
      argv,
    };
  }
}

export function git(root: string, args: string[]) {
  const result = run(['git', ...args], { cwd: root });
  assert.equal(result.exitCode, 0, result.stderr);
  return result.stdout.trim();
}

export function gitState(root: string) {
  return {
    commit: git(root, ['rev-parse', 'HEAD']),
    tree: git(root, ['rev-parse', 'HEAD^{tree}']),
    dirty: git(root, ['status', '--porcelain=v1']).length > 0,
    status: git(root, ['status', '--porcelain=v1']).split(/\r?\n/).filter(Boolean),
  };
}

export async function treeHashes(root: string, files: string[]): Promise<HashEntry[]> {
  return Promise.all(files.sort().map(async (path) => {
    const bytes = await readFile(join(root, path));
    return { path: path.replaceAll('\\', '/'), sha256: sha256(bytes), bytes: bytes.length };
  }));
}

export async function directoryHashes(root: string, directory = '.'): Promise<HashEntry[]> {
  const entries: HashEntry[] = [];
  async function walk(relativePath: string) {
    const current = join(root, relativePath);
    for (const entry of (await readdir(current, { withFileTypes: true })).sort((a, b) => a.name.localeCompare(b.name))) {
      if (entry.isSymbolicLink() || entry.isDirectory()) {
        const child = join(relativePath, entry.name);
        if (entry.isDirectory()) {
          if (['.git', '__pycache__', '.pytest_cache', '.acceptance-runs'].includes(entry.name)) continue;
          await walk(child);
        }
        continue;
      }
      if (!entry.isFile()) continue;
      const path = join(relativePath, entry.name).replace(/^\.\\/, '').replaceAll('\\', '/');
      const bytes = await readFile(join(root, path));
      entries.push({ path, sha256: sha256(bytes), bytes: bytes.length });
    }
  }
  await walk(directory);
  return entries;
}

export function oracleSource() {
  return `from __future__ import annotations\n\nimport importlib\nimport sqlite3\nfrom pathlib import Path\n\nfrom fastapi.testclient import TestClient\n\n\ndef _fresh_app(tmp_path: Path):\n    app_root = Path(__file__).resolve().parents[2]\n    database = tmp_path / "oracle.db"\n    previous = __import__("os").environ.get("YONGHU_DATABASE_PATH")\n    __import__("os").environ["YONGHU_DATABASE_PATH"] = str(database)\n    for module_name in ("main", "database_config", "user_router", "user_service"):\n        __import__("sys").modules.pop(module_name, None)\n    main = importlib.import_module("main")\n    main.init_db()\n    client = TestClient(main.app, raise_server_exceptions=False)\n    return client, database, previous\n\n\ndef test_apostrophe_username_round_trip(tmp_path: Path) -> None:\n    client, database, previous = _fresh_app(tmp_path)\n    try:\n        username = "O'Brien"\n        created = client.post("/api/yonghu/yonghu", json={"username": username, "email": "apostrophe@example.invalid", "status": "1"})\n        assert created.status_code == 200, created.text\n        user_id = created.json()["id"]\n        detail = client.get(f"/api/yonghu/yonghu/{user_id}")\n        assert detail.status_code == 200, detail.text\n        assert detail.json()["username"] == username\n        connection = sqlite3.connect(database)\n        try:\n            row = connection.execute("SELECT username FROM yonghu WHERE id = ?", (user_id,)).fetchone()\n            assert row == (username,)\n        finally:\n            connection.close()\n    finally:\n        if previous is None:\n            __import__("os").environ.pop("YONGHU_DATABASE_PATH", None)\n        else:\n            __import__("os").environ["YONGHU_DATABASE_PATH"] = previous\n`;
}

export async function createMoyuSnapshot(runRoot: string, name: string) {
  await mkdir(runRoot, { recursive: true });
  const sourceRoot = resolve(MOYU_SOURCE);
  const sourceProject = join(sourceRoot, MOYU_SUBPROJECT);
  const originalGit = gitState(sourceRoot);
  const originalFiles = (await readdir(sourceProject, { recursive: true, withFileTypes: true }))
    .filter((entry) => entry.isFile())
    .map((entry) => relative(sourceProject, join(entry.parentPath ?? (entry as unknown as { path: string }).path, entry.name)))
    .filter((file) => !file.includes('__pycache__') && !file.includes('.pytest_cache') && !file.includes('.acceptance-runs'))
    .sort();
  const before = await treeHashes(sourceProject, originalFiles);
  const sentinel = join(runRoot, 'outside-sentinel.txt');
  await writeFile(sentinel, `sentinel-${randomUUID()}\n`, 'utf8');
  const sentinelHash = sha256(await readFile(sentinel));
  const workspaceBase = process.env.CLAWX_MOYU_WORKSPACE_ROOT ?? 'D:\\ClawX\\.tmp\\tf0581-moyu-workspaces';
  await mkdir(workspaceBase, { recursive: true });
  const snapshotRoot = await mkdtemp(join(workspaceBase, `moyu-${name}-`));
  const snapshotProject = join(snapshotRoot, MOYU_SUBPROJECT);
  await mkdir(dirname(snapshotProject), { recursive: true });
  await cp(sourceProject, snapshotProject, {
    recursive: true,
    filter: (source) => !/[/\\](?:__pycache__|\.pytest_cache|\.acceptance-runs|\.git|\.env(?:\..*)?|\.venv|\.acceptance-venv|[^/\\]+\.db)$/.test(source),
  });
  await writeFile(join(snapshotProject, 'pytest.ini'), '[pytest]\n', 'utf8');
  await writeFile(join(snapshotProject, '.gitignore'), ['.acceptance-runs/', 'acceptance-before/', 'acceptance-after/', '__pycache__/', '*.pyc', '.pytest_cache/', 'yonghu.db', ''].join('\n'), 'utf8');
  await mkdir(join(snapshotProject, 'tests'), { recursive: true });
  await writeFile(join(snapshotProject, MOYU_ORACLE_PATH), oracleSource(), 'utf8');
  const oracleHash = sha256(await readFile(join(snapshotProject, MOYU_ORACLE_PATH)));
  git(snapshotRoot, ['init', '--quiet']);
  git(snapshotRoot, ['config', 'user.email', 'moyu-acceptance@example.invalid']);
  git(snapshotRoot, ['config', 'user.name', 'Moyu Acceptance']);
  git(snapshotRoot, ['add', '.']);
  git(snapshotRoot, ['commit', '--quiet', '-m', 'frozen moyu acceptance baseline']);
  const baselineCommit = git(snapshotRoot, ['rev-parse', 'HEAD']);
  const baselineHashes = await directoryHashes(snapshotProject);
  const env = {
    ...process.env,
    TEMP: 'D:\\tmp',
    TMP: 'D:\\tmp',
    PYTHONPATH: snapshotProject,
    PYTHONDONTWRITEBYTECODE: '1',
    PATH: `${dirname(MOYU_PYTHON)};${process.env.PATH ?? ''}`,
  };
  const projectTestsBefore = run([MOYU_PYTHON, '-m', 'pytest', 'tests/acceptance', '-q'], { cwd: snapshotProject, env });
  assert.equal(projectTestsBefore.exitCode, 0, projectTestsBefore.stdout + projectTestsBefore.stderr);
  const pytestBefore = run([MOYU_PYTHON, '-m', 'pytest', MOYU_ORACLE_PATH, '-q'], { cwd: snapshotProject, env });
  assert.notEqual(pytestBefore.exitCode, 0, 'The frozen apostrophe oracle must start red');
  const acceptanceBefore = run([MOYU_PYTHON, '-m', 'acceptance', 'run', '--mode', 'offline', '--seed', '20260908', '--output', join(snapshotProject, 'acceptance-before')], { cwd: snapshotProject, env });
  assert.equal(acceptanceBefore.exitCode, 1);
  assert.match(acceptanceBefore.stdout, /19 passed, 1 failed, 0 errors/);
  const routerSource = await readFile(join(snapshotProject, MOYU_ALLOWED_PATH), 'utf8');
  const normalizedRouter = routerSource.replace(/\r\n/g, '\n');
  const blockStart = normalizedRouter.indexOf('    sql = "INSERT INTO yonghu');
  const blockEnd = normalizedRouter.indexOf('    cursor.execute(sql)', blockStart);
  const routerBlock = blockStart >= 0 && blockEnd >= 0
    ? normalizedRouter.slice(blockStart, blockEnd + '    cursor.execute(sql)'.length)
    : '';
  return {
    sourceRoot, sourceProject, snapshotRoot, snapshotProject, originalGit, originalFiles,
    routerBlock,
    originalHashes: before, sentinel, sentinelHash, oracleHash, baselineCommit,
    baselineHashes, env, projectTestsBefore, pytestBefore, acceptanceBefore,
    async verifyAllowedChanges(expected: string[]) {
      const actual = await treeHashes(snapshotProject, baselineHashes.map(entry => entry.path));
      const changed = actual.filter(entry => baselineHashes.find(before => before.path === entry.path)?.sha256 !== entry.sha256).map(entry => entry.path).sort();
      assert.deepEqual(changed, [...expected].sort(), 'Agent changed a frozen or unauthorized source file');
      assert.equal(git(snapshotRoot, ['rev-parse', 'HEAD']), baselineCommit, 'Agent changed the Git baseline');
      assert.equal(git(snapshotRoot, ['diff', '--cached', '--name-only']), '', 'Agent staged source or a new oracle');
      const newFiles = git(snapshotRoot, ['ls-files', '--others', '--exclude-standard']).split(/\r?\n/).filter(Boolean);
      assert.deepEqual(newFiles.filter(path => !path.startsWith(MOYU_SUBPROJECT + '/.openclaw/') && !path.startsWith(MOYU_SUBPROJECT + '/.verse-claw/')), [], 'Agent added an unauthorized file');
      return changed;
    },
    async verifyOriginalUnchanged() {
      const after = await treeHashes(sourceProject, originalFiles);
      assert.deepEqual(after, before, 'Original moyu project bytes changed');
      assert.equal(sha256(await readFile(sentinel)), sentinelHash, 'Outside sentinel changed');
      assert.deepEqual(gitState(sourceRoot), originalGit, 'Original moyu Git state changed');
    },
    async verifyRestored() {
      const tracked = git(snapshotRoot, ['ls-files']).split(/\r?\n/).filter(Boolean);
      const trackedProject = tracked.filter((path) => path.startsWith(MOYU_SUBPROJECT + '/')).map((path) => path.slice(MOYU_SUBPROJECT.length + 1));
      const baselineTracked = baselineHashes.filter((entry) => trackedProject.includes(entry.path)).sort((a, b) => a.path.localeCompare(b.path));
      const restoredTracked = (await treeHashes(snapshotProject, trackedProject)).sort((a, b) => a.path.localeCompare(b.path));
      assert.deepEqual(restoredTracked, baselineTracked, 'Snapshot tracked source was not restored byte-for-byte');
      const status = git(snapshotRoot, ['status', '--porcelain=v1', '--untracked-files=no']);
      assert.equal(status, '', 'Snapshot tracked worktree is not clean after undo');
    },
    async cleanup() {
      if (process.env.CLAWX_E2E_KEEP_TEMP !== '1' && process.env.CLAWX_MOYU_KEEP_WS !== '1') {
        await rm(snapshotRoot, { recursive: true, force: true }).catch(() => undefined);
      }
    },
  };
}

export async function runMoyuChecks(snapshot: Awaited<ReturnType<typeof createMoyuSnapshot>>) {
  const projectTests = run([MOYU_PYTHON, '-m', 'pytest', 'tests/acceptance', '-q'], { cwd: snapshot.snapshotProject, env: snapshot.env });
  const pytest = run([MOYU_PYTHON, '-m', 'pytest', MOYU_ORACLE_PATH, '-q'], { cwd: snapshot.snapshotProject, env: snapshot.env });
  const acceptance = run([MOYU_PYTHON, '-m', 'acceptance', 'run', '--mode', 'offline', '--seed', '20260908', '--output', join(snapshot.snapshotProject, 'acceptance-after')], { cwd: snapshot.snapshotProject, env: snapshot.env });
  return { projectTests, pytest, acceptance };
}

export async function appendJournalEvidence(snapshot: Awaited<ReturnType<typeof createMoyuSnapshot>>) {
  const journalRoot = join(snapshot.snapshotProject, '.openclaw', 'journal');
  const sessions = await readdir(journalRoot).catch(() => []);
  const entries: Array<{ file: string; sha256: string; bytes: number }> = [];
  for (const session of sessions) {
    const directory = join(journalRoot, session);
    for (const name of (await readdir(directory)).sort()) {
      if (!name.endsWith('.meta.json') && !name.endsWith('.pre')) continue;
      const bytes = await readFile(join(directory, name));
      entries.push({ file: join(session, name).replaceAll('\\', '/'), sha256: sha256(bytes), bytes: bytes.length });
    }
  }
  return entries;
}

export async function waitForFile(path: string, timeoutMs = 120_000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try { await stat(path); return; } catch { /* retry */ }
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
  throw new Error(`timed out waiting for ${path}`);
}

export async function snapshotTree(root: string) {
  return directoryHashes(root);
}
