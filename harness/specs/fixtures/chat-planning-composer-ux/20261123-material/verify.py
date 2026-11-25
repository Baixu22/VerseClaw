import hashlib
import json
from pathlib import Path
import subprocess

root = Path(__file__).resolve().parent
def read(name): return json.loads((root / name).read_text(encoding='utf-8'))
report, candidate = read('report.json'), read('candidate.json')
assert report['status'] == 'passed' and report['driven_by'] == 'agent'
assert report['candidate'] == candidate['commit'] and not candidate['dirty']
carbon = read('carbon-summary.json')
assert carbon['rounds'] == 2 and carbon['requests'] == 4 and carbon['imageReads'] == 7
assert all(read(f'carbon-{name}.json')['status'] == 'SUCCESS' for name in ['design', 'review'])
assert candidate['productionSourcesMatchBuild']
units = read('unit-tests.json')
assert units['passed'] == units['tests'] == 184 and units['failed'] == 0
assert len(units['cases']) == 184 and all(case['status'] == 'passed' for case in units['cases'])
electron = read('electron-checks.json')
assert electron['passed'] == 7 and electron['failed'] == 0
assert len(electron['latestCases']) == 7 and all(case['status'] == 'expected' for case in electron['latestCases'])
assert all(run['sourceGuard']['ok'] and run['cleanup']['status'] == 'passed' and not run['cleanup']['remaining'] and not run['cleanup']['survivors'] for run in electron['runs'])
assert all(read('journey.json')['steps'].values()) and not read('journey.json')['pageErrors']
assert all(command['exitCode'] == 0 for command in read('checks.json')['commands'])
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
print(json.dumps({'passed': True, 'candidate': candidate['commit'], 'unitTests': 184, 'electronJourneys': 7, 'files': len(files)}))
