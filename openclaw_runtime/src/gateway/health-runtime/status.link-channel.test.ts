import { describe, expect, it, vi } from "vitest";
import * as statusLinkChannelModule from "./status.link-channel.js";

const channelRegistry = vi.hoisted((): { plugins: object[] } => ({
  plugins: [],
}));
const accountInspection = vi.hoisted(() => ({
  resolve: vi.fn(),
}));

vi.mock("../../channels/plugins/read-only.js", () => ({
  listReadOnlyChannelPluginsForConfig: () => channelRegistry.plugins,
}));

vi.mock("../../channels/account-inspection.js", () => ({
  resolveInspectedChannelAccount: accountInspection.resolve,
}));

function readResolver(): unknown {
  const descriptor = Object.getOwnPropertyDescriptor(
    statusLinkChannelModule,
    "resolveLinkChannelContext",
  );
  return descriptor?.get
    ? Reflect.apply(descriptor.get, statusLinkChannelModule, [])
    : descriptor?.value;
}

async function invokeResolver(config: object): Promise<unknown> {
  const resolver = readResolver();
  expect(typeof resolver).toBe("function");
  if (typeof resolver !== "function") {
    return null;
  }
  return await Reflect.apply(resolver, undefined, [config]);
}

describe("resolveLinkChannelContext", () => {
  it("returns explicit linked state from the first reporting channel", async () => {
    const account = { enabled: true, configured: true };
    channelRegistry.plugins = [
      {
        id: "whatsapp",
        meta: {
          id: "whatsapp",
          label: "WhatsApp",
          selectionLabel: "WhatsApp",
          docsPath: "/channels/whatsapp",
          blurb: "WhatsApp channel",
        },
        capabilities: { chatTypes: ["direct"] },
        config: {
          listAccountIds: () => ["default"],
          defaultAccountId: () => "default",
          resolveAccount: () => account,
          describeAccount: () => ({
            accountId: "default",
            enabled: true,
            configured: true,
          }),
        },
        status: {
          buildChannelSummary: () => ({ linked: true, authAgeMs: 1234 }),
        },
      },
    ];
    accountInspection.resolve.mockResolvedValue({
      account,
      enabled: true,
      configured: true,
    });

    await expect(invokeResolver({})).resolves.toMatchObject({
      linked: true,
      authAgeMs: 1234,
      account,
      accountId: "default",
    });
  });

  it("degrades to no link context when read-only account inspection fails", async () => {
    channelRegistry.plugins = [
      {
        id: "whatsapp",
        meta: {
          id: "whatsapp",
          label: "WhatsApp",
          selectionLabel: "WhatsApp",
          docsPath: "/channels/whatsapp",
          blurb: "WhatsApp channel",
        },
        capabilities: { chatTypes: ["direct"] },
        config: {
          listAccountIds: () => ["default"],
          resolveAccount: () => {
            throw new Error("missing secret");
          },
        },
      },
    ];
    accountInspection.resolve.mockRejectedValue(new Error("missing secret"));

    await expect(invokeResolver({})).resolves.toBeNull();
  });
});
