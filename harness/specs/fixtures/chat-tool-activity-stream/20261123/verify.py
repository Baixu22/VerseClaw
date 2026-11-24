import hashlib
import json
from pathlib import Path
import subprocess
import sys

root = Path(__file__).resolve().parent
repo = root.parents[4]

def read(name):
    return json.loads((root / name).read_text(encoding='utf-8'))

def git(*args):
    return subprocess.check_output(['git', *args], cwd=repo).decode('utf-8').strip()

report, candidate = read('report.json'), read('candidate.json')
assert report['status'] == 'passed' and report['driven_by'] == 'agent'
assert report['candidate'] == candidate['commit'] and not candidate['dirty']
units = read('unit-tests.json')
assert units['tests'] == units['passed'] == len(units['cases']) == 104
assert all(case['status'] == 'passed' for case in units['cases'])
electron = read('electron-checks.json')
assert electron['distinctJourneys'] == 12 and electron['supplementalExecutions'] == 2
for label, count in [('electron-delivery', 12), ('electron-native-375', 2)]:
    run = electron['runs'][label]
    assert run['stats']['expected'] == len(run['cases']) == count
    assert run['stats']['unexpected'] == run['stats']['flaky'] == run['stats']['skipped'] == 0
    assert all(case['status'] == 'expected' for case in run['cases'])
    cleanup = read('cleanup/' + label + '.json')
    assert cleanup['status'] == 'passed' and not cleanup['remaining'] and not cleanup['survivors'] and not cleanup['pendingLaunches']
geometry = read('geometry.json')
assert len(geometry['measurements']) == 16
assert all(item['width'] == item['viewportWidth'] and item['left'] == item['right'] == 0 and not item['overflow'] for item in geometry['measurements'])
assert not geometry['errors'] and geometry['openPanel']['left'] == geometry['openPanel']['right'] == 0
assert all(command['exitCode'] == 0 for command in read('checks.json')['commands'].values())
assert read('typecheck.json')['success'] and not read('typecheck.json')['cache']['enabled']
carbon = read('carbon.json')['receipt']
assert carbon['status'] == 'SUCCESS' and not carbon['blockedModels'] and not carbon['stoppedForGuard']
assert len(carbon['modelRequests']) == 4 and carbon['usage']['total_tokens'] == 78353
installed = read('main-build-installed.json')
assert installed['candidateCommit'] == candidate['commit'] and installed['verifiedFiles'] == len(read('main-build-files.json')) == 1412
assert hashlib.sha256((root / 'main-build-files.json').read_bytes()).hexdigest() == installed['fileManifestSha256']
assert read('credential-scan.json')['status'] == 'passed' and not read('credential-scan.json')['findings']
for source in candidate['sources']:
    assert git('rev-parse', f"{candidate['commit']}:{source['path']}") == source['gitBlob'], source['path']
assert not git('diff', report['buildSourceCommit'], candidate['commit'], '--', 'src', 'shared', 'electron', 'vite.config.ts', 'package.json')
hashes = {name: digest for digest, name in (line.split('  ', 1) for line in (root / 'SHA256SUMS').read_text().splitlines())}
files = {path.relative_to(root).as_posix() for path in root.rglob('*') if path.is_file() and path.name != 'SHA256SUMS' and '__pycache__' not in path.parts}
assert files == set(hashes)
for name, digest in hashes.items():
    assert hashlib.sha256((root / name).read_bytes()).hexdigest() == digest, name
    if '--git' in sys.argv:
        relative = (root / name).relative_to(repo).as_posix()
        blob = subprocess.check_output(['git', 'show', 'HEAD:' + relative], cwd=repo)
        assert hashlib.sha256(blob).hexdigest() == digest, relative
print(json.dumps({'passed': True, 'candidate': candidate['commit'], 'unitTests': 104, 'electronJourneys': 12, 'native375Executions': 2, 'verifiedEvidenceFiles': len(files), 'gitBytesChecked': '--git' in sys.argv}))
