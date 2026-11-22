"""Verify the candidate-bound TF-0683 retained evidence with the Python standard library."""
import hashlib
import json
from pathlib import Path
root = Path(__file__).resolve().parent
for line in (root / 'SHA256SUMS').read_text(encoding='utf8').splitlines():
    digest, name = line.split('  ', 1)
    assert hashlib.sha256((root / name).read_bytes()).hexdigest() == digest, name
read = lambda name: json.loads((root / name).read_text(encoding='utf8'))
report, gates, unit, electron, review = map(read, ('report.json', 'gates.json', 'unit-tests.json', 'electron.json', 'independent-review.json'))
candidate = report['candidate']['commit']
assert all(data['candidate'] == candidate for data in (gates, unit, electron))
assert review['sourceCandidate'] == candidate and review['findings'] == []
assert gates['product']['dirty'] is False and gates['support']['dirty'] is False
assert all(step['exit'] == 0 for step in gates['product']['steps'])
assert all(step['exit'] == 0 for step in gates['support']['steps'] if step['name'] != 'harness-ci')
assert unit['passed'] == report['counts']['unit'] == 81 and unit['failed'] == 0
assert electron['stats']['expected'] == 1 and electron['stats']['unexpected'] == electron['stats']['skipped'] == 0
journey = electron['journey']
assert journey['sourceCandidate'] == candidate and journey['sourceStatus'] == '' and journey['status'] == 'passed'
assert len(journey['frames']) == 8 and all(not frame['overflow'] for frame in journey['frames'])
assert journey['readOnly'] == {'workspaceUnchanged': True, 'modelCallsBefore': 0, 'modelCallsAfter': 0}
assert journey['unavailableRecovered'] and electron['ui']['errors'] == []
a, b = journey['ownerReadbacks']['alpha'], journey['ownerReadbacks']['beta']
assert a['workspaceId'] != b['workspaceId'] and a['coordinator']['sessionKey'] != b['coordinator']['sessionKey']
assert a['evidence'][0]['candidate'] == 'alpha-candidate' and b['evidence'][0]['candidate'] == 'beta-candidate'
assert a['resources']['costUsd'] is None and b['resources']['costUsd'] is None
print(json.dumps({'candidate': candidate, 'unit': 81, 'electron': 1, 'frames': 8, 'functional': 'passed', 'repositoryHarnessCi': report['verdict']['repositoryHarnessCi']}))
