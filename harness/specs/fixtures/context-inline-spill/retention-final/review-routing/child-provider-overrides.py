"""Run the unchanged review helper with the owner-supplied transient provider."""
import json
import hashlib
import pathlib
import runpy
import sys

helper = pathlib.Path(r'C:\Users\27933\.codex\worktrees\context-inline-spill\ClawX\openclaw_runtime\.agents\skills\autoreview\scripts\autoreview')
module = runpy.run_path(str(helper), run_name='autoreview_owner_provider')
scope = module['main'].__globals__
original_run = scope['run_with_heartbeat']

def code_first_branch_bundle(repo, base_ref):
    changed = scope['git'](repo, 'diff', '--name-only', f'{base_ref}...HEAD').splitlines()
    data_paths = [name for name in changed if name.endswith('.json') and name.startswith('harness/specs/fixtures/context-inline-spill/')]
    source_paths = [name for name in changed if name not in data_paths]
    patch = scope['git'](repo, 'diff', '--patch', '--find-renames', f'{base_ref}...HEAD', '--', *source_paths)
    data = []
    for name in data_paths:
        raw = (repo / name).read_bytes()
        data.append({'path':name, 'bytes':len(raw), 'sha256':hashlib.sha256(raw).hexdigest(),
            'review_representation':'bulk fixture bytes summarized; file remains available to read-only inspection'})
    return '\n\n'.join(['# Branch Diff', f'base: {base_ref}',
        scope['git'](repo, 'diff', '--stat', f'{base_ref}...HEAD'),
        '# Complete Production, Test and Documentation Patch', patch,
        '# Fixture Identity (raw JSONL/archive replay is checked independently)', json.dumps(data,indent=2)])

def run_with_owner_provider(command, *args, **kwargs):
    if kwargs.get('label') == 'codex':
        command = list(command)
        model_index = command.index('--model')
        model = command[model_index + 1]
        if model != 'space-bunny':
            raise RuntimeError('This wrapper only routes the owner-supplied model.')
        del command[model_index:model_index + 2]
        exec_index = command.index('exec')
        overrides = [
            'model_provider="inline_spill_owner"',
            'model_providers.inline_spill_owner.name="Owner supplied local Responses"',
            'model_providers.inline_spill_owner.base_url="http://127.0.0.1:3065/v1"',
            'model_providers.inline_spill_owner.wire_api="responses"',
            'model_providers.inline_spill_owner.env_key="CONTEXT_INLINE_SPILL_API_KEY"',
            'model_providers.inline_spill_owner.requires_openai_auth=false',
        ]
        routed = ['--model', model, '--ignore-user-config']
        for override in overrides:
            routed.extend(['-c', override])
        routed.extend(['--disable', 'shell_tool'])
        command[exec_index + 1:exec_index + 1] = routed
        print(json.dumps({'schema':'ContextInlineSpillReviewRouting/v1', 'driven_by':'agent',
            'actor':'codex-inline-spill-retention', 'engine':'codex', 'model':model,
            'endpoint_origin':'http://127.0.0.1:3065', 'credential_source':'process environment',
            'credential_persisted':False, 'user_config_modified':False, 'argv':command}), flush=True)
    return original_run(command, *args, **kwargs)

scope['run_with_heartbeat'] = run_with_owner_provider
scope['branch_bundle'] = code_first_branch_bundle
sys.argv[0] = str(helper)
raise SystemExit(module['main']())
