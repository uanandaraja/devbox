import { Sandbox } from "e2b";
import { readAuthorizedKey, sshProxyPort, sshUser } from "./ssh-settings";

const template = Bun.argv[2] ?? process.env.E2B_TEMPLATE ?? "werkbench-dev";
const timeoutMs = Number(process.env.E2B_SANDBOX_TIMEOUT_MS ?? 3600000);
const authorizedKey = await readAuthorizedKey();

const sandbox = await Sandbox.create(template, {
  timeoutMs,
  envs: {
    E2B_SSH_PROXY_PORT: String(sshProxyPort),
  },
  lifecycle: {
    onTimeout: "pause",
  },
});
await sandbox.commands.run(
  [
    "mkdir -p /home/user/.ssh",
    "chmod 700 /home/user/.ssh",
    "printf '%s\\n' \"$AUTHORIZED_KEY\" > /home/user/.ssh/authorized_keys",
    "chmod 600 /home/user/.ssh/authorized_keys",
    "chown -R user:user /home/user/.ssh",
  ].join(" && "),
  {
    user: "root",
    envs: {
      AUTHORIZED_KEY: authorizedKey,
    },
    timeoutMs: 20000,
  },
);
const info = await sandbox.getInfo();

console.log(`sandbox_id=${sandbox.sandboxId}`);
console.log(`template=${template}`);
console.log(`state=${info.state}`);
console.log(`end_at=${info.endAt.toISOString()}`);
console.log("on_timeout=pause");
console.log(`connect_cmd=e2b sandbox connect ${sandbox.sandboxId}`);
console.log(`ssh_user=${sshUser}`);
console.log(`ssh_cmd=bun run sandbox:ssh ${sandbox.sandboxId}`);
