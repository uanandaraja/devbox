import { Template, defaultBuildLogger } from "e2b";
import { template } from "./template";

const alias = Bun.argv[2] ?? process.env.E2B_TEMPLATE_ALIAS ?? "devbox-dev";

await Template.build(template, alias, {
  cpuCount: Number(process.env.E2B_TEMPLATE_CPU_COUNT ?? 4),
  memoryMB: Number(process.env.E2B_TEMPLATE_MEMORY_MB ?? 8192),
  onBuildLogs: defaultBuildLogger(),
});
