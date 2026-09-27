import { generateVapidKeys } from "@mmmike/web-push/vapid";
import { spawnSync } from "node:child_process";

const workerUrl =
  process.env.WIKIDEX_PUBLIC_URL ||
  "https://wikidex-cloud-poc.alexismeon1472.workers.dev";

function putSecret(name, value) {
  const command = process.platform === "win32" ? "npx.cmd" : "npx";
  const result = spawnSync(
    command,
    ["wrangler", "secret", "put", name],
    {
      input: String(value) + "\n",
      stdio: ["pipe", "inherit", "inherit"],
      encoding: "utf8"
    }
  );

  if (result.status !== 0) {
    throw new Error("Unable to set Cloudflare secret " + name + ".");
  }
}

const { publicKey, privateKey } = await generateVapidKeys();

console.log("Generating one VAPID key pair for WikiDex Push…");

putSecret("VAPID_PUBLIC_KEY", publicKey);
putSecret("VAPID_PRIVATE_KEY", privateKey);
putSecret("VAPID_SUBJECT", workerUrl);

console.log("");
console.log("WikiDex Push configured.");
console.log("VAPID public key:", publicKey);
console.log("Subject:", workerUrl);
console.log("The private key was sent directly to Cloudflare and was not printed.");
