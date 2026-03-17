#!/usr/bin/env bash
set -euo pipefail

mkdir -p /run/sshd /var/log/e2b /home/user/.ssh
rm -f /tmp/e2b-ssh-ready
chmod 700 /home/user/.ssh
chown user:user /home/user/.ssh

if [ -n "${E2B_SSH_AUTHORIZED_KEY:-}" ]; then
  printf '%s\n' "${E2B_SSH_AUTHORIZED_KEY}" > /home/user/.ssh/authorized_keys
  chmod 600 /home/user/.ssh/authorized_keys
  chown user:user /home/user/.ssh/authorized_keys
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

for _ in $(seq 1 10); do
  if ss -tuln | grep -q ":22\\b" \
    && ss -tuln | grep -q ":${E2B_SSH_PROXY_PORT:-2222}\\b"; then
    touch /tmp/e2b-ssh-ready
    exit 0
  fi

  sleep 1
done

tail -n 50 /var/log/e2b/sshd.log >&2 || true
tail -n 50 /var/log/e2b/websocat.log >&2 || true
exit 1
