/**
 * 抄写自 browser-ai-assistant-master/src/background/browserControlMessageHandler.ts
 * 中的 BrowserControlSnapshotManager 类及相关 helper 函数。
 *
 * 适配点（仅类型对接）：
 * - AccessibilityNode / SnapshotFormatBudget / BrowserControlTabInfo 从
 *   @shared/agent-browser/types 导入（结构与源项目一致）。
 * - 构造函数的 connection 参数改为最小接口 BrowserControlSnapshotConnection，
 *   只依赖 getFullAccessibilityTree()（源项目传入 BrowserDebuggerConnection 也只用到此方法）。
 *
 * 逻辑结构、常量、正则、阈值原样抄写，便于后续同步上游修复。
 */

import type {
  AccessibilityNode,
  BrowserControlTabInfo,
  SnapshotFormatBudget,
} from "@shared/agent-browser/types";

/** 快照管理器所需的 connection 接口（源项目传入 BrowserDebuggerConnection，仅用到 getFullAccessibilityTree）。 */
export interface BrowserControlSnapshotConnection {
  getFullAccessibilityTree(): Promise<unknown>;
}

const SNAPSHOT_MAX_LENGTH = 20_000;
const SNAPSHOT_MAX_DEPTH = 50;
const SNAPSHOT_MAX_NODE_COUNT = 1_000;
const SNAPSHOT_EMPTY_TEXT = "未读取到可访问节点。";
const SNAPSHOT_TRUNCATED_TEXT = "快照内容过长，已停止继续展开。";
const SKIPPED_AX_ROLES = new Set(["none", "generic", "section", "paragraph", "StaticText", "InlineTextBox"]);

export class BrowserControlSnapshotManager {
  private snapshotVersion = 0;
  private lastPageIdentity = "";
  private readonly uidToBackendNodeId = new Map<string, number>();
  private readonly uidToAxNode = new Map<string, AccessibilityNode>();
  private readonly backendNodeIdToUid = new Map<number, string>();

  constructor(
    private readonly connection: BrowserControlSnapshotConnection,
    private readonly getTabInfo: () => Promise<BrowserControlTabInfo>,
  ) {}

  getBackendNodeId(uid: string): number {
    const backendNodeId = this.uidToBackendNodeId.get(uid);
    if (backendNodeId) {
      return backendNodeId;
    }

    const snapshotVersion = Number.parseInt(uid.split("_")[0] ?? "", 10);
    if (Number.isFinite(snapshotVersion) && snapshotVersion > 0 && snapshotVersion !== this.snapshotVersion) {
      throw new Error(`UID ${uid} 来自旧快照，当前页面快照版本是 ${this.snapshotVersion}。`);
    }

    throw new Error(`UID ${uid} 在当前页面快照中不存在。`);
  }

  getAXNode(uid: string): AccessibilityNode | undefined {
    return this.uidToAxNode.get(uid);
  }

  listElementCandidates(): Array<{ uid: string; backendNodeId: number; axNode?: AccessibilityNode }> {
    return Array.from(this.uidToBackendNodeId.entries()).map(([uid, backendNodeId]) => ({
      uid,
      backendNodeId,
      axNode: this.uidToAxNode.get(uid),
    }));
  }

  clearSnapshotCache(): void {
    this.snapshotVersion += 1;
    this.lastPageIdentity = "";
    this.uidToBackendNodeId.clear();
    this.uidToAxNode.clear();
    this.backendNodeIdToUid.clear();
  }

  async takeSnapshot(): Promise<string> {
    const response = await this.connection.getFullAccessibilityTree();
    const nodes = normalizeAccessibilityNodes(response);
    const tabInfo = await this.getTabInfo();
    this.resetUidCacheIfPageChanged(createPageIdentity(tabInfo));
    const body = this.formatSnapshot(nodes);
    const content = [
      "# 浏览器页面快照",
      `页面标题：${tabInfo.title || "无标题"}`,
      `页面 URL：${tabInfo.url || "未知"}`,
      "",
      body || SNAPSHOT_EMPTY_TEXT,
    ].join("\n");

    return truncateSnapshot(content);
  }

  private formatSnapshot(nodes: AccessibilityNode[]): string {
    this.snapshotVersion += 1;
    this.uidToBackendNodeId.clear();
    this.uidToAxNode.clear();

    if (!nodes.length) {
      this.backendNodeIdToUid.clear();
      return SNAPSHOT_EMPTY_TEXT;
    }

    const nodeById = new Map<string, AccessibilityNode>();
    for (const node of nodes) {
      if (node.nodeId) {
        nodeById.set(node.nodeId, node);
      }
    }

    const root = nodes.find((node) => getAxValue(node.role) === "RootWebArea") ?? nodes[0];
    const seenBackendNodeIds = new Set<number>();
    const budget: SnapshotFormatBudget = {
      lines: [],
      visitedNodeIds: new Set(),
      nodeCount: 0,
      characterCount: 0,
      truncated: false,
    };
    this.formatNode(root, nodeById, 0, seenBackendNodeIds, { value: 0 }, budget);

    for (const backendNodeId of Array.from(this.backendNodeIdToUid.keys())) {
      if (!seenBackendNodeIds.has(backendNodeId)) {
        this.backendNodeIdToUid.delete(backendNodeId);
      }
    }

    return budget.lines.join("\n") || SNAPSHOT_EMPTY_TEXT;
  }

