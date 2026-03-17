export {};

const sandboxId = Bun.argv[2];

if (!sandboxId) {
  console.error("usage: bun run sandbox:connect <sandbox-id>");
  process.exit(1);
}

const proc = Bun.spawn({
  cmd: ["e2b", "sandbox", "connect", sandboxId],
  stdin: "inherit",
  stdout: "inherit",
  stderr: "inherit",
});

const exitCode = await proc.exited;

process.exit(exitCode);
