"""Bind an explicitly reviewed USACO reference to the complete official test archive."""
import argparse
import ast
from html.parser import HTMLParser
import json
from pathlib import Path, PurePosixPath
import re
import runpy
import stat
from urllib.parse import parse_qs, urljoin, urlsplit
import zipfile

ROOT = Path(__file__).resolve().parents[1]
M = runpy.run_path(str(ROOT / 'scripts/rsi-openr1-intake.py'))
CONTRACTS = 'harness/specs/fixtures/rsi-live-experience/usaco-output-contracts.json'
SOURCES = ('scripts/rsi-usaco-source-intake.py', 'scripts/rsi-openr1-intake.py', CONTRACTS)
LIMIT = 64 * 1024 * 1024


class Page(HTMLParser):
    def __init__(self, text):
        super().__init__(convert_charrefs=True)
        self.links, self.blocks, self.prompt = [], [], []
        self.sample_blocks = []
        self.heading = None
        self.sample_label = None
        self.in_pre, self.problem_depth = False, 0
        self.feed(text)
        self.close()

    def handle_starttag(self, tag, attrs):
        attrs = dict(attrs)
        if tag == 'a' and attrs.get('href'):
            self.links.append(attrs['href'])
        if tag == 'pre':
            self.in_pre = True
            self.blocks.append('')
            if self.problem_depth:
                kinds = set(attrs.get('class', '').split()) & {'in', 'out'}
                if self.sample_label:
                    kinds.add(self.sample_label)
                M['require'](len(kinds) <= 1, 'conflicting public sample labels')
                if kinds:
                    self.sample_blocks.append((kinds.pop(), len(self.blocks) - 1))
                self.sample_label = None
        if self.problem_depth and tag == 'h4':
            M['require'](self.sample_label is None, 'public sample block missing')
            self.heading = []
        if tag == 'span':
            if self.problem_depth:
                self.problem_depth += 1
            elif attrs.get('id') == 'probtext-text':
                self.problem_depth = 1
        if self.problem_depth and tag in ('p', 'div', 'h4', 'pre', 'br', 'li'):
            self.prompt.append('\n')

    def handle_endtag(self, tag):
        if tag == 'h4' and self.heading is not None:
            match = re.fullmatch(r'\s*SAMPLE\s+(INPUT|OUTPUT)(?:\s+\d+)?\s*:?\s*', ''.join(self.heading), re.I)
            self.sample_label = {'INPUT': 'in', 'OUTPUT': 'out'}[match[1].upper()] if match else None
            self.heading = None
        if tag == 'pre':
            self.in_pre = False
        if self.problem_depth and tag in ('p', 'div', 'h4', 'pre', 'li'):
            self.prompt.append('\n')
        if self.problem_depth and tag == 'span':
            self.problem_depth -= 1

    def handle_data(self, data):
        if self.heading is not None:
            self.heading.append(data)
        if self.in_pre:
            self.blocks[-1] += data
        if self.problem_depth:
            self.prompt.append(data)

    def public_pairs(self):
        samples = self.sample_blocks
        M['require'](self.sample_label is None and len(samples) % 2 == 0 and all(kind == ('in', 'out')[i % 2]
                     for i, (kind, _) in enumerate(samples)), 'unpaired public sample input/output')
        return {(sample_text(self.blocks[samples[i][1]]), sample_text(self.blocks[samples[i + 1][1]]))
                for i in range(0, len(samples), 2)}


def sample_text(value):
    return '\n'.join(line.rstrip() for line in value.replace('\r\n', '\n').replace('\r', '\n').split('\n')).strip()


def official_url(value):
    parsed = urlsplit(value)
    M['require'](parsed.scheme in ('http', 'https') and parsed.netloc in ('usaco.org', 'www.usaco.org')
                 and not parsed.fragment, 'official USACO URL required')
    return 'https://usaco.org' + parsed.path + ('?' + parsed.query if parsed.query else '')


def problem_identity(value):
    parsed = urlsplit(official_url(value))
    query = parse_qs(parsed.query)
    M['require'](parsed.path == '/index.php' and query.get('page') == ['viewproblem2']
                 and set(query) == {'page', 'cpid'} and len(query['cpid']) == 1
                 and re.fullmatch(r'[1-9][0-9]*', query['cpid'][0]), 'USACO problem identity required')
    return 'usaco:' + query['cpid'][0]


