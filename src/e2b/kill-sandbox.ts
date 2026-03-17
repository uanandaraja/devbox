import { Sandbox } from "e2b";

const sandboxId = Bun.argv[2];

if (!sandboxId) {
  console.error("usage: bun run sandbox:kill <sandbox-id>");
  process.exit(1);
}

const sandbox = await Sandbox.connect(sandboxId);
await sandbox.kill();

console.log(`killed=${sandboxId}`);
