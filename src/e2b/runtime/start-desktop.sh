#!/usr/bin/env bash
set -euo pipefail

USER_NAME="user"
USER_HOME="/home/user"
DISPLAY_NUM="${E2B_DESKTOP_DISPLAY:-1}"
DISPLAY=":${DISPLAY_NUM}"
DESKTOP_PORT="${E2B_DESKTOP_PORT:-6901}"
DESKTOP_WEB_PORT="${E2B_DESKTOP_WEB_PORT:-6902}"
DESKTOP_USER="${E2B_DESKTOP_USER:-devbox}"
DESKTOP_PASSWORD="${E2B_DESKTOP_PASSWORD:?E2B_DESKTOP_PASSWORD is required}"
RESOLUTION="${E2B_DESKTOP_RESOLUTION:-1600x900}"
LOG_DIR="/var/log/e2b"
VNC_DIR="${USER_HOME}/.vnc"
AUTOSTART_DIR="${USER_HOME}/.config/autostart"
BIN_DIR="${USER_HOME}/.local/bin"
PASSWORD_FILE="${USER_HOME}/.kasmpasswd"
TLS_CERT="${VNC_DIR}/tls-cert.pem"
TLS_KEY="${VNC_DIR}/tls-key.pem"
DESKTOP_PROXY_LOG="${LOG_DIR}/desktop-proxy.log"

mkdir -p "${LOG_DIR}" "${VNC_DIR}" "${AUTOSTART_DIR}" "${BIN_DIR}"
chown -R "${USER_NAME}:${USER_NAME}" "${VNC_DIR}" "${AUTOSTART_DIR}" "${BIN_DIR}"

if [ ! -s "${TLS_CERT}" ] || [ ! -s "${TLS_KEY}" ]; then
  openssl req -x509 -nodes -newkey rsa:2048 \
    -keyout "${TLS_KEY}" \
    -out "${TLS_CERT}" \
    -days 3650 \
    -subj "/CN=devbox-desktop" \
    >/dev/null 2>&1
fi
chmod 600 "${TLS_KEY}"
chmod 644 "${TLS_CERT}"
chown "${USER_NAME}:${USER_NAME}" "${TLS_KEY}" "${TLS_CERT}"

cat > "${BIN_DIR}/devbox-launch-browser.sh" <<'EOF'
#!/usr/bin/env bash
set -euo pipefail

export HOME="${HOME:-/home/user}"
export USER="${USER:-user}"
export LOGNAME="${LOGNAME:-user}"
export DISPLAY="${DISPLAY:-:1}"
export XDG_RUNTIME_DIR="${XDG_RUNTIME_DIR:-/tmp/runtime-${USER}}"
export CHROME_LOG="${HOME}/.cache/devbox/chrome.log"

mkdir -p "${XDG_RUNTIME_DIR}" "${HOME}/.cache/devbox/chrome-profile"
chmod 700 "${XDG_RUNTIME_DIR}"

if pgrep -u "${USER}" -f "${HOME}/.cache/devbox/chrome-profile" >/dev/null 2>&1; then
  exit 0
fi

nohup google-chrome-stable \
  --no-first-run \
  --no-default-browser-check \
  --disable-dev-shm-usage \
  --disable-gpu \
  --disable-software-rasterizer \
  --disable-features=UseSkiaRenderer,Vulkan \
  --user-data-dir="${HOME}/.cache/devbox/chrome-profile" \
  --window-size=1440,900 \
  --new-window \
  about:blank \
  >"${CHROME_LOG}" 2>&1 &
EOF

cat > "${BIN_DIR}/devbox-focus-browser.sh" <<'EOF'
#!/usr/bin/env bash
set -euo pipefail

export HOME="${HOME:-/home/user}"
export USER="${USER:-user}"
export LOGNAME="${LOGNAME:-user}"
export DISPLAY="${DISPLAY:-:1}"
export XDG_RUNTIME_DIR="${XDG_RUNTIME_DIR:-/tmp/runtime-${USER}}"

mkdir -p "${XDG_RUNTIME_DIR}"
chmod 700 "${XDG_RUNTIME_DIR}"

for _ in $(seq 1 60); do
  if pgrep -x xfwm4 >/dev/null 2>&1; then
    break
  fi
  sleep 1
done

xfconf-query -c xfwm4 -p /general/workspace_count -s 1 >/dev/null 2>&1 || true
xfconf-query -c xfwm4 -p /general/use_compositing -n -t bool -s false >/dev/null 2>&1 || \
  xfconf-query -c xfwm4 -p /general/use_compositing -t bool -s false >/dev/null 2>&1 || true
wmctrl -n 1 >/dev/null 2>&1 || true

if ! pgrep -u "${USER}" -f "${HOME}/.cache/devbox/chrome-profile" >/dev/null 2>&1; then
  nohup "${HOME}/.local/bin/devbox-launch-browser.sh" >/dev/null 2>&1 &
fi

for _ in $(seq 1 60); do
  window_id="$(wmctrl -lx 2>/dev/null | awk '/google-chrome/ { print $1; exit }')"

  if [ -n "${window_id}" ]; then
    wmctrl -i -r "${window_id}" -t 0 >/dev/null 2>&1 || true
    wmctrl -i -R "${window_id}" >/dev/null 2>&1 || true
    wmctrl -i -r "${window_id}" -b add,maximized_vert,maximized_horz >/dev/null 2>&1 || true
    exit 0
  fi

  sleep 1
