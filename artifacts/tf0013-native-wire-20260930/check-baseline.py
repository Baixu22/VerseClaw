"""Check HEAD plugin sources against the same current public SDK declarations."""
import json
from pathlib import Path
import subprocess
import tempfile

root = Path(__file__).resolve().parents[2]
runtime = root / 'openclaw_runtime'
out = Path(__file__).resolve().parent
current_command = ['node', 'scripts/run-tsgo.mjs', '-p', 'extensions/codex/tsconfig.json']
current_result = subprocess.run(current_command, cwd=runtime, stdout=subprocess.PIPE, stderr=subprocess.STDOUT, text=True)
(out / 'plugin-types.log').write_text(current_result.stdout, encoding='utf8')
baseline = Path(tempfile.mkdtemp(prefix='tf0013-codex-', dir=runtime / '.artifacts'))
prefix = 'openclaw_runtime/extensions/codex/'
files = subprocess.check_output(['git', 'ls-files', prefix], cwd=root, text=True).splitlines()
for name in files:
    if not name.endswith(('.ts', '.json')):
        continue
    dest = baseline / name.removeprefix(prefix)
    dest.parent.mkdir(parents=True, exist_ok=True)
    dest.write_bytes(subprocess.check_output(['git', 'show', f'HEAD:{name}'], cwd=root))
(baseline / 'tsconfig.json').write_text(json.dumps({
    'extends': str(runtime / 'extensions/codex/tsconfig.json'),
    'compilerOptions': {'rootDir': '.'},
    'include': ['./*.ts', './src/**/*.ts'],
    'exclude': ['./**/*.test.ts', './dist/**', './node_modules/**', './src/test-support/**'],
}))
command = ['node', 'scripts/run-tsgo.mjs', '-p', str(baseline / 'tsconfig.json')]
result = subprocess.run(command, cwd=runtime, stdout=subprocess.PIPE, stderr=subprocess.STDOUT, text=True)
raw = result.stdout.replace(str(baseline).replace('\\', '/'), 'extensions/codex').replace(str(baseline.relative_to(runtime)).replace('\\', '/'), 'extensions/codex')
(out / 'plugin-types-head.log').write_text(raw, encoding='utf8')
current = (out / 'plugin-types.log').read_text(encoding='utf8')
current_errors = [line.strip() for line in current.splitlines() if ': error TS' in line]
head_errors = [line.strip() for line in raw.splitlines() if ': error TS' in line]
report = {'actor': 'codex/root', 'driven_by': 'agent', 'command': command, 'currentCommand': current_command, 'currentPluginExitCode': current_result.returncode, 'headPluginExitCode': result.returncode,
          'currentErrors': current_errors, 'headErrors': head_errors,
          'sameDiagnostics': current_errors == head_errors,
          'limitation': 'Both runs use current SDK declarations; this is not a full clean HEAD build.'}
(out / 'plugin-types-baseline.json').write_text(json.dumps(report, indent=2) + '\n')
print(json.dumps({'headExit': result.returncode, 'currentErrors': len(current_errors), 'headErrors': len(head_errors), 'sameDiagnostics': report['sameDiagnostics']}))
raise SystemExit(0 if report['sameDiagnostics'] and current_errors else 1)
