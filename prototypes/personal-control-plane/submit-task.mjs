const endpoint = process.env.CONTROL_PLANE_URL || 'http://127.0.0.1:42173';
const [kind, ...args] = process.argv.slice(2);

function usage() {
  console.log(`Usage:
  node submit-task.mjs message <title> <body>
  node submit-task.mjs doctor [diagnose|fix]
  node submit-task.mjs settings '{"theme":"dark"}'`);
}

function buildCommand() {
  if (kind === 'message') {
    const [title, body] = args;
    if (!title || !body) return null;
    return { kind: 'message', title, body };
  }

  if (kind === 'doctor') {
    return { kind: 'doctor', mode: args[0] === 'fix' ? 'fix' : 'diagnose' };
  }

  if (kind === 'settings') {
    if (!args[0]) return null;
    return { kind: 'settingsPatch', patch: JSON.parse(args[0]) };
  }

  return null;
}

const command = buildCommand();
if (!command) {
  usage();
  process.exit(1);
}

const response = await fetch(`${endpoint}/api/tasks`, {
  method: 'POST',
  headers: { 'content-type': 'application/json' },
  body: JSON.stringify({
    source: 'cli',
    reason: 'Submitted from local CLI prototype',
    command,
  }),
});

const payload = await response.json();
if (!response.ok || payload.success === false) {
  console.error(payload.error || `HTTP ${response.status}`);
  process.exit(1);
}

console.log(`Submitted ${payload.task.id}`);
