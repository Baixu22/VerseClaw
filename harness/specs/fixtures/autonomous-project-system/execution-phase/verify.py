"""Verify the TF-0666 candidate evidence without external services."""
from pathlib import Path
import json, hashlib
root=Path(__file__).resolve().parent
for line in (root/'SHA256SUMS').read_text().splitlines():
    digest,name=line.split('  ',1)
    assert hashlib.sha256((root/name).read_bytes()).hexdigest()==digest,name
read=lambda name:json.loads((root/name).read_text('utf8'))
r,g,u,j,review=map(read,('report.json','gates.json','unit-tests.json','journeys.json','independent-review.json'))
candidate=r['candidate']['commit']
assert all(value['candidate']==candidate for value in (g,u,j))
assert review['sourceCandidate']==candidate and review['verdict']=='PASS_WITH_REPOSITORY_HARNESS_CI_FAILURE'
assert not g['product']['dirty'] and all(step['exit']==0 for step in g['product']['steps'])
for key in ('dispatchBudgets','runtimeSupplement'):
    assert g[key]['candidate']==candidate and not g[key]['dirty'] and g[key]['exit']==0
assert sum(s['passed'] for s in u['suites'])==r['counts']['unit']==330
assert all(s['failed']==0 for s in u['suites'])
assert j['stats']['expected']==11 and j['stats']['unexpected']==j['stats']['skipped']==0
for name,data in j['readbacks'].items():
    if 'sourceCandidate' in data: assert data['sourceCandidate']==candidate,name
    if name.endswith('closeout-readback.json'):
        assert data['status']=='passed' and data['task']['contract']['state']=='done' and data['sourceDirty']==''
        assert sum(e['kind']=='accepted' for e in data['events'])==1
        assert sum(e['kind']=='repair_started' for e in data['events'])==1
    if name.endswith('project-continuation.json'):
        assert data['callsBeforeRestart']==data['callsAfterRestart']==data['callsAfterLateCompletion']
        assert data['coordinatorWriteCalls']==1
assert read('credential-scan.json')['hits']==[]
print(json.dumps({'candidate':candidate,'unit':330,'electron':11,'functional':'passed','repositoryHarnessCi':'failed'}))
