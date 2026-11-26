"""Replay the offline prospective family census. Never execute submitted code or contact a provider."""
import argparse
from collections import Counter, defaultdict
import gzip
import hashlib
import json
from pathlib import Path
import re
import unicodedata

ROOT = Path(__file__).resolve().parents[1]
FIXTURES = ROOT / 'harness/specs/fixtures'
PACKS = ['rsi-live-experience/semantic-population-20261116/independent-cases.v2.json.gz',
         'rsi-live-experience/semantic-independent-cases.v1.json', 'rsi-guided-tool-loop/pilot-cases.v1.json',
         'rsi-live-experience/cases.v2.json']
MANIFEST = FIXTURES / 'rsi-live-experience/prospective-openr1-intake-20261120/source-manifest.json'
BASE_SHA = '4cd43e9eb87864da8d16f8603aa16a959d0ec168eec904d4f86aca628992e916'
PACK_SHAS = ['1fb0a5a321613560af3a4c765556669e69461ebffa00b28c7421a6cf6e32095b',
             '963590cb099e8515a48d6b4803cfb5806887449c0161ef8e3e0c50a61e103632',
             'f337e2421c607ebe7d0ed4d50b420d06da94bff04a38b9f64a8c5384d8ab33c8',
             '1a6dc9ae155fccf57b0fd8916eb066225695f1b9eddf8619e557a92e6b6df83e']
MANIFEST_SHA = '9d8658df8b73b59373593849c32dfee8b6346bc0b02f48fdb639f3d5e8eb8cd6'
CC_RECEIPTS = FIXTURES / 'rsi-live-experience/semantic-population-20261114/codecontests-conversion-20261114'
CC_CONVERSION_SHA = '131cec1488fa00ad7e491af669797c9ff9b4a0039316ccb6dfac4bf7eb62df97'
CC_AUDIT_SHA = '3c6596dc5a3443bd3981cc51688840a347de325fa800822a0e729538fd4e9e96'
SUPPLEMENTAL_SHA = '13dbfb7dd16bd3458b296dcb41f93f637c8a2670688d79421a2ef5d4cf83e2c3'
SPACE = re.compile(r'[\u0009-\u000d \u00a0\u1680\u2000-\u200a\u2028\u2029\u202f\u205f\u3000\ufeff]+')
DECIMAL = re.compile(r'(?:^|\s)[+-]?(?:\d+\.\d*|\.\d+|\d+[eE][+-]?\d+)(?:[eE][+-]?\d+)?(?=\s|$)')
PYTHON = {'Python 3', 'PyPy 3', 'PyPy 3-64', 'Python 3 + libs'}
CPP = {'GNU C++', 'GNU C++0x', 'GNU C++11', 'C++14 (GCC 6-32)', 'C++17 (GCC 7-32)', 'C++17 (GCC 9-64)'}


def digest(text):
    return hashlib.sha256(text.encode('utf-8')).hexdigest()


def file_digest(path):
    h = hashlib.sha256()
    with path.open('rb') as f:
        for block in iter(lambda: f.read(1024 * 1024), b''):
            h.update(block)
    return h.hexdigest()


def require(ok, message):
    if not ok:
        raise ValueError(message)


def prompt_key(text):
    return 'p:' + digest(SPACE.sub(' ', unicodedata.normalize('NFKC', text)).strip(' ').lower())


def cf_key(key, *, openr1=False):
    # Bare contest/index pairs are identities only inside the Codeforces source namespace.
    match = re.fullmatch(r'(?:codeforces:(\d+):|cf-(\d+)-)([a-z]+\d*)', key, re.I)
    if match:
        return f'codeforces:{match[1] or match[2]}:{match[3].upper()}'
    if openr1 and (m := re.fullmatch(r'(\d+)/([a-z]+\d*)', key, re.I)):
        return f'codeforces:{m[1]}:{m[2].upper()}'
    m = re.fullmatch(r'(?:url:)?https?://(?:www\.)?codeforces\.com/(?:problemset/problem/(\d+)/|(contest|gym)/(\d+)/problem/)([a-z]+\d*)/?(?:[?#].*)?', key, re.I)
    if m:
        return 'codeforces:' + ('gym:' if (m[2] or '').lower() == 'gym' else '') + (m[1] or m[3]) + ':' + m[4].upper()
    return key


