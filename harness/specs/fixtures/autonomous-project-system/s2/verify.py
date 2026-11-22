"""Verify the scoped project dispatch acceptance evidence."""
from pathlib import Path
import json, hashlib
root=Path(__file__).resolve().parent
for line in (root/'SHA256SUMS').read_text().splitlines():
    digest,name=line.split('  ',1); assert hashlib.sha256((root/name).read_bytes()).hexdigest()==digest,name
read=lambda name:json.loads((root/name).read_text('utf8'))
r,g,u,j,review=map(read,('report.json','gates.json','unit-tests.json','journeys.json','independent-review.json'))
c=r['candidate']['commit']
assert all(d['candidate']==c for d in (g,u,j)) and review['scope']['head']==c and review['findings']==[]
assert not g['product']['dirty'] and not g['support']['dirty']
assert all(s['exit']==0 for s in g['product']['steps']+g['support']['steps'])
assert sum(s['passed'] for s in u['suites'])==490 and all(s['failed']==0 for s in u['suites'])
assert j['stats']['expected']==2 and j['stats']['unexpected']==j['stats']['skipped']==0
for name,data in j['readbacks'].items():
    if name.endswith('system-dispatch.json'):
        assert data['status']=='passed' and data['sourceDirty']=='' and data['sourceCandidate']==c
        assert data['activeWorkspaceUnchanged'] and data['activeWorkspacePermission']=='readOnly'
        assert 'SYSTEM_EXECUTION_PAUSED' in data['pausedAgent']['pausedAgentError']
        assert data['pausedAgent']['modelCallsBeforePausedAgent']==data['pausedAgent']['modelCallsAfter']
        assert data['admissions']['alphaAdmission']['replayed'] and data['admissions']['betaAdmission']['replayed']
        assert data['admissions']['refused']['success'] is False and data['admissions']['stale']['success'] is False
    if name.endswith('system-portfolio.json'):
        assert data['sourceCandidate']==c and data['sourceStatus']=='' and data['status']=='passed'
        assert len(data['frames'])==8 and all(not f['overflow'] for f in data['frames'])
    if name.endswith('ui-diagnostics.json'):assert data['errors']==[]
assert read('credential-scan.json')['hits']==[]
print(json.dumps({'candidate':c,'unit':490,'electron':2,'frames':8,'functional':'passed'}))