def official_pairs(archive_path):
    with zipfile.ZipFile(archive_path) as archive:
        members = archive.infolist()
        M['require'](members and len(members) <= 10000 and sum(m.file_size for m in members) <= LIMIT,
                     'complete archive exceeds intake bound')
        files = {}
        for member in members:
            name = PurePosixPath(member.filename)
            mode = member.external_attr >> 16
            M['require'](len(name.parts) == 1 and name.name == member.filename and
                         re.fullmatch(r'[A-Za-z0-9_-]+\.(in|out)', member.filename) and
                         member.filename not in files and not member.flag_bits & 1 and
                         member.compress_type in (zipfile.ZIP_STORED, zipfile.ZIP_DEFLATED) and
                         stat.S_IFMT(mode) in (0, stat.S_IFREG), 'unsupported or duplicate archive member')
            files[member.filename] = member
        inputs = {name[:-3] for name in files if name.endswith('.in')}
        outputs = {name[:-4] for name in files if name.endswith('.out')}
        M['require'](inputs == outputs and inputs, 'complete official input/output pairs required')
        # Decode without newline conversion; every archive vector survives intake.
        def read(name):
            member = files[name]
            with archive.open(member) as stream:
                body = stream.read(member.file_size + 1)
            M['require'](len(body) == member.file_size, 'archive member size drift')
            return body.decode('utf-8')
        vectors = [{'testId': name, 'input': read(name + '.in'), 'output': read(name + '.out')}
                   for name in sorted(inputs)]
    issue = M['vector_issue'](vectors)
    M['require'](issue is None, issue or 'invalid official vectors')
    return vectors


def build_candidate(plan_path, expected_sha):
    plan = M['checked_json'](plan_path, expected_sha)
    M['require'](plan.get('schemaVersion') == 'RsiUsacoSourceIntakePlan/v1' and
                 plan.get('driven_by') == 'agent' and plan.get('executionMode') == 'source-only',
                 'agent-driven source-only plan required')
    bindings = {name: M['file_digest'](ROOT / name) for name in SOURCES}
    M['require'](plan.get('sourceFilesSha256') == bindings, 'source intake executor drift')
    artifacts, paths = plan['artifacts'], {}
    M['require'](set(artifacts) == {'results', 'problem', 'solution', 'tests'}, 'complete source snapshots required')
    for name, artifact in artifacts.items():
        path = plan_path.parent / artifact['file']
        M['require'](Path(artifact['file']).name == artifact['file'] and path.is_file() and
                     0 < path.stat().st_size <= LIMIT and M['file_digest'](path) == artifact['sha256'],
                     'source snapshot drift: ' + name)
        official_url(artifact['url'])
        paths[name] = path
    source_id = problem_identity(artifacts['problem']['url'])
    results_query = parse_qs(urlsplit(official_url(artifacts['results']['url'])).query)
    M['require'](set(results_query) == {'page'} and len(results_query['page']) == 1 and
                 re.fullmatch(r'(jan|feb|dec|open)[0-9]{2}results', results_query['page'][0]),
                 'official contest results page required')
    contest = results_query['page'][0].removesuffix('results')
    links = [official_url(urljoin(artifacts['results']['url'], href)) for href in
             Page(paths['results'].read_text(encoding='utf-8')).links
             if 'viewproblem2' in href or '/data/' in href or href.endswith(('.zip', '.html'))]
    problem_url = official_url(artifacts['problem']['url'])
    M['require'](links.count(problem_url) == 1, 'official results problem binding required')
    start = links.index(problem_url) + 1
    end = next((i for i in range(start, len(links)) if 'viewproblem2' in links[i]), len(links))
    selected = links[start:end]
    tests_url, solution_url = (official_url(artifacts[name]['url']) for name in ('tests', 'solution'))
    stem = urlsplit(tests_url).path.removeprefix('/current/data/').removesuffix('.zip')
    M['require'](tests_url in selected and solution_url in selected and
                 re.fullmatch(r'prob[1-3]_(bronze|silver|gold|platinum)_(jan|feb|dec|open)[0-9]{2}', stem) and
                 stem.endswith('_' + contest) and
                 solution_url == 'https://usaco.org/current/data/sol_' + stem + '.html',
                 'official results test/solution binding required')
    problem_html = paths['problem'].read_text(encoding='utf-8')
    for cpid in re.findall(r'viewproblem2(?:&amp;|&)cpid=(\d+)(?:&amp;|&)lang=', problem_html):
        M['require'](source_id == 'usaco:' + cpid, 'problem page cpid disagrees with source identity')
    page = Page(problem_html)
    prompt = ''.join(page.prompt).strip()
    M['require'](40 <= len(prompt) <= 200000 and 'stdin' in prompt and 'stdout' in prompt,
                 'complete public stdin/stdout problem required')
    choice = plan['referenceSelection']
    M['require'](type(choice.get('preIndex')) is int and choice['preIndex'] >= 0 and
                 choice.get('runtime') in ('python3', 'cpp') and choice.get('purpose') == 'full-credit-calibration' and
                 isinstance(choice.get('basis'), str) and choice['basis'].strip(), 'explicit full-credit reference review required')
    blocks = Page(paths['solution'].read_text(encoding='utf-8')).blocks
    M['require'](choice['preIndex'] < len(blocks), 'selected reference block missing')
    reference = blocks[choice['preIndex']]
    M['require'](reference.strip() and len(reference.encode('utf-8')) <= 2_000_000 and
                 M['digest'](reference) == choice['sha256'], 'selected reference bytes drift')
    if choice['runtime'] == 'python3':
        ast.parse(reference)
    else:
        M['require'](re.search(r'\b(?:int|signed|auto)\s+main\s*\(', reference), 'C++ main declaration required')
    vectors = official_pairs(paths['tests'])
    M['require'](type(plan.get('officialVectorCount')) is int and plan['officialVectorCount'] == len(vectors),
                 'frozen official vector count drift')
    reviewed = json.loads((ROOT / CONTRACTS).read_bytes()).get(source_id, {})
    captured = reviewed.get('artifacts')
    if 'snapshotReceipt' in plan:
        receipt = plan['snapshotReceipt']
        M['require'](Path(receipt['file']).name == receipt['file'], 'local acquisition receipt required')
        snapshot = M['checked_json'](plan_path.parent / receipt['file'], receipt['sha256'])
        M['require'](snapshot.get('schemaVersion') == 'RsiUsacoSnapshotReceipt/v1', 'acquisition receipt required')
        captured = snapshot['artifacts']
    actual = {name: {'url': official_url(a['url']), 'sha256': a['sha256']} for name, a in artifacts.items()}
    M['require'](captured == actual, 'source URLs and snapshot digests must match acquisition receipt')
    comparison = 'pending'
    if reviewed and all(actual[k] == reviewed['artifacts'][k] for k in ('problem', 'solution', 'tests')):
        comparison = reviewed['comparison']
    samples = page.public_pairs()
    for vector in vectors:
        pair = (sample_text(vector['input']), sample_text(vector['output']))
        vector['visibility'] = 'public' if pair in samples else 'private'
    row = {'schemaVersion': 'RsiUsacoSourceCandidate/v1', 'driven_by': 'agent',
           'sourceIdentity': source_id, 'prompt': prompt, 'runtime': choice['runtime'], 'reference': reference,
           'vectors': vectors, 'identityKeys': [source_id, problem_url, M['prompt_key'](prompt)],
           'sourceArtifacts': artifacts, 'referenceSelection': choice, 'outputComparison': comparison,
           'status': 'pending-family-review-and-native-calibration', 'formalAdmission': False,
           'referenceFullCreditVerified': False}
    return row, bindings


