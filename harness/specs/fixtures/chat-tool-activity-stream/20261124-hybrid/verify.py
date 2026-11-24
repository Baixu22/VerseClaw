import hashlib, json, subprocess, sys
from pathlib import Path

root = Path(__file__).resolve().parent
repo = root.parents[4]
def read(name): return json.loads((root / name).read_text(encoding='utf-8'))
def git(*args): return subprocess.check_output(['git', *args], cwd=repo)
report = read('report.json'); candidate = read('candidate.json')
assert report['status'] == 'passed' and report['driven_by'] == 'agent' and report['candidate'] == candidate['commit']
unit = read('unit-tests.json')
assert unit['tests'] == unit['passed'] == len(unit['cases']) == 135 and all(row['status'] == 'passed' for row in unit['cases'])
electron = read('electron-checks.json')
assert electron['journeys'] == len(electron['cases']) == 11 and all(row['status'] == 'expected' for row in electron['cases'])
assert electron['stats']['unexpected'] == electron['stats']['skipped'] == 0
assert all(row['exitCode'] == 0 and row['sourceUnchanged'] and row['candidate']['commit'] == candidate['commit'] for row in read('checks.json').values())
assert all(row['exitCode'] == 0 for row in read('static-checks.json').values())
assert read('typecheck.json')['success'] and not read('typecheck.json')['cache']['enabled']
cleanup = read('cleanup.json')
assert cleanup['status'] == 'passed' and not cleanup['remaining'] and not cleanup['survivors'] and not cleanup['pendingLaunches']
assert read('source-mutation-guard.json')['ok'] and not read('source-mutation-guard.json')['sourceChanged']
geometry = read('geometry.json')
assert len(geometry['measurements']) == 16 and all(row['width'] == row['viewportWidth'] and row['left'] < 2 and row['right'] < 2 and not row['overflow'] for row in geometry['measurements'])
assert len(geometry['expandedNarrow']) == 2 and all(row['targetWidth'] > 40 and not row['overflow'] for row in geometry['expandedNarrow'])
live = read('live.json')
assert live['status'] == 'passed' and live['chunkKeepsIconAndEntrance'] and live['sameIconNewCallRestartsReveal']
assert 'rgb(255, 255, 255)' in live['gradient'] and len(live['latestTargets']) == 3
installed = read('main-build-installed.json')
assert installed['candidateCommit'] == installed['buildSourceCommit'] == candidate['commit']
assert installed['verifiedFiles'] == len(read('main-build-files.json')) == 1412
assert hashlib.sha256((root / 'main-build-files.json').read_bytes()).hexdigest() == installed['fileManifestSha256']
assert read('parallel-source-preserved.json')['filesVerified'] == installed['parallelSourceFilesPreserved'] == 38
carbon = read('carbon/receipt.json')
assert carbon['status'] == 'ERROR' and carbon['exitCode'] == 3 and not carbon['stoppedForGuard'] and not carbon['blockedModels']
assert carbon['usage']['total_tokens'] == report['carbon']['reportedTokens'] == 112854
assert len(read('carbon/decision-recovered.json')['requirements']) == 7
assert all(row['verdict'] == 'pass' for row in read('carbon/decision-recovered.json')['requirements'])
assert len(read('carbon/applied-design.json')['items']) == 5
assert len(read('carbon/image-read-receipt.json')['reads']) == 5
assert read('baseline-harness.json')['command']['exitCode'] == 1 and read('baseline-harness.json')['testsPassedBeforeStop'] == 59
assert read('credential-scan.json')['status'] == 'passed' and not read('credential-scan.json')['findings']
for source in candidate['sources']:
    assert git('rev-parse', candidate['commit'] + ':' + source['path']).decode().strip() == source['gitBlob']
    assert hashlib.sha256(git('show', candidate['commit'] + ':' + source['path'])).hexdigest() == source['sha256']
for item in read('carbon/retained-inputs.json'):
    assert hashlib.sha256((repo / item['retainedPath']).read_bytes()).hexdigest() == item['sha256']
hashes = {name: sha for sha, name in (line.split('  ', 1) for line in (root / 'SHA256SUMS').read_text().splitlines())}
files = {path.relative_to(root).as_posix() for path in root.rglob('*') if path.is_file() and path.name != 'SHA256SUMS' and '__pycache__' not in path.parts}
assert files == set(hashes)
for name, sha in hashes.items():
    assert hashlib.sha256((root / name).read_bytes()).hexdigest() == sha, name
    if '--git' in sys.argv: assert hashlib.sha256(git('show', 'HEAD:' + (root / name).relative_to(repo).as_posix())).hexdigest() == sha, name
print(json.dumps({'passed': True, 'candidate': candidate['commit'], 'unitTests': 135, 'electronJourneys': 11,
    'evidenceFiles': len(files), 'gitBytesChecked': '--git' in sys.argv}))
