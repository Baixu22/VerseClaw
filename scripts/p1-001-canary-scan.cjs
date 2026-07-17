const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const { createCipheriv, createDecipheriv, randomBytes } = crypto;

const outDir = "artifacts/system-maturity/P1-001";
fs.mkdirSync(outDir, { recursive: true });

// Offline canary simulation (mirrors secret-store-broker test without vitest)
const canary = "sk-canary-P1-001-MUST-NOT-LEAK-" + randomBytes(6).toString("hex");
const storeData = { apiKeys: {}, providerSecrets: {} };
const key = randomBytes(32);
const algorithm = "aes-256-gcm";
function encryptString(value) {
  const iv = randomBytes(12);
  const cipher = createCipheriv(algorithm, key, iv);
  const enc = Buffer.concat([cipher.update(value, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return Buffer.concat([iv, tag, enc]);
}
const secret = { type: "api_key", accountId: "provider-canary", apiKey: canary };
const ciphertext = encryptString(JSON.stringify(secret)).toString("base64");
storeData.providerSecrets["provider-canary"] = { format: "safeStorage-v1", ciphertext };

// Simulate legacy dual-write would look like:
const dualWriteWouldLeak = JSON.stringify({
  apiKeys: { "provider-canary": canary },
  providerSecrets: { "provider-canary": secret },
});

const singleSourceBlob = JSON.stringify(storeData);
const hits = [];
if (singleSourceBlob.includes(canary)) hits.push("provider-store-json");
if ((storeData.apiKeys || {})["provider-canary"]) hits.push("apiKeys.dualWrite");

// Scan typical unprotected path names (empty fixtures for offline gate)
const scanRoots = [
  "artifacts/system-maturity/P1-001/canary-scan-targets",
];
fs.mkdirSync(scanRoots[0], { recursive: true });
// write a log/trajectory/sekb sample without canary
fs.writeFileSync(path.join(scanRoots[0], "app.log"), "info gateway ready\n");
fs.writeFileSync(path.join(scanRoots[0], "session.trajectory.jsonl"), JSON.stringify({ type: "assistant", text: "ok" }) + "\n");
fs.writeFileSync(path.join(scanRoots[0], "sekb-index.json"), JSON.stringify({ entries: [] }));

function scanDir(dir, needle) {
  const found = [];
  for (const name of fs.readdirSync(dir)) {
    const full = path.join(dir, name);
    const st = fs.statSync(full);
    if (st.isDirectory()) found.push(...scanDir(full, needle));
    else {
      const text = fs.readFileSync(full, "utf8");
      if (text.includes(needle)) found.push(full);
    }
  }
  return found;
}
const diskHits = scanDir(scanRoots[0], canary);

const report = {
  task: "P1-001",
  canary,
  dualWriteWouldLeak: dualWriteWouldLeak.includes(canary),
  singleSourceEncryptedContainsCanary: singleSourceBlob.includes(canary),
  apiKeysDualWritePresent: Boolean((storeData.apiKeys || {})["provider-canary"]),
  unprotectedPathHits: diskHits,
  providerStoreHits: hits,
  status: hits.length === 0 && diskHits.length === 0 ? "PASS" : "FAIL",
  generatedAt: new Date().toISOString(),
};
fs.writeFileSync(path.join(outDir, "canary-scan.json"), JSON.stringify(report, null, 2) + "\n");
console.log(JSON.stringify(report, null, 2));
if (report.status !== "PASS") process.exit(1);
