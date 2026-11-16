import hashlib,json,pathlib,subprocess
root=pathlib.Path(__file__).resolve().parent
repo=root.parents[5]
manifest=json.loads((root/'manifest.json').read_text(encoding='utf-8'))
for item in manifest['files']:assert hashlib.sha256((root/item['path']).read_bytes()).hexdigest()==item['sha256'],item['path']
r=json.loads((root/'report.json').read_text(encoding='utf-8'))
assert r['status']=='passed' and r['sourceCleanAfter'] and not r['candidate']['dirty']
for s in r['sources']:
 assert hashlib.sha256((repo/s['path']).read_bytes()).hexdigest()==s['sha256'],s['path']
 assert hashlib.sha256(subprocess.check_output(['git','show',r['candidate']['commit']+':'+s['path']],cwd=repo)).hexdigest()==s['gitBlobSha256'],s['path']
assert all(x['exitCode']==0 for x in r['commands'])
assert r['verificationCounts']['total']==135
print(json.dumps({'status':'passed','checks':135,'sourceFiles':len(r['sources']),'artifacts':len(manifest['files'])}))
