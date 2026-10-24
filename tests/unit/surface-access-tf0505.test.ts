// @vitest-environment node
import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  isDeveloperSurfacePath,
  isDevOrTestSurfacePath,
  resolveSurfaceAccess,
} from "../../src/lib/surface-access";

const root = process.cwd();
const read = (rel: string) => fs.readFileSync(path.join(root, rel), "utf8");

describe("TF-0505 user-facing surface access policy", () => {
  it("keeps retired pages closed and gates dev/test pages for ordinary users", () => {
    expect(resolveSurfaceAccess({ pathname: "/dreams", devModeUnlocked: false, devRuntime: false })).toEqual({
      allowed: false,
      reason: "retired",
    });
    for (const pathname of ["/ui-v2-showcase"]) {
      expect(resolveSurfaceAccess({ pathname, devModeUnlocked: false, devRuntime: false })).toEqual({
        allowed: false,
        reason: "developer-only",
      });
    }
  });

  it("allows the showcase only in dev mode or dev/test runtime", () => {
    expect(resolveSurfaceAccess({
      pathname: "/ui-v2-showcase",
      devModeUnlocked: false,
      devRuntime: true,
    })).toEqual({ allowed: true, reason: "dev-runtime" });
    expect(resolveSurfaceAccess({
      pathname: "/settings/developer",
      devModeUnlocked: true,
      devRuntime: false,
    })).toEqual({ allowed: true, reason: "dev-mode" });
  });

  it("keeps retired Dreams out of the production route even when developer mode is on", () => {
    expect(isDevOrTestSurfacePath("/dreams")).toBe(false);
    expect(resolveSurfaceAccess({
      pathname: "/dreams",
      devModeUnlocked: true,
      devRuntime: true,
    })).toEqual({ allowed: false, reason: "retired" });
  });

  it("recognizes only developer-owned settings routes", () => {
    expect(isDeveloperSurfacePath("/settings/developer")).toBe(true);
    expect(isDeveloperSurfacePath("/settings/developer/")).toBe(true);
    expect(isDeveloperSurfacePath("/settings/general")).toBe(false);
  });

  it("keeps raw DCS flags and the retired VToken bridge out of ordinary Settings", () => {
    const settings = read("src/pages/Settings/index.tsx");
    expect(settings).not.toContain("VtokenBridgePanel");
    expect(settings).toContain("{currentSection === 'developer' && (");
    expect(settings).toContain("{devModeUnlocked && (");
    expect(settings).toContain("DcsProdFlagsPanelLazy");
  });

  it("redirects the retired Dreams route and gates the showcase by the shared policy", () => {
    const app = read("src/App.tsx");
    const sidebar = read("src/components/layout/Sidebar.tsx");
    for (const lang of ["en", "zh", "ja", "ru"]) {
      const common = JSON.parse(read(`shared/i18n/locales/${lang}/common.json`));
      expect(common.sidebar.openClawDreams).toBeUndefined();
      expect(common.sidebar.imageGeneration).toBeUndefined();
    }
    expect(app).toContain('path="/dreams"');
    expect(app).toContain('<Route path="/dreams" element={<Navigate to="/" replace />} />');
    expect(app).not.toContain('pages/Dreams');
    expect(app).toContain('path="/ui-v2-showcase"');
    expect(app).toContain('devRuntime: isDevRuntime()');
    expect(sidebar).not.toContain("sidebar-more-dreams");
    expect(sidebar).not.toContain("sidebar-more-image-generation");
  });
});