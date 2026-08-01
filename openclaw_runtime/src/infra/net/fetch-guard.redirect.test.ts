/**
 * fetch-guard 重定向语义测试(能力 6 SSRF 测试缺口补齐):
 * 每跳重评估 / 重定向上限 / 环检测 / 跨源敏感头剥离。
 * 通过注入 vitest mock fetch(fetchImpl)走 hermetic mocked 路径——
 * mocked 路径仍执行每跳 hostname/IP 策略检查(fetch-guard.ts L546-548),
 * 只是跳过 DNS pinning,适合重定向控制流测试。
 */
import { describe, expect, it, vi } from "vitest";
import { fetchWithSsrFGuard } from "./fetch-guard.js";
import { SsrFBlockedError } from "./ssrf.js";

type FetchCall = { url: string; init: RequestInit };

function redirectResponse(location: string, status = 302): Response {
  return new Response("redirecting", {
    status,
    headers: { location },
  });
}

async function runFetch(
  url: string,
  fetchImpl: typeof fetch,
  init?: RequestInit,
) {
  const result = await fetchWithSsrFGuard({
    url,
    fetchImpl,
    capture: false,
    init,
    // Strict mode default; allowlist/private-network policy untouched.
  });
  try {
    return { response: result.response, finalUrl: result.finalUrl };
  } finally {
    await result.release();
  }
}

describe("fetch-guard redirect re-evaluation (SSRF parity)", () => {
  it("R1 follows one 301 hop and re-evaluates the destination", async () => {
    const calls: FetchCall[] = [];
    const fetchImpl = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      calls.push({ url, init: init ?? {} });
      if (url === "https://a.example/start") {
        return redirectResponse("https://b.example/final", 301);
      }
      return new Response("final-body", { status: 200 });
    }) as unknown as typeof fetch;

    const { response, finalUrl } = await runFetch("https://a.example/start", fetchImpl);
    expect(calls.map((c) => c.url)).toEqual([
      "https://a.example/start",
      "https://b.example/final",
    ]);
    expect(finalUrl).toBe("https://b.example/final");
    expect(await response.text()).toBe("final-body");
  });

  it("R2 redirect to a private-IP literal is blocked per hop (re-evaluation)", async () => {
    const fetchImpl = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url === "https://public.example/start") {
        return redirectResponse("http://127.0.0.1/evil");
      }
      return new Response("should-never-arrive", { status: 200 });
    }) as unknown as typeof fetch;

    await expect(runFetch("https://public.example/start", fetchImpl)).rejects.toThrow(
      SsrFBlockedError,
    );
  });

  it("R3 exceeds the default redirect limit (3) with 'Too many redirects'", async () => {
    const fetchImpl = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      const n = Number(new URL(url).searchParams.get("n") ?? "0");
      return redirectResponse(`https://a.example/next?n=${n + 1}`);
    }) as unknown as typeof fetch;

    await expect(runFetch("https://a.example/start?n=0", fetchImpl)).rejects.toThrow(
      /Too many redirects/,
    );
    // 初始 1 次 + 3 次允许的重定向尝试;第 4 个重定向响应解析后立即抛错(不再发起请求)
    expect(fetchImpl).toHaveBeenCalledTimes(4);
  });

  it("R4 detects a redirect loop (A -> B -> A)", async () => {
    const fetchImpl = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url === "https://a.example/x") {
        return redirectResponse("https://b.example/y");
      }
      return redirectResponse("https://a.example/x");
    }) as unknown as typeof fetch;

    await expect(runFetch("https://a.example/x", fetchImpl)).rejects.toThrow(
      /Redirect loop detected/,
    );
  });

  it("R5 strips Authorization on cross-origin redirect hops", async () => {
    const calls: FetchCall[] = [];
    const fetchImpl = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      calls.push({ url, init: init ?? {} });
      if (url === "https://a.example/start") {
        return redirectResponse("https://b.example/final");
      }
      return new Response("ok", { status: 200 });
    }) as unknown as typeof fetch;

    await runFetch("https://a.example/start", fetchImpl, {
      headers: { authorization: "Bearer secret", "user-agent": "parity/1" },
    });

    expect(calls).toHaveLength(2);
    const secondHeaders = new Headers(calls[1]!.init.headers);
    expect(secondHeaders.get("authorization")).toBeNull();
    expect(secondHeaders.get("cookie")).toBeNull();
    // Safe headers survive (redirect-headers.ts allowlist).
    expect(secondHeaders.get("user-agent")).toBe("parity/1");
  });
});
