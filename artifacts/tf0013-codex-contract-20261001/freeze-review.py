import json
import os
from pathlib import Path
import subprocess
import tempfile

root = Path(__file__).resolve().parents[2]
out = Path(__file__).resolve().parent
env = dict(os.environ, GIT_INDEX_FILE=str(Path(tempfile.mkdtemp(prefix='tf0013-review-')) / 'index'))
def git(*args, input=None):
    return subprocess.check_output(['git', *args], cwd=root, env=env, input=input, text=True).strip()
paths = ['openclaw_runtime/extensions/codex/src/app-server/' + name for name in [
    'attempt-context.ts', 'dynamic-tool-diagnostics.ts', 'dynamic-tools.ts',
    'event-projector.ts', 'run-attempt.ts', 'side-question.ts', 'diagnostic-contract.test.ts',
]]
head = git('rev-parse', 'HEAD')
git('read-tree', head)
git('add', '--', *paths)
tree = git('write-tree')
commit = git('commit-tree', tree, '-p', head, input='review snapshot: complete Codex diagnostic contracts\n')
(out / 'review-object.json').write_text(json.dumps({'commit': commit, 'parent': head, 'tree': tree, 'paths': paths, 'purpose': 'Review object; real HEAD/index untouched, no clean candidate claim.'}, indent=2) + '\n', newline='\n')
print(commit)
