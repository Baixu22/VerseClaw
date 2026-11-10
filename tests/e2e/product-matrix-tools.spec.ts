import { randomUUID } from 'node:crypto';
import { mkdir, readFile, readdir, writeFile } from 'node:fs/promises';
import { join, relative } from 'node:path';
import type { ElectronApplication } from '@playwright/test';
import { closeElectronApp, expect, getStableWindow, test } from './fixtures/electron';
import {
  buildMockProviderConfig,
  hostInvoke,
  startScriptedLlm,
  type ScriptedLlmRequest,
} from './fixtures/fp-p1-harness';
import { createSessionChainProject } from './fixtures/session-task-chain';

type History = {
  messages?: Array<{
    role?: string;
    content?: string | Array<{ text?: string }>;
  }>;
};

type RuntimeConfig = Record<string, unknown>;

type ReceiptReadback = {
  path: string;
  content: unknown;
};

function asRecord(value: unknown): Record<string, unknown> | undefined {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : undefined;
}

function toolName(tool: unknown): string | undefined {
  const record = asRecord(tool);
  const fn = asRecord(record?.function);
  const name = fn?.name ?? record?.name;
  return typeof name === 'string' ? name : undefined;
}

function assistantTexts(history: History): string[] {
  return (history.messages ?? [])
    .filter(message => message.role === 'assistant')
    .map(message => typeof message.content === 'string'
      ? message.content
      : (message.content ?? []).map(part => part.text ?? '').join(''));
}

function parsedResult(results: Record<string, string>, id: string): unknown {
  const text = results[id];
  if (!text) throw new Error(`missing tool result ${id}`);
  try {
    return JSON.parse(text) as unknown;
  } catch {
    return text;
  }
}

async function readLifecycleReceipts(workspace: string): Promise<ReceiptReadback[]> {
  const root = join(workspace, '.ae', 'process-lifecycle');
  const receipts: ReceiptReadback[] = [];
  const walk = async (directory: string): Promise<void> => {
    let entries;
    try {
      entries = await readdir(directory, { withFileTypes: true });
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return;
      throw error;
    }
    for (const entry of entries) {
      const path = join(directory, entry.name);
      if (entry.isDirectory()) {
        await walk(path);
        continue;
      }
      const raw = await readFile(path, 'utf8');
      let content: unknown = raw;
      try {
        content = JSON.parse(raw) as unknown;
      } catch {
        // Keep non-JSON executor receipts as raw readback.
      }
      receipts.push({ path: relative(workspace, path), content });
    }
  };
  await walk(root);
  return receipts;
}

async function seedRuntimeConfig(
  homeDir: string,
  userDataDir: string,
  config: RuntimeConfig,
): Promise<void> {
  const sourceState = join(userDataDir, 'openclaw-source-state');
  const serialized = JSON.stringify(config);
  await mkdir(join(homeDir, '.openclaw'), { recursive: true });
  await mkdir(sourceState, { recursive: true });
  await writeFile(join(homeDir, '.openclaw', 'openclaw.json'), serialized);
  await writeFile(join(sourceState, 'openclaw.json'), serialized);
}

async function gatewayRpc<T>(
  app: ElectronApplication,
  method: string,
  params: Record<string, unknown>,
): Promise<T> {
  return await hostInvoke<T>(app, 'gateway', 'rpc', {
    method,
    params,
    timeoutMs: 30_000,
  });
}

async function sendViaRendererAndWait(params: {
  app: ElectronApplication;
  page: Awaited<ReturnType<typeof getStableWindow>>;
  sessionKey: string;
  prompt: string;
  finalMarker: string;
}): Promise<History> {
  const composer = params.page.getByTestId('chat-composer-input');
  await expect(composer).toBeVisible({ timeout: 30_000 });
  await composer.fill(params.prompt);
  await params.page.getByTestId('chat-composer-send').click();
  await expect.poll(async () => assistantTexts(await gatewayRpc<History>(
    params.app,
    'chat.history',
    { sessionKey: params.sessionKey, limit: 100 },
  )), { timeout: 120_000 }).toContain(params.finalMarker);
  return await gatewayRpc<History>(params.app, 'chat.history', {
    sessionKey: params.sessionKey,
    limit: 100,
  });
}

