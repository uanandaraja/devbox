#!/usr/bin/env bash
set -euo pipefail

USER_NAME="user"
USER_HOME="/home/user"
DEBUG_PORT="${E2B_BROWSER_DEBUG_PORT:-9222}"
INTERNAL_DEBUG_PORT="${E2B_BROWSER_INTERNAL_PORT:-}"
PREVIEW_PROXY_PORT="${E2B_BROWSER_PROXY_PORT:-8090}"
TARGET_PORT="${E2B_BROWSER_TARGET_PORT:-}"
START_URL="${E2B_BROWSER_START_URL:-about:blank}"
LOG_DIR="/var/log/e2b"
PROFILE_DIR="${USER_HOME}/.cache/werkbench/browser-profile"
RUNTIME_DIR="${USER_HOME}/.cache/werkbench/runtime"
URL_FILE="${USER_HOME}/.cache/werkbench/browser-target-url"
TARGET_PORT_FILE="${USER_HOME}/.cache/werkbench/browser-target-port"
READY_FILE="/tmp/e2b-browser-ready"
BROWSER_LOG="${LOG_DIR}/browser.log"
PROXY_LOG="${LOG_DIR}/browser-debug-proxy.log"
PREVIEW_PROXY_LOG="${LOG_DIR}/browser-preview-proxy.log"

if [[ -z "${INTERNAL_DEBUG_PORT}" ]]; then
  INTERNAL_DEBUG_PORT="$((DEBUG_PORT + 1))"
fi

mkdir -p "${LOG_DIR}" "${PROFILE_DIR}" "${RUNTIME_DIR}" "${USER_HOME}/.cache/werkbench"
chown -R "${USER_NAME}:${USER_NAME}" "${USER_HOME}/.cache/werkbench"
rm -f "${READY_FILE}"

current_url=""
if [[ -f "${URL_FILE}" ]]; then
  current_url="$(cat "${URL_FILE}")"
fi

current_target_port=""
if [[ -f "${TARGET_PORT_FILE}" ]]; then
  current_target_port="$(cat "${TARGET_PORT_FILE}")"
fi

browser_running=false
if pgrep -u "${USER_NAME}" -f "${PROFILE_DIR}" >/dev/null 2>&1; then
  browser_running=true
fi

restart_browser=false
if [[ "${browser_running}" == "true" && "${current_url}" != "${START_URL}" ]]; then
  restart_browser=true
fi

if [[ "${restart_browser}" == "true" ]]; then
  pkill -u "${USER_NAME}" -f "${PROFILE_DIR}" >/dev/null 2>&1 || true
  browser_running=false
  sleep 1
fi

if [[ "${browser_running}" == "false" ]]; then
  nohup sudo -u "${USER_NAME}" env \
    HOME="${USER_HOME}" \
    USER="${USER_NAME}" \
    LOGNAME="${USER_NAME}" \
    XDG_RUNTIME_DIR="${RUNTIME_DIR}" \
    /usr/bin/google-chrome-stable \
    --headless=new \
    --disable-dev-shm-usage \
    --disable-gpu \
    --disable-software-rasterizer \
    --no-first-run \
    --no-default-browser-check \
    --no-sandbox \
    --remote-allow-origins="*" \
    --remote-debugging-address=127.0.0.1 \
    --remote-debugging-port="${INTERNAL_DEBUG_PORT}" \
    --user-data-dir="${PROFILE_DIR}" \
    "${START_URL}" >"${BROWSER_LOG}" 2>&1 &
fi

proxy_running=false
if pgrep -u "${USER_NAME}" -f "browser_debug_proxy.py --listen-port ${DEBUG_PORT}" >/dev/null 2>&1; then
  proxy_running=true
fi

if [[ "${proxy_running}" == "false" ]]; then
  nohup sudo -u "${USER_NAME}" env \
    HOME="${USER_HOME}" \
    USER="${USER_NAME}" \
    LOGNAME="${USER_NAME}" \
    XDG_RUNTIME_DIR="${RUNTIME_DIR}" \
    python3 /usr/local/bin/browser_debug_proxy.py \
    --listen-port "${DEBUG_PORT}" \
    --upstream-port "${INTERNAL_DEBUG_PORT}" >"${PROXY_LOG}" 2>&1 &
fi

preview_proxy_running=false
if pgrep -u "${USER_NAME}" -f "browser_preview_proxy.py --listen-port ${PREVIEW_PROXY_PORT}" >/dev/null 2>&1; then
  preview_proxy_running=true
fi

restart_preview_proxy=false
if [[ -n "${TARGET_PORT}" && "${preview_proxy_running}" == "true" && "${current_target_port}" != "${TARGET_PORT}" ]]; then
  restart_preview_proxy=true
fi

if [[ "${restart_preview_proxy}" == "true" ]]; then
  pkill -u "${USER_NAME}" -f "browser_preview_proxy.py --listen-port ${PREVIEW_PROXY_PORT}" >/dev/null 2>&1 || true
  preview_proxy_running=false
  sleep 1
fi

if [[ -n "${TARGET_PORT}" && "${preview_proxy_running}" == "false" ]]; then
  nohup sudo -u "${USER_NAME}" env \
    HOME="${USER_HOME}" \
    USER="${USER_NAME}" \
    LOGNAME="${USER_NAME}" \
    XDG_RUNTIME_DIR="${RUNTIME_DIR}" \
    python3 /usr/local/bin/browser_preview_proxy.py \
    --listen-port "${PREVIEW_PROXY_PORT}" \
    --target-port "${TARGET_PORT}" >"${PREVIEW_PROXY_LOG}" 2>&1 &
fi

printf "%s" "${START_URL}" > "${URL_FILE}"
chown "${USER_NAME}:${USER_NAME}" "${URL_FILE}"

if [[ -n "${TARGET_PORT}" ]]; then
  printf "%s" "${TARGET_PORT}" > "${TARGET_PORT_FILE}"
  chown "${USER_NAME}:${USER_NAME}" "${TARGET_PORT_FILE}"
fi

for _ in $(seq 1 40); do
  debug_ready=false
  preview_ready=true

  if curl -fsS "http://127.0.0.1:${DEBUG_PORT}/json/version" >/dev/null 2>&1; then
    debug_ready=true
  fi

  if [[ -n "${TARGET_PORT}" ]]; then
    if ! curl -sS -o /dev/null --max-time 2 "http://localhost:${PREVIEW_PROXY_PORT}/" >/dev/null 2>&1; then
      preview_ready=false
    fi
  fi

  if [[ "${debug_ready}" == "true" && "${preview_ready}" == "true" ]]; then
    touch "${READY_FILE}"
    exit 0
  fi

  sleep 1
done

tail -n 100 "${BROWSER_LOG}" >&2 || true
tail -n 100 "${PROXY_LOG}" >&2 || true
tail -n 100 "${PREVIEW_PROXY_LOG}" >&2 || true
exit 1
