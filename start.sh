#!/usr/bin/env bash
set -euo pipefail

mkdir -p /data/tailscale /data/repos /data/state /data/logs /workspace
mkdir -p /data/state/gh

export GH_CONFIG_DIR=/data/state/gh

link_persistent_dir() {
  local target="$1"
  local link="$2"

  mkdir -p "$target"

  if [ -L "$link" ]; then
    rm -f "$link"
  elif [ -e "$link" ]; then
    rm -rf "$link"
  fi

  ln -s "$target" "$link"
}

link_persistent_file() {
  local target="$1"
  local link="$2"

  mkdir -p "$(dirname "$target")"
  touch "$target"

  if [ -L "$link" ]; then
    rm -f "$link"
  elif [ -e "$link" ]; then
    rm -rf "$link"
  fi

  ln -s "$target" "$link"
}

mkdir -p /data/state/home
link_persistent_dir /data/state/home/.agents /root/.agents
link_persistent_dir /data/state/home/.config /root/.config
link_persistent_dir /data/state/home/.codex /root/.codex
link_persistent_dir /data/state/home/.pi /root/.pi
link_persistent_file /data/state/home/.tmux.conf /root/.tmux.conf

mkdir -p \
  /root/.agents/skills \
  /root/.codex/skills \
  /root/.pi/agent \
  /root/.config/nvim \
  /root/.config/fish/completions \
  /root/.config/fish/functions

if [ ! -f /root/.config/fish/config.fish ]; then
  cp /usr/local/share/devbox-defaults/fish/config.fish /root/.config/fish/config.fish
fi

if [ ! -f /root/.config/fish/functions/reload.fish ]; then
  cp /usr/local/share/devbox-defaults/fish/functions/reload.fish /root/.config/fish/functions/reload.fish
fi

if [ ! -f /root/.config/fish/completions/bun.fish ]; then
  cp /usr/local/share/devbox-defaults/fish/completions/bun.fish /root/.config/fish/completions/bun.fish
fi

if [ ! -s /root/.tmux.conf ]; then
  cp /usr/local/share/devbox-defaults/tmux.conf /root/.tmux.conf
fi

SOCK="/tmp/tailscaled.sock"
STATE_FILE="/data/tailscale/tailscaled.state"

tailscaled \
  --tun=userspace-networking \
  --state="${STATE_FILE}" \
  --socket="${SOCK}" \
  > /data/logs/tailscaled.log 2>&1 &

for _ in $(seq 1 30); do
  if [ -S "${SOCK}" ]; then
    break
  fi
  sleep 1
done

if [ ! -S "${SOCK}" ]; then
  echo "tailscaled socket did not appear at ${SOCK}" >&2
  exit 1
fi

if [ -n "${TAILSCALE_AUTHKEY:-}" ]; then
  tailscale_up_args=(
    --auth-key="${TAILSCALE_AUTHKEY}"
    --hostname="${TAILSCALE_HOSTNAME:-railway-devbox}"
    --reset
  )

  if [ "${TAILSCALE_ACCEPT_ROUTES:-false}" = "true" ]; then
    tailscale_up_args+=(--accept-routes)
  fi

  if [ -n "${TAILSCALE_ADVERTISE_TAGS:-}" ]; then
    tailscale_up_args+=(--advertise-tags="${TAILSCALE_ADVERTISE_TAGS}")
  fi

  if [ "${TAILSCALE_ENABLE_SSH:-false}" = "true" ]; then
    tailscale_up_args+=(--ssh)
  fi

  tailscale --socket="${SOCK}" up "${tailscale_up_args[@]}" || true
fi

if command -v gh >/dev/null 2>&1; then
  gh config set git_protocol ssh >/dev/null 2>&1 || true
fi

echo "dev box ready"
echo "workspace: /workspace"
echo "persistent data: /data"

exec sleep infinity
