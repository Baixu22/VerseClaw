import hashlib,json,pathlib,subprocess
root=pathlib.Path(__file__).resolve().parent;repo=root.parents[4]
manifest=json.loads((root/'manifest.json').read_text(encoding='utf-8'))
for row in manifest['files']:assert hashlib.sha256((root/row['path']).read_bytes()).hexdigest()==row['sha256'],row['path']
report=json.loads((root/'report.json').read_text(encoding='utf-8'))
assert report['status']=='passed' and report['acceptedNode']=='TF-0661' and len(report['acceptance'])==10
assert all(row['result']=='passed' for row in report['acceptance'])
for row in report['sources']:assert hashlib.sha256(subprocess.check_output(['git','show',report['candidate']+':'+row['path']],cwd=repo)).hexdigest()==row['sha256'],row['path']
print(json.dumps({'status':'passed','node':report['acceptedNode'],'unit':report['uniqueUnitPassed'],'electron':report['uniqueElectronPassed'],'files':len(manifest['files'])}))
