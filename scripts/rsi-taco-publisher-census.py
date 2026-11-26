"""Join a pinned publisher intake into the complete retained prospective family census."""
import argparse
from collections import defaultdict
import gzip
import json
from pathlib import Path
import re
import runpy
from urllib.parse import urlsplit, urlunsplit

ROOT = Path(__file__).resolve().parents[1]
M = runpy.run_path(str(ROOT / 'scripts/rsi-openr1-intake.py'))
ORIGINAL_CENSUS = M['joint_census']
FUNCTION_SHA = 'a605c65e757bfb0da5506474b71c99c09925200ce747089b7c7ea1040f78cce3'
NATIVE_SHA = '275d15a2168f8752731dacebea1887fb679d30e7b80c33a82c9bb21f6e0c23a5'
REVISION = 'd593ed0a2becbbc952230bb89be09189bf1056dc'
NEW_TIERS = ('tacoTrainStrings', 'tacoTrainLines', 'tacoTestStrings', 'tacoTestFunctions', 'tacoTestLines')


def source_keys(identity):
    keys = [identity, M['cf_key'](identity)]
    parsed = urlsplit(identity)
    if parsed.scheme.lower() in ('http', 'https'):
        host = parsed.netloc.lower()
        if host.startswith('www.'):
            host = host[4:]
        normalized = urlunsplit((parsed.scheme.lower(), host, re.sub('/+', '/', parsed.path).rstrip('/'), parsed.query, ''))
        keys += [normalized, 'url:' + normalized, M['cf_key'](normalized)]
    return keys


def publisher_census(graph, historical, tiers, functions, records, forbidden_shapes, bad_refs,
                     identities=(), supplemental_components=None, candidate_components=None, require_screened_base=False):
    additions = defaultdict(list)
    for label, rows in [('tacoFunctions', functions), ('publisher', records), ('identities', identities)]:
        for row in rows:
            key = 'taco-intake:' + row['upstreamId']
            keys = [key, 'p:' + row['promptDigest']]
            if row['sourceIdentity']:
                keys += source_keys(row['sourceIdentity'])
            graph.join(keys)
            if row['referenceShape'] in forbidden_shapes:
                historical.add(key)
            if row['eligible']:
                if label == 'publisher':
                    label_for_row = {'strings': 'tacoTrainStrings', 'function': 'tacoFunctions',
                                     'lines': 'tacoTrainLines'}[row['kind']] if row['nativeSplit'] == 'train' else {
                        'strings': 'tacoTestStrings', 'function': 'tacoTestFunctions', 'lines': 'tacoTestLines'}[row['kind']]
                else:
                    label_for_row = label
                additions[label_for_row].append((key, row))
    rejected = [row for row in tiers['alternateReference'] if
                (row[1]['familyId'], row[1]['reference']['sha256'], row[1]['officialSubsetSha256']) in bad_refs]
    extended = {}
    for label, rows in tiers.items():
        extended[label] = [row for row in rows if row not in rejected] if label == 'alternateReference' else rows
        if label == 'alternateReference':
            for added in ('tacoFunctions', *NEW_TIERS):
                extended[added] = additions[added]
    if require_screened_base:
        verified = {graph.root(key) for label, rows in extended.items()
                    if label in ('openR1', 'codeContestsPassed', 'tacoFunctions', *NEW_TIERS)
                    for key, _ in rows}
        legacy = extended['base']
        extended['base'] = [row for row in legacy if graph.root(row[0]) in verified]
        extended['legacyBaseHeld'] = [row for row in legacy if graph.root(row[0]) not in verified]
    report, deltas = ORIGINAL_CENSUS(graph, historical, extended)
    screened = sum(report['tiers'][label]['additional'] for label in ('base', 'openR1', 'codeContestsPassed', 'tacoFunctions', *NEW_TIERS))
    alternate = screened + report['tiers']['alternateReference']['additional']
    named = alternate + report['tiers']['supplementalNamed']['additional']
    report.update(schemaVersion='RsiProspectivePublisherJointCensus/v1', actor='codex/rsi-taco-publisher-census', screenedUpperBound=screened,
                  withAlternateUpperBound=alternate, withAlternateAndNamedSupplementalUpperBound=named,
                  allListedShortfall=max(0, 6264 - report['allListedRoutesUpperBound']), namedShortfall=max(0, 6264 - named))
    if require_screened_base:
        report.update(schemaVersion='RsiProspectivePublisherJointCensus/v5',
                      legacyBaseContract='base credit requires a current screened source in the same complete component',
                      legacyBaseHeldRows=len(extended['legacyBaseHeld']))
    members = defaultdict(list)
    for key in graph.parents:
        members[graph.root(key)].append(key)
    excluded = {graph.root(key) for key in historical}
    choices = defaultdict(dict)
    if candidate_components is not None:
        for label, rows in extended.items():
            for key, row in rows:
                choice = {'tier': label, 'identityKey': key, 'record': row}
                choices[graph.root(key)][M['compact'](choice)] = choice
    covered, fresh_records = set(), []
    for label, rows in extended.items():
        grouped = defaultdict(list)
        for key, row in rows:
            grouped[graph.root(key)].append(row)
        fresh = grouped.keys() - excluded - covered
        if candidate_components is not None:
            for component in fresh:
                keys = sorted(members[component])
                candidate_components.append({'tier': label, 'componentSha256': M['digest'](M['compact'](keys)),
                                             'identityKeys': keys,
                                             'candidateRecords': [choices[component][key] for key in sorted(choices[component])]})
        if supplemental_components is not None and label in ('supplementalNamed', 'supplementalHeld'):
            for component in fresh:
                keys = sorted(members[component])
                ids = sorted(key.removeprefix('supplemental:') for key in keys if key.startswith('supplemental:'))
                M['require'](bool(ids), 'supplemental component has no source row')
                supplemental_components.append({'tier': label, 'componentSha256': M['digest'](M['compact'](keys)),
                                                'supplementalIds': ids, 'identityKeys': keys})
        if label in NEW_TIERS:
            for component in fresh:
                representative = min(grouped[component], key=lambda row: row['upstreamId'])
                fresh_records.append({'tier': label, 'componentSha256': M['digest'](M['compact'](sorted(members[component]))),
                                      **representative})
        covered.update(fresh)
    return report, deltas, sorted(fresh_records, key=lambda row: (row['tier'], row['upstreamId']))


