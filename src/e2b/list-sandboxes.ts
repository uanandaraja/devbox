import { Sandbox } from "e2b";

const paginator = Sandbox.list({
  query: {
    state: ["running", "paused"],
  },
  limit: 100,
});

const sandboxes = [];

while (paginator.hasNext) {
  sandboxes.push(...(await paginator.nextItems()));
}

if (sandboxes.length === 0) {
  console.log("no sandboxes");
  process.exit(0);
}

for (const sandbox of sandboxes) {
  console.log(
    [
      sandbox.sandboxId,
      sandbox.state,
      sandbox.startedAt.toISOString(),
      sandbox.endAt.toISOString(),
      sandbox.name ?? sandbox.templateId,
    ].join("\t"),
  );
}
