// Deterministic LLM driver for runtime-memory evaluation.
// Maintains per-sessionKey response queues; CI-friendly (zero network, zero randomness).

export type ScriptedLlmResponse = {
  text: string;
  toolCalls?: Array<{ name: string; args: Record<string, unknown> }>;
  usage?: { input: number; output: number; total: number };
};

export type ScriptedLlmArm = "baseline" | "treatment";

export type ScriptedLlmScript = {
  sessionKey: string;
  arm?: ScriptedLlmArm;
  responses: readonly ScriptedLlmResponse[];
};

export class ScriptedLlmDriver {
  readonly #queues: Map<string, ScriptedLlmResponse[]>;
  readonly #original: Map<string, readonly ScriptedLlmResponse[]>;

  constructor(scripts: readonly ScriptedLlmScript[]) {
    this.#queues = new Map();
    this.#original = new Map();
    for (const script of scripts) {
      const key = ScriptedLlmDriver.key(script.sessionKey, script.arm);
      if (this.#queues.has(key)) {
        throw new Error(
          `ScriptedLlmDriver: duplicate script for key "${key}".`,
        );
      }
      this.#queues.set(key, [...script.responses]);
      this.#original.set(key, script.responses);
    }
  }

  respond(sessionKey: string): ScriptedLlmResponse {
    return this.#dequeue(ScriptedLlmDriver.key(sessionKey, undefined));
  }

  respondForArm(sessionKey: string, arm: ScriptedLlmArm): ScriptedLlmResponse {
    return this.#dequeue(ScriptedLlmDriver.key(sessionKey, arm));
  }

  remaining(sessionKey: string, arm?: ScriptedLlmArm): number {
    return this.#queues.get(ScriptedLlmDriver.key(sessionKey, arm))?.length ?? 0;
  }

  reset(): void {
    for (const [key, responses] of this.#original) {
      this.#queues.set(key, [...responses]);
    }
  }

  #dequeue(key: string): ScriptedLlmResponse {
    const queue = this.#queues.get(key);
    if (!queue) {
      throw new Error(
        `ScriptedLlmDriver: no script registered for key "${key}".`,
      );
    }
    if (queue.length === 0) {
      throw new Error(
        `ScriptedLlmDriver: script queue exhausted for key "${key}".`,
      );
    }
    return queue.shift() as ScriptedLlmResponse;
  }

  static key(sessionKey: string, arm?: ScriptedLlmArm): string {
    return arm ? `${sessionKey}#${arm}` : sessionKey;
  }
}
