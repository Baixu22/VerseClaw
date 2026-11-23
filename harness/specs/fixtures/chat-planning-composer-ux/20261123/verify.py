import hashlib
import json
from pathlib import Path
import subprocess

root = Path(__file__).resolve().parent
read = lambda name: json.loads((root / name).read_text(encoding='utf-8'))
report, candidate = read('report.json'), read('candidate.json')
assert report['status'] == 'passed' and report['driven_by'] == 'agent'
assert candidate['dirty'] is False and candidate['productionSourcesMatchBuild']
assert report['candidate'] == candidate['commit']
units = read('unit-tests.json')
assert units['failed'] == 0 and units['passed'] == units['tests'] == 218
assert all(case['status'] == 'passed' for case in units['cases'])
electron = read('electron-checks.json')
assert electron['passed'] == 8 and electron['failed'] == 0
assert all(case['status'] == 'expected' for case in electron['latestCases'])
assert all(run['cleanup']['status'] == 'passed' and run['sourceGuard']['ok'] for run in electron['runs'])
assert all(read('journey.json')['steps'].values())
checks = read('checks.json')
assert checks['nodeTypes']['exitCode'] == 0
assert all(command['exitCode'] == 0 for command in checks['commands'])
carbon = read('carbon-summary.json')
assert carbon['totalReportedTokens'] == 61425 and carbon['requests'] == 4 and carbon['imageReads'] == 7
assert read('credential-scan.json')['hits'] == 0
hashes = dict((name, digest) for digest, name in (line.split('  ', 1) for line in (root / 'SHA256SUMS').read_text().splitlines()))
files = {path.relative_to(root).as_posix() for path in root.rglob('*') if path.is_file() and path.name != 'SHA256SUMS' and '__pycache__' not in path.parts}
assert files == set(hashes)
for name, digest in hashes.items():
    assert not name.startswith('/') and '..' not in Path(name).parts
    assert hashlib.sha256((root / name).read_bytes()).hexdigest() == digest, name
repo = root.parents[4]
for source in candidate['sources']:
    blob = subprocess.check_output(['git', 'rev-parse', f"{candidate['commit']}:{source['path']}"], cwd=repo, text=True).strip()
    assert blob == source['gitBlob'], source['path']
print(json.dumps({'passed': True, 'candidate': candidate['commit'], 'unitTests': 218, 'electronJourneys': 8, 'retainedFiles': len(files)}))