class Families:
    def __init__(self):
        self.parents = {}

    def root(self, k):
        self.parents.setdefault(k, k)
        while self.parents[k] != k:
            self.parents[k] = self.parents[self.parents[k]]
            k = self.parents[k]
        return k

    def join(self, keys):
        first = self.root(keys[0])
        for key in keys[1:]:
            self.parents[self.root(key)] = first
        return first


def vector_issue(vectors):
    if not all(isinstance(v, dict) and isinstance(v.get('input'), str) and isinstance(v.get('output'), str) for v in vectors):
        return 'malformed-official-vector'
    # One complete official I/O pair is one vector. Do not split packed inputs or count duplicates.
    if len({v['input'] for v in vectors}) < 5:
        return 'under-five-distinct-official-inputs'
    if len({(v['input'], v['output']) for v in vectors}) != len({v['input'] for v in vectors}):
        return 'conflicting-output'
    if any(DECIMAL.search(v['output']) for v in vectors):
        return 'numeric-checker-not-bound'
    return None


def runner_issue(row):
    if not row['executable'] or row['input_mode'] != 'stdio' or row['interaction_format'] or row['generated_checker']:
        return 'incompatible-runner'
    if re.search(r'(absolute or relative error|relative or absolute error)', row['output_format'] or '', re.I):
        return 'numeric-checker-not-bound'
    return None


def rows(source, name, columns):
    import pyarrow.parquet as pq
    for batch in pq.ParquetFile(source / name).iter_batches(batch_size=8, columns=columns):
        yield from batch.to_pylist()


def compact(value):
    return json.dumps(value, ensure_ascii=False, sort_keys=True, separators=(',', ':'))


def write_report(path, value):
    with path.open('x', encoding='utf-8', newline='\n') as f:
        f.write(json.dumps(value, indent=2) + '\n')


def checked_json(path, sha):
    raw = path.read_bytes()
    require(hashlib.sha256(raw).hexdigest() == sha, 'digest mismatch: ' + path.name)
    return json.loads(raw)


def checked_rows(path, sha):
    h = hashlib.sha256()
    with path.open('rb') as f:
        for line in f:
            h.update(line)
            yield json.loads(line)
    require(h.hexdigest() == sha, 'digest mismatch: ' + path.name)


def official_subset(tests):
    return [v for v in tests if (v.get('visibility'), v.get('provenanceField')) in
            {('public', 'public_tests'), ('private', 'private_tests')} and v.get('kind') == 'stdio']


def audit_status(receipt, item):
    for k in ('familyId', 'representative', 'runtime'):
        require(receipt[k] == item[k], 'runner binding mismatch: ' + k)
    total = len(item['tests'])
    require(receipt['tests'] == total > 0, 'runner vector count mismatch')
    clean = receipt['passed'] == total and all(receipt[k] == 0 for k in ('failed', 'timedOut', 'processError'))
    status = 'passed' if clean else 'mismatch'
    require(receipt['status'] == status, 'runner verdict mismatch')
    return status


def alternate_ref(compatible_refs, origin, original_sha):
    # Transfer only along an explicit contest identity or a publisher-declared alias, never a prompt match.
    choices = compatible_refs.get(origin, {})
    return next((choices[k] for k in sorted(choices) if choices[k]['sha256'] != original_sha), None)


