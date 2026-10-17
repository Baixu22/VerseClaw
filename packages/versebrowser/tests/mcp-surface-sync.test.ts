/**
 * TF-0100：MCP 接口面必须自洽 —— 声明、注册、接线、驱动档案四处不能各说各话。
 *
 * 这三类不一致**都真实发生过**：
 *  - `vb_wait`：文档（browser-ops §4.2 / mcp.md）与策略都写了，代码里却没注册 → 客户端根本看不到；
 *  - `vb_mode_revoke` / `vb_mode_status`：注册了却没在策略里声明 → `requiredCapability` 返回
 *    `undefined`，`isToolAllowed` 直接 false，成了"看得见、调不动"的死工具；
 *  - `vb_page_text`：工具接线 + 驱动实现都做了，却漏登记驱动档案 →
 *    运行期 `driver "playwright" does not serve extractPageText`。
 *
 * 这四条断言把上述三类问题一次性钉住（纯静态，无需浏览器）。
 */
import { describe, expect, it } from 'vitest';
import { TOOL_CATALOG } from '../src/mcp/server.ts';
import { declaredToolNames, requiredCapability, toolGroup } from '../src/mcp/capability-policy.ts';
import { TOOL_AVAILABILITY } from '../src/mcp/tool-availability.ts';
import { profileForDriver, driverSupports } from '../src/engine/driver-profile.ts';
import {renderToolResultForTool} from '../src/mcp/result-envelope.ts';

const registered = TOOL_CATALOG.map((tool) => tool.name);

/** 文档化的"永远允许"探活工具：服务端在策略检查之前就处理它。 */
const POLICY_EXEMPT = new Set(['vb_ping']);

describe('MCP surface stays in sync (TF-0100)', () => {
  it('keeps usable page IDs and explicit truncation when the inventory exceeds the model budget',()=>{
    for(const tool of ['vb_pages','vb_page_select']) {
      const rendered=renderToolResultForTool(tool,{ok:true,content:'50 pages',data:{activePageId:'p49',pages:Array.from({length:50},(_,i)=>({pageId:`p${i}`,index:i,active:i===49,title:'title '.repeat(80),url:`https://example.test/${i}`}))}});
      const result=JSON.parse(rendered);expect(result.data.activePageId).toBe('p49');expect(result.data.pages.length).toBeGreaterThan(0);expect(result.data.pages.length).toBeLessThan(50);
      expect(result.data.pages[0].pageId).toBe('p0');expect(result.dataTruncated).toBeTruthy();
    }
  });
  it('每个注册的工具都有分组与能力声明（除 vb_ping 这一处文档化例外）', () => {
    const missing = registered.filter(
      (name) =>
        !POLICY_EXEMPT.has(name) &&
        (requiredCapability(name) === undefined || toolGroup(name) === undefined),
    );
    expect(missing).toEqual([]);
  });

  it('策略里声明的工具都必须真的注册（不留"文档里有、代码里没有"）', () => {
    const ghosts = declaredToolNames().filter((name) => !registered.includes(name));
    expect(ghosts).toEqual([]);
  });

  it('注册面与可用性表一一对应（不多不少）', () => {
    expect(registered.filter((name) => !TOOL_AVAILABILITY[name])).toEqual([]);
    expect(Object.keys(TOOL_AVAILABILITY).filter((name) => !registered.includes(name))).toEqual([]);
  });

  it('每个wired工具的全部依赖由至少一个真实驱动档案支持', () => {
    const missing: string[] = [];
    const profiles = [profileForDriver('playwright'), profileForDriver('upstream'), profileForDriver('upstream', true)];
    for (const [name, entry] of Object.entries(TOOL_AVAILABILITY)) {
      if (!entry.wired) continue;
      if (!profiles.some(profile => entry.requiresDriverMethods.every(method => driverSupports(profile, method)))) missing.push(name);
    }
    expect(missing).toEqual([]);
  });

  it('vb_find只由upstream广告，读取权限与依赖明确', () => {
    expect(toolGroup('vb_find')).toBe('core');
    expect(requiredCapability('vb_find')).toBe('browser.observe');
    expect(TOOL_AVAILABILITY.vb_find?.requiresDriverMethods).toEqual(['findElement']);
    expect(driverSupports(profileForDriver('playwright'), 'findElement')).toBe(false);
    expect(driverSupports(profileForDriver('upstream'), 'findElement')).toBe(true);
  });

  it('vb_wait 按文档接线：core 组 + browser.observe，且已注册', () => {
    expect(registered).toContain('vb_wait');
    expect(toolGroup('vb_wait')).toBe('core');
    expect(requiredCapability('vb_wait')).toBe('browser.observe');
    expect(TOOL_AVAILABILITY.vb_wait?.wired).toBe(true);
  });

  it('vb_runtime_read 按 TF-0105 接线：debug 组 + debug.runtime，只服务 inspect-globals', () => {
    expect(registered).toContain('vb_runtime_read');
    expect(toolGroup('vb_runtime_read')).toBe('debug');
    expect(requiredCapability('vb_runtime_read')).toBe('debug.runtime');
    expect(TOOL_AVAILABILITY.vb_runtime_read?.wired).toBe(true);
    // 只承诺薄驱动真的提供的那一个动作；search-modules / describe-function 仍是宿主能力。
    expect(TOOL_AVAILABILITY.vb_runtime_read?.requiresDriverMethods).toEqual([
      'runtimeInspectGlobals',
    ]);
    const schema = TOOL_CATALOG.find((tool) => tool.name === 'vb_runtime_read')?.inputSchema as {
      properties?: { action?: { enum?: string[] } };
      required?: string[];
    };
    expect(schema.properties?.action?.enum).toEqual(['inspect-globals']);
    expect(schema.required).toEqual(['sessionId', 'paths']);
  });

  it('标注与真实风险一致：能导航的标 open-world，关页/对话框标 destructive', () => {
    // docs/mcp.md used to say every tool carries the hint set, but 12 of 53 carry none - and three
    // risk-bearing tools carried nothing while their siblings did: vb_page_close (vb_close is
    // destructive), vb_page_new (vb_open is open-world) and vb_dialog_respond (accepting a dialog can
    // confirm a state change). Everything that can navigate must now be open-world.
    const byName = new Map(TOOL_CATALOG.map((tool) => [tool.name, tool]));
    const navigates = ['browser.open', 'browser.navigate'];
    const notOpenWorld = TOOL_CATALOG
      .filter((tool) => navigates.includes(requiredCapability(tool.name) ?? ''))
      .filter((tool) => tool.annotations?.openWorldHint !== true)
      .map((tool) => tool.name);
    expect(notOpenWorld, 'every navigating tool must be open-world').toEqual([]);
    for (const name of ['vb_page_close', 'vb_dialog_respond']) {
      expect(byName.get(name)?.annotations?.destructiveHint, `${name} must be destructive`).toBe(true);
    }
    expect(byName.get('vb_page_new')?.annotations?.openWorldHint, 'vb_page_new must be open-world').toBe(true);
  });

  it('撤销/查看运行模式的工具可被调用（不再被 deny-by-default 挡掉）', () => {
    for (const name of ['vb_mode_revoke', 'vb_mode_status']) {
      expect(registered).toContain(name);
      expect(requiredCapability(name)).not.toBeUndefined();
      expect(toolGroup(name)).toBe('authority');
      // 与 revoke 同平面同授权：默认 deny-by-default 下仍然只放行 vb_ping。
      expect(requiredCapability(name)).toBe('authority.revoke');
    }
    expect(declaredToolNames()).toContain('vb_mode_status');
  });
});
