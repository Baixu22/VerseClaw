"""Offline integrity and outcome checks. Makes no model or network requests."""
import csv
import hashlib
import json
import re
import subprocess
from datetime import datetime, timezone
from pathlib import Path

root = Path(__file__).resolve().parent


def read_json(name):
    return json.loads((root / name).read_text(encoding='utf-8'))


def read_jsonl(name):
    return [json.loads(line) for line in (root / name).read_text(encoding='utf-8').splitlines() if line.strip()]


def answer_json(turn):
    return json.loads(re.sub(r'^```(?:json)?\s*|\s*```$', '', turn['answer'].strip()))


manifest = read_json('manifest.json')
for item in manifest['files']:
    path = (root / item['path']).resolve()
    assert path.is_relative_to(root), item['path']
    content = path.read_bytes()
    assert len(content) == item['bytes'], item['path']
    assert hashlib.sha256(content).hexdigest() == item['sha256'], item['path']
    if path.suffix != '.png':
        assert not re.search(rb'\bsk-[A-Za-z0-9_-]{16,}\b', content), item['path']

turns = read_jsonl('dataset.jsonl')
by_id = {turn['id']: turn for turn in turns}
sessions = read_json('sessions.json')
summary = read_json('summary.json')
assert len(turns) == len(by_id) == 18
assert len(sessions) == len({turn['sessionId'] for turn in turns}) == 6
assert len({turn['runId'] for turn in turns}) == 18
assert summary['humanQualifyingRuns'] == 0 and summary['mocked'] is False
assert summary['costUsd'] is None

messages = []
for session in sessions:
    rows = read_jsonl(session['transcript'])
    entries = {row['id']: row for row in rows if 'id' in row}
    assert rows[0]['id'] == session['sessionId']
    messages.extend(row['message'] for row in rows if 'message' in row)
    for turn in (turn for turn in turns if turn['sessionId'] == session['sessionId']):
        assert turn['model'] == 'senseaudio-s2-flash'
        assert turn['operator'] == 'user-authorized-codex-cdp'
        assert turn['attempts']
        for attempt in turn['attempts']:
            user = attempt['userEntry']
            assert entries[user['id']] == user
            assert user['message']['idempotencyKey'] == turn['runId'] + ':user'
            for response in attempt['responses']:
                assert entries[response['id']] == response
        if session['workspaceScope'] == 'isolated-exercise-workspace':
            assert session['workspaceAtRun'] == '<WORKSPACE>'
        else:
            # The first two samples used the application's default workspace.
            # They must not be mislabeled as isolated file-tool exercises.
            tools = [entry['message']['toolName'] for attempt in turn['attempts'] for entry in attempt['responses'] if entry['message']['role'] == 'toolResult']
            assert set(tools) <= {'update_plan'}

assert sum(message.get('role') == 'user' for message in messages) == summary['counts']['nativeUserEntries'] == 19
assert sum(message.get('role') == 'assistant' for message in messages) == summary['counts']['modelMessageEntries'] == 73
assert sum(message.get('role') == 'toolResult' for message in messages) == summary['counts']['toolResultEntries'] == 56
for field, expected in summary['usage'].items():
    actual = sum(message.get('usage', {}).get(field, 0) for message in messages if message.get('role') == 'assistant')
    assert actual == expected, field
assert summary['usage']['input'] + summary['usage']['output'] + summary['usage']['cacheRead'] + summary['usage']['cacheWrite'] == summary['usage']['totalTokens']

assert answer_json(by_id['s01-t03']) == {'project': '青松', 'owner': '林舟', 'date': '2026-09-18', 'start': '15:10', 'end': '15:55', 'budget': 4200}
assert by_id['s02-t01']['assessment']['status'] == 'failed'
assert answer_json(by_id['s02-t01'])['totalCents'] == 4247
assert answer_json(by_id['s02-t02']) == {'lineTotalsCents': [2598, 1650, 3000], 'subtotalCents': 7248, 'discountCents': 500, 'totalCents': 6748}
assert answer_json(by_id['s02-t03']) == {'subtotalCents': 7798, 'totalCents': 7298, 'withinBudget': True, 'remainingCents': 702}
assert by_id['s03-t02']['status'] == 'aborted-after-tool-timeout'
assert read_json('coding-independent-verification.json')['exitCode'] == 0
assert read_json('coding-terminal-verification.json')['success'] is False
assert 'unknown method: tools.exec' in read_json('coding-terminal-verification.json')['stderr']

guide = (root / 'workspace-final/docs/harbor-guide.md').read_text(encoding='utf-8')
checklist = (root / 'workspace-final/docs/harbor-checklist.md').read_text(encoding='utf-8')
assert '1.5%' in guide and '1.5%' in checklist
assert '连续3分钟高于2%' not in guide
assert answer_json(by_id['s04-t03'])['candidateNeedsConfirmation'] is True
assert by_id['s05-t01']['status'] == 'aborted-tool-repeat'
with (root / 'workspace-final/data/work-log.csv').open(encoding='utf-8', newline='') as handle:
    csv_rows = list(csv.DictReader(handle))
done = [row for row in csv_rows if row['status'] == 'done']
expected_summary = {'doneCount': len(done), 'doneMinutes': sum(int(row['minutes']) for row in done), 'pendingCount': sum(row['status'] == 'pending' for row in csv_rows), 'doneIds': sorted(row['id'] for row in done)}
assert read_json('workspace-final/data/work-summary.json') == expected_summary == answer_json(by_id['s05-t03'])

retried = by_id['s06-t02']
assert retried['status'] == 'completed-after-retry' and len(retried['attempts']) == 2
assert retried['attempts'][0]['error'] == '500 status code (no body)'
assert retried['attempts'][1]['stopReason'] == 'stop'
assert answer_json(by_id['s06-t03']) == {'project': '北辰', 'tracking': 'NC-731', 'deadline': '2026-09-29', 'owner': '林舟', 'email': None}
reload_session = next(session for session in sessions if session['id'] == 's06-cdp-reload')
assert reload_session['reload']['historyVisible'] is True
assert reload_session['reload']['sessionIdBefore'] == reload_session['sessionId']

replay = subprocess.run(['node', '--test', 'coding/invoice.test.mjs'], cwd=root / 'workspace-final', capture_output=True, text=True, encoding='utf-8', timeout=20)
assert replay.returncode == 0, replay.stdout + replay.stderr
report = {'schema': 'live-cdp-offline-verification/v1', 'status': 'passed', 'checkedAt': datetime.now(timezone.utc).isoformat(), 'hashedFiles': len(manifest['files']), 'cdpUserTurns': len(turns), 'sessions': len(sessions), 'nativeRetryPreserved': True, 'failureSamplesPreserved': True, 'secretPatternMatches': 0, 'fixtureReplay': {'exitCode': replay.returncode, 'stdout': replay.stdout, 'stderr': replay.stderr}, 'modelOrNetworkRequests': 0}
(root / 'verification.json').write_bytes((json.dumps(report, ensure_ascii=False, indent=2) + '\n').encode('utf-8'))
print(json.dumps(report, ensure_ascii=False, indent=2))