def codecontests_pool(source, graph, compatible_refs, observed_families):
    conversion = checked_json(CC_RECEIPTS / 'conversion.json', CC_CONVERSION_SHA)
    review = checked_json(source / 'family-review.json', conversion['familyReviewSha256'])
    metadata = checked_json(source / 'index.json', conversion['indexSha256'])
    by_id = {r['upstreamId']: r for r in metadata}
    family = {uid: f['familyId'] for f in review['families'] for uid in f['upstreamIds']}
    require(len(by_id) == len(metadata) == len(family) and family.keys() == by_id.keys(), 'family/index coverage')
    mixed = CC_RECEIPTS / 'admission-mixed-20261115'
    audit = checked_json(mixed / 'runner-audit-mixed.json', CC_AUDIT_SHA)
    binding = audit['sourceIdentity']
    chunks = checked_json(mixed / 'audit-inputs-mixed-manifest.json', binding['auditInputsManifestSha256'])
    receipts = {r['familyId']: r for r in audit['rows']}
    require(len(receipts) == len(audit['rows']) and observed_families <= receipts.keys(), 'runner/observed family coverage')
    require(chunks['sourceIdentity'].items() <= binding.items() and
            chunks['selection']['maxTestsPerFamily'] == audit['maxTestsPerFamily'], 'audit input contract drift')
    reps = {r['representative'] for r in receipts.values()}
    seen, selected_tests, good_prompt = set(), {}, set()
    for shard in conversion['shards']:
        for row in checked_rows(source / shard['output'], shard['outputSha256']):
            uid = row['upstreamId']; meta = by_id[uid]; prov = row['provenance']
            require(uid not in seen and meta['sourceIdentity'] == row['sourceIdentity'] and
                    meta['shard'] == prov['shard'] == shard['path'] and meta['rowIndex'] == prov['rowIndex'] and
                    meta['sourceRowSha256'] == prov['sourceRowSha256'], 'canonical row binding: ' + uid)
            seen.add(uid)
            graph.join(['cc-family:' + family[uid], cf_key(uid), cf_key(meta['sourceIdentity']), prompt_key(row['prompt'])])
            if uid in reps:
                require(meta['shard'].startswith('data/train-') and digest(row['reference']['source']) == meta['referenceDigest'],
                        'non-train or unbound runner representative: ' + uid)
                ordered = sorted(row['tests'], key=lambda v: v['visibility'] != 'public')[:audit['maxTestsPerFamily']]
                selected_tests[uid] = digest(compact(ordered))
                if 40 <= len(row['prompt'].strip()) <= 200000:
                    good_prompt.add(uid)
    require(seen == by_id.keys() and selected_tests.keys() == reps, 'canonical/runner coverage')
    candidates = {'passed': [], 'alternate': []}; outcomes = Counter(); reasons = Counter(); seen = set()
    for chunk in chunks['chunks']:
        n = 0
        for i, item in enumerate(checked_rows(source / 'audit-inputs-mixed' / chunk['file'], chunk['sha256'])):
            n += 1; fid = item['familyId']; uid = item['representative']; meta = by_id[uid]
            require(fid not in seen and family[uid] == fid and item['sourceRowSha256'] == meta['sourceRowSha256'] and
                    item['runtime'] == meta['runtime'] and digest(item['reference']) == meta['referenceDigest'] and
                    digest(compact(item['tests'])) == selected_tests[uid], 'audited source or oracle mismatch: ' + fid)
            seen.add(fid); status = audit_status(receipts[fid], item); outcomes[status] += 1
            tests = official_subset(item['tests']); issue = vector_issue(tests) if uid in good_prompt else 'public-contract-incomplete'
            if issue:
                reasons[issue] += 1; continue
            group = 'passed'; ref = {'runtime': item['runtime'], 'sha256': meta['referenceDigest']}
            if status == 'mismatch':
                group = 'alternate'; ref = alternate_ref(compatible_refs, cf_key(meta['sourceIdentity']), meta['referenceDigest'])
                if ref is None:
                    reasons['mismatch-without-compatible-alternate'] += 1; continue
            candidates[group].append(('cc-family:' + fid, {
                'familyId': fid, 'representative': uid, 'origin': meta['sourceIdentity'], 'canonicalShard': meta['shard'],
                'canonicalRow': meta['rowIndex'], 'sourceRowSha256': meta['sourceRowSha256'],
                'auditChunk': chunk['file'], 'auditRow': i, 'originalVerdict': status, 'originalReferenceSha256': meta['referenceDigest'],
                'officialDistinctInputs': len({v['input'] for v in tests}), 'officialSubsetSha256': digest(compact(tests)), 'reference': ref,
            }))
        require(n == chunk['families'], 'audit chunk row count drift')
    require(seen == receipts.keys() and outcomes['passed'] == audit['counts']['passedFamilies'] and
            outcomes['mismatch'] == audit['counts']['mismatchFamilies'], 'runner verdict coverage')
    require(all(receipts[fid]['status'] == 'passed' for fid in observed_families), 'observed cohort/runner verdict drift')
    return candidates, {'canonicalRows': len(by_id), 'familiesReviewed': len(review['families']), 'auditFamilies': len(seen),
                        'historicalVerdicts': dict(sorted(outcomes.items())), 'previouslyObservedPassed': len(observed_families),
                        'historicallyPassedOutsideObserved': outcomes['passed'] - len(observed_families),
                        'screeningRejections': dict(sorted(reasons.items())), 'qualifiedPassedRows': len(candidates['passed']),
                        'unverifiedAlternateRows': len(candidates['alternate'])}


