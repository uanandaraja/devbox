import { getPrivateKeyPath, sshUser } from "./ssh-settings";

const sandboxId = Bun.argv[2];
const extraArgs = Bun.argv.slice(3).filter((arg) => arg !== "--");

if (!sandboxId) {
  console.error("usage: bun run sandbox:ssh <sandbox-id> [ssh-args...]");
  process.exit(1);
}

if (!process.env.E2B_API_KEY) {
  console.error("E2B_API_KEY is required");
  process.exit(1);
}

function shellEscape(value: string) {
  return `'${value.replaceAll("'", `'\\''`)}'`;
}

const proxyScript = new URL("./ssh-proxy.ts", import.meta.url).pathname;
const proxyArgs = [
  "env",
  `E2B_API_KEY=${process.env.E2B_API_KEY}`,
  `E2B_SANDBOX_TIMEOUT_MS=${process.env.E2B_SANDBOX_TIMEOUT_MS ?? "3600000"}`,
  `E2B_SSH_PROXY_PORT=${process.env.E2B_SSH_PROXY_PORT ?? "2222"}`,
];

if (process.env.E2B_DOMAIN) {
  proxyArgs.push(`E2B_DOMAIN=${process.env.E2B_DOMAIN}`);
}

proxyArgs.push("bun", "run", proxyScript, sandboxId);

const proxyCommand = `/bin/sh -lc ${shellEscape(
  proxyArgs.map(shellEscape).join(" "),
)}`;

const args = [
  "ssh",
  "-o",
  `ProxyCommand=${proxyCommand}`,
  "-o",
  `HostKeyAlias=e2b-${sandboxId}`,
  "-o",
  "StrictHostKeyChecking=accept-new",
  "-o",
  "ServerAliveInterval=30",
];

const privateKeyPath = getPrivateKeyPath();

if (privateKeyPath) {
  args.push("-i", privateKeyPath, "-o", "IdentitiesOnly=yes");
}

args.push(`${sshUser}@e2b`, ...extraArgs);

const proc = Bun.spawn({
  cmd: args,
  stdin: "inherit",
  stdout: "inherit",
  stderr: "inherit",
});

process.exit(await proc.exited);