  private formatNode(
    node: AccessibilityNode | undefined,
    nodeById: Map<string, AccessibilityNode>,
    depth: number,
    seenBackendNodeIds: Set<number>,
    uidCounter: { value: number },
    budget: SnapshotFormatBudget,
  ): void {
    if (!node || budget.truncated) {
      return;
    }

    if (node.nodeId && budget.visitedNodeIds.has(node.nodeId)) {
      return;
    }
    if (node.nodeId) {
      budget.visitedNodeIds.add(node.nodeId);
    }

    if (depth >= SNAPSHOT_MAX_DEPTH) {
      this.appendSnapshotLine(`${"  ".repeat(SNAPSHOT_MAX_DEPTH)}- 节点层级过深，已停止继续展开。`, budget);
      return;
    }

    const interesting = isInterestingAxNode(node);

    if (interesting) {
      const parts = this.createNodeParts(node, seenBackendNodeIds, uidCounter);
      if (parts.length) {
        this.appendSnapshotLine(`${"  ".repeat(depth)}- ${parts.join(" ")}`, budget);
      }
    }

    for (const childId of node.childIds ?? []) {
      this.formatNode(nodeById.get(childId), nodeById, depth + (interesting ? 1 : 0), seenBackendNodeIds, uidCounter, budget);
      if (budget.truncated) {
        return;
      }
    }
  }

  private createNodeParts(node: AccessibilityNode, seenBackendNodeIds: Set<number>, uidCounter: { value: number }): string[] {
    const parts: string[] = [];
    if (typeof node.backendDOMNodeId === "number") {
      const uid = this.resolveUid(node.backendDOMNodeId, uidCounter);
      this.uidToBackendNodeId.set(uid, node.backendDOMNodeId);
      this.uidToAxNode.set(uid, node);
      seenBackendNodeIds.add(node.backendDOMNodeId);
      parts.push(`uid=${uid}`);
    }

    const role = getAxValue(node.role);
    const name = getAxValue(node.name);
    const value = getAxValue(node.value);
    if (role) {
      parts.push(role);
    }
    if (name) {
      parts.push(JSON.stringify(name));
    }
    if (value && value !== name) {
      parts.push(`value=${JSON.stringify(value)}`);
    }

    for (const property of node.properties ?? []) {
      if (!property.name || !["checked", "disabled", "expanded", "selected", "focused", "required"].includes(property.name)) {
        continue;
      }
      const propertyValue = getAxValue(property.value);
      if (propertyValue !== "") {
        parts.push(`${property.name}=${JSON.stringify(propertyValue)}`);
      }
    }

    return parts;
  }

  private resolveUid(backendNodeId: number, uidCounter: { value: number }): string {
    const existingUid = this.backendNodeIdToUid.get(backendNodeId);
    if (existingUid) {
      return existingUid;
    }

    uidCounter.value += 1;
    const uid = `${this.snapshotVersion}_${uidCounter.value}`;
    this.backendNodeIdToUid.set(backendNodeId, uid);
    return uid;
  }

  private appendSnapshotLine(line: string, budget: SnapshotFormatBudget): void {
    if (budget.nodeCount >= SNAPSHOT_MAX_NODE_COUNT || budget.characterCount + line.length > SNAPSHOT_MAX_LENGTH) {
      if (!budget.truncated) {
        budget.lines.push(`${"  ".repeat(Math.min(SNAPSHOT_MAX_DEPTH, 1))}- ${SNAPSHOT_TRUNCATED_TEXT}`);
        budget.truncated = true;
      }
      return;
    }

    budget.lines.push(line);
    budget.nodeCount += 1;
    budget.characterCount += line.length + 1;
  }

  private resetUidCacheIfPageChanged(pageIdentity: string): void {
    if (this.lastPageIdentity && this.lastPageIdentity !== pageIdentity) {
      this.backendNodeIdToUid.clear();
    }

    this.lastPageIdentity = pageIdentity;
  }
}

function normalizeAccessibilityNodes(response: unknown): AccessibilityNode[] {
  if (!response || typeof response !== "object" || !("nodes" in response) || !Array.isArray(response.nodes)) {
    return [];
  }

  return response.nodes.filter((node): node is AccessibilityNode => Boolean(node && typeof node === "object"));
}

function isInterestingAxNode(node: AccessibilityNode): boolean {
  const role = getAxValue(node.role);
  const name = getAxValue(node.name);
  const value = getAxValue(node.value);
  if (node.ignored && !name && !value) {
    return false;
  }

  if (typeof node.backendDOMNodeId === "number") {
    return true;
  }

  if (!role && !name && !value) {
    return false;
  }

  return !SKIPPED_AX_ROLES.has(role);
}

function getAxValue(source: { value?: unknown } | undefined): string {
  if (source?.value === undefined || source.value === null) {
    return "";
  }

  return String(source.value).trim();
}

function createPageIdentity(tabInfo: BrowserControlTabInfo): string {
  return `${tabInfo.url}\n${tabInfo.title}`;
}

function truncateSnapshot(content: string): string {
  if (content.length <= SNAPSHOT_MAX_LENGTH) {
    return content;
  }

  return `${content.slice(0, SNAPSHOT_MAX_LENGTH)}\n\n[快照内容过长，已截断。请基于已显示结构继续分析，必要时让用户缩小页面范围。]`;
}
