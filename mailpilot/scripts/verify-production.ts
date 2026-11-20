import { productionLaunchReady } from "../src/lib/security/runtime-config";

const result = productionLaunchReady();
if (!result.ready) {
  console.error("Production launch validation failed:");
  for (const key of result.missing) console.error(`- ${key}`);
  process.exit(1);
}
console.log("Production launch configuration looks complete.");
