/**
 * Display identity for a sub-agent — a name and a face.
 *
 * WHY THIS EXISTS. The runtime reports a sub-agent's ROLE (`explorer`,
 * `reviewer`, `planner`), which is what it is for, not who it is. A fan-out that
 * spawns three reviewers produces three rows all called "reviewer", and the
 * workspace tab strip ends up with three chips nobody can tell apart. So each
 * worker also gets a short name and a distinct face.
 *
 * DETERMINISTIC, NOT RANDOM-PER-RENDER. The name and face are derived from the
 * worker's own stable key (its `childSessionKey`, falling back to its agent or
 * roster id), so the same worker is the same person on every render, after a
 * remount, and after a reload. Calling `Math.random()` here would rename the
 * worker mid-run and repaint its avatar on every keystroke in the composer.
 * "Random" in the product sense — you cannot predict which name a worker gets —
 * is delivered by hashing, and hashing is what makes it stable.
 *
 * ONE SOURCE FOR THREE SURFACES. The status panel row, the workspace tab chip
 * and the sub-agent page header all call this, so a worker cannot be Wren in
 * one place and Piper in another.
 *
 * The avatar reuses the existing assistant pipeline (`AGENT_AVATAR_BACKGROUNDS`,
 * `agentAvatarRevision`, dicebear `lorelei-neutral`) rather than inventing a
 * second avatar system — `AgentAvatar` renders the returned view unchanged.
 */
import { AGENT_AVATAR_BACKGROUNDS, agentAvatarRevision, DEFAULT_AGENT_AVATAR_STYLE } from './agent-avatar';
import type { AgentAvatarView } from './types/agent';

/**
 * Short, pronounceable, role-neutral names.
 *
 * Deliberately not people's names: a worker called "Sarah" reads as a teammate
 * you could ask something. These are things — birds, trees, weather — so the
 * name is a handle, not a persona. 48 entries keeps collisions rare in the
 * fan-out sizes this UI shows (a dozen workers at most) without turning into a
 * dictionary nobody can scan.
 */
const SUBAGENT_NAMES: readonly string[] = [
  'Wren', 'Piper', 'Juniper', 'Cedar', 'Marlow', 'Quill',
  'Sable', 'Fen', 'Bramble', 'Cove', 'Dune', 'Ember',
  'Frost', 'Glade', 'Harbor', 'Indigo', 'Kestrel', 'Larch',
  'Meadow', 'North', 'Onyx', 'Pike', 'Quarry', 'Rowan',
  'Slate', 'Thistle', 'Umber', 'Vale', 'Willow', 'Yarrow',
  'Alder', 'Basil', 'Clover', 'Drift', 'Elm', 'Flint',
  'Gale', 'Hollow', 'Ivy', 'Jetty', 'Kite', 'Linden',
  'Moss', 'Nettle', 'Osprey', 'Plume', 'Reed', 'Sorrel',
];

/**
 * FNV-1a. Same algorithm and constants as `agentAvatarRevision` in
 * agent-avatar.ts — one hash in the codebase rather than two that drift.
 */
function hash32(input: string): number {
  let hash = 0x811c9dc5;
  for (let index = 0; index < input.length; index += 1) {
    hash ^= input.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193);
  }
  return hash >>> 0;
}

export type SubagentIdentity = {
  /** The generated handle, e.g. `Wren`. */
  name: string;
  /** Stable key the name and face were derived from. */
  seedKey: string;
  /** Ready for `<AgentAvatar agentId={avatarId} avatar={avatar} />`. */
  avatar: AgentAvatarView;
  /** Pass as `agentId` to `AgentAvatar` — the dicebear seed is salted with it. */
  avatarId: string;
};

/**
 * Resolve one sub-agent's display identity.
 *
 * `seedKey` should be the most stable identifier available, in this order:
 * `childSessionKey` (survives status changes and reloads) → `agentId` → the
 * roster id. Callers pass whichever they have; `subagentIdentityKey` below
 * encodes that preference so every call site picks the same one.
 */
export function subagentIdentity(seedKey: string): SubagentIdentity {
  const key = seedKey.trim() || 'subagent';
  const digest = hash32(key);
  const name = SUBAGENT_NAMES[digest % SUBAGENT_NAMES.length];
  // A second, decorrelated draw for the background: reusing `digest` directly
  // would tie a name to one colour forever, so every Wren would be blue.
  const backgroundColor = AGENT_AVATAR_BACKGROUNDS[
    hash32(`${key}:bg`) % AGENT_AVATAR_BACKGROUNDS.length
  ];
  const preset = {
    style: DEFAULT_AGENT_AVATAR_STYLE,
    seed: key,
    backgroundColor,
  };
  return {
    name,
    seedKey: key,
    avatarId: key,
    avatar: {
      kind: 'fallback',
      source: 'identity',
      preset,
      revision: agentAvatarRevision(key, preset),
    },
  };
}

/**
 * The stable key for a roster entry, so the panel row, the tab chip and the
 * page header all derive the same identity from the same worker.
 */
export function subagentIdentityKey(entry: {
  childSessionKey?: string;
  agentId?: string;
  id?: string;
}): string {
  return entry.childSessionKey?.trim()
    || entry.agentId?.trim()
    || entry.id?.trim()
    || 'subagent';
}
