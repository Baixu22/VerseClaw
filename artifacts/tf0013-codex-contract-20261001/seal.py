import hashlib
import json
from pathlib import Path
import re

out = Path(__file__).resolve().parent
for path in out.rglob('*'):
    if path.is_file() and path.name != 'SHA256SUMS':
        data = path.read_bytes().replace(b'\r\n', b'\n')
        if path.suffix == '.log' and data:
            data = data.rstrip(b'\n') + b'\n'
        path.write_bytes(data)
files = sorted(p for p in out.rglob('*') if p.is_file() and p.name not in ['SHA256SUMS','credential-scan.json'])
patterns = [rb'(?<![A-Za-z0-9_-])sk-(?:or-v1-)?[A-Za-z0-9_-]{24,}', rb'gh[pousr]_[A-Za-z0-9]{30,}', rb'AKIA[0-9A-Z]{16}']
hits = sum(len(re.findall(pattern,p.read_bytes())) for p in files for pattern in patterns)
assert hits == 0
(out/'credential-scan.json').write_text(json.dumps({'actor':'codex/root','driven_by':'agent','credentialScanHits':hits,'filesScanned':len(files),'method':'API/GitHub/AWS token patterns, not an exhaustive detector; explicitly fake fixture credential only','textNormalization':'CRLF to LF and redundant terminal log blank lines removed before hashing; escaped JSON content and observed values unchanged'},indent=2)+'\n',newline='\n')
files = sorted(p for p in out.rglob('*') if p.is_file() and p.name != 'SHA256SUMS')
(out/'SHA256SUMS').write_text(''.join(hashlib.sha256(p.read_bytes()).hexdigest()+'  '+p.relative_to(out).as_posix()+'\n' for p in files),newline='\n')
for line in (out/'SHA256SUMS').read_text().splitlines():
    digest,name=line.split('  ',1)
    assert hashlib.sha256((out/name).read_bytes()).hexdigest()==digest
print(json.dumps({'sealedFiles':len(files),'credentialScanHits':hits}))