done

exit 0
EOF

chmod 755 "${BIN_DIR}/devbox-launch-browser.sh"
chmod 755 "${BIN_DIR}/devbox-focus-browser.sh"
chown "${USER_NAME}:${USER_NAME}" "${BIN_DIR}/devbox-launch-browser.sh" "${BIN_DIR}/devbox-focus-browser.sh"

cat > "${AUTOSTART_DIR}/devbox-browser.desktop" <<EOF
[Desktop Entry]
Type=Application
Version=1.0
Name=Devbox Browser
Exec=${BIN_DIR}/devbox-launch-browser.sh
X-GNOME-Autostart-enabled=true
EOF

cat > "${VNC_DIR}/kasmvnc.yaml" <<EOF
desktop:
  resolution:
    width: ${RESOLUTION%x*}
    height: ${RESOLUTION#*x}
  allow_resize: true
  pixel_depth: 24
network:
  protocol: http
  interface: 127.0.0.1
  websocket_port: ${DESKTOP_PORT}
  udp:
    public_ip: 127.0.0.1
  ssl:
    pem_certificate: ${TLS_CERT}
    pem_key: ${TLS_KEY}
    require_ssl: false
user_session:
  new_session_disconnects_existing_exclusive_session: false
  concurrent_connections_prompt: false
  idle_timeout: never
runtime_configuration:
  allow_client_to_override_kasm_server_settings: true
EOF

cat > "${VNC_DIR}/xstartup" <<'EOF'
#!/usr/bin/env bash
set -euo pipefail

export XDG_RUNTIME_DIR="${XDG_RUNTIME_DIR:-/tmp/runtime-user}"
mkdir -p "${XDG_RUNTIME_DIR}"
chmod 700 "${XDG_RUNTIME_DIR}"

exec dbus-launch --exit-with-session startxfce4
EOF

chmod 700 "${VNC_DIR}/xstartup"
chown "${USER_NAME}:${USER_NAME}" "${VNC_DIR}/kasmvnc.yaml" "${VNC_DIR}/xstartup" "${AUTOSTART_DIR}/devbox-browser.desktop"

sudo -u "${USER_NAME}" env \
  HOME="${USER_HOME}" \
  USER="${USER_NAME}" \
  LOGNAME="${USER_NAME}" \
  bash -lc "printf '%s\n%s\n' '${DESKTOP_PASSWORD}' '${DESKTOP_PASSWORD}' | vncpasswd -u '${DESKTOP_USER}' -wo '${PASSWORD_FILE}'"

chmod 600 "${PASSWORD_FILE}"
chown "${USER_NAME}:${USER_NAME}" "${PASSWORD_FILE}"

if ! pgrep -u "${USER_NAME}" -f "/usr/bin/Xvnc ${DISPLAY}" >/dev/null 2>&1; then
  sudo -u "${USER_NAME}" env \
    HOME="${USER_HOME}" \
    USER="${USER_NAME}" \
    LOGNAME="${USER_NAME}" \
    bash -lc "vncserver ${DISPLAY} -geometry ${RESOLUTION} -depth 24 -select-de xfce" \
    >/var/log/e2b/desktop.log 2>&1
fi

nohup sudo -u "${USER_NAME}" env \
  HOME="${USER_HOME}" \
  USER="${USER_NAME}" \
  LOGNAME="${USER_NAME}" \
  DISPLAY="${DISPLAY}" \
  XDG_RUNTIME_DIR="/tmp/runtime-${USER_NAME}" \
  bash -lc "${BIN_DIR}/devbox-focus-browser.sh" \
  >/var/log/e2b/browser-focus.log 2>&1 &

AUTH_HEADER="$(printf '%s' "${DESKTOP_USER}:${DESKTOP_PASSWORD}" | base64 -w0)"

if ! pgrep -f "desktop_proxy.py --listen 0.0.0.0 --port ${DESKTOP_WEB_PORT}" >/dev/null 2>&1; then
  nohup python3 /usr/local/bin/desktop_proxy.py \
    --listen 0.0.0.0 \
    --port "${DESKTOP_WEB_PORT}" \
    --upstream "http://127.0.0.1:${DESKTOP_PORT}" \
    --auth-header "Basic ${AUTH_HEADER}" \
    >"${DESKTOP_PROXY_LOG}" 2>&1 &
fi

for _ in $(seq 1 30); do
  if ss -tuln | grep -q ":${DESKTOP_PORT}\\b" && ss -tuln | grep -q ":${DESKTOP_WEB_PORT}\\b"; then
    touch /tmp/e2b-desktop-ready
    exit 0
  fi
  sleep 1
done

tail -n 100 /var/log/e2b/desktop.log >&2 || true
tail -n 100 /var/log/e2b/browser-launch.log >&2 || true
tail -n 100 /var/log/e2b/browser-focus.log >&2 || true
tail -n 100 "${DESKTOP_PROXY_LOG}" >&2 || true
exit 1
