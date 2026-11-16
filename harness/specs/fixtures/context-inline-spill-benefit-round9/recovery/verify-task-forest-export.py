# driven_by: agent; actor: codex-g7-inline-spill-tf0749-01a1d34c; realHumanEvidence: false
from pathlib import Path
from datetime import datetime, timezone
import hashlib, json, sys

forest = Path('D:/ClawX/.agent-workbench/task-forest')
output = Path(sys.argv[1])
meta = dict(driven_by='agent', actor='codex-g7-inline-spill-tf0749-01a1d34c', realHumanEvidence=False)
ids = ['TF-0749', 'TF-0750', 'TF-0751', 'TF-0752', 'TF-0753', 'TF-0754', 'TF-0755', 'TF-0859']
def load(path): return json.loads(path.read_text(encoding='utf-8-sig'))
def by_id(nodes): return {n['id']: n for n in nodes} if isinstance(nodes, list) else nodes
def check(nodes):
    index = by_id(nodes)
    for node_id in ids:
        assert index[node_id]['status'] == 'done', node_id
        assert index[node_id]['progress'] == 100, node_id
    assert set(ids[1:]).issubset(index['TF-0749']['children'])
    return {node_id: dict(status=index[node_id]['status'], progress=index[node_id]['progress']) for node_id in ids}
def digest(path):
    h = hashlib.sha256()
    with path.open('rb') as f:
        for chunk in iter(lambda: f.read(2*1024*1024), b''): h.update(chunk)
    return dict(path=path.as_posix(), bytes=path.stat().st_size, sha256=h.hexdigest())

try:
    graph_path = forest/'exports/task-forest.graph.json'
    graph = load(graph_path)
    html_path = forest/'exports/task-forest.html'
    with html_path.open('rb') as f:
        prefix = f.read(16*1024*1024)
        f.seek(max(0, html_path.stat().st_size-16*1024*1024))
        tail = f.read()
    marker = b'<script id="task-forest-overview-data" type="application/json">'
    start = prefix.index(marker) + len(marker)
    current_text = prefix[start:prefix.index(b'</script>', start)].decode('utf-8')
    current = json.loads(current_text)
    end = tail.index(b'</script>')
    history_tail = tail[:end]
    frame_start = history_tail.rindex(b'{"frameType":')
    last_frame, consumed = json.JSONDecoder().raw_decode(history_tail[frame_start:].decode('utf-8'))
    assert history_tail[frame_start:].decode('utf-8')[consumed:].strip() == ']'
    assert last_frame['frameType'] in ['current_snapshot', 'current_unsaved']
    statuses = check(graph['nodes'])
    assert check(current['nodes']) == statuses
    assert check(last_frame['data']['nodes']) == statuses
    latest = sorted((forest/'snapshots').glob('*.json'))[-1]
    snapshot = load(latest)
    assert check(snapshot['graph']['nodes']) == statuses
    assert current == last_frame['data']
    result = dict(schema='G7TaskForestExportReadback/v1', **meta, checkedAt=datetime.now(timezone.utc).isoformat(), passed=True, nodes=statuses, graph=digest(graph_path), html=digest(html_path), latestSnapshot=digest(latest), currentAndLastHtmlFrameMatch=True, lastFrameType=last_frame['frameType'], lastFrameSaved=last_frame['saved'], lastFrameSnapshotId=last_frame.get('snapshotId'), timelineBytes=(forest/'exports/task-forest.timeline.json').stat().st_size)
    output.write_text(json.dumps(result, ensure_ascii=False, indent=2)+'\n', encoding='utf-8')
    print(json.dumps(dict(passed=True, node='TF-0749', status='done', progress=100, htmlBytes=result['html']['bytes'], currentAndLastHtmlFrameMatch=True)))
except Exception as error:
    output.write_text(json.dumps(dict(schema='G7TaskForestExportReadback/v1', **meta, passed=False, error=str(error)), indent=2)+'\n', encoding='utf-8')
    raise