def supplemental_pool(path, graph):
    result = {'named': [], 'held': []}; seen = set()
    for row in checked_rows(path, SUPPLEMENTAL_SHA):
        rid = row['id']; source = row['origin']['source']; upstream = row['origin']['upstream_id']
        require(rid not in seen and source in ('open-r1/codeforces', 'ccplus', 'deepcoder/taco', 'deepcoder/primeintellect')
                and isinstance(upstream, str) and upstream, 'supplemental identity mismatch')
        seen.add(rid); key = 'supplemental:' + rid
        keys = [key, 'supplemental-origin:' + source + ':' + upstream, prompt_key(row['prompt'])]
        if source == 'open-r1/codeforces':
            origin = cf_key(upstream, openr1=True)
            require(origin.startswith('codeforces:'), 'invalid supplemental Codeforces origin')
            keys.append(origin)
        elif source == 'ccplus' and (m := re.fullmatch(r'codeforces/(\d+)[/-]([a-z]+\d*)', upstream, re.I)):
            keys.append(f'codeforces:{m[1]}:{m[2].upper()}')
        graph.join(keys)
        named = source in ('ccplus', 'open-r1/codeforces') and not row['decimalOutputs']
        pairs = row['tests']
        if named:
            named = all(isinstance(v, list) and len(v) == 2 for v in pairs) and not vector_issue([{'input': v[0], 'output': v[1]} for v in pairs])
        result['named' if named else 'held'].append((key, None))
    require(len(seen) == 7776, 'supplemental row coverage')
    return result


def joint_census(graph, historical, tiers):
    # Resolve roots after the last source: an ineligible row can still identify a historical sibling.
    excluded = {graph.root(k) for k in historical}; covered = set(); counts = {}; deltas = []
    for items in tiers.values():
        for key, _ in items:
            graph.root(key)
    members = defaultdict(list)
    for key in graph.parents:
        members[graph.root(key)].append(key)
    for label, items in tiers.items():
        grouped = defaultdict(list)
        for k, record in items:
            grouped[graph.root(k)].append(record)
        eligible = grouped.keys() - excluded; fresh = eligible - covered
        counts[label] = {'rowsOrBaseFamilies': len(items), 'components': len(grouped), 'historical': len(grouped.keys() & excluded),
                         'alreadyCovered': len(eligible & covered), 'additional': len(fresh)}
        if label in ('codeContestsPassed', 'alternateReference'):
            for k in fresh:
                r = min(grouped[k], key=lambda v: v['familyId'])
                deltas.append({'tier': label, 'componentSha256': digest(compact(sorted(members[k]))), **r})
        covered.update(fresh)
    screened = sum(counts[k]['additional'] for k in ('base', 'openR1', 'codeContestsPassed'))
    alternate = screened + counts['alternateReference']['additional']
    named = alternate + counts['supplementalNamed']['additional']
    return ({'schemaVersion': 'RsiProspectiveJointCensus/v1', 'driven_by': 'agent', 'actor': 'codex/rsi-openr1-intake',
             'realHumanEvidence': False, 'modelRequests': 0, 'formalAdmission': False, 'runnerCalibration': False,
             'tiers': counts, 'screenedUpperBound': screened, 'withAlternateUpperBound': alternate,
             'withAlternateAndNamedSupplementalUpperBound': named, 'allListedRoutesUpperBound': len(covered),
             'requiredPerSplit': 3132, 'requiredTotal': 6264, 'benefit': 'NO_GO', 'adoption': 'hold'},
            sorted(deltas, key=lambda r: (r['tier'], r['familyId'])))


