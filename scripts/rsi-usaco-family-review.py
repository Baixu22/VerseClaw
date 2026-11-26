"""Join replayed USACO candidates to all frozen source families and observed history."""
import argparse
from collections import Counter, defaultdict
import gzip
import hashlib
import json
from pathlib import Path
import re
import runpy
import subprocess
from urllib.parse import parse_qs, urlsplit

ROOT = Path(__file__).resolve().parents[1]
U = runpy.run_path(str(ROOT / 'scripts/rsi-usaco-source-intake.py'))
Q = runpy.run_path(str(ROOT / 'scripts/rsi-prospective-source-selection.py'))
M = U['M']
SOURCES = (*U['SOURCES'], *Q['SOURCE_FILES'], 'scripts/rsi-usaco-family-review.py',
           'scripts/lib/rsi-semantic-corpus-import.mjs', 'pnpm-lock.yaml')


def identity_keys(value):
    keys = {value, M['cf_key'](value)}
    bare = value.removeprefix('url:')
    parsed = urlsplit(bare)
    if parsed.scheme in ('http', 'https') and parsed.netloc.lower() in ('usaco.org', 'www.usaco.org'):
        query = parse_qs(parsed.query)
        cpid = query.get('cpid')
        if parsed.path == '/index.php' and query.get('page') == ['viewproblem2'] and \
                cpid and len(cpid) == 1 and re.fullmatch(r'[1-9][0-9]*', cpid[0]):
            keys.add('usaco:' + cpid[0])
    return keys


def join_families(queue, candidates, shapes, historical):
    M['require'](len(shapes) == len(candidates), 'complete candidate shape coverage required')
    graph, old, fresh, observed, seen = M['Families'](), {}, {}, set(), set()
    for family in queue:
        fid = family['familyId']
        M['require'](isinstance(fid, str) and fid and fid not in old and family['identityKeys'] and
                     family['identityKeys'] == sorted(set(family['identityKeys'])) and
                     family['status'] in ('planned', 'held', 'excluded') and
                     type(family['excludedByHistoricalShape']) is bool and
                     (family['status'] == 'excluded') == family['excludedByHistoricalShape'],
                     'frozen queue family drift')
        key = 'old-family:' + fid
        keys = {key, *('shape:' + shape for shape in family['knownReferenceShapes'])}
        for value in family['identityKeys']:
            keys.update(identity_keys(value))
        graph.join(sorted(keys))
        old[fid] = {'key': key, 'status': family['status']}
        if family['status'] == 'excluded':
            observed.add(key)
    for index, record in enumerate(historical):
        key = 'historical:' + str(index)
        graph.join([key, *record])
        observed.add(key)
    for row, shape in zip(candidates, shapes, strict=True):
        source = row['sourceIdentity']
        M['require'](re.fullmatch(r'usaco:[1-9][0-9]*', source) and source not in seen and
                     re.fullmatch(r'[a-f0-9]{64}', shape), 'candidate source/shape drift')
        seen.add(source)
        key = 'new-source:' + source
        keys = {key, M['prompt_key'](row['prompt']), 'shape:' + shape}
        for value in row['identityKeys']:
            keys.update(identity_keys(value))
        graph.join(sorted(keys))
        fresh[source] = {'key': key, 'referenceShape': shape}
    # Resolve after every new source: one source may bridge several old families.
    excluded_roots = {graph.root(key) for key in observed}
    old_roots = defaultdict(list)
    for fid, item in old.items():
        old_roots[graph.root(item['key'])].append(fid)
    grouped = defaultdict(list)
    for source, item in fresh.items():
        grouped[graph.root(item['key'])].append(source)
    all_keys = defaultdict(list)
    for key in graph.parents:
        all_keys[graph.root(key)].append(key)
    results = []
    for root, sources in grouped.items():
        old_ids = sorted(old_roots[root])
        keys = sorted(all_keys[root])
        status = 'excluded-observed' if root in excluded_roots else 'existing-component' if old_ids else 'new-component'
        results.append({'familyId': 'usaco-family-' + M['digest'](M['compact'](keys))[:24],
                        'status': status, 'sourceIdentities': sorted(sources), 'oldFamilyIds': old_ids,
                        'knownReferenceShapes': sorted({fresh[source]['referenceShape'] for source in sources}),
                        'componentKeys': keys})
    results.sort(key=lambda row: row['familyId'])
    return results


def historical_keys():
    rows = []
    path = M['FIXTURES'] / 'rsi-live-experience/prospective-library-checker-native-20261122/base-families.json.gz'
    raw = gzip.decompress(path.read_bytes())
    M['require'](hashlib.sha256(raw).hexdigest() == M['BASE_SHA'], 'historical base family manifest drift')
    for family in json.loads(raw)['families']:
        if family['excluded']:
            keys = set()
            for member in family['members']:
                keys.update(('p:' + member['promptDigest'], 'shape:' + member['referenceShape']))
                for value in (member['id'], member.get('url'), *member['identities']):
                    if value:
                        keys.update(identity_keys(value))
            rows.append(sorted(keys))
    del raw
    for name, digest in zip(M['PACKS'], M['PACK_SHAS'], strict=True):
        path = M['FIXTURES'] / name
        M['require'](M['file_digest'](path) == digest, 'historical source pack drift')
        opener = gzip.open if path.suffix == '.gz' else open
        with opener(path, 'rt', encoding='utf-8') as stream:
            pack = json.load(stream)
        for row in pack['cases']:
            provenance = row.get('provenance', {})
            keys = {M['prompt_key'](row['prompt'])} if isinstance(row.get('prompt'), str) else set()
            if provenance.get('implementationShape'):
                keys.add('shape:' + provenance['implementationShape'])
            for field in ('sourceIdentities', 'upstreamIds'):
                for value in provenance.get(field, []):
                    keys.update(identity_keys(value))
            for value in (provenance.get('sourceId'), provenance.get('sourceIdentity'), row.get('sourceId')):
                if isinstance(value, str):
                    keys.update(identity_keys(value))
            if keys:
                rows.append(sorted(keys))
        del pack
    return rows


