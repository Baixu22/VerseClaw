import hashlib
import json
from pathlib import Path
import subprocess

root = Path(__file__).resolve().parent
def read(name): return json.loads((root / name).read_text(encoding='utf-8'))
report, candidate = read('report.json'), read('candidate.json')
assert report['status'] == 'passed' and report['driven_by'] == 'agent'
assert report['candidate'] == candidate['commit'] and not candidate['dirty'] and candidate['productionSourcesMatchBuild']
units = read('unit-tests.json')
assert units['tests'] == units['passed'] == len(units['cases']) == 85 and units['failed'] == 0
assert all(case['status'] == 'passed' for case in units['cases'])
electron = read('electron-checks.json')
assert electron['passed'] == len(electron['latestCases']) == 5 and electron['failed'] == 0
assert all(case['status'] == 'expected' for case in electron['latestCases'])
assert all(run['sourceGuard']['ok'] and run['cleanup']['status'] == 'passed' and not run['cleanup']['remaining'] and not run['cleanup']['survivors'] for run in electron['runs'])
assert all(command['exitCode'] == 0 for command in read('checks.json')['commands'])
execution = read('execution-context.json')
assert execution['git'] == 'real' and execution['created']['clicks'] == 2 and not execution['errors']
assert all(execution[key] for key in ['originalDraftRestored', 'existingDraftRestored', 'createWithoutSwitching', 'permissionFailureRetried', 'runningGuard'])
assert all(read('task-journey.json')['steps'].values())
carbon = read('carbon-summary.json')
assert carbon['requests'] == 6 and carbon['imageReads'] == 9 and carbon['totalReportedTokens'] == 84377
assert len(carbon['refinements']) == 3
assert read('main-build-installed.json')['candidateCommit'] == candidate['commit']
hashes = dict((name, digest) for digest, name in (line.split('  ', 1) for line in (root / 'SHA256SUMS').read_text().splitlines()))
files = {path.relative_to(root).as_posix() for path in root.rglob('*') if path.is_file() and path.name != 'SHA256SUMS' and '__pycache__' not in path.parts}
assert files == set(hashes)
for name, digest in hashes.items():
    assert not name.startswith('/') and '..' not in Path(name).parts
    assert hashlib.sha256((root / name).read_bytes()).hexdigest() == digest, name
repo = root.parents[4]
for entry in candidate['sources']:
    actual = subprocess.check_output(['git', 'rev-parse', f"{candidate['commit']}:{entry['path']}"], cwd=repo, text=True).strip()
    assert actual == entry['gitBlob'], entry['path']
print(json.dumps({'passed': True, 'candidate': candidate['commit'], 'unitTests': 85, 'electronJourneys': 5, 'files': len(files)}))
