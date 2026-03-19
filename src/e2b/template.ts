import { Template, waitForFile } from "e2b";

const aptPackages = [
  "bash",
  "ca-certificates",
  "curl",
  "wget",
  "git",
  "sudo",
  "openssh-server",
  "openssh-client",
  "unzip",
  "zip",
  "xz-utils",
  "jq",
  "less",
  "nano",
  "ripgrep",
  "tmux",
  "htop",
  "procps",
  "iproute2",
  "lsof",
  "net-tools",
  "iputils-ping",
  "dnsutils",
  "rsync",
  "file",
  "tree",
  "python3",
  "python3-pip",
  "python3-venv",
  "build-essential",
  "make",
  "gcc",
  "g++",
  "libc6-dev",
  "pkg-config",
  "gnupg",
  "gpg",
  "gh",
  "dbus-x11",
  "openbox",
  "xfce4",
  "xfce4-terminal",
  "xauth",
  "xfonts-base",
  "x11-xserver-utils",
  "wmctrl",
];

const userEnv = [
  'export BUN_INSTALL="$HOME/.bun"',
  'export PATH="$HOME/.bun/bin:$HOME/.local/bin:$HOME/.npm-global/bin:$HOME/.opencode/bin:$PATH"',
  'export EDITOR=nvim',
  'export VISUAL=nvim',
  'export PAGER=less',
  'alias ll="ls -lah"',
  'alias la="ls -A"',
  'alias gs="git status"',
  'alias gd="git diff"',
  'alias gc="git commit"',
  'alias gp="git pull"',
  'alias gl="git log --oneline --graph --decorate -20"',
].join("\n");

export const template = Template()
  .fromUbuntuImage("24.04")
  .setUser("root")
  .copy(
    "runtime/start-desktop.sh",
    "/usr/local/bin/start-desktop.sh",
    { user: "root", mode: 0o755 },
  )
  .copy("runtime/desktop_proxy.py", "/usr/local/bin/desktop_proxy.py", {
    user: "root",
    mode: 0o755,
  })
  .copy(
    "runtime/start-ssh-stack.sh",
    "/usr/local/bin/start-ssh-stack.sh",
    { user: "root", mode: 0o755 },
  )
  .copy("runtime/sshd_config", "/etc/ssh/sshd_config_e2b", {
    user: "root",
    mode: 0o644,
  })
  .copy("runtime/terminal_proxy.py", "/usr/local/bin/terminal_proxy.py", {
    user: "root",
    mode: 0o755,
  })
  .aptInstall(aptPackages)
  .runCmd(
    [
      "curl -fsSL -o /tmp/kasmvncserver.deb https://github.com/kasmtech/KasmVNC/releases/download/v1.4.0/kasmvncserver_noble_1.4.0_amd64.deb",
      "apt-get update",
      "apt-get install -y --no-install-recommends /tmp/kasmvncserver.deb",
      "rm -f /tmp/kasmvncserver.deb",
      "rm -rf /var/lib/apt/lists/*",
    ].join(" && "),
  )
  .runCmd(
    [
      "mkdir -p /etc/apt/keyrings",
      "curl -fsSL https://dl.google.com/linux/linux_signing_key.pub | gpg --dearmor -o /etc/apt/keyrings/google-linux.gpg",
      'echo "deb [arch=amd64 signed-by=/etc/apt/keyrings/google-linux.gpg] https://dl.google.com/linux/chrome/deb/ stable main" > /etc/apt/sources.list.d/google-chrome.list',
      "apt-get update",
      "apt-get install -y --no-install-recommends google-chrome-stable",
      "rm -rf /var/lib/apt/lists/*",
    ].join(" && "),
  )
  .runCmd(
    [
      "mkdir -p /etc/apt/keyrings",
      "curl -fsSL https://deb.nodesource.com/gpgkey/nodesource-repo.gpg.key | gpg --dearmor -o /etc/apt/keyrings/nodesource.gpg",
      'echo "deb [signed-by=/etc/apt/keyrings/nodesource.gpg] https://deb.nodesource.com/node_20.x nodistro main" > /etc/apt/sources.list.d/nodesource.list',
      "apt-get update",
      "apt-get install -y --no-install-recommends nodejs",
      "rm -rf /var/lib/apt/lists/*",
    ].join(" && "),
  )
  .runCmd(
    [
      "curl -fsSL https://github.com/vi/websocat/releases/download/v1.9.0/websocat_linux64 -o /usr/local/bin/websocat",
      "chmod +x /usr/local/bin/websocat",
    ].join(" && "),
  )
  .runCmd(
    [
      "curl -fsSL https://github.com/neovim/neovim/releases/download/v0.11.6/nvim-linux-x86_64.tar.gz -o /tmp/nvim-linux-x86_64.tar.gz",
      "rm -rf /opt/nvim",
      "tar -xzf /tmp/nvim-linux-x86_64.tar.gz -C /opt",
      "mv /opt/nvim-linux-x86_64 /opt/nvim",
      "ln -sf /opt/nvim/bin/nvim /usr/local/bin/nvim",
      "rm -f /tmp/nvim-linux-x86_64.tar.gz",
    ].join(" && "),
  )
  .runCmd("python3 -m pip install --break-system-packages aiohttp websockets uv")
  .runCmd("mkdir -p /etc/sudoers.d && printf 'user ALL=(ALL) NOPASSWD: ALL\n' > /etc/sudoers.d/e2b-user && chmod 440 /etc/sudoers.d/e2b-user")
  .runCmd("mkdir -p /home/user/workspace && chown -R user:user /home/user")
  .setUser("user")
  .setWorkdir("/home/user/workspace")
  .runCmd("curl -fsSL https://bun.sh/install | bash")
  .runCmd("mkdir -p $HOME/.npm-global && npm config set prefix $HOME/.npm-global")
  .runCmd("npm install -g @openai/codex@0.115.0 @mariozechner/pi-coding-agent@0.57.1")
  .runCmd(
    [
      "if curl -fsSL https://claude.ai/install.sh | bash; then",
      "  echo 'claude-install=ok';",
      "else",
      "  echo 'claude-install=skipped';",
      "fi",
    ].join("\n"),
  )
  .runCmd("curl -fsSL https://opencode.ai/install | bash -s -- --no-modify-path")
  .runCmd(`printf '%s\n' '${userEnv.replaceAll("'", "'\\''")}' >> $HOME/.bashrc`)
  .runCmd("printf '\n[ -f ~/.bashrc ] && . ~/.bashrc\n' >> $HOME/.profile")
  .runCmd(
    [
      "node -v",
      "npm -v",
      "$HOME/.bun/bin/bun -v",
      "gh --version",
      "python3 --version",
      "uv --version",
      "git --version",
      "nvim --version | head -n 1",
      "tmux -V",
      "rg --version | head -n 1",
      "$HOME/.npm-global/bin/codex --version",
      "if [ -x \"$HOME/.local/bin/claude\" ]; then $HOME/.local/bin/claude --version; else echo 'claude-not-installed'; fi",
      "$HOME/.opencode/bin/opencode --version",
      "/usr/local/bin/websocat --version | head -n 1",
      "dpkg -s kasmvncserver | grep '^Version:'",
      "google-chrome-stable --version",
    ].join(" && "),
  )
  .setStartCmd(
    "bash -lc 'sudo /usr/local/bin/start-ssh-stack.sh && exec sleep infinity'",
    waitForFile("/tmp/e2b-ready"),
  );
