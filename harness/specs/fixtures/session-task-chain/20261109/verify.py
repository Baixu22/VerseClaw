import hashlib,json,pathlib,subprocess
root=pathlib.Path(__file__).resolve().parent
repo=root.parents[4]
manifest=json.loads((root/'manifest.json').read_text(encoding='utf-8'))
for entry in manifest['files']:
 assert hashlib.sha256((root/entry['path']).read_bytes()).hexdigest()==entry['sha256'],entry['path']
report=json.loads((root/'report.json').read_text(encoding='utf-8'))
assert report['status']=='accepted-slice' and report['acceptanceComplete'] is False
assert set(report['acceptedNodes'])=={'TF-0673','TF-0657'}
assert report['uniqueE2ePassed']==43
for entry in report['sources']:
 actual=subprocess.check_output(['git','show',report['candidate']+':'+entry['path']],cwd=repo)
 assert hashlib.sha256(actual).hexdigest()==entry['sha256'],entry['path']
assert report['originalCriteriaRetained']==64
print(json.dumps({'status':'passed','acceptedNodes':report['acceptedNodes'],'openNodes':report['openNodes'],'artifacts':len(manifest['files'])}))
