import hashlib,json,pathlib,subprocess
root=pathlib.Path(__file__).resolve().parent;repo=root.parents[4]
m=json.loads((root/'manifest.json').read_text(encoding='utf-8'))
for x in m['files']:assert hashlib.sha256((root/x['path']).read_bytes()).hexdigest()==x['sha256'],x['path']
r=json.loads((root/'report.json').read_text(encoding='utf-8'))
assert r['status']=='passed' and r['acceptedNode']=='TF-0658' and r['uniqueUnitPassed']==230 and r['uniqueElectronPassed']==10
assert all(x['sourceUnchanged'] and (x['exitCode']==0 or (x['name']=='u2-core-final2' and x['acceptedCaseSubset'] and x['exitCode']==1)) for x in r['commands'])
for x in r['sources']:
 assert hashlib.sha256(subprocess.check_output(['git','show',r['candidate']+':'+x['path']],cwd=repo)).hexdigest()==x['sha256'],x['path']
print(json.dumps({'status':'passed','node':r['acceptedNode'],'unit':230,'electron':10,'files':len(m['files'])}))