test('TF-0582 VerseShell starts, reads input, exits, and cancels through the product owner', async ({
  launchElectronApp,
  homeDir,
  userDataDir,
}, testInfo) => {
  test.setTimeout(240_000);
  const marker = randomUUID().replaceAll('-', '');
  const inputMarker = `INPUT:${marker}`;
  const finalMarker = `VERSHELL-E2E-COMPLETE:${marker}`;
  const workspace = testInfo.outputPath('workspace');
  await mkdir(workspace, { recursive: true });
  await writeFile(join(workspace, 'interactive.js'), [
    `console.log('READY:${marker}:' + process.pid);`,
    "process.stdin.setEncoding('utf8');",
    "let pending = '';",
    "process.stdin.on('data', chunk => {",
    '  pending += chunk;',
    "  const newline = pending.indexOf('\\n');",
    '  if (newline < 0) return;',
    '  const value = pending.slice(0, newline);',
    "  console.log('INPUT:' + value);",
    `  console.log('EXIT:${marker}');`,
    '  process.stdin.pause();',
    '});',
    '',
  ].join('\n'));
  await writeFile(join(workspace, 'hold.js'), [
    `console.log('HOLD:${marker}:' + process.pid);`,
    'setInterval(() => {}, 1000);',
    '',
  ].join('\n'));

  const providerRequests: Array<{
    requestIndex: number;
    tools: Array<{ name?: string }>;
    messages: ScriptedLlmRequest['messages'];
  }> = [];
  const toolCommands: Array<{ id: string; name: string; args: Record<string, unknown> }> = [];
  const toolOutputs: Array<{ id: string; content: string }> = [];
  const positivePolls: string[] = [];
  const cancelPolls: string[] = [];
  let phase = 'start';
  let positiveSessionId = '';
  let positivePid: number | null = null;
  let cancelSessionId = '';
  let cancelPid: number | null = null;
  let positivePollNumber = 0;
  let positivePollId = '';
  let cancelPollNumber = 0;
  let cancelPollId = '';

  const llm = await startScriptedLlm(async (userText, results, requestIndex, request) => {
    providerRequests.push({
      requestIndex,
      tools: (request.tools ?? []).flatMap((tool) => {
        const name = toolName(tool);
        return name ? [{ name }] : [];
      }),
      messages: request.messages,
    });
    if (!userText.includes(marker)) return { text: 'Ready' };

    const call = (id: string, name: string, args: Record<string, unknown>) => {
      toolCommands.push({ id, name, args });
      return { toolCall: { id, name, args } };
    };
    const remember = (id: string) => {
      const content = results[id];
      if (content) toolOutputs.push({ id, content });
      return content;
    };

    if (phase === 'start') {
      phase = 'positive-start';
      return call('vs-start', 'exec', {
        command: 'node interactive.js',
        workdir: workspace,
        background: true,
        yieldMs: 100,
        timeout: 30,
      });
    }

    if (phase === 'positive-start') {
      const content = remember('vs-start');
      const match = content.match(/session ([^,\s]+), pid (\d+|n\/a)/);
      if (!match) throw new Error(`VerseShell did not yield a session owner: ${content}`);
      positiveSessionId = match[1];
      positivePid = match[2] === 'n/a' ? null : Number(match[2]);
      phase = 'positive-ready';
      positivePollId = `vs-positive-poll-${++positivePollNumber}`;
      return call(positivePollId, 'process', {
        action: 'poll',
        sessionId: positiveSessionId,
        timeout: 5_000,
      });
    }

    if (phase === 'positive-ready') {
      const content = remember(positivePollId);
      positivePolls.push(content);
      if (!content.includes(`READY:${marker}`)) {
        positivePollId = `vs-positive-poll-${++positivePollNumber}`;
        return call(positivePollId, 'process', {
          action: 'poll',
          sessionId: positiveSessionId,
          timeout: 5_000,
        });
      }
      phase = 'positive-write';
      return call('vs-write', 'process', {
        action: 'write',
        sessionId: positiveSessionId,
        data: `${inputMarker}\n`,
      });
    }

    if (phase === 'positive-write') {
      remember('vs-write');
      phase = 'positive-exit';
      positivePollId = `vs-positive-poll-${++positivePollNumber}`;
      return call(positivePollId, 'process', {
        action: 'poll',
        sessionId: positiveSessionId,
        timeout: 5_000,
      });
    }

    if (phase === 'positive-exit') {
      const content = remember(positivePollId);
      positivePolls.push(content);
      if (!content.includes('Process exited with')) {
        positivePollId = `vs-positive-poll-${++positivePollNumber}`;
        return call(positivePollId, 'process', {
          action: 'poll',
          sessionId: positiveSessionId,
          timeout: 5_000,
        });
      }
      phase = 'cancel-start';
      return call('vs-cancel-start', 'exec', {
        command: 'node hold.js',
        workdir: workspace,
        background: true,
        yieldMs: 100,
        timeout: 30,
      });
    }

    if (phase === 'cancel-start') {
      const content = remember('vs-cancel-start');
      const match = content.match(/session ([^,\s]+), pid (\d+|n\/a)/);
      if (!match) throw new Error(`cancel fixture did not yield a session owner: ${content}`);
      cancelSessionId = match[1];
      cancelPid = match[2] === 'n/a' ? null : Number(match[2]);
      phase = 'cancel-kill';
      return call('vs-cancel-kill', 'process', {
        action: 'kill',
        sessionId: cancelSessionId,
      });
    }

    if (phase === 'cancel-kill') {
      remember('vs-cancel-kill');
      phase = 'cancel-exit';
      cancelPollId = `vs-cancel-poll-${++cancelPollNumber}`;
      return call(cancelPollId, 'process', {
        action: 'poll',
        sessionId: cancelSessionId,
        timeout: 5_000,
      });
    }

    if (phase === 'cancel-exit') {
      const content = remember(cancelPollId);
      cancelPolls.push(content);
      if (!content.includes('Process exited with')) {
        cancelPollId = `vs-cancel-poll-${++cancelPollNumber}`;
        return call(cancelPollId, 'process', {
          action: 'poll',
          sessionId: cancelSessionId,
          timeout: 5_000,
        });
      }
      phase = 'done';
      return { text: finalMarker };
    }

    return { text: finalMarker };
  });

  const evidence: Record<string, unknown> = {
    schema: 'product-matrix-tools-verse-shell/v1',
    driven_by: 'agent',
    actor: 'playwright-product-matrix-tools',
    marker,
    entrypoints: [
      'renderer:chat-composer',
      'hostInvoke:gateway.rpc',
      'gateway:agent-run',
      'tool:exec(host=verseshell)',
      'owner:VerseShellProcessManager(process.start/poll/write/kill)',
    ],
    status: 'running',
  };
  let app: ElectronApplication | undefined;
  let cleanupError: string | undefined;
  try {
    const config = buildMockProviderConfig(llm.port, workspace);
    config.tools = {
      profile: 'coding',
      exec: { host: 'verseshell', security: 'full', ask: 'off' },
    };
    const runtime = config.runtime as Record<string, unknown>;
    runtime.verseShellFoundation = {
      verifiedRuntime: true,
      typedAci: true,
      facade: true,
      governedExec: true,
    };
    evidence.executionMode = { kind: 'explicit-opt-in', tools: config.tools, verseShellFoundation: runtime.verseShellFoundation };
    await seedRuntimeConfig(homeDir, userDataDir, config);

    app = await launchElectronApp({
      skipSetup: true,
      env: { TEMP: 'D:/tmp', TMP: 'D:/tmp' },
    });
    const project = await createSessionChainProject(app, workspace, 'Product matrix tools');
    const page = await getStableWindow(app);
    await page.reload();
    const history = await sendViaRendererAndWait({
      app,
      page,
      sessionKey: project.sessionKey,
      prompt: `VERSE-SHELL-E2E:${marker}: exercise the real background process owner.`,
      finalMarker,
    });

    const positiveExit = positivePolls.join('\n');
    expect(positiveExit).toContain(`READY:${marker}`);
    expect(positiveExit).toContain(inputMarker);
    expect(positiveExit).toContain(`EXIT:${marker}`);
    expect(positiveExit).toContain('Process exited with code 0');
    expect(toolOutputs.find(entry => entry.id === 'vs-write')?.content).toContain('Wrote');
    expect(toolOutputs.find(entry => entry.id === 'vs-cancel-kill')?.content).toMatch(
      /(Termination requested|Killed session)/,
    );
    expect(cancelPolls.join('\n')).toMatch(/Process exited with (signal|code)/);
    expect(positivePid).not.toBeNull();
    expect(positivePid).not.toBe(app.process().pid);
    expect(cancelPid).not.toBeNull();

    const receipts = await readLifecycleReceipts(workspace);
    expect(receipts.length).toBeGreaterThan(0);
    expect(receipts.some(receipt =>
      JSON.stringify(receipt.content).includes('process_id')
      && JSON.stringify(receipt.content).includes('session_id'),
    )).toBe(true);

    Object.assign(evidence, {
      status: 'passed',
      workspace,
      command: {
        value: 'node interactive.js',
        cwd: workspace,
        background: true,
      },
      owner: {
        positiveSessionId,
        positivePid,
        cancelSessionId,
        cancelPid,
        electronPid: app.process().pid,
      },
      commands: toolCommands,
      outputs: toolOutputs,
      positivePolls,
      cancelPolls,
      receipts,
      providerRequests,
      providerLog: llm.log,
      providerAnomalies: llm.anomalies,
      chatHistory: history,
    });
  } catch (error) {
    evidence.status = 'failed';
    evidence.error = String(error);
    throw error;
  } finally {
    try {
      if (app) {
        try { await hostInvoke(app, 'gateway', 'stop'); }
        finally { await closeElectronApp(app); }
      }
    } catch (error) { cleanupError = String(error); evidence.status = 'failed'; }
    llm.server.closeAllConnections();
    await new Promise<void>((resolve) => llm.server.close(() => resolve()));
    if (cleanupError) evidence.cleanupError = cleanupError;
    evidence.providerLog = llm.log;
    evidence.providerAnomalies = llm.anomalies;
    const output = testInfo.outputPath('verse-shell-result.json');
    await writeFile(output, JSON.stringify(evidence, null, 2) + '\n');
    await testInfo.attach('verse-shell-result.json', {
      path: output,
      contentType: 'application/json',
    });
  }
  expect(cleanupError).toBeUndefined();
});

