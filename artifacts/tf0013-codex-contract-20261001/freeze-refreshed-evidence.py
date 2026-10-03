"""Commit freshly executed CI evidence in the isolated candidate; never rewrite earlier results."""
import hashlib
import json
from pathlib import Path
import shutil
import subprocess

out = Path(__file__).resolve().parent
main = out.parents[1]
meta = json.loads((out / 'candidate.json').read_text())
root = Path(meta['candidate'])
paths = ['artifacts/agent-dev-deep-test/history.json', 'artifacts/agent-dev-deep-test/report.json',
         'artifacts/agent-dev-deep-test/report.md', 'artifacts/agent-dev-quality/report.json',
         'artifacts/agent-dev-workbench/evidence.json']
spec = 'harness/specs/tasks/uas-02-context-orchestrator-authority-closure.md'
deep = json.loads((root / paths[1]).read_text())
assert deep['success'] and deep['decision']['status'] == 'daily-loop-ok'
assert not deep['decision']['requiredFullGates']
changed = subprocess.check_output(['git', 'diff', 'HEAD', '--name-only'], cwd=root, text=True).splitlines()
assert set(paths) <= set(changed) <= set(paths + [spec]), changed
staged = subprocess.check_output(['git', 'diff', '--cached', '--name-only'], cwd=root, text=True).splitlines()
assert set(staged) <= set(paths + [spec]), staged
for path, digest in meta['sourceHashes'].items():
    if path != spec:
        assert hashlib.sha256((root / path).read_bytes()).hexdigest() == digest
shutil.copyfile(main / spec, root / spec)
subprocess.run(['git', 'add', '-f', '--', *paths, spec], cwd=root, check=True)
subprocess.run(['git', '-c', 'user.name=codex/root', '-c', 'user.email=codex@local', 'commit', '-m', 'chore(acceptance): refresh required Agent Dev evidence'], cwd=root, check=True)
assert not subprocess.check_output(['git', 'status', '--porcelain'], cwd=root, text=True).strip()
shutil.copyfile(out / 'candidate.json', out / 'candidate-before-evidence-refresh.json')
shutil.copyfile(out / 'candidate-verification.json', out / 'candidate-verification-before-evidence-refresh.json')
meta['sourceCandidateCommit'] = meta['commit']
meta['commit'] = subprocess.check_output(['git', 'rev-parse', 'HEAD'], cwd=root, text=True).strip()
meta['tree'] = subprocess.check_output(['git', 'rev-parse', 'HEAD^{tree}'], cwd=root, text=True).strip()
meta['sourceHashes'][spec] = hashlib.sha256((root / spec).read_bytes()).hexdigest()
meta['evidenceRefreshPaths'] = paths
(out / 'candidate.json').write_text(json.dumps(meta, indent=2) + '\n', newline='\n')
(out / 'candidate-verification.json').write_text(json.dumps({'actor':'codex/root','driven_by':'agent','commit':meta['commit'],'tree':meta['tree'],'runs':[]}, indent=2) + '\n', newline='\n')
archive = out / 'agent-dev-fresh-evidence'
archive.mkdir(exist_ok=True)
for path in paths:
    name = path.replace('/', '__')
    shutil.copyfile(root / path, archive / name)
print(json.dumps({'candidate':meta['commit'],'dirty':False,'unchangedProductSource':True,'refreshedReports':len(paths)}))
