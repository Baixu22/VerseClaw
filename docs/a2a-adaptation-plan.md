# ClawX A2A Adaptation Plan

> Date: 2026-06-19  
> Scope: Future-facing design notes for adapting ClawX/OpenClaw to Google's Agent2Agent Protocol (A2A) without disrupting the current role-first runtime, MCP/tool model, Knowledge Hub governance, or ClawGraph execution model.

## 1. Why This Matters

Google announced the Agent2Agent Protocol (A2A) as an open protocol for AI agents to communicate, exchange information, coordinate actions, and collaborate across enterprise systems. The announcement positions A2A as complementary to MCP: MCP connects agents to tools/context, while A2A connects agents to other agents. Google highlights design principles that matter directly to ClawX: build on HTTP/SSE/JSON-RPC, support enterprise authentication/authorization, long-running tasks, multimodal parts, capability discovery through Agent Cards, and task/artifact lifecycle semantics.

Sources reviewed:

- [Google Developers Blog: Announcing the Agent2Agent Protocol](https://developers.googleblog.com/en/a2a-a-new-era-of-agent-interoperability/)
- [A2A Protocol Specification](https://a2a-protocol.org/latest/specification/)
- [A2A and MCP comparison](https://a2a-protocol.org/latest/topics/a2a-and-mcp/)
- [Linux Foundation A2A project launch](https://www.linuxfoundation.org/press/linux-foundation-launches-the-agent2agent-protocol-project-to-enable-secure-intelligent-communication-between-ai-agents)

## 2. Interpretation for ClawX

A2A should not replace ClawX's existing architecture. The right interpretation is an interoperability edge:

- MCP remains the tool/resource edge.
- ClawX host-api remains the renderer/Main boundary.
- OpenClaw Gateway remains the local runtime boundary.
- ClawGraph remains the long-task orchestration layer.
- Task Ledger remains the durable work-state ledger.
- Knowledge Hub remains source-backed, user-confirmed knowledge governance.
- A2A becomes a future external agent collaboration layer: discover remote agents, delegate bounded tasks, receive task updates/artifacts, and surface those interactions through existing review and permission systems.

This means A2A is not a new chat transport, not a direct replacement for role workers, and not an excuse to bypass user confirmation.

## 3. A2A Concepts Mapped to ClawX

| A2A concept | ClawX/OpenClaw mapping | Adaptation note |
|---|---|---|
| Agent Card | Agent/role capability profile + public endpoint metadata | Can be generated from role profile, skills, model/tool policy, and workspace permission posture. |
| Agent Skill | Role capability or bounded service capability | Should expose coarse capabilities, not raw tools. |
| Client agent | Local OpenClaw agent or ClawGraph node requesting external help | Must go through Main/Gateway policy and audit. |
| Remote agent | External A2A server | Treat as untrusted, permission-scoped collaborator. |
| Task | Task Ledger node / ClawGraph external-task node | Preserve A2A task id and status as evidence refs. |
| Task state | Task Ledger status + Observability span status | Map A2A lifecycle into ClawX status vocabulary without losing remote state. |
| Artifact | Generated file, structured result, trace attachment, or Knowledge draft source | Store or stage artifacts through existing file/preview/ledger paths. |
| Message parts | Chat/ClawGraph content parts, file refs, media refs | Avoid text-only bottlenecks; preserve media type and provenance. |
| Streaming updates | Gateway events / Observability lifecycle events | Surface progress without mutating local task truth until accepted. |
| Push notifications | Future remote callback channel | Requires explicit local endpoint, auth, and user/admin opt-in. |
| Extended Agent Card | Authenticated capability metadata | Never expose secrets or internal paths in public cards. |

## 4. Product Boundaries

Hard boundaries:

- A2A delegation does not grant workspace write permission.
- A2A remote agents are never trusted as local agents.
- Remote artifacts are evidence until user or policy accepts them.
- Knowledge writes still go through Knowledge Draft / Proposal / User Apply.
- ClawGraph remote nodes must freeze for review if evidence is incomplete, conflicting, or unverifiable.
- A2A Agent Cards must not leak local filesystem paths, provider keys, user identities, hidden role prompts, or private Knowledge Hub content.

Non-goals for the first adaptation:

- Do not implement a public always-on A2A server by default.
- Do not expose every local role as a remote agent automatically.
- Do not map A2A tasks directly to shell/file operations.
- Do not introduce a new vector database or knowledge graph for A2A.
- Do not make A2A a required dependency for local ClawX usage.

## 5. Proposed Architecture

### 5.1 Local A2A Client

Add an OpenClaw Gateway service layer for outbound A2A:

- `a2a.discover`
  - Fetch `.well-known/agent-card.json`.
  - Validate transport, version, security schemes, advertised skills, and cache headers.
  - Store only sanitized metadata in ClawX state.
- `a2a.sendTask`
  - Create a remote task from a local Task Ledger node or ClawGraph external node.
  - Include bounded context pack, explicit objective, allowed artifact types, and permission constraints.
- `a2a.getTask`
  - Poll or retrieve current task status.
- `a2a.subscribeTask`
  - Stream task status/artifact updates when supported.
- `a2a.cancelTask`
  - Cancel remote task from user action or local graph abort.

Renderer should only call typed host-api methods; no renderer-direct A2A HTTP calls.

### 5.2 Optional Local A2A Server

Later, ClawX/OpenClaw may expose a local A2A server for selected roles:

- Disabled by default.
- Workspace-scoped opt-in.
- Separate public Agent Card from authenticated Extended Agent Card.
- Agent Card generated from a role/capability profile, not from raw prompts.
- Incoming tasks enter Task Ledger review or a ClawGraph external inbox before execution.
- Any requested write operation follows existing workspace permission approval.

The default product posture should be "A2A client first, server later."

### 5.3 A2A Registry UI

Add a future Settings or Agents panel section:

- Remote Agents
- Agent Card URL
- Trust status
- Auth method
- Supported skills
- Allowed workspaces
- Allowed ClawGraph nodes or task types
- Last task status
- Revocation/remove action

This should feel like MCP server management, but with task/collaboration semantics instead of tool invocation semantics.

## 6. Role-First Integration

A2A should align with role-first rather than flatten it.

Rules:

- A local role can request A2A help only if its role profile allows external delegation.
- A role's Agent Card should expose capability categories, not inner chain-of-thought, hidden prompts, provider details, or unrestricted tools.
- External A2A results should be attributed to a remote agent identity and attached to Task Ledger / Observability evidence.
- Lead-worker orchestration can use A2A as one worker class, but the lead remains responsible for synthesis and verifier gating.
- Adversarial-review mode should treat remote outputs as untrusted claims until checked.

Suggested capability flags:

```ts
type RoleA2ACapability = {
  canDelegateToRemoteAgents: boolean;
  canExposeAsRemoteAgent: boolean;
  allowedRemoteAgentIds: string[];
  allowedSkillTags: string[];
  maxRemoteTaskDurationMs: number;
  requireUserApprovalForRemoteTask: boolean;
};
```

## 7. ClawGraph Integration

A2A maps cleanly to ClawGraph as an external node execution strategy.

Example future node shape:

```yaml
nodes:
  external_research:
    kind: a2a
    remoteAgent: vendor.research-agent
    skill: source-backed-market-research
    input:
      objective: "Compare candidate APIs"
      contextPack: "@current"
    review:
      requireArtifacts: true
      requireCitations: true
      freezeOnConflict: true
```

Execution model:

1. ClawGraph compiles the node into an A2A task plan.
2. Main/Gateway checks workspace permissions and remote-agent policy.
3. User approval is required when delegation sends sensitive workspace context.
4. Gateway sends the A2A task.
5. Streaming updates become Observability spans and Task Ledger events.
6. Artifacts land in a review surface, not directly in source files.
7. Verifier/auditor gates downstream nodes.

## 8. Task Ledger and Observability

Task Ledger should store A2A references without becoming an A2A database:

```ts
type A2ATaskRef = {
  providerId: string;
  agentCardUrl: string;
  remoteAgentName?: string;
  remoteTaskId: string;
  remoteContextId?: string;
  skillId?: string;
  status: 'submitted' | 'working' | 'input_required' | 'completed' | 'failed' | 'canceled';
  artifactRefs: string[];
  lastSeenAt: string;
};
```

Observability spans should include:

- `a2a.discover`
- `a2a.task.submit`
- `a2a.task.update`
- `a2a.artifact.received`
- `a2a.task.cancel`
- `a2a.auth.refresh`

Each span should include remote provider id, sanitized agent card hash/version, task id, skill id, duration, status, and error mapping.

## 9. Knowledge Hub Integration

A2A can improve knowledge workflows, but must preserve governance:

- Remote A2A artifacts can become `KnowledgeSourceRef` entries.
- Remote claims can seed a `KnowledgeDraft`.
- Remote research summaries must not write directly to `memory-wiki`.
- Knowledge Steward can review remote artifacts for source quality, conflicts, duplicates, and stale assumptions.
- If a remote agent returns an update/merge suggestion, ClawX should create a `KnowledgeChangeProposal` with target pages and diff preview.

Recommended source ref:

```ts
type A2AKnowledgeSourceRef = {
  id: string;
  kind: 'a2a';
  providerId: string;
  agentCardUrl: string;
  remoteTaskId: string;
  artifactId?: string;
  label?: string;
};
```

## 10. Security and Governance

A2A adoption must be security-first:

- Verify HTTPS for remote Agent Cards by default.
- Cache Agent Cards using ETag / max-age when available.
- Support signed Agent Cards later; do not trust unsigned cards for privileged workflows.
- Treat Extended Agent Cards as authenticated metadata and do not display secrets.
- Add allowlists for remote Agent Card origins.
- Require explicit user approval before sending workspace files, transcripts, Knowledge Hub content, or Task Ledger details to a remote agent.
- Keep a remote-agent audit log with task id, context sent, artifacts received, approvals, and cancellation events.
- Map remote auth scopes to ClawX permissions; never inherit local permissions from a remote agent.

## 11. Data Minimization

The default A2A payload should be a bounded Context Pack:

- objective
- relevant source snippets
- user-approved file excerpts
- selected Task Ledger node summary
- allowed output/artifact types
- explicit denied actions

It should not include:

- full transcript by default
- provider API keys
- hidden role prompts
- local filesystem topology
- private Knowledge Hub pages unless user-approved
- unbounded workspace file contents

## 12. Implementation Phases

### Phase 0: Documentation and Spec Tracking

- Keep this plan current as A2A evolves.
- Add an overview note that A2A is the future agent-to-agent edge, complementary to MCP.
- Track A2A version, Agent Card shape, task lifecycle names, and auth requirements.

### Phase 1: Read-Only Discovery

- Add typed host API for `a2a.discover`.
- Fetch and validate Agent Cards from user-provided URLs.
- Show remote agent capabilities in Settings.
- No task delegation yet.

### Phase 2: Outbound Task Delegation

- Add `a2a.sendTask`, `a2a.getTask`, `a2a.cancelTask`.
- Integrate with Task Ledger and Observability.
- Require user approval for any workspace or knowledge context.
- Start with non-streaming JSON-RPC/HTTP binding.

### Phase 3: Streaming and Artifacts

- Add SSE streaming support.
- Display task progress and artifacts in ClawGraph / Task Ledger review.
- Stage file artifacts through existing file preview and approval surfaces.

### Phase 4: ClawGraph External Nodes

- Add `kind: a2a` ClawGraph node type.
- Add compile-time validation for remote agent id, skill id, artifact requirements, and review gates.
- Freeze downstream execution when remote evidence is incomplete.

### Phase 5: Optional Inbound A2A Server

- Expose selected ClawX roles as local A2A agents only after user/admin opt-in.
- Serve `.well-known/agent-card.json`.
- Accept tasks into a reviewed inbox.
- Do not allow remote-triggered writes without local user approval.

## 13. Acceptance Criteria for First Engineering Task

The first implementation task should be discovery-only:

- User can add an Agent Card URL.
- Main/Gateway fetches it, validates basic shape, caches it, and redacts unsafe fields.
- Renderer displays agent name, provider, version, skills, supported transports, auth requirements, and warnings.
- No chat send, remote task execution, file sharing, or Knowledge write occurs.
- Tests cover invalid card, unsupported version, insecure URL warning, cache behavior, and renderer/Main boundary.

## 14. Open Questions

- Which A2A protocol version should ClawX target first once implementation begins?
- Should remote agents be configured globally, per workspace, or per role profile?
- Should A2A remote tasks appear primarily in Task Ledger, ClawGraph, or a dedicated Remote Agents panel?
- What is the minimum Agent Card signature policy for enterprise-grade workflows?
- How should ClawX represent remote multimodal artifacts in the existing file preview and chat surfaces?

## 15. Near-Term Recommendation

Do not rush into a full A2A server. The lowest-risk path is:

1. Document the architecture boundary.
2. Implement read-only Agent Card discovery.
3. Add policy and audit foundations.
4. Add outbound task delegation for explicitly approved ClawGraph nodes.
5. Only then consider exposing selected local roles as inbound A2A agents.

This preserves ClawX's current strengths: role-first governance, explicit user control, bounded context, and reviewable long-task execution.