def inspect(args):
    M['require'](getattr(args, 'identity_index', None) is not None, 'complete publisher identity index required')
    all_native = getattr(args, 'all_native_records', False)
    records = list(M['checked_rows'](args.index, args.index_sha256))
    M['require'](len(records) == (26443 if all_native else 2139) and
                 sum(row['nativeSplit'] == 'test' for row in records) == 1000,
                 'publisher row coverage drift')
    seen = set()
    for row in records:
        split = row['nativeSplit']
        M['require'](split in ('train', 'test') and row['shard'].startswith('ALL/' + split + '-') and
                     type(row['rowIndex']) is int and 0 <= row['rowIndex'] < (1000 if split == 'test' else 2827) and
                     row['upstreamId'] == f"taco:{row['shard']}#{row['rowIndex']}" and row['upstreamId'] not in seen,
                     'publisher record identity drift')
        seen.add(row['upstreamId'])
        if row['eligible']:
            M['require'](row['distinctInputs'] >= 5 and row['referenceSha256'] and row['referenceShape'] and
                         (all_native or split != 'train' or row['kind'] == 'lines'), 'publisher record screening drift')
    identities = []
    identity_path = getattr(args, 'identity_index', None)
    if identity_path is not None:
        identity_sha = getattr(args, 'identity_index_sha256', None)
        M['require'](isinstance(identity_sha, str) and re.fullmatch('[0-9a-f]{64}', identity_sha),
                     'identity index digest required')
        identities = list(M['checked_rows'](identity_path, identity_sha))
        M['require'](len(identities) == 26443 and sum(row['nativeSplit'] == 'test' for row in identities) == 1000,
                     'complete publisher identity coverage required')
        identity_ids = set()
        publisher_by_id = {row['upstreamId']: row for row in records}
        for row in identities:
            split = row['nativeSplit']
            shard = row['shard']
            M['require'](split in ('train', 'test') and
                         re.fullmatch(r'ALL/(?:train-0000[0-8]-of-00009|test-00000-of-00001)\.parquet', shard) and
                         shard.startswith('ALL/' + split + '-') and type(row['rowIndex']) is int and
                         0 <= row['rowIndex'] < (1000 if split == 'test' else 2827) and
                         row['upstreamId'] == f"taco:{shard}#{row['rowIndex']}" and
                         row['upstreamId'] not in identity_ids and row['eligible'] is False and row['referenceShape'] is None and
                         isinstance(row['sourceIdentity'], str) and row['sourceIdentity'] and
                         row.get('sourceIdentityEvidence') in ('upstream-url', 'source-name', 'pinned-row') and
                         re.fullmatch('[0-9a-f]{64}', row['promptDigest']) and
                         re.fullmatch('[0-9a-f]{64}', row['sourceProjectionSha256']), 'publisher identity row drift')
            identity_ids.add(row['upstreamId'])
            if row['upstreamId'] in publisher_by_id:
                M['require'](row['promptDigest'] == publisher_by_id[row['upstreamId']]['promptDigest'] and
                             row['sourceIdentity'] == publisher_by_id[row['upstreamId']]['sourceIdentity'],
                             'publisher source identity drift')
        M['require'](not all_native or identity_ids == seen, 'all-native publisher index coverage drift')
    functions = list(M['checked_rows'](args.function_index, FUNCTION_SHA))
    M['require'](len(functions) == 3244 and sum(row['eligible'] for row in functions) == 1495, 'function row coverage drift')
    native = M['checked_json'](args.native_report, NATIVE_SHA)
    M['require'](native['status'] == 'complete' and native['qualifiedAlternates'] == 0, 'alternate reference verdict drift')
    bad_refs = {(row['familyId'], row['referenceSha256'], row['officialSubsetSha256']) for row in native['cases']}
    forbidden_shapes = set()
    for name, sha in zip(M['PACKS'], M['PACK_SHAS'], strict=True):
        path = M['FIXTURES'] / name
        M['require'](M['file_digest'](path) == sha, 'historical pack drift')
        raw = path.read_bytes()
        pack = json.loads(gzip.decompress(raw) if path.suffix == '.gz' else raw)
        forbidden_shapes.update(row.get('provenance', {}).get('implementationShape') for row in pack['cases'])
    forbidden_shapes.discard(None)

    fresh_rows = []
    supplemental_components = [] if getattr(args, 'supplemental_components', False) else None
    candidate_components = [] if getattr(args, 'candidate_components', False) else None

    def extended(graph, historical, tiers):
        report, deltas, fresh = publisher_census(graph, historical, tiers, functions, records, forbidden_shapes, bad_refs,
                                                identities, supplemental_components, candidate_components, all_native)
        fresh_rows.extend(fresh)
        delta_sha = M['digest'](''.join(M['compact'](row) + '\n' for row in fresh))
        report['publisherIntake'] = {'indexSha256': args.index_sha256, 'revision': REVISION, 'rows': len(records),
                                     'freshComponents': len(fresh), 'deltaIndexSha256': delta_sha,
                                     'functionIndexSha256': FUNCTION_SHA, 'alternateReportSha256': NATIVE_SHA,
                                     'historicalImplementationShapes': len(forbidden_shapes)}
        if identity_path is not None:
            report.update(schemaVersion='RsiProspectivePublisherJointCensus/v5' if all_native else 'RsiProspectivePublisherJointCensus/v3')
            report['publisherIntake']['identityInventory'] = {'rows': len(identities), 'indexSha256': identity_sha,
                                                              'contract': 'native-url-source-name-or-pinned-row'}
        report['publisherIntake']['allNativeRecords'] = all_native
        if supplemental_components is not None:
            ordered = sorted(supplemental_components, key=lambda row: (row['tier'], row['componentSha256']))
            report['supplementalComponentsSha256'] = M['digest'](''.join(M['compact'](row) + '\n' for row in ordered))
        if candidate_components is not None:
            ordered = sorted(candidate_components, key=lambda row: (row['tier'], row['componentSha256']))
            M['require'](len(ordered) == report['allListedRoutesUpperBound'], 'candidate component coverage drift')
            report.update(schemaVersion='RsiProspectivePublisherJointCensus/v5' if all_native else 'RsiProspectivePublisherJointCensus/v4',
                          candidateComponents=len(ordered),
                          candidateComponentsSha256=M['digest'](''.join(M['compact'](row) + '\n' for row in ordered)),
                          componentExporterSha256=M['file_digest'](ROOT / 'scripts/rsi-taco-publisher-census.py'))
        return report, deltas

    M['inspect'].__globals__['joint_census'] = extended
    M['inspect'](args.sources, args.family_manifest, args.output_directory, args.codecontests, args.supplemental)
    path = args.output_directory / 'publisher-delta.jsonl'
    with path.open('x', encoding='utf-8', newline='\n') as target:
        for row in fresh_rows:
            target.write(M['compact'](row) + '\n')
    report = json.loads((args.output_directory / 'joint-census.json').read_bytes())
    M['require'](M['file_digest'](path) == report['publisherIntake']['deltaIndexSha256'], 'publisher delta write drift')
    if supplemental_components is not None:
        path = args.output_directory / 'supplemental-components.jsonl'
        with path.open('x', encoding='utf-8', newline='\n') as target:
            for row in sorted(supplemental_components, key=lambda row: (row['tier'], row['componentSha256'])):
                target.write(M['compact'](row) + '\n')
        M['require'](M['file_digest'](path) == report['supplementalComponentsSha256'], 'supplemental component write drift')
    if candidate_components is not None:
        path = args.output_directory / 'candidate-components.jsonl'
        with path.open('x', encoding='utf-8', newline='\n') as target:
            for row in sorted(candidate_components, key=lambda row: (row['tier'], row['componentSha256'])):
                target.write(M['compact'](row) + '\n')
        M['require'](M['file_digest'](path) == report['candidateComponentsSha256'], 'candidate component write drift')


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    for name in ('sources', 'family-manifest', 'codecontests', 'supplemental', 'index', 'function-index', 'native-report', 'output-directory'):
        parser.add_argument('--' + name, type=Path, required=True)
    parser.add_argument('--index-sha256', required=True)
    parser.add_argument('--identity-index', type=Path, required=True)
    parser.add_argument('--identity-index-sha256', required=True)
    parser.add_argument('--supplemental-components', action='store_true', help='Retain the remaining named and held source components.')
    parser.add_argument('--candidate-components', action='store_true', help='Retain all fresh components and eligible source alternatives for admission review.')
    parser.add_argument('--all-native-records', action='store_true', help='Use a digest-bound complete publisher record index.')
    inspect(parser.parse_args())
