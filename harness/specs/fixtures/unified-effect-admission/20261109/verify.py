import hashlib,json,pathlib,subprocess
root=pathlib.Path(__file__).resolve().parent;repo=root.parents[4]
m=json.loads((root/'manifest.json').read_text(encoding='utf-8'))
for x in m['files']:assert hashlib.sha256((root/x['path']).read_bytes()).hexdigest()==x['sha256'],x['path']
r=json.loads((root/'report.json').read_text(encoding='utf-8'))
assert r['status']=='passed' and r['acceptedNode']=='TF-0865' and r['uniqueE2ePassed']==6
assert all(x['exitCode']==0 and x['sourceUnchanged'] for x in r['commands'])
for x in r['sources']:
 assert hashlib.sha256(subprocess.check_output(['git','show',r['candidate']+':'+x['path']],cwd=repo)).hexdigest()==x['sha256'],x['path']
print(json.dumps({'status':'passed','node':r['acceptedNode'],'unit':r['uniqueUnitPassed'],'e2e':r['uniqueE2ePassed'],'artifacts':len(m['files'])}))
