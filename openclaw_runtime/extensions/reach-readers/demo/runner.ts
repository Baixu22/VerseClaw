/**
 * Demo runner —— 验证 shadow 项目可跑。
 *
 * 只跑无副作用的检查：工具注册、canHandle、check（探活）。
 * 不触网读取（除了 check 内置的网络探活，那部分是预期行为）。
 *
 * 用法：
 *   npx tsx demo/runner.ts              # 全量
 *   npx tsx demo/runner.ts --probe      # 只跑探活
 *   npx tsx demo/runner.ts --route URL  # 测试 URL 路由
 */
import { reachReadersPlugin, createCollectingApi, ALL_TOOLS, TOOL_BY_NAME } from '../src/index.js';
import * as web from '../src/tools/web.js';
import * as rss from '../src/tools/rss.js';
import * as v2ex from '../src/tools/v2ex.js';
import * as xueqiu from '../src/tools/xueqiu.js';
import * as bilibili from '../src/tools/bilibili.js';
import * as youtube from '../src/tools/youtube.js';
import * as github from '../src/tools/github.js';
import * as twitter from '../src/tools/twitter.js';
import * as xiaohongshu from '../src/tools/xiaohongshu.js';

const channels = [
  { name: 'web', mod: web },
  { name: 'rss', mod: rss },
  { name: 'v2ex', mod: v2ex },
  { name: 'xueqiu', mod: xueqiu },
  { name: 'bilibili', mod: bilibili },
  { name: 'youtube', mod: youtube },
  { name: 'github', mod: github },
  { name: 'twitter', mod: twitter },
  { name: 'xiaohongshu', mod: xiaohongshu },
] as const;

function header(s: string): void {
  console.log(`\n${'═'.repeat(60)}`);
  console.log(`  ${s}`);
  console.log('═'.repeat(60));
}

async function testRegistration(): Promise<void> {
  header('1. 工具注册（ClawX api.registerTool 形状）');
  const { api, tools } = createCollectingApi();
  reachReadersPlugin.register(api);
  console.log(`插件 id: ${reachReadersPlugin.id}`);
  console.log(`插件 name: ${reachReadersPlugin.name}`);
  console.log(`注册工具数: ${tools.length}（期望 9）`);
  console.log('工具清单:');
  for (const t of tools) {
    console.log(`  • ${t.name.padEnd(20)} label="${t.label}"`);
  }
  // 校验 ALL_TOOLS 与 TOOL_BY_NAME 一致
  const allNames = ALL_TOOLS.map((t) => t.name);
  const byNames = Object.keys(TOOL_BY_NAME);
  console.log(`\nALL_TOOLS names: ${allNames.join(', ')}`);
  console.log(`TOOL_BY_NAME keys: ${byNames.join(', ')}`);
  console.log(allNames.length === byNames.length && allNames.every((n) => byNames.includes(n)) ? '✓ 一致' : '✗ 不一致');
}

async function testRouting(url: string): Promise<void> {
  header(`2. URL 路由 —— ${url}`);
  // web/rss 用 canHandle，其他用 canHandleUrl
  for (const c of channels) {
    const mod = c.mod as Record<string, unknown>;
    const fn = (mod['canHandle'] ?? mod['canHandleUrl']) as ((u: string) => boolean) | undefined;
    if (fn) {
      const hit = fn(url);
      if (hit) console.log(`  → 命中 ${c.name}`);
    }
  }
}

async function testProbe(): Promise<void> {
  header('3. 后端探活（check）—— 这是 Agent Reach doctor 的核心逻辑');
  for (const c of channels) {
    const mod = c.mod as { check?: () => Promise<unknown> };
    if (!mod.check) continue;
    process.stdout.write(`  ${c.name.padEnd(14)} ... `);
    try {
      const avail = (await mod.check()) as { status: string; activeBackend?: string; message: string };
      const tag = avail.status === 'ok' ? '✓' : avail.status === 'warn' ? '~' : avail.status === 'off' ? '○' : '✗';
      const backend = avail.activeBackend ? `[${avail.activeBackend}]` : '[none]';
      console.log(`${tag} ${avail.status.padEnd(5)} ${backend}`);
      console.log(`                 ${avail.message.split('\n')[0]!.slice(0, 80)}`);
    } catch (e) {
      console.log(`! error: ${e instanceof Error ? e.message : e}`);
    }
  }
}

async function testCleaners(): Promise<void> {
  header('4. cleaners 单测（xiaohongshu _clean_note 对译验证）');
  // 模拟一个典型 note 响应
  const rawNote = {
    note_card: {
      id: 'abc123',
      title: '测试笔记',
      desc: '这是一个测试',
      type: 'normal',
      user: { nickname: 'tester', user_id: 'u1', extra_field: 'should be stripped' },
      interact_info: { liked_count: '123', collected_count: '45', comment_count: '6', share_count: '7' },
      image_list: [{ url: 'http://img1', url_default: 'http://img1d' }, { url: 'http://img2' }],
      tag_list: [{ name: 'tag1' }, { name: 'tag2' }, { type: 'x' }],
      comments: [{ content: 'nice', user_info: { nickname: 'c1' }, like_count: 1, sub_comment_count: 0 }],
    },
    extra_garbage: 'should be stripped',
  };
  const cleaned = xiaohongshu.cleanNote(rawNote);
  console.log('原始字段数:', Object.keys(rawNote.note_card).length + 1, '(含 garbage)');
  console.log('清洗后字段数:', Object.keys(cleaned).length);
  console.log('清洗结果:', JSON.stringify(cleaned, null, 2));
  // 校验关键字段
  const ok = cleaned['id'] === 'abc123'
    && cleaned['title'] === '测试笔记'
    && (cleaned['user'] as Record<string, unknown>)['nickname'] === 'tester'
    && cleaned['liked_count'] === '123'
    && Array.isArray(cleaned['images']) && (cleaned['images'] as string[]).length === 2
    && Array.isArray(cleaned['tags']) && (cleaned['tags'] as string[]).length === 2
    && Array.isArray(cleaned['comments']) && (cleaned['comments'] as unknown[]).length === 1
    && !('extra_garbage' in cleaned);
  console.log(ok ? '\n✓ cleaner 对译正确' : '\n✗ cleaner 对译有误');
}

async function main(): Promise<void> {
  console.log('agent-reach-ts-shadow —— 自检');
  console.log(`Node: ${process.version}`);
  console.log(`Platform: ${process.platform}`);

  const args = process.argv.slice(2);
  const onlyProbe = args.includes('--probe');
  const routeArg = args.find((a: string) => a.startsWith('--route='));
  const routeUrl = routeArg ? routeArg.slice('--route='.length) : undefined;

  if (onlyProbe) {
    await testProbe();
  } else {
    await testRegistration();

    if (routeUrl) {
      await testRouting(routeUrl);
    } else {
      // 默认跑几个代表性 URL
      for (const url of [
        'https://www.youtube.com/watch?v=dQw4w9WgXcQ',
        'https://github.com/owner/repo',
        'https://www.v2ex.com/t/123',
        'https://xueqiu.com/S/SH600519',
        'https://www.bilibili.com/video/BV1xx',
        'https://rsshub.app/abc',
        'https://www.xiaohongshu.com/explore/xyz',
        'https://x.com/user/status/123',
        'https://example.com/some-article',
      ]) {
        await testRouting(url);
      }
    }

    await testCleaners();
    // 探活放最后，因为它会真触网/触子进程
    await testProbe();
  }

  header('完成');
}

main().catch((e) => {
  console.error('demo runner crashed:', e);
  process.exit(1);
});
