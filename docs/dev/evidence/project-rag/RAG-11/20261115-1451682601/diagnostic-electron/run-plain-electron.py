import datetime
import hashlib
import json
import os
import subprocess
import time
from pathlib import Path

ROOT = Path('C:/Users/27933/.codex/worktrees/project-rag-longterm-20261109/ClawX')
BASE = Path('D:/tmp/project-rag-relay-01a1d9e2')
OUT = BASE / 'plain-electron-verification'
OUT.mkdir(exist_ok=False)
config = json.loads((BASE / 'final-config.json').read_text())
def snapshot():
    git = lambda *args: subprocess.check_output(['git', *args], cwd=ROOT, text=True).strip()
    return dict(commit=git('rev-parse', 'HEAD'), tree=git('rev-parse', 'HEAD^{tree}'), status=git('status', '--porcelain'))
before = snapshot()
assert before['commit'] == config['candidate'] and not before['status']
files = ['tests/e2e/project-rag-dcs-citation.spec.ts', 'tests/e2e/project-rag-chat-modes.spec.ts', 'tests/e2e/project-rag-provider-settings.spec.ts']
cli = ROOT / 'node_modules/@playwright/test/cli.js'
trace = BASE / 'trace-main-launch3.cjs'
env = dict(os.environ, TEMP='D:/tmp', TMP='D:/tmp', PYTHONUTF8='1', NODE_OPTIONS='--max-old-space-size=1024',
           CLAWX_E2E_APP_LOGS='0', PROJECT_RAG_E2E_ASSETS_DIR='D:/tmp/project-rag-rag05-e2e-assets', CLAWX_E2E_RUN_ROOT_BASE=str(OUT / 'runtime'))
env['PATH'] = 'D:/tmp/project-rag-relay-01a1d438/wmic-bin;' + env['PATH']
env['NODE_PATH'] = 'D:/tmp/project-rag-longterm-20261109-deps/clawx/.pnpm/@playwright+test@1.59.0/node_modules;D:/tmp/project-rag-longterm-20261109-deps/clawx/.pnpm/node_modules'
command = ['C:/Program Files/nodejs/node.exe', str(cli), 'test', *files, '--workers=1', '--retries=0', '--reporter=json', '--output', str(OUT / 'electron')]
(OUT / 'started.json').write_text(json.dumps(dict(pid=os.getpid(), candidate=before, command=command, startedAt=datetime.datetime.now(datetime.timezone.utc).isoformat()), indent=2))
started = time.perf_counter()
with (OUT / 'electron.json').open('wb') as output, (OUT / 'electron.stderr.log').open('wb') as errors:
    result = subprocess.run(command, cwd=ROOT, env=env, stdout=output, stderr=errors)
report = json.loads((OUT / 'electron.json').read_text(encoding='utf-8-sig'))
after = snapshot()
success = result.returncode == 0 and report['stats']['expected'] == 3 and not any(report['stats'][key] for key in ['unexpected', 'skipped', 'flaky']) and before == after
receipt = dict(schema='ProjectRagDirectElectronRecovery/v2', actor='codex/project-rag-relay-01a1d9e2', driven_by='agent', realHumanEvidence=False,
               candidate=before, after=after, sourceUnchanged=before == after, command=command, exitCode=result.returncode,
               durationMs=round((time.perf_counter()-started)*1000), stats=report['stats'], files=files, cliSha256=hashlib.sha256(cli.read_bytes()).hexdigest(),
               executionMode='plain-project-cli-without-tracing-preload', status='pass' if success else 'fail')
(OUT / 'receipt.json').write_text(json.dumps(receipt, indent=2) + '\n')
print(json.dumps(dict(status=receipt['status'], exitCode=result.returncode, stats=report['stats'])), flush=True)
raise SystemExit(0 if success else 1)
