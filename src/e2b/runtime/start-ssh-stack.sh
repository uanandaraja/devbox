#!/usr/bin/env bash
set -euo pipefail

mkdir -p /run/sshd /var/log/e2b /home/user/.ssh /home/user/.cache/devbox
rm -f /tmp/e2b-ssh-ready /tmp/e2b-terminal-ready /tmp/e2b-ready
chmod 700 /home/user/.ssh
chown -R user:user /home/user/.ssh /home/user/.cache/devbox

if [ -n "${E2B_SSH_AUTHORIZED_KEY:-}" ]; then
  printf '%s\n' "${E2B_SSH_AUTHORIZED_KEY}" > /home/user/.ssh/authorized_keys
  chmod 600 /home/user/.ssh/authorized_keys
  chown user:user /home/user/.ssh/authorized_keys
fi

BOOTSTRAP_MARKER="/home/user/.cache/devbox/bootstrap.done"
BOOTSTRAP_CWD="${DEVBOX_CWD:-/home/user/workspace}"
USER_HOME="/home/user"
USER_NAME="user"
REPO_OWNER="${DEVBOX_REPO_OWNER:-}"
REPO_NAME="${DEVBOX_REPO_NAME:-}"
REPO_DEFAULT_BRANCH="${DEVBOX_REPO_DEFAULT_BRANCH:-}"
REPO_URL=""
REPO_DIR="${BOOTSTRAP_CWD}"

if [ -n "${REPO_OWNER}" ] && [ -n "${REPO_NAME}" ]; then
  REPO_URL="https://github.com/${REPO_OWNER}/${REPO_NAME}.git"
fi

sudo -u "${USER_NAME}" env \
  HOME="${USER_HOME}" \
  USER="${USER_NAME}" \
  LOGNAME="${USER_NAME}" \
  GH_TOKEN="${GH_TOKEN:-}" \
  GITHUB_TOKEN="${GITHUB_TOKEN:-}" \
  bash -lc \
  "mkdir -p \"${REPO_DIR}\" \
    && git config --global credential.helper '!gh auth git-credential' \
    && git config --global credential.https://github.com.helper '' \
    && if [ -n \"${GH_TOKEN:-}\" ]; then gh auth setup-git >/dev/null 2>&1 || true; fi" \
  >/var/log/e2b/github-auth.log 2>&1

if [ -n "${DEVBOX_BOOTSTRAP_COMMAND:-}" ] && [ ! -f "${BOOTSTRAP_MARKER}" ]; then
  sudo -u "${USER_NAME}" env \
    HOME="${USER_HOME}" \
    USER="${USER_NAME}" \
    LOGNAME="${USER_NAME}" \
    DEVBOX_CWD="${BOOTSTRAP_CWD}" \
    bash -lc \
    "cd \"${BOOTSTRAP_CWD}\" && ${DEVBOX_BOOTSTRAP_COMMAND}" \
    >/var/log/e2b/bootstrap.log 2>&1
  touch "${BOOTSTRAP_MARKER}"
  chown "${USER_NAME}:${USER_NAME}" "${BOOTSTRAP_MARKER}"
fi

if [ -n "${REPO_URL}" ] && [ ! -d "${REPO_DIR}/.git" ]; then
  sudo -u "${USER_NAME}" env \
    HOME="${USER_HOME}" \
    USER="${USER_NAME}" \
    LOGNAME="${USER_NAME}" \
    GH_TOKEN="${GH_TOKEN:-}" \
    GITHUB_TOKEN="${GITHUB_TOKEN:-}" \
    bash -lc \
    "mkdir -p \"$(dirname "${REPO_DIR}")\" \
      && git clone \"${REPO_URL}\" \"${REPO_DIR}\" \
      && if [ -n \"${REPO_DEFAULT_BRANCH}\" ]; then git -C \"${REPO_DIR}\" checkout \"${REPO_DEFAULT_BRANCH}\" || true; fi" \
    >/var/log/e2b/repo-bootstrap.log 2>&1
fi

ssh-keygen -A >/dev/null 2>&1 || true

if ! ss -tuln | grep -q ":22\\b" && ! pgrep -f "sshd -D -e -f /etc/ssh/sshd_config_e2b" >/dev/null 2>&1; then
  nohup /usr/sbin/sshd -D -e -f /etc/ssh/sshd_config_e2b \
    >/var/log/e2b/sshd.log 2>&1 &
fi

if ! pgrep -f "ws-l:0.0.0.0:${E2B_SSH_PROXY_PORT:-2222}" >/dev/null 2>&1; then
  nohup /usr/local/bin/websocat --binary "ws-l:0.0.0.0:${E2B_SSH_PROXY_PORT:-2222}" tcp:127.0.0.1:22 \
    >/var/log/e2b/websocat.log 2>&1 &
fi

if ! pgrep -f "terminal_proxy.py" >/dev/null 2>&1; then
  nohup sudo -u "${USER_NAME}" env \
    HOME="${USER_HOME}" \
    USER="${USER_NAME}" \
    LOGNAME="${USER_NAME}" \
    python3 /usr/local/bin/terminal_proxy.py \
    >/var/log/e2b/terminal.log 2>&1 &
fi

for _ in $(seq 1 20); do
  if ss -tuln | grep -q ":22\\b" \
    && ss -tuln | grep -q ":${E2B_SSH_PROXY_PORT:-2222}\\b" \
    && ss -tuln | grep -q ":${E2B_TERMINAL_PORT:-7681}\\b"; then
    touch /tmp/e2b-ssh-ready
    touch /tmp/e2b-ready
    exit 0
  fi

  sleep 1
done

tail -n 50 /var/log/e2b/sshd.log >&2 || true
tail -n 50 /var/log/e2b/websocat.log >&2 || true
tail -n 50 /var/log/e2b/terminal.log >&2 || true
exit 1
