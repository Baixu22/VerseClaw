"""Recompute TF-0686 source and runtime acceptance from retained evidence."""
from pathlib import Path
import json, hashlib
root=Path(__file__).resolve().parent
for line in (root/'SHA256SUMS').read_text().splitlines():
    digest,name=line.split('  ',1)
    assert hashlib.sha256((root/name).read_bytes()).hexdigest()==digest,name
read=lambda name:json.loads((root/name).read_text('utf8'))
r,g,u,j,p,review=map(read,('report.json','gates.json','unit-tests.json','journeys.json','paired-evaluation.json','independent-review.json'))
candidate=r['candidate']['commit']
assert all(d['candidate']==candidate for d in (g,u,j,p,review))
assert review['findings']==[]
assert not g['product']['dirty'] and not g['support']['dirty']
assert all(s['exit']==0 for s in g['product']['steps']+g['support']['steps'])
assert sum(s['passed'] for s in u['suites'])==r['counts']['unit']==204
assert all(s['failed']==0 for s in u['suites'])
assert j['stats']['expected']==2 and j['stats']['unexpected']==j['stats']['skipped']==0
for name,data in j['readbacks'].items():
    if 'sourceCandidate' in data:assert data['sourceCandidate']==candidate,name
    if name.endswith('continuity-observation.json'):
        assert data['status']=='passed' and data['sourceDirty']=='' and len(data['negatives'])==3
        isolated=data['foreignAcceptedTask']['isolated']
        assert isolated['validation']=='current' and 'PRIVATE_OTHER_TASK_' not in isolated['rendered']
        assert 'Stay inside workspace scope.' in isolated['rendered']
    if name.endswith('project-handoff-checkpoint.json'):
        assert data['lateCompletionProviderCalls']==0
assert p['counts']=={'pairs':30,'baselineFacts':90,'candidateFacts':150,'requiredFacts':150}
assert not p['report']['qualityClaimAllowed'] and p['report']['metricsBasis']=='agent-derived-structural'
assert all(not row['candidate']['missedMustPreserve'] and not row['candidate']['leakedForbiddenFacts'] for row in p['rows'])
assert read('negative-before.json')['defectReproduced'] and not read('negative-after.json')['defectReproduced']
assert read('credential-scan.json')['hits']==[]
print(json.dumps({'candidate':candidate,'unit':204,'electron':2,'pairs':30,'functional':'passed','liveModelQuality':'not-measured'}))
