import { describe, expect, it } from "vitest";
import { createSetupTranslator as createSetupTranslatorFromSetupRuntime } from "./setup-runtime.js";
import { createSetupTranslator as createSetupTranslatorFromSetup } from "./setup.js";

describe("retained setup translator contract", () => {
  it.each([
    ["setup", createSetupTranslatorFromSetup],
    ["setup-runtime", createSetupTranslatorFromSetupRuntime],
  ])("keeps %s setup wizards independent from the removed CLI prompt framework", (_name, create) => {
    const translate = create();

    expect(translate("wizard.channels.statusConnectedAs", { name: "Feishu" })).toBe(
      "wizard.channels.statusConnectedAs",
    );
    expect(translate("Hello {name}", { name: "Feishu" })).toBe("Hello Feishu");
  });
});
