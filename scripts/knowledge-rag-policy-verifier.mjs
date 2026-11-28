import { verifyOfflineRagPolicyPackage } from './lib/project-rag-promotion.mjs';

try {
  const [directory, digest, name] = process.argv.slice(2);
  if (!directory || !digest) throw new Error('Usage: project-rag-policy-verifier <evidence-directory> <manifest-digest>');
  console.log(JSON.stringify(verifyOfflineRagPolicyPackage(directory, digest, name)));
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
}
