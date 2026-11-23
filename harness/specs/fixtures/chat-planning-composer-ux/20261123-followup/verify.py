import hashlib
import json
from pathlib import Path
import subprocess

root = Path(__file__).resolve().parent
def read(name): return json.loads((root / name).read_text(encoding='utf-8'))
report, candidate = read('report.json'), read('candidate.json')
assert report['status'] == 'passed' and report['driven_by'] == 'agent'
assert report['candidate'] == candidate['commit'] and not candidate['dirty']
assert report['carbonAdditionalRequests'] == 0
units = read('unit-tests.json')
assert units['passed'] == units['tests'] == 161 and units['failed'] == 0
assert len(units['cases']) == 161 and all(case['status'] == 'passed' for case in units['cases'])
electron = read('electron-checks.json')
assert electron['candidate'] == candidate['commit'] and electron['stats']['expected'] == 5
assert len(electron['cases']) == 5 and all(case['status'] == 'expected' for case in electron['cases'])
assert electron['sourceGuard']['ok'] and electron['cleanup']['status'] == 'passed'
assert not electron['cleanup']['remaining'] and not electron['cleanup']['survivors']
assert all(read('journey.json')['steps'].values()) and not read('journey.json')['pageErrors']
assert all(command['exitCode'] == 0 for command in read('checks.json')['commands'])
assert read('main-build-installed.json')['sourceCommit'] == candidate['commit']
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
print(json.dumps({'passed': True, 'candidate': candidate['commit'], 'unitTests': 161, 'electronJourneys': 5, 'files': len(files)}))
