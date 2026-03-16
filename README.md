# railway devbox

mount volume: `/data`

set vars:

```bash
TAILSCALE_AUTHKEY=tskey-xxxxxxxx
TAILSCALE_HOSTNAME=railway-devbox
TAILSCALE_ACCEPT_ROUTES=false
TAILSCALE_ENABLE_SSH=true
TAILSCALE_ADVERTISE_TAGS=
GH_TOKEN=gho_xxx
```

deploy:

```bash
railway up --service devbox2
```

connect:

```bash
tailscale ssh root@railway-devbox
```

quick check:

```bash
node -v
npm -v
bun -v
gh --version
python3 --version
uv --version
git --version
fish --version
rg --version
tailscale --socket=/tmp/tailscaled.sock status
```
