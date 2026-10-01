"""Freeze the TF-0013 source delta in an independent local clone, preserving the main tree."""
import hashlib
import json
import os
from pathlib import Path
import subprocess
import tempfile

root = Path(__file__).resolve().parents[2]
out = Path(__file__).resolve().parent
env = dict(os.environ, GIT_INDEX_FILE=str(Path(tempfile.mkdtemp(prefix='tf0013-index-')) / 'index'))
def git(*args, input=None):
    return subprocess.check_output(['git', *args], cwd=root, env=env, input=input, text=True).strip()
assert not json.loads((out / 'autoreview.json').read_text())['findings']
paths = subprocess.check_output(
    ['git', 'diff', '--name-only', '--', 'openclaw_runtime'], cwd=root, text=True,
).splitlines()
assert 'openclaw_runtime/src/agents/harness/context-engine-lifecycle.ts' in paths
assert 'openclaw_runtime/extensions/codex/src/app-server/dynamic-tool-diagnostics.ts' in paths
paths += [
    'openclaw_runtime/extensions/codex/src/app-server/diagnostic-contract.test.ts',
    'harness/specs/tasks/uas-02-context-orchestrator-authority-closure.md',
    'docs/dev/context-orchestrator.md', 'docs/dev/first-product-controlled-preview/STATUS.md',
    'docs/dev/unified-agent-system/DEVELOPMENT-LOG.zh-CN.md',
    'docs/dev/tf0013-message-budget-20260930.md', 'docs/dev/tf0013-native-budget-20260930.md',
    'docs/dev/tf0013-native-wire-20261001.md', 'README.md', 'README.zh-CN.md', 'README.ja-JP.md',
]
paths = list(dict.fromkeys(paths))
head = git('rev-parse', 'HEAD')
git('read-tree', head)
git('add', '--', *paths)
tree = git('write-tree')
commit = git('commit-tree', tree, '-p', head, input='fix(context): complete native budget and diagnostic contracts\n')
temp_parent = Path('C:/tmp')
temp_parent.mkdir(exist_ok=True)
previous = out / 'candidate.json'
if previous.exists():
    previous_record = json.loads(previous.read_text())
    candidate = Path(previous_record['candidate'])
    assert not subprocess.check_output(['git', 'status', '--porcelain'], cwd=candidate, text=True).strip()
    (out / 'candidate-invalid-incomplete-scope.json').write_text(previous.read_text(), newline='\n')
else:
    candidate = Path(tempfile.mkdtemp(prefix='ClawX-tf0013-acceptance-', dir=temp_parent))
log = out / 'prepare-candidate.log'
with log.open('w', encoding='utf8', newline='\n') as stream:
    if not (candidate / '.git').exists():
        subprocess.run(['git', 'clone', '--shared', '--no-checkout', str(root), str(candidate)], check=True, stdout=stream, stderr=subprocess.STDOUT)
    subprocess.run(['git', 'checkout', '--detach', commit], cwd=candidate, check=True, stdout=stream, stderr=subprocess.STDOUT)
dirty = subprocess.check_output(['git', 'status', '--porcelain'], cwd=candidate, text=True).strip()
assert not dirty, dirty
report = {'actor': 'codex/root', 'driven_by': 'agent', 'candidate': str(candidate), 'commit': commit, 'tree': tree, 'base': head, 'dirtyBeforeDependencies': False, 'paths': paths, 'sourceHashes': {p: hashlib.sha256((candidate / p).read_bytes()).hexdigest() for p in paths}, 'scope': 'TF-0013 source candidate; no main HEAD/index mutation, no VerseConf graph or source changes'}
(out / 'candidate.json').write_text(json.dumps(report, indent=2) + '\n', newline='\n')
print(json.dumps({'candidate': str(candidate), 'commit': commit, 'dirty': False, 'files': len(paths)}))
