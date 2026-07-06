import { describe, expect, it } from "vitest";
import { LruCache } from "../../openclaw_runtime/src/infra/lru-cache";

describe("LruCache", () => {
  it("stores and retrieves values by key", () => {
    const cache = new LruCache<string, number>(4);
    cache.set("a", 1);
    cache.set("b", 2);
    expect(cache.get("a")).toBe(1);
    expect(cache.get("b")).toBe(2);
    expect(cache.size()).toBe(2);
  });

  it("returns undefined for missing keys", () => {
    const cache = new LruCache<string, number>(4);
    expect(cache.get("missing")).toBeUndefined();
    expect(cache.has("missing")).toBe(false);
  });

  it("evicts the eldest entry when capacity is exceeded", () => {
    const cache = new LruCache<string, number>(3);
    cache.set("a", 1);
    cache.set("b", 2);
    cache.set("c", 3);
    cache.set("d", 4);
    expect(cache.size()).toBe(3);
    expect(cache.has("a")).toBe(false);
    expect(cache.get("b")).toBe(2);
    expect(cache.get("c")).toBe(3);
    expect(cache.get("d")).toBe(4);
  });

  it("promotes accessed entries to the end (most recently used)", () => {
    const cache = new LruCache<string, number>(3);
    cache.set("a", 1);
    cache.set("b", 2);
    cache.set("c", 3);
    cache.get("a");
    cache.set("d", 4);
    expect(cache.has("a")).toBe(true);
    expect(cache.has("b")).toBe(false);
  });

  it("updates existing keys without growing size and promotes them", () => {
    const cache = new LruCache<string, number>(3);
    cache.set("a", 1);
    cache.set("b", 2);
    cache.set("c", 3);
    cache.set("a", 10);
    expect(cache.size()).toBe(3);
    expect(cache.get("a")).toBe(10);
    cache.set("d", 4);
    expect(cache.has("a")).toBe(true);
    expect(cache.has("b")).toBe(false);
  });

  it("deletes entries by key", () => {
    const cache = new LruCache<string, number>(4);
    cache.set("a", 1);
    expect(cache.delete("a")).toBe(true);
    expect(cache.has("a")).toBe(false);
    expect(cache.size()).toBe(0);
    expect(cache.delete("a")).toBe(false);
  });

  it("clears all entries", () => {
    const cache = new LruCache<string, number>(4);
    cache.set("a", 1);
    cache.set("b", 2);
    cache.clear();
    expect(cache.size()).toBe(0);
    expect(cache.get("a")).toBeUndefined();
  });

  it("iterates entries in LRU order (eldest first)", () => {
    const cache = new LruCache<string, number>(4);
    cache.set("a", 1);
    cache.set("b", 2);
    cache.set("c", 3);
    cache.get("a");
    const keys = [...cache.keys()];
    expect(keys).toEqual(["b", "c", "a"]);
  });

  it("forEach iterates all entries", () => {
    const cache = new LruCache<string, number>(4);
    cache.set("a", 1);
    cache.set("b", 2);
    const seen: Array<[string, number]> = [];
    cache.forEach((value, key) => {
      seen.push([key, value]);
    });
    expect(seen).toEqual([
      ["a", 1],
      ["b", 2],
    ]);
  });

  it("throws on non-positive maxSize", () => {
    expect(() => new LruCache<string, number>(0)).toThrow();
    expect(() => new LruCache<string, number>(-1)).toThrow();
    expect(() => new LruCache<string, number>(1.5)).toThrow();
  });

  it("supports maxSize of 1 (evicts on every new key)", () => {
    const cache = new LruCache<string, number>(1);
    cache.set("a", 1);
    expect(cache.get("a")).toBe(1);
    cache.set("b", 2);
    expect(cache.has("a")).toBe(false);
    expect(cache.get("b")).toBe(2);
    expect(cache.size()).toBe(1);
  });

  it("preserves insertion order when no gets happen", () => {
    const cache = new LruCache<string, number>(3);
    cache.set("a", 1);
    cache.set("b", 2);
    cache.set("c", 3);
    cache.set("d", 4);
    const entries = [...cache.entries()];
    expect(entries).toEqual([
      ["b", 2],
      ["c", 3],
      ["d", 4],
    ]);
  });

  it("exposes maxSize as a readonly property", () => {
    const cache = new LruCache<string, number>(8);
    expect(cache.maxSize).toBe(8);
  });
});
