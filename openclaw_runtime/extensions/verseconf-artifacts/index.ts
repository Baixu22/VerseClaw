import { definePluginEntry } from "./api.js";
import { VerseConfArtifactStore } from "./src/store.js";
import { VerseConfComputeEngine } from "./src/engine.js";
import { createVerseConfTools } from "./src/tools.js";
import { registerVerseConfGatewayMethods } from "./src/gateway.js";

export default definePluginEntry({
  id: "verseconf-artifacts",
  name: "VerseConf Structured Artifacts",
  description: "Bounded research-table and slide-outline artifacts with runtime-owned commits and history.",
  register(api) {
    const store = new VerseConfArtifactStore();
    const engine = new VerseConfComputeEngine();
    store.reconcilePreparedOperations();
    registerVerseConfGatewayMethods({ api, store });
    api.registerService({
      id: "verseconf-artifacts",
      start: () => {},
      stop: async () => {
        await engine.dispose();
        store.close();
      },
    });
    api.registerTool((context) => createVerseConfTools({ api, context, store, engine }), {
      names: [
        "structured_artifact_create",
        "structured_artifact_inspect",
        "structured_artifact_revise",
        "structured_artifact_record_ops",
        "structured_artifact_restore",
        "structured_artifact_history",
        "structured_artifact_export",
        "structured_artifact_disable",
      ],
      optional: true,
    });
  },
});