def intake_report(row, bindings, expected_sha, candidate_sha):
    return {'schemaVersion': 'RsiUsacoSourceIntake/v1', 'driven_by': 'agent', 'actor': 'codex/rsi-usaco-source-intake',
              'realHumanEvidence': False, 'planSha256': expected_sha, 'sourceFilesSha256': bindings,
              'sourceIdentity': row['sourceIdentity'], 'referenceBlockIndex': row['referenceSelection']['preIndex'],
              'vectors': len(row['vectors']), 'distinctInputs': len({v['input'] for v in row['vectors']}),
              'candidateSha256': candidate_sha,
              'status': row['status'], 'formalAdmission': False, 'runnerCalibration': False,
              'referenceFullCreditVerified': False,
              'executedPrograms': 0, 'modelRequests': 0, 'benefit': 'NO_GO', 'adoption': 'hold'}


def inspect(plan_path, expected_sha, output):
    M['require'](not output.exists(), 'new output directory required')
    row, bindings = build_candidate(plan_path, expected_sha)
    output.mkdir(parents=True)
    M['write_report'](output / 'source-candidate.json', row)
    report = intake_report(row, bindings, expected_sha, M['file_digest'](output / 'source-candidate.json'))
    M['write_report'](output / 'intake.json', report)
    return report


def replay(plan_path, expected_sha, directory):
    row, bindings = build_candidate(plan_path, expected_sha)
    candidate = directory / 'source-candidate.json'
    M['require'](M['compact'](json.loads(candidate.read_bytes())) == M['compact'](row), 'source candidate replay drift')
    report = intake_report(row, bindings, expected_sha, M['file_digest'](candidate))
    M['require'](M['compact'](json.loads((directory / 'intake.json').read_bytes())) == M['compact'](report),
                 'source intake report replay drift')
    return row, report


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--plan', type=Path, required=True)
    parser.add_argument('--plan-sha256', required=True)
    parser.add_argument('--output-directory', type=Path, required=True)
    parser.add_argument('--verify', action='store_true')
    args = parser.parse_args()
    report = replay(args.plan, args.plan_sha256, args.output_directory)[1] if args.verify else \
        inspect(args.plan, args.plan_sha256, args.output_directory)
    print(json.dumps(report, indent=2))
