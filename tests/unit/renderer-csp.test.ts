import fs from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

import { RENDERER_CSP, RENDERER_DEV_CSP } from "../../shared/security/url-policy";

function extractCsp(html: string): string {
  const match = /<meta http-equiv="Content-Security-Policy" content="([^"]+)"/u.exec(html);
  if (!match) throw new Error("renderer CSP meta tag is missing");
  return match[1]!;
}

describe("renderer CSP", () => {
  const root = path.resolve(__dirname, "../..");
  const indexHtml = fs.readFileSync(path.join(root, "index.html"), "utf8");

  it("keeps the static shell on the production policy and externalizes boot script", () => {
    expect(extractCsp(indexHtml)).toBe(RENDERER_CSP);
    expect(indexHtml).toContain('src="./boot-theme.js"');
    expect(indexHtml).not.toMatch(/<script>\s*\(\(\)\s*=>/u);
    expect(fs.readFileSync(path.join(root, "public/boot-theme.js"), "utf8")).toContain(
      "dataset.bootTheme",
    );
  });

  it("blocks arbitrary renderer HTTP(S) connections and inline production scripts", () => {
    const connectDirective = /(?:^|;\s*)connect-src\s+([^;]+)/u.exec(RENDERER_CSP)?.[1] ?? "";
    const scriptDirective = /(?:^|;\s*)script-src\s+([^;]+)/u.exec(RENDERER_CSP)?.[1] ?? "";
    expect(connectDirective).toContain("http://127.0.0.1:*");
    expect(connectDirective).toContain("data:");
    expect(connectDirective).not.toMatch(/(?:^|\s)https:(?:\s|$)/u);
    expect(connectDirective).not.toMatch(/(?:^|\s)http:(?:\s|$)/u);
    expect(scriptDirective).toBe("'self'");
    expect(RENDERER_DEV_CSP).toMatch(/script-src[^;]*'unsafe-inline'/u);
  });
});