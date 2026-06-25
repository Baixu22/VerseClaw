// Narrow entry point for setSlackRuntime â€?avoids pulling in the full
// runtime-api barrel (284KB, 29 chunks) during plugin register().
export { setSlackRuntime } from "./src/runtime.js";