test('TF-0582 Tool Search expands a real schema and rejects absent or denied tools', async ({
  launchElectronApp,
  homeDir,
  userDataDir,
}, testInfo) => {
  test.setTimeout(240_000);
  const marker = randomUUID().replaceAll('-', '');
  const finalMarker = `TOOL-SEARCH-E2E-COMPLETE:${marker}`;
  const workspace = testInfo.outputPath('workspace');
  await mkdir(workspace, { recursive: true });
  const providerRequests: Array<{
    requestIndex: number;
    tools: Array<{ name?: string }>;
    messages: ScriptedLlmRequest['messages'];
  }> = [];
  const toolOutputs: Array<{ id: string; content: string }> = [];
  let phase = 'search';
  let searchedProcess: Record<string, unknown> | undefined;
  let describedSchema: Record<string, unknown> | undefined;
  let missingRefusal = '';
  let deniedRefusal = '';

  const llm = await startScriptedLlm(async (userText, results, requestIndex, request) => {
    providerRequests.push({
      requestIndex,
      tools: (request.tools ?? []).flatMap((tool) => {
        const name = toolName(tool);
        return name ? [{ name }] : [];
      }),
      messages: request.messages,
    });
    if (!userText.includes(marker)) return { text: 'Ready' };

    const remember = (id: string) => {
      const content = results[id];
      if (content) toolOutputs.push({ id, content });
      return content;
    };

    if (phase === 'search') {
      phase = 'describe';
      return {
        toolCall: {
          id: 'ts-search',
          name: 'tool_search',
          args: { query: 'background process lifecycle poll write kill', limit: 8 },
        },
      };
    }

    if (phase === 'describe') {
      const parsed = parsedResult(results, 'ts-search');
      remember('ts-search');
      const entries = Array.isArray(parsed) ? parsed : [];
      searchedProcess = entries
        .map(asRecord)
        .find(entry => entry?.name === 'process');
      if (!searchedProcess || typeof searchedProcess.id !== 'string') {
        throw new Error(`Tool Search did not return the process tool: ${results['ts-search']}`);
      }
      phase = 'missing';
      return {
        toolCall: {
          id: 'ts-describe',
          name: 'tool_describe',
          args: { id: searchedProcess.id },
        },
      };
    }

    if (phase === 'missing') {
      const parsed = parsedResult(results, 'ts-describe');
      remember('ts-describe');
      describedSchema = asRecord(parsed);
      if (!describedSchema || !asRecord(describedSchema.parameters)) {
        throw new Error(`Tool Describe did not return a schema: ${results['ts-describe']}`);
      }
      phase = 'denied';
      return {
        toolCall: {
          id: 'ts-missing',
          name: 'tool_describe',
          args: { id: 'definitely_missing_product_matrix_tool' },
        },
      };
    }

    if (phase === 'denied') {
      missingRefusal = remember('ts-missing');
      if (!missingRefusal.includes('Unknown tool id')) {
        throw new Error(`missing tool was not rejected: ${missingRefusal}`);
      }
      phase = 'done';
      return {
        toolCall: {
          id: 'ts-denied',
          name: 'tool_call',
          args: { id: 'sessions_spawn', args: { task: 'must not run' } },
        },
      };
    }

    if (phase === 'done') {
      deniedRefusal = remember('ts-denied');
      if (!deniedRefusal.includes('Unknown tool id')) {
        throw new Error(`policy-denied tool was not rejected: ${deniedRefusal}`);
      }
      phase = 'finish';
      return { text: finalMarker };
    }

    return { text: finalMarker };
  });

  const evidence: Record<string, unknown> = {
    schema: 'product-matrix-tools-tool-search/v1',
    driven_by: 'agent',
    actor: 'playwright-product-matrix-tools',
    marker,
    entrypoints: [
      'renderer:chat-composer',
      'hostInvoke:gateway.rpc',
      'gateway:agent-run',
      'tool-search:search/describe/call',
    ],
    deniedTool: 'sessions_spawn',
    status: 'running',
  };
  let app: ElectronApplication | undefined;
  let cleanupError: string | undefined;
  try {
    const config = buildMockProviderConfig(llm.port, workspace);
    config.tools = {
      profile: 'coding',
      deny: ['sessions_spawn'],
      toolSearch: {
        enabled: true,
        mode: 'tools',
        searchDefaultLimit: 8,
        maxSearchLimit: 20,
      },
    };
    evidence.executionMode = { kind: 'explicit-tool-search', tools: config.tools };
    await seedRuntimeConfig(homeDir, userDataDir, config);

    app = await launchElectronApp({
      skipSetup: true,
      env: { TEMP: 'D:/tmp', TMP: 'D:/tmp' },
    });
    const project = await createSessionChainProject(app, workspace, 'Product matrix tool search');
    const page = await getStableWindow(app);
    await page.reload();
    const history = await sendViaRendererAndWait({
      app,
      page,
      sessionKey: project.sessionKey,
      prompt: `TOOL-SEARCH-E2E:${marker}: expand process and check the denial boundary.`,
      finalMarker,
    });

    const visibleTools = providerRequests.flatMap(request => request.tools.map(tool => tool.name));
    expect(visibleTools).toEqual(expect.arrayContaining([
      'tool_search',
      'tool_describe',
      'tool_call',
    ]));
    expect(searchedProcess).toMatchObject({ name: 'process', source: 'openclaw' });
    expect(describedSchema).toMatchObject({
      name: 'process',
      parameters: expect.any(Object),
    });
    expect(JSON.stringify(describedSchema)).toContain('action');
    expect(missingRefusal).toContain('Unknown tool id');
    expect(deniedRefusal).toContain('Unknown tool id');
    expect(toolOutputs.some(entry =>
      entry.id === 'ts-denied' && entry.content.includes('sessions_spawn'))).toBe(true);
    expect(llm.log.some(entry => entry.issued === 'ts-denied')).toBe(true);

    Object.assign(evidence, {
      status: 'passed',
      workspace,
      visibleTools: [...new Set(visibleTools)],
      searchedProcess,
      describedSchema,
      missingRefusal,
      deniedRefusal,
      outputs: toolOutputs,
      providerRequests,
      providerLog: llm.log,
      providerAnomalies: llm.anomalies,
      chatHistory: history,
    });
  } catch (error) {
    evidence.status = 'failed';
    evidence.error = String(error);
    throw error;
  } finally {
    try {
      if (app) {
        try { await hostInvoke(app, 'gateway', 'stop'); }
        finally { await closeElectronApp(app); }
      }
    } catch (error) { cleanupError = String(error); evidence.status = 'failed'; }
    llm.server.closeAllConnections();
    await new Promise<void>((resolve) => llm.server.close(() => resolve()));
    if (cleanupError) evidence.cleanupError = cleanupError;
    evidence.providerLog = llm.log;
    evidence.providerAnomalies = llm.anomalies;
    const output = testInfo.outputPath('tool-search-result.json');
    await writeFile(output, JSON.stringify(evidence, null, 2) + '\n');
    await testInfo.attach('tool-search-result.json', {
      path: output,
      contentType: 'application/json',
    });
  }
  expect(cleanupError).toBeUndefined();
});
