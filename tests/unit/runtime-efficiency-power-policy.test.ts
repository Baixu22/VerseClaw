import { describe, expect, it } from "vitest";
import { EfficiencyPowerPolicy } from "../../electron/services/efficiency-power-policy";

describe("runtime efficiency power/idle policy", () => {
  it("does not shed by default", () => {
    const policy = new EfficiencyPowerPolicy();
    expect(policy.shedding).toBe(false);
    expect(policy.getState().reason).toBeNull();
    expect(policy.getState().transitionCount).toBe(0);
  });

  it("sheds when the window is hidden and records an observable transition", () => {
    const policy = new EfficiencyPowerPolicy();
    const state = policy.update({ windowHidden: true });
    expect(state.shedding).toBe(true);
    expect(state.reason).toBe("window-hidden");
    expect(state.activeReasons).toEqual(["window-hidden"]);
    expect(state.transitionCount).toBe(1);
    expect(state.lastTransitionAt).not.toBeNull();
  });

  it("restores normal load when the condition clears", () => {
    const policy = new EfficiencyPowerPolicy();
    policy.update({ windowHidden: true });
    const cleared = policy.update({ windowHidden: false });
    expect(cleared.shedding).toBe(false);
    expect(cleared.reason).toBeNull();
    expect(cleared.transitionCount).toBe(2);
  });

  it("does not count a transition when inputs change but effective state does not", () => {
    const policy = new EfficiencyPowerPolicy();
    policy.update({ windowHidden: true });
    const before = policy.getState().transitionCount;
    // Same effective reason, but a new secondary reason appears.
    const state = policy.update({ powerSaver: true });
    expect(state.transitionCount).toBe(before);
    expect(state.activeReasons).toEqual(["window-hidden", "power-saver"]);
  });

  it("applies documented reason precedence when several signals are active", () => {
    const policy = new EfficiencyPowerPolicy();
    const state = policy.update({ windowHidden: false, powerSaver: true, displaySleep: true });
    expect(state.shedding).toBe(true);
    expect(state.reason).toBe("display-sleep");
    expect(state.activeReasons).toEqual(["power-saver", "display-sleep"]);
  });

  it("window-hidden outranks power-saver", () => {
    const policy = new EfficiencyPowerPolicy();
    const state = policy.update({ windowHidden: true, powerSaver: true });
    expect(state.reason).toBe("window-hidden");
  });

  it("invokes the transition callback only on real transitions", () => {
    const seen: string[] = [];
    const policy = new EfficiencyPowerPolicy({
      now: () => 42,
      onTransition: (state) => seen.push(`${state.shedding ? "shed" : "run"}:${state.reason}`),
    });
    policy.update({ windowHidden: true });
    policy.update({ windowHidden: true });
    policy.update({ powerSaver: true });
    // The effective reason changes from window-hidden to power-saver, which is
    // still a shed state, so this IS a real transition.
    policy.update({ windowHidden: false });
    // Only once every reason clears does load come back.
    policy.update({ powerSaver: false });
    expect(seen).toEqual(["shed:window-hidden", "shed:power-saver", "run:null"]);
  });

  it("stays responsive to a power-saver-only signal", () => {
    const policy = new EfficiencyPowerPolicy();
    const state = policy.update({ powerSaver: true });
    expect(state.shedding).toBe(true);
    expect(state.reason).toBe("power-saver");
  });

  it("reset() returns to the initial non-shedding state", () => {
    const policy = new EfficiencyPowerPolicy();
    policy.update({ windowHidden: true, powerSaver: true });
    policy.reset();
    const state = policy.getState();
    expect(state.shedding).toBe(false);
    expect(state.reason).toBeNull();
    expect(state.transitionCount).toBe(0);
    expect(policy.getInputs()).toEqual({
      windowHidden: false,
      powerSaver: false,
      displaySleep: false,
    });
  });

  it("returns defensive copies so callers cannot mutate internal state", () => {
    const policy = new EfficiencyPowerPolicy();
    policy.update({ windowHidden: true });
    const snapshot = policy.getState();
    snapshot.activeReasons.push("power-saver");
    expect(policy.getState().activeReasons).toEqual(["window-hidden"]);
  });
});