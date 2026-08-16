void (async () => {
  const tc = await import("../openclaw_runtime/src/agents/tool-catalog.ts");
  const pf = await import("../shared/dcs/prod-flags-catalog.ts");
  console.log("tool-catalog exports:", Object.keys(tc).filter((k) => /section|profile|group|tool/i.test(k)).join(","));
  const sections = tc.listCoreToolSections();
  console.log("sections:", sections.length, "| first:", JSON.stringify(sections[0]));
  console.log("profiles of first tool:", JSON.stringify(tc.resolveCoreToolProfiles(sections[0].tools[0].id)));
  console.log("flags:", pf.DCS_PROD_FLAGS.length, "| first:", JSON.stringify(pf.DCS_PROD_FLAGS[0]));
})();
