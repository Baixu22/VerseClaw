import argparse
import hashlib
import json
from pathlib import Path
import zipfile

p = argparse.ArgumentParser()
p.add_argument('--directory', type=Path, default=Path(__file__).parent)
a = p.parse_args()
root = a.directory
read = lambda name: json.loads((root/name).read_text(encoding='utf-8-sig'))
sha = lambda path: hashlib.sha256(Path(path).read_bytes()).hexdigest()
sums = [line.split('  ', 1) for line in (root/'SHA256SUMS').read_text(encoding='utf-8').splitlines()]
assert {name for _,name in sums} == {f.name for f in root.iterdir() if f.is_file() and f.name != 'SHA256SUMS'}
for digest, name in sums:
    assert sha(root/name) == digest, 'retained file changed: ' + name
assert read('credential-scan.json')['credentialMatches'] == 0
gates = read('gates.json')
assert gates['candidate']['commit'] == '61cde6ebbeef0290f5b0a1fdf9d6174eb2167511'
assert sha(root/'source-manifest.json') == gates['sourceManifestSha256']
assert read('source-manifest.json')['candidateCommit'] == gates['candidate']['commit']
assert gates['scopeGates']['success'] and gates['scopeGates']['sourceInputsUnchanged']
assert len(gates['scopeGates']['records']) == 13 and all(r['exitCode'] == 0 for r in gates['scopeGates']['records'])
for key, count in [('core',245),('crossOwner',49),('removal',44)]:
    assert gates[key]['passed'] == count and gates[key]['failed'] == gates[key]['skipped'] == 0
cases = [case for suite in read('cases.json')['suites'] for case in suite['cases']]
assert len(cases) == 338 and len({c['name'] for c in cases}) == 338 and all(c['status']=='passed' for c in cases)
native = read('native.json')
assert native['candidate'] == gates['candidate']
assert native['execution']['sourceManifestSha256'] == gates['sourceManifestSha256']
assert native['results']['stats']['expected'] == 2
assert all(native['results']['stats'][k] == 0 for k in ['skipped','unexpected','flaky'])
assert native['sourceMutationGuard']['ok'] and not native['sourceMutationGuard']['sourceChanged']
assert read('resource-reclamation.json')['cleanup']['survivors'] == []
review = read('review.json')['finalReview']
assert review['candidate']['commit'] == gates['candidate']['commit']
assert review['requestedModel'] == 'ccs-workbuddy/deepseek-v4.1-flash'
assert not any(f.get('blocking') is True for f in review.get('findings',[]))
assert review['conclusion']['priorFindingsClosed'] == 3 and review['conclusion']['priorFindingsOpen'] == 0
assert review['conclusion']['introducedReachableProblems'] == 0
assert review['finalSourceVerification']['headAndTreeUnchanged']
assert review['finalSourceVerification']['readFilesHashMismatchCount'] == 0
claim = read('native-proofs.json')['proofs']['cleanup-contention-claim']
assert claim['readback']['claimedEvents'] == [] and claim['readback']['persistedClaim'] is None
probe = read('integration-candidate.json')['mediaAliasProbe']
assert probe['status'] == 'passed' and probe['identical'] and len(probe['mediaModules']) == 12
criteria = read('acceptance.json')['criteria']
assert len(criteria) == 7 and all(c['status']=='passed' and all((root/f).is_file() for f in c['artifacts']) for c in criteria)
for archive in read('raw-archive.json')['archives']:
    assert sha(archive['archive']) == archive['sha256']
    assert sha(archive['index']) == archive['indexSha256']
    assert sha(archive['sourceBundle']) == archive['sourceBundleSha256']
    index = json.loads(Path(archive['index']).read_text(encoding='utf-8'))
    with zipfile.ZipFile(archive['archive']) as z:
        assert z.testzip() is None
        assert set(z.namelist()) == {e['member'] for e in index['members']}
        for entry in index['members']:
            digest = hashlib.sha256()
            with z.open(entry['member']) as stream:
                for chunk in iter(lambda: stream.read(1024*1024), b''):
                    digest.update(chunk)
            assert digest.hexdigest() == entry['sha256'], entry['member']
        if archive['candidate'] == gates['candidate']['commit']:
            reports = [('raw/pipeline/full-gates-fresh-61cde6ebb/regressions.json','core'),
                       ('raw/pipeline/full-gates-fresh-61cde6ebb/cross-owner-regressions.json','crossOwner'),
                       ('raw/pipeline/removal-and-harness-ci-61cde6ebb/removal-entry-tests.json','removal')]
            for member,key in reports:
                raw = z.read(member)
                j = json.loads(raw.decode('utf-8-sig'))
                assert hashlib.sha256(raw).hexdigest() == gates[key]['sha256']
                assert j['numPassedTests'] == gates[key]['passed'] and j['numFailedTests'] == j['numPendingTests'] == 0
print(json.dumps({'candidate':gates['candidate']['commit'],'criteria':7,'scopeGates':13,'passedCases':338,
                  'nativePassed':2,'credentialMatches':0,'archivesVerified':2,'harnessCiSuccess':gates['harnessCi']['success']}))