def inspect(source, base, out, codecontests=None, supplemental=None):
    require(not out.exists(), 'new output directory required')
    require((codecontests is None) == (supplemental is None), 'joint census needs both --codecontests and --supplemental')
    require(file_digest(base) == BASE_SHA, 'base family manifest digest mismatch')
    previous = json.loads(base.read_bytes())['families']
    packs = [FIXTURES / path for path in PACKS]
    files = checked_json(MANIFEST, MANIFEST_SHA)
    for j in files:
        p = source / j['name']
        require(p.stat().st_size == j['size'] and file_digest(p) == j['sha256'], 'shard mismatch: ' + p.name)
        require(file_digest(source / (j['repo'] + '.card.md')) == j['cardSha256'], 'card digest mismatch')
    graph, prior, existing = Families(), set(), set()
    observed_families = set()
    for group in previous:
        members = group['members']; keys = ['p:' + m['promptDigest'] for m in members]
        keys += [cf_key(k) for m in members for k in m['identities']]
        graph.join(keys); (prior if group['excluded'] else existing).add(keys[0])
    for p, sha in zip(packs, PACK_SHAS, strict=True):
        raw = p.read_bytes()
        require(hashlib.sha256(raw).hexdigest() == sha, 'historical pack digest mismatch: ' + p.name)
        data = gzip.decompress(raw) if p.suffix == '.gz' else raw
        for row in json.loads(data)['cases']:
            if p == packs[0]:
                observed_families.add(row['familyId'])
                prior.add('cc-family:' + row['familyId'])
            v = row.get('provenance') or {}; fr = v.get('familyReview') or {}
            keys = [prompt_key(row['prompt'])] + [cf_key(k) for k in [v.get('sourceId'), v.get('selectedUpstreamId'), *v.get('sourceIdentities', []), *v.get('upstreamIds', []), *fr.get('sourceIdentities', []), *fr.get('sourceIds', [])] if isinstance(k, str) and k]
            graph.join(keys); prior.add(keys[0])
    refs, ref_count = defaultdict(list), 0
    rs, = [j for j in files if j['repo'] == 'codeforces-submissions']
    rcols = ['problem_id','contestId','problem_index','programmingLanguage','source','submission_id','verdict','testset','passedTestCount']
    for i, r in enumerate(rows(source, rs['name'], rcols)):
        ref_count += 1; lang = r['programmingLanguage']; code = r['source']; sid = r['submission_id']
        if (lang not in PYTHON | CPP or r['verdict'] != 'OK' or r['testset'] != 'TESTS' or (r['passedTestCount'] or 0) < 5
                or not code or not code.strip() or len(code) > 2_000_000 or not str(sid).isdigit()):
            continue
        if r['problem_id'] != f"{r['contestId']}/{r['problem_index']}":
            continue
        key = cf_key(r['problem_id'], openr1=True); rank = (lang not in PYTHON, int(sid), i)
        refs[key].append((rank, {'row':i,'submissionId':sid,'origin':r['problem_id'],'language':lang,'runtime':'python3' if lang in PYTHON else 'cpp','sha256':digest(code)}))
    stats, candidates, seen = Counter(), [], set()
    compatible_refs = defaultdict(dict)
    cols = ['id','aliases','contest_id','index','description','input_format','output_format','interaction_format','official_tests','official_tests_complete','input_mode','executable','generated_checker']
    for j in files:
        if j['repo'] != 'codeforces': continue
        for i, row in enumerate(rows(source, j['name'], cols)):
            key = row['id']; require(key not in seen and key == f"{row['contest_id']}/{row['index']}", 'duplicate or mismatched problem id: '+key); seen.add(key)
            aliases = [cf_key(k, openr1=True) for k in [key, *(row['aliases'] or [])]]
            description = row['description'] or ''; public = '\n\n'.join(value for value in (description, row['input_format'], row['output_format']) if value)
            keys = aliases + [prompt_key(v) for v in (description,public) if v.strip()]; graph.join(keys)
            compatibility = runner_issue(row)
            reject = compatibility or vector_issue(row['official_tests'] or [])
            if not all((row[k] or '').strip() for k in ('description','input_format','output_format')) or not 40 <= len(public) <= 200000:
                reject = 'public-contract-incomplete'
            choices = [entry for k in aliases for entry in refs.get(k, ())]
            if not compatibility:
                for alias in aliases:
                    compatible_refs[alias].update((rank, ref) for rank, ref in choices)
            if not reject and not choices: reject = 'no-supported-accepted-reference'
            if reject: stats[reject] += 1; continue
            ref = min(choices, key=lambda x:x[0])[1]; tests = row['official_tests']; oracle = json.dumps(tests,ensure_ascii=False,sort_keys=True,separators=(',',':'))
            candidates.append({'id':key,'origins':sorted(set(aliases)),'shard':j['path'],'row':i,'promptDigest':prompt_key(public)[2:],
                               'officialVectors':len(tests),'completeOfficialSuite':row['official_tests_complete'],'vectorsSha256':digest(oracle),'reference':ref})
    excluded = {graph.root(k) for k in prior}; original = {graph.root(k) for k in existing}; surviving = original - excluded
    grouped = defaultdict(list)
    for row in candidates:
        grouped[graph.root(cf_key(row['id'], openr1=True))].append(row)
    new = sorted((min(records,key=lambda r:r['id']) for k,records in grouped.items() if k not in excluded|original),key=lambda r:r['id'])
    require(len(seen)==9556 and ref_count==42467 and len(seen)==len(candidates)+sum(stats.values()), 'source coverage drift')
    if codecontests is not None:
        cc_rows, audit_stats = codecontests_pool(codecontests, graph, compatible_refs, observed_families)
        extra = supplemental_pool(supplemental, graph)
        tiers = {
            'base': [(k, None) for k in existing],
            'openR1': [(cf_key(r['id'], openr1=True), r) for r in candidates],
            'codeContestsPassed': cc_rows['passed'], 'alternateReference': cc_rows['alternate'],
            'supplementalNamed': extra['named'], 'supplementalHeld': extra['held'],
        }
        joint, deltas = joint_census(graph, prior, tiers)
        joint['codeContests'] = audit_stats
        joint['inputs'] = {'openR1ManifestSha256': MANIFEST_SHA, 'baseSha256': BASE_SHA,
                           'historicalPackSha256': dict(zip(PACKS, PACK_SHAS, strict=True)),
                           'supplementalSha256': SUPPLEMENTAL_SHA, 'conversionSha256': CC_CONVERSION_SHA,
                           'historicalRunnerAuditSha256': CC_AUDIT_SHA}
    out.mkdir(parents=True, exist_ok=False)
    if codecontests is not None:
        delta_path = out / 'codecontests-delta.jsonl'
        with delta_path.open('x', encoding='utf-8', newline='\n') as f:
            for delta in deltas:
                f.write(compact(delta) + '\n')
        joint['deltaIndexSha256'] = file_digest(delta_path)
        write_report(out / 'joint-census.json', joint)
    index = out/'prospective-index.jsonl'
    with index.open('x',encoding='utf-8',newline='\n') as f:
        for row in new: f.write(json.dumps(row,sort_keys=True,separators=(',',':'))+'\n')
    report={'schemaVersion':'RsiOpenR1Intake/v1','driven_by':'agent','actor':'codex/rsi-openr1-intake','realHumanEvidence':False,'modelRequests':0,
            'sourceManifestSha256':file_digest(MANIFEST),'priorPackSha256':{k:file_digest(p) for k,p in zip(PACKS,packs)},'baseManifestSha256':BASE_SHA,
            'problemTrainRows':len(seen),'acceptedSubsetRows':ref_count,'rejectedProblemRows':dict(sorted(stats.items())),
            'screenedRows':len(candidates),'screenedComponents':len(grouped),'historicalComponentHits':len(grouped.keys() & excluded),
            'existingNonhistoricalComponentHits':len(grouped.keys() & surviving),'previouslyRetainedComponents':sum(not g['excluded'] for g in previous),
            'retainedBaseAfterAliasBridges':len(surviving),'freshComponentsBeforeShapeAndCalibration':len(new),
            'referenceRuntimes':dict(sorted(Counter(r['reference']['runtime'] for r in new).items())),
            'freshWithCompleteOfficialSuite':sum(r['completeOfficialSuite'] is True for r in new),'indexSha256':file_digest(index),
            'combinedBasePlusOpenR1UpperBound':len(surviving)+len(new),'required':6264,'formalAdmission':False,'runnerCalibration':False}
    write_report(out / 'intake.json', report)
    print(json.dumps(joint if codecontests is not None else report, indent=2))


if __name__ == '__main__':
    ap=argparse.ArgumentParser(description=__doc__)
    ap.add_argument('--sources',required=True,type=Path)
    ap.add_argument('--family-manifest',required=True,type=Path,help='candidate-families.json, not the crosswalk summary')
    ap.add_argument('--output-directory',required=True,type=Path)
    ap.add_argument('--codecontests', type=Path, help='pinned canonical shards and audit-inputs-mixed directory')
    ap.add_argument('--supplemental', type=Path, help='pinned supplementary candidate-rows.jsonl')
    args=ap.parse_args();inspect(args.sources,args.family_manifest,args.output_directory,args.codecontests,args.supplemental)