def reference_shapes(candidates):
    # Use the same implementation-shape function as the retained population.
    program = """import { readFileSync } from 'node:fs';
import { referenceShape } from './scripts/lib/rsi-semantic-corpus-import.mjs';
const references = JSON.parse(readFileSync(0, 'utf8'));
process.stdout.write(JSON.stringify(references.map(reference => referenceShape(reference))));"""
    payload = [{'language': 'python' if row['runtime'] == 'python3' else row['runtime'], 'source': row['reference']}
               for row in candidates]
    reply = subprocess.run(['node', '--max-old-space-size=384', '--input-type=module', '-e', program], cwd=ROOT,
                           input=json.dumps(payload), encoding='utf-8', capture_output=True, timeout=60, check=True)
    return json.loads(reply.stdout)


def build_review(manifest_path, expected_sha):
    manifest = M['checked_json'](manifest_path, expected_sha)
    M['require'](manifest.get('schemaVersion') == 'RsiUsacoFamilyReviewPlan/v1' and manifest.get('driven_by') == 'agent'
                 and isinstance(manifest.get('candidates'), list) and manifest['candidates'], 'family review plan required')
    bindings = {name: M['file_digest'](ROOT / name) for name in sorted(set(SOURCES))}
    M['require'](manifest.get('sourceFilesSha256') == bindings, 'family review source drift')
    shape_runtime = {'nodeVersion': subprocess.check_output(['node', '--version'], encoding='utf-8').strip(),
                     'typescriptSha256': M['file_digest'](ROOT / 'node_modules/typescript/lib/typescript.js')}
    M['require'](manifest.get('shapeRuntime') == shape_runtime, 'implementation shape runtime drift')
    selection_path = Path(manifest['selection']['path'])
    selection = M['checked_json'](selection_path, manifest['selection']['sha256'])
    M['require'](selection['schemaVersion'] == 'RsiProspectiveSourceSelection/v1', 'original source selection required')
    index = selection_path.parent / 'source-queue.jsonl.gz'
    M['require'](M['file_digest'](index) == selection['compressedIndexSha256'], 'source queue transport drift')
    queue = Q['checked_index'](index, selection['indexSha256'])
    candidates, receipts = [], []
    for item in manifest['candidates']:
        row, receipt = U['replay'](Path(item['plan']), item['planSha256'], Path(item['directory']))
        candidates.append(row)
        receipts.append({'sourceIdentity': row['sourceIdentity'], 'outputComparison': row['outputComparison'],
                         'candidateSha256': receipt['candidateSha256'],
                         'planSha256': item['planSha256'], 'intakeSha256': M['file_digest'](Path(item['directory']) / 'intake.json')})
    shapes = reference_shapes(candidates)
    families = join_families(queue, candidates, shapes, historical_keys())
    return {'schemaVersion': 'RsiUsacoFamilyReview/v2', 'driven_by': 'agent', 'actor': 'codex/rsi-usaco-family-review',
            'realHumanEvidence': False, 'planSha256': expected_sha, 'sourceFilesSha256': bindings,
            'shapeRuntime': shape_runtime,
            'sourceSelectionSha256': manifest['selection']['sha256'], 'sourceQueueSha256': selection['indexSha256'],
            'historicalPacksSha256': dict(zip(M['PACKS'], M['PACK_SHAS'], strict=True)),
            'historicalBaseManifestSha256': M['BASE_SHA'],
            'sourceCandidates': sorted(receipts, key=lambda row: row['sourceIdentity']), 'families': families,
            'counts': dict(Counter(row['status'] for row in families)),
            'semanticIndependenceReview': 'pending', 'formalAdmission': False, 'runnerCalibration': False,
            'qualifiedFamilyIncrement': 0, 'modelRequests': 0, 'executedPrograms': 0}


def inspect(manifest_path, expected_sha, output, verify=False):
    M['require'](verify or not output.exists(), 'new family review output required')
    report = build_review(manifest_path, expected_sha)
    if verify:
        M['require'](M['compact'](json.loads((output / 'family-review.json').read_bytes())) == M['compact'](report),
                     'family review replay drift')
    else:
        output.mkdir(parents=True)
        M['write_report'](output / 'family-review.json', report)
    return report


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--plan', type=Path, required=True)
    parser.add_argument('--plan-sha256', required=True)
    parser.add_argument('--output-directory', type=Path, required=True)
    parser.add_argument('--verify', action='store_true')
    args = parser.parse_args()
    report = inspect(args.plan, args.plan_sha256, args.output_directory, args.verify)
    print(json.dumps({key: report[key] for key in ('schemaVersion', 'counts', 'qualifiedFamilyIncrement', 'modelRequests')}))
