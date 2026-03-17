import { Sandbox } from "e2b";
import { sshUser } from "./ssh-settings";

const sandboxId = Bun.argv[2];
const timeoutMs = Number(process.env.E2B_SANDBOX_TIMEOUT_MS ?? 3600000);

if (!sandboxId) {
  console.error("usage: bun run sandbox:resume <sandbox-id>");
  process.exit(1);
}

const sandbox = await Sandbox.connect(sandboxId);
await sandbox.setTimeout(timeoutMs);
const info = await sandbox.getInfo();

console.log(`sandbox_id=${sandboxId}`);
console.log(`state=${info.state}`);
console.log(`end_at=${info.endAt.toISOString()}`);
console.log(`timeout_ms=${timeoutMs}`);
console.log(`connect_cmd=e2b sandbox connect ${sandboxId}`);
console.log(`ssh_user=${sshUser}`);
console.log(`ssh_cmd=bun run sandbox:ssh ${sandboxId}`);
