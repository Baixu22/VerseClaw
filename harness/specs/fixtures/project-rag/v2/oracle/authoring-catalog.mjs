import { catalogue as original } from './v1.catalog.mjs';
// v1's sealed bytes remain intact. v2 adds companion evidence and real code
// repairs before any model trial or ranking calibration has run.
export const catalogue = structuredClone(original);
const companion = (path, field, value, needle, en, zh, ja, ru, lines = 2) => ({ path,
  fact: { field, value, needle, questions: { en, zh, ja, ru }, lines } });
const companions = [
  companion('shared/knowledge/owner-read-contract.ts', 'publicOwnerTypesModule', 'openclaw/plugin-sdk/memory-owner-read-types', "from 'openclaw/plugin-sdk/memory-owner-read-types';",
    'Which public SDK module supplies the shared owner-read types?', '哪个公开 SDK 模块提供共享 owner-read 类型？', '共有 owner-read 型を提供する公開 SDK モジュールは何ですか？', 'Какой публичный SDK-модуль предоставляет shared owner-read types?'),
  companion('openclaw_runtime/extensions/memory-wiki/src/query.ts', 'wikiPageReader', 'getMemoryWikiPage', 'export async function getMemoryWikiPage(params:',
    'Which Wiki query entry reads a page and its owner snapshot?', '哪个 Wiki query 入口读取页面及其 owner snapshot？', 'ページと owner snapshot を読み取る Wiki query エントリは何ですか？', 'Какой entry Wiki query читает страницу и её owner snapshot?'),
  companion('electron/services/chat-api.ts', 'chatReadScopePreparation', 'prepareKnowledgeReadScope', 'prepareKnowledgeReadScope',
    'Which scope preparation helper does Main chat use?', 'Main chat 使用哪个 scope preparation helper？', 'Main chat が使用する scope preparation helper は何ですか？', 'Какой scope preparation helper использует Main chat?'),
  companion('electron/services/knowledge-evidence-qa.ts', 'qaOutputValidator', 'validateKnowledgeQaOutput', 'export function validateKnowledgeQaOutput',
    'Which helper validates the model-only Knowledge QA output?', '哪个 helper 校验 model-only Knowledge QA 输出？', 'model-only Knowledge QA の出力を検証する helper は何ですか？', 'Какой helper проверяет вывод model-only Knowledge QA?'),
  companion('openclaw_runtime/src/context-engine/assembler.ts', 'dcsAssembler', 'Assembler', 'export class Assembler',
    'Which class owns the DCS assembly entry?', '哪个 class 提供 DCS assembly 入口？', 'DCS assembly エントリを提供する class は何ですか？', 'Какой class предоставляет entry DCS assembly?'),
  companion('openclaw_runtime/src/runtime-core/memory-hybrid-retrieval.ts', 'hybridCjkFallback', 'cjkBigrams', 'cjkBigrams',
    'Which CJK fallback is consumed by memory hybrid retrieval?', 'memory hybrid retrieval 使用哪个 CJK fallback？', 'memory hybrid retrieval が使用する CJK fallback は何ですか？', 'Какой CJK fallback использует memory hybrid retrieval?'),
  companion('openclaw_runtime/src/runtime-core/memory-temporal-detector.ts', 'queryTemporalDetector', 'detectQueryTemporalMode', 'export function detectQueryTemporalMode',
    'Which function detects a query temporal mode?', '哪个函数探测 query temporal mode？', 'query temporal mode を検出する関数は何ですか？', 'Какая функция определяет query temporal mode?'),
  companion('src/lib/host-api-client.ts', 'rendererDeadlineFactory', 'createHostDeadline', 'createHostDeadline',
    'Which deadline factory does the renderer Host client consume?', 'renderer Host client 使用哪个 deadline factory？', 'renderer Host client が使用する deadline factory は何ですか？', 'Какой deadline factory использует renderer Host client?'),
  companion('electron/main/ipc/host-invoke.ts', 'typedHostChannel', 'host:invoke', 'host:invoke',
    'Which typed IPC channel carries Main Host invocation?', '哪个 typed IPC channel 承载 Main Host invocation？', 'Main Host invocation を運ぶ typed IPC channel は何ですか？', 'Какой typed IPC channel передаёт Main Host invocation?'),
  companion('scripts/harness-ci.mjs', 'harnessStageCount', 12, 'const stages = [',
    'How many baseline CI stages are declared by the sequential Harness runner?', '顺序 Harness runner 声明多少个 baseline CI stages？', '順次 Harness runner が宣言する baseline CI stages は何個ですか？', 'Сколько baseline CI stages объявляет последовательный Harness runner?', 14),
];
companions.forEach((c, index) => catalogue[index].companions.push(c));
