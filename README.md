# e2b devbox

vars:

```bash
cp .env.example .env
export E2B_API_KEY=...
```

install:

```bash
bun install
```

build template:

```bash
bun run build:template:dev
```

create sandbox:

```bash
bun run sandbox:create
```

list sandboxes:

```bash
bun run sandbox:list
```

connect:

```bash
bun run sandbox:connect <sandbox-id>
```

ssh:

```bash
bun run sandbox:ssh <sandbox-id>
```

pause:

```bash
bun run sandbox:pause <sandbox-id>
```

resume:

```bash
bun run sandbox:resume <sandbox-id>
```

use `sandbox:resume` before `e2b sandbox connect` if the sandbox is paused. that resets timeout back to your configured value.

kill:

```bash
bun run sandbox:kill <sandbox-id>
```

installed in sandbox:

```bash
node
npm
bun
git
gh
python3
uv
nvim
tmux
rg
codex
claude
opencode
pi
```
