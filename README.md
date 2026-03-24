# werkbench

copy env:

```bash
cp .env.example .env
```

required:

```bash
E2B_API_KEY=
GITHUB_TOKEN=
```

browser defaults:

```bash
E2B_BROWSER_DEBUG_PORT=9222
E2B_PREVIEW_PORTS=3000,3001,4173,5173,8000,8080,8787,4321
E2B_TEMPLATE_CPU_COUNT=4
E2B_TEMPLATE_MEMORY_MB=8192
```

install:

```bash
bun install
bun run gen
bun run db:migrate:local
```

web app:

```bash
bun run dev
bun run dev:cf
bun run build
bun run preview
```

deploy:

```bash
wrangler deploy
```

db:

```bash
bun run db:generate
bun run db:migrate:local
bun run db:migrate:remote
```

template admin:

```bash
bun run build:template:dev
bun run sandbox:create
bun run sandbox:list
bun run sandbox:ssh <sandbox-id>
```

browser tab:

```bash
browser opens the sandbox app directly in-app
chrome runs headless inside the sandbox for devtools
devtools are docked below the preview
```
