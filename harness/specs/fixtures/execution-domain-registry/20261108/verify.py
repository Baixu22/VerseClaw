import hashlib,json,pathlib,subprocess
root=pathlib.Path(__file__).resolve().parent
repo=root.parents[4]
manifest=json.loads((root/'manifest.json').read_text(encoding='utf-8'))
for item in manifest['files']:
    assert hashlib.sha256((root/item['path']).read_bytes()).hexdigest()==item['sha256'],item['path']
report=json.loads((root/'report.json').read_text(encoding='utf-8'))
assert report['status']=='passed' and report['finalSourceClean']
for source in report['sources']:
    assert hashlib.sha256((repo/source['path']).read_bytes()).hexdigest()==source['sha256'],source['path']
    blob=subprocess.check_output(['git','show',report['candidate']['commit']+':'+source['path']],cwd=repo)
    assert hashlib.sha256(blob).hexdigest()==source['gitBlobSha256'],source['path']
assert all(row['exitCode']==0 for row in report['commands'])
assert sum(row.get('passed',0) for row in report['commands'])==54
print(json.dumps({'status':'passed','tests':54,'sources':len(report['sources']),'artifacts':len(manifest['files'])}))
