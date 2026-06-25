import { createServer } from 'node:http';
import { randomUUID } from 'node:crypto';
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { createReadStream, existsSync } from 'node:fs';
import { extname, join, normalize } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = fileURLToPath(new URL('.', import.meta.url));
const publicDir = join(__dirname, 'public');
const dataDir = join(__dirname, '.data');
const taskFile = join(dataDir, 'tasks.json');
const port = Number(process.env.PORT || 42173);

const allowedSettings = new Set([
  'theme',
  'language',
  'gatewayAutoStart',
  'telemetryEnabled',
  'autoCheckUpdate',
  'autoDownloadUpdate',
  'cdpRemoteControlEnabled',
  'cdpRemoteDebuggingPort',
]);

const clients = new Set();

function now() {
  return new Date().toISOString();
}

function json(res, status, body) {
  const payload = JSON.stringify(body);
  res.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'cache-control': 'no-store',
  });
  res.end(payload);
}

async function readBody(req) {
  let raw = '';
  for await (const chunk of req) {
    raw += chunk;
    if (raw.length > 1_000_000) throw new Error('Request body too large');
  }
  return raw ? JSON.parse(raw) : {};
}

async function loadTasks() {
  try {
    const raw = await readFile(taskFile, 'utf8');
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

async function saveTasks(tasks) {
  await mkdir(dataDir, { recursive: true });
  const tmp = `${taskFile}.tmp`;
  await writeFile(tmp, JSON.stringify(tasks.slice(0, 200), null, 2), 'utf8');
  await rename(tmp, taskFile);
}

function broadcast(event, payload) {
  const line = `event: ${event}\ndata: ${JSON.stringify(payload)}\n\n`;
  for (const client of clients) {
    client.write(line);
  }
}

function sanitizeSource(source) {
  return ['local', 'cli', 'folder', 'git', 'lan'].includes(source) ? source : 'local';
}

function normalizeCommand(input) {
  if (!input || typeof input !== 'object') throw new Error('command is required');

  if (input.kind === 'message') {
    if (typeof input.title !== 'string' || !input.title.trim()) throw new Error('message.title is required');
    if (typeof input.body !== 'string' || !input.body.trim()) throw new Error('message.body is required');
    return {
      kind: 'message',
      title: input.title.trim(),
      body: input.body.trim(),
    };
  }

  if (input.kind === 'doctor') {
    return {
      kind: 'doctor',
      mode: input.mode === 'fix' ? 'fix' : 'diagnose',
    };
  }

  if (input.kind === 'settingsPatch') {
    if (!input.patch || typeof input.patch !== 'object' || Array.isArray(input.patch)) {
      throw new Error('settingsPatch.patch is required');
    }
    const patch = {};
    for (const [key, value] of Object.entries(input.patch)) {
      if (!allowedSettings.has(key)) throw new Error(`settingsPatch.${key} is not allowed`);
      patch[key] = value;
    }
    if (Object.keys(patch).length === 0) throw new Error('settingsPatch.patch cannot be empty');
    return { kind: 'settingsPatch', patch };
  }

  throw new Error('Unsupported command kind');
}

function makeTask(payload) {
  const createdAt = now();
  const command = normalizeCommand(payload.command);
  return {
    id: randomUUID(),
    source: sanitizeSource(payload.source),
    status: command.kind === 'settingsPatch' ? 'pendingApproval' : 'pending',
    command,
    reason: typeof payload.reason === 'string' ? payload.reason.trim() : '',
    createdAt,
    updatedAt: createdAt,
    approvedAt: null,
    completedAt: null,
    result: '',
    error: '',
    audit: [
      {
        at: createdAt,
        event: 'created',
        detail: command.kind === 'settingsPatch' ? 'Waiting for explicit approval' : 'Ready to execute',
      },
    ],
  };
}

function taskLabel(task) {
  if (task.command.kind === 'message') return task.command.title;
  if (task.command.kind === 'doctor') return `OpenClaw doctor ${task.command.mode}`;
  return `Settings patch: ${Object.keys(task.command.patch).join(', ')}`;
}

async function updateTask(id, updater) {
  const tasks = await loadTasks();
  const index = tasks.findIndex((task) => task.id === id);
  if (index < 0) throw new Error('Task not found');
  tasks[index] = updater(tasks[index]);
  await saveTasks(tasks);
  broadcast('tasks', { tasks });
  return tasks[index];
}

async function listTasks(req, res) {
  const tasks = await loadTasks();
  json(res, 200, { success: true, tasks });
}

async function createTask(req, res) {
  const body = await readBody(req);
  const task = makeTask(body);
  const tasks = [task, ...(await loadTasks())];
  await saveTasks(tasks);
  broadcast('tasks', { tasks });
  json(res, 201, { success: true, task });
}

async function approveTask(req, res, id) {
  const task = await updateTask(id, (current) => {
    if (current.status !== 'pendingApproval') return current;
    const at = now();
    return {
      ...current,
      status: 'pending',
      approvedAt: at,
      updatedAt: at,
      audit: [...current.audit, { at, event: 'approved', detail: 'User approved execution' }],
    };
  });
  json(res, 200, { success: true, task });
}

async function rejectTask(req, res, id) {
  const task = await updateTask(id, (current) => {
    const at = now();
    return {
      ...current,
      status: 'rejected',
      updatedAt: at,
      completedAt: at,
      audit: [...current.audit, { at, event: 'rejected', detail: 'User rejected task' }],
    };
  });
  json(res, 200, { success: true, task });
}

async function executeTask(req, res, id) {
  let task = await updateTask(id, (current) => {
    if (current.status === 'pendingApproval') throw new Error('Task requires approval');
    if (current.status === 'completed' || current.status === 'rejected') return current;
    const at = now();
    return {
      ...current,
      status: 'running',
      updatedAt: at,
      audit: [...current.audit, { at, event: 'running', detail: 'Execution started' }],
    };
  });

  const at = now();
  task = await updateTask(id, (current) => {
    let result = '';
    if (current.command.kind === 'message') {
      result = current.command.body;
    } else if (current.command.kind === 'doctor') {
      result = `Simulated ${current.command.mode} completed locally`;
    } else {
      result = `Would apply settings: ${JSON.stringify(current.command.patch)}`;
    }
    return {
      ...current,
      status: 'completed',
      updatedAt: at,
      completedAt: at,
      result,
      audit: [...current.audit, { at, event: 'completed', detail: result }],
    };
  });

  json(res, 200, { success: true, task });
}

async function streamEvents(req, res) {
  res.writeHead(200, {
    'content-type': 'text/event-stream; charset=utf-8',
    'cache-control': 'no-store',
    connection: 'keep-alive',
  });
  clients.add(res);
  res.write(`event: ready\ndata: ${JSON.stringify({ at: now() })}\n\n`);
  res.write(`event: tasks\ndata: ${JSON.stringify({ tasks: await loadTasks() })}\n\n`);
  req.on('close', () => clients.delete(res));
}

function serveStatic(req, res) {
  const url = new URL(req.url, `http://${req.headers.host}`);
  const rawPath = url.pathname === '/' ? '/index.html' : url.pathname;
  const filePath = normalize(join(publicDir, rawPath));
  if (!filePath.startsWith(publicDir) || !existsSync(filePath)) {
    res.writeHead(404);
    res.end('Not found');
    return;
  }
  const types = {
    '.html': 'text/html; charset=utf-8',
    '.css': 'text/css; charset=utf-8',
    '.js': 'text/javascript; charset=utf-8',
  };
  res.writeHead(200, {
    'content-type': types[extname(filePath)] || 'application/octet-stream',
    'cache-control': 'no-store',
  });
  createReadStream(filePath).pipe(res);
}

async function route(req, res) {
  try {
    const url = new URL(req.url, `http://${req.headers.host}`);
    const match = url.pathname.match(/^\/api\/tasks\/([^/]+)\/(approve|reject|execute)$/);

    if (req.method === 'GET' && url.pathname === '/api/tasks') return await listTasks(req, res);
    if (req.method === 'POST' && url.pathname === '/api/tasks') return await createTask(req, res);
    if (req.method === 'GET' && url.pathname === '/api/events') return await streamEvents(req, res);
    if (match && req.method === 'POST') {
      const [, id, action] = match;
      if (action === 'approve') return await approveTask(req, res, id);
      if (action === 'reject') return await rejectTask(req, res, id);
      return await executeTask(req, res, id);
    }

    if (req.method === 'GET') return serveStatic(req, res);
    json(res, 404, { success: false, error: 'Not found' });
  } catch (error) {
    json(res, 400, { success: false, error: error instanceof Error ? error.message : String(error) });
  }
}

const server = createServer((req, res) => {
  void route(req, res);
});

server.listen(port, '127.0.0.1', () => {
  console.log(`Personal Control Plane prototype: http://127.0.0.1:${port}`);
});
