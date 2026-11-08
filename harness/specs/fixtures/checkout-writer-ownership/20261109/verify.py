import hashlib,json,pathlib,subprocess
root=pathlib.Path(__file__).resolve().parent
repo=root.parents[4]
manifest=json.loads((root/'manifest.json').read_text(encoding='utf-8'))
for item in manifest['files']:assert hashlib.sha256((root/item['path']).read_bytes()).hexdigest()==item['sha256'],item['path']
r=json.loads((root/'report.json').read_text(encoding='utf-8'))
assert r['status']=='passed' and r['sourceCleanAfter'] and not r['candidate']['dirty']
for s in r['sources']:
 assert hashlib.sha256((repo/s['path']).read_bytes()).hexdigest()==s['sha256'],s['path']
 assert hashlib.sha256(subprocess.check_output(['git','show',r['candidate']['commit']+':'+s['path']],cwd=repo)).hexdigest()==s['gitBlobSha256'],s['path']
assert all(c['exitCode']==0 for c in r['commands'])
assert r['uniquePassedTests']==47 and r['totalPassedExecutions']==59
print(json.dumps({'status':'passed','uniqueTests':47,'executions':59,'sourceFiles':len(r['sources']),'artifacts':len(manifest['files'])}))
