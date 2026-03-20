#!/usr/bin/env python3
import asyncio
import json
import os
import pwd
import pty
import shlex
import signal
import subprocess
import termios
from fcntl import ioctl
from pathlib import Path
from struct import pack

import websockets


PORT = int(os.environ.get("E2B_TERMINAL_PORT", "7681"))
DEFAULT_WORKDIR = os.environ.get("WERKBENCH_CWD", "/home/user/workspace")
DEFAULT_COMMAND = os.environ.get("WERKBENCH_TERMINAL_COMMAND", "fish -l")
SESSION_CONFIG_PATH = Path(
    os.environ.get(
        "WERKBENCH_TERMINAL_CONFIG_PATH",
        "/home/user/.cache/werkbench/terminal-session.json",
    )
)

LEGACY_BASH_COMMANDS = {
    "bash",
    "bash -l",
    "bash --login",
    "/bin/bash",
    "/bin/bash -l",
    "/bin/bash --login",
}

DIRECT_SHELL_COMMANDS = {
    "fish": ["/usr/bin/fish"],
    "fish -l": ["/usr/bin/fish", "-l"],
    "/usr/bin/fish": ["/usr/bin/fish"],
    "/usr/bin/fish -l": ["/usr/bin/fish", "-l"],
    "bash": ["/bin/bash"],
    "bash -l": ["/bin/bash", "-l"],
    "/bin/bash": ["/bin/bash"],
    "/bin/bash -l": ["/bin/bash", "-l"],
}


def set_winsize(fd: int, rows: int, cols: int) -> None:
    ioctl(fd, termios.TIOCSWINSZ, pack("HHHH", rows, cols, 0, 0))


def shell_env() -> dict[str, str]:
    env = os.environ.copy()
    user = pwd.getpwuid(os.getuid())
    term = env.get("TERM")
    path = env.get("PATH", "")

    env["HOME"] = user.pw_dir
    env["USER"] = user.pw_name
    env["LOGNAME"] = user.pw_name
    env["SHELL"] = "/usr/bin/fish"
    env["BUN_INSTALL"] = f"{user.pw_dir}/.bun"
    env["PATH"] = ":".join(
        [
            f"{user.pw_dir}/.bun/bin",
            f"{user.pw_dir}/.local/bin",
            f"{user.pw_dir}/.npm-global/bin",
            f"{user.pw_dir}/.opencode/bin",
            path,
        ]
    )
    env["TERM"] = (
        "xterm-256color"
        if not term or term in {"unknown", "dumb"}
        else term
    )
    env["COLORTERM"] = env.get("COLORTERM") or "truecolor"

    return env


def normalize_command(command: str) -> str:
    normalized = command.strip()
    if not normalized or normalized in LEGACY_BASH_COMMANDS:
        return DEFAULT_COMMAND
    return normalized


def resolve_process_command(command: str) -> list[str]:
    if command in DIRECT_SHELL_COMMANDS:
        return DIRECT_SHELL_COMMANDS[command]

    return ["bash", "-lc", f"exec {command}"]


def read_terminal_config() -> tuple[str, str]:
    if SESSION_CONFIG_PATH.exists():
        try:
            payload = json.loads(SESSION_CONFIG_PATH.read_text())
            cwd = payload.get("cwd") or DEFAULT_WORKDIR
            command = normalize_command(payload.get("command") or DEFAULT_COMMAND)
            return cwd, command
        except (json.JSONDecodeError, OSError):
            pass

    return DEFAULT_WORKDIR, DEFAULT_COMMAND


def child_session_setup(slave_fd: int):
    def setup() -> None:
        os.setsid()
        ioctl(slave_fd, termios.TIOCSCTTY, 0)

    return setup


async def handle_terminal(websocket):
    master_fd, slave_fd = pty.openpty()
    set_winsize(slave_fd, 24, 80)
    workdir, command = read_terminal_config()

    process = subprocess.Popen(
        resolve_process_command(command),
        stdin=slave_fd,
        stdout=slave_fd,
        stderr=slave_fd,
        preexec_fn=child_session_setup(slave_fd),
        cwd=workdir,
        env=shell_env(),
    )
    os.close(slave_fd)

    loop = asyncio.get_running_loop()

    async def pty_to_socket():
        while True:
            data = await loop.run_in_executor(None, os.read, master_fd, 4096)
            if not data:
                break
            await websocket.send(data)

    async def socket_to_pty():
        async for message in websocket:
            if isinstance(message, bytes):
                os.write(master_fd, message)
                continue

            payload = json.loads(message)
            kind = payload.get("type")
            if kind == "input":
                os.write(master_fd, payload.get("data", "").encode())
            elif kind == "resize":
                set_winsize(
                    master_fd,
                    int(payload.get("rows", 24)),
                    int(payload.get("cols", 80)),
                )
                try:
                    os.killpg(process.pid, signal.SIGWINCH)
                except ProcessLookupError:
                    pass

    try:
        await asyncio.gather(pty_to_socket(), socket_to_pty())
    finally:
        try:
            os.killpg(process.pid, signal.SIGKILL)
        except ProcessLookupError:
            pass
        os.close(master_fd)


async def main():
    Path("/tmp").mkdir(parents=True, exist_ok=True)
    async with websockets.serve(handle_terminal, "0.0.0.0", PORT, max_size=None):
        Path("/tmp/e2b-terminal-ready").touch()
        await asyncio.Future()


if __name__ == "__main__":
    asyncio.run(main())
