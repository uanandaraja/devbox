# devbox web

copy env:

```bash
cp .env.example .env
```

required:

```bash
E2B_API_KEY=
GITHUB_TOKEN=
```

desktop defaults:

```bash
E2B_DESKTOP_PORT=6901
E2B_DESKTOP_WEB_PORT=6902
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
browser opens a full remote desktop session
chrome starts inside that desktop
native chrome devtools run there
```
