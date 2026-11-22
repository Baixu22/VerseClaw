import hashlib
import json
from pathlib import Path
import re

root = Path(__file__).resolve().parent
report = json.loads((root/'report.json').read_text(encoding='utf-8'))
assert report['status'] == 'passed'
assert report['driven_by'] == 'agent'
assert report['candidate']['dirty'] is False
assert re.fullmatch(r'[a-f0-9]{40}', report['candidate']['commit'])
assert re.fullmatch(r'[a-f0-9]{40}', report['candidate']['tree'])
hashes = {}
for line in (root/'SHA256SUMS').read_text(encoding='utf-8').splitlines():
    digest, name = line.split('  ', 1)
    assert not name.startswith('/') and '..' not in Path(name).parts
    hashes[name] = digest
files = {path.relative_to(root).as_posix() for path in root.rglob('*') if path.is_file() and path.name != 'SHA256SUMS' and '__pycache__' not in path.parts}
assert set(hashes) == files
for name, digest in hashes.items():
    assert hashlib.sha256((root/name).read_bytes()).hexdigest() == digest, name
scan = json.loads((root/'credential-scan.json').read_text(encoding='utf-8'))
assert scan['hits'] == 0
checks = json.loads((root/'clean-checks.json').read_text(encoding='utf-8'))
assert checks['driven_by'] == 'agent' and checks['commands']
assert all(command['exitCode'] == 0 for command in checks['commands'])
reviews = json.loads((root/'reviews.json').read_text(encoding='utf-8'))
assert reviews['pendingFinalReview'] is False
print(json.dumps({'passed':True, 'driven_by':'agent', 'candidate':report['candidate']['commit'], 'retainedFiles':len(files)}))
