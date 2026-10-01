"""Create a narrow review object without changing HEAD, branches or the real index."""
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
head = git('rev-parse', 'HEAD')
git('read-tree', head)
git('add', '--', 'openclaw_runtime/extensions/codex/src/app-server/run-attempt.ts')
tree = git('write-tree')
commit = git('commit-tree', tree, '-p', head, input='review snapshot: restore native bootstrap after failed resume\n')
(out / 'review-object.json').write_text(json.dumps({'commit': commit, 'parent': head, 'tree': tree, 'purpose': 'Unreferenced review object only; no branch/index/HEAD mutation and no clean candidate claim.'}, indent=2) + '\n')
print(commit)
