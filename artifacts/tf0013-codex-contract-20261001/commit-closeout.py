"""Checkpoint the accepted implementation and coherent shared TF metadata, preserving other work."""
import hashlib
import json
from pathlib import Path
import re
import subprocess
import sys

root=Path(__file__).resolve().parents[2]
out=Path(__file__).resolve().parent
meta=json.loads((out/'candidate.json').read_text())
assert not subprocess.check_output(['git','diff','--cached','--name-only'],cwd=root,text=True).strip()
for name,digest in json.loads((out/'source-hashes.json').read_text())['files'].items():
    assert hashlib.sha256((root/name).read_bytes()).hexdigest()==digest, name
for line in (out/'SHA256SUMS').read_text().splitlines():
    digest,name=line.split('  ',1)
    assert hashlib.sha256((out/name).read_bytes()).hexdigest()==digest, name
ref='refs/heads/codex/tf0013-accepted-'+meta['commit'][:12]
found=subprocess.run(['git','rev-parse','--verify',ref],cwd=root,capture_output=True,text=True)
if found.returncode:
    subprocess.run(['git','fetch',str(Path(meta['candidate'])),meta['commit']+':'+ref],cwd=root,check=True)
else:
    assert found.stdout.strip()==meta['commit']
paths=list(meta['paths'])+meta['evidenceRefreshPaths']+[
    'docs/dev/handoffs/LATEST.md','docs/dev/tf0013-authority-closeout-20261001.md',
    'artifacts/tf0013-native-wire-20260930','artifacts/tf0013-codex-contract-20261001',
]
for name in ['artifacts/tf0013-message-budget-20260930','artifacts/tf0013-native-budget-20260930']:
    if (root/name).is_dir(): paths.append(name)
skill=Path.home()/'.codex/skills/task-forest/scripts'
sys.path.insert(0,str(skill))
from task_forest import FileLock
with FileLock(root/'.agent-workbench/task-forest/lock'):
    paths+=subprocess.check_output(['git','diff','--name-only','--','.agent-workbench/task-forest'],cwd=root,text=True).splitlines()
    untracked=subprocess.check_output(['git','ls-files','--others','--exclude-standard','.agent-workbench/task-forest'],cwd=root,text=True).splitlines()
    for name in untracked:
        if '/snapshots/' in name:
            paths.append(name)
        elif '/proposals/' in name and json.loads((root/name).read_text()).get('applied_at'):
            paths.append(name)
    paths=list(dict.fromkeys(paths))
    pattern=re.compile(rb'(?<![A-Za-z0-9_-])sk-(?:or-v1-)?[A-Za-z0-9_-]{24,}')
    for name in paths:
        path=root/name
        for file in ([path] if path.is_file() else path.rglob('*')):
            if file.is_file():
                assert not pattern.search(file.read_bytes()), 'Credential-shaped value in '+str(file)
    subprocess.run(['C:/Program Files/Git/bin/bash.exe','openclaw_runtime/scripts/committer',
                    'fix(context): close TF-0013 with verified native budgets and contracts',*paths],cwd=root,check=True)
print(subprocess.check_output(['git','rev-parse','HEAD'],cwd=root,text=True).strip())
