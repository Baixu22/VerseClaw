import hashlib, json, subprocess
from pathlib import Path

folder = Path(__file__).resolve().parent
repo = folder.parents[4]
read = lambda name: json.loads((folder/name).read_text(encoding='utf-8'))
sha = lambda data: hashlib.sha256(data).hexdigest()
git = lambda *args: subprocess.check_output(['git',*args],cwd=repo)
report = read('report.json')
assert report['status'] == 'passed' and report['driven_by'] == 'agent'
candidate = report['candidate']
assert candidate['dirty'] is False
assert git('rev-parse',candidate['commit']+'^{tree}').decode().strip() == candidate['tree']
for item in report['sources']:
    assert sha(git('show',candidate['commit']+':'+item['path'])) == item['gitSha256']
    assert sha((repo/item['path']).read_bytes()) == item['workingSha256']
units = read('unit-tests.json')
assert units['success'] and units['total'] == units['passed'] == len(units['cases']) == 133
assert units['failed'] == units['pending'] == 0 and all(case['status']=='passed' for case in units['cases'])
checks = read('checks.json')
assert all(c['exitCode']==0 and c['candidate']==candidate for c in checks['required'])
assert checks['typecheck']['cache']['enabled'] is False and checks['typecheck']['success']
assert all(item['exitCode']==0 for item in checks['typecheck']['results'])
assert checks['harness']['result']=='pass' and checks['harness']['specPath'].replace('\\','/') == report['spec']
assert set(checks['harness']['changedFiles']) == set(report['changedFiles'])
assert checks['commsCompare']['result']=='PASS' and not checks['commsCompare']['failures']
assert checks['commsCompare']['candidate']['commit']==candidate['commit']
owners = read('owner-readbacks.json')
assert owners['driven_by']=='agent' and owners['modelCalls']==0
receipts = {r['case']:r for r in owners['receipts']}
positive = receipts['two-independent-and-child']
assert positive['before']==positive['after'] and positive['beforeSha256']==positive['afterSha256']
assert sha(json.dumps(positive['before'],ensure_ascii=False,separators=(',',':')).encode()) == positive['beforeSha256']
assert len(positive['inputs'])==len(positive['snapshots'])==3
for request,snapshot in zip(positive['inputs'],positive['snapshots']):
    sources=snapshot['readModel']['sources']
    assert sources['session']['state']=='ready' and sources['session']['value']['scope']==request['scope']
    assert sources['execution']['state']=='ready' and sources['binding']['value']['bindingRevision']==3
    assert sources['run']['state']=='ready'
    assert sources['run']['value']['scope']=={k:request['scope'][k] for k in ['workspaceId','projectId','sessionKey']}
    assert sources['tasks']['state']=='ready' and sources['tasks']['value'][0]['authorityId']==sources['execution']['value']['authorityId']
references=[s['readModel']['sources']['tasks']['value'][0] for s in positive['snapshots']]
assert references[0]['taskNodeId']!=references[1]['taskNodeId']
assert references[2]['taskNodeId']==references[0]['taskNodeId'] and references[2]['referenceOnly']
for name,state in [('workspace','unavailable'),('project','unavailable'),('generation','stale'),('missing-owner','unavailable')]:
    snapshot=receipts[name]['snapshot']
    assert snapshot['readModel']['sources']['session']['state']==state and snapshot['tasks']==[]
assert receipts['read-states']['unread']['readModel']['sources']['tasks']['state']=='not_read'
assert receipts['read-states']['empty']['readModel']['sources']['tasks']['state']=='empty'
assert receipts['read-states']['unavailable']['readModel']['sources']['tasks']['state']=='unavailable'
for name in ['unpinned','missing']:
    assert receipts['unknown-run-owners'][name]['readModel']['sources']['run']['state']=='unknown'
for name in ['staleTask','staleExecution']:
    source='tasks' if name=='staleTask' else 'execution'
    assert receipts['old-task-generation-and-execution-revision'][name]['readModel']['sources'][source]['state']=='stale'
assert receipts['reset-during-runtime-read']['snapshot']['readModel']['sources']['session']['state']=='stale'
assert receipts['reset-during-host-read-and-old-binding-revision']['reset']['readModel']['sources']['session']['state']=='stale'
assert receipts['reset-during-host-read-and-old-binding-revision']['staleBinding']['readModel']['sources']['binding']['state']=='stale'
assert report['credentialScan']['hits']==[]
assert report['baselineCi']['exitCode']==1
for asset in report['baselineCi']['duplicates']:
    assert git('show',report['diffBase']+':'+asset['path']) == git('show',candidate['commit']+':'+asset['path'])
    assert sha(git('show',candidate['commit']+':'+asset['path']))==asset['sha256']
for line in (folder/'SHA256SUMS').read_text().splitlines():
    expected,name=line.split('  ',1)
    assert sha((folder/name).read_bytes())==expected, name
manifest={line.split('  ',1)[1] for line in (folder/'SHA256SUMS').read_text().splitlines()}
assert manifest == {p.name for p in folder.iterdir() if p.is_file() and p.name!='SHA256SUMS'}
print(json.dumps({'status':'passed','candidate':candidate['commit'],'sourceFiles':len(report['sources']),'artifactFiles':len(manifest),'tests':units['passed'],'ownerStateUnchanged':True}))
