FROM ubuntu:24.04

ENV DEBIAN_FRONTEND=noninteractive
ENV BUN_INSTALL=/root/.bun
ENV GH_CONFIG_DIR=/data/state/gh
ENV PATH="/root/.bun/bin:/root/.local/bin:/root/.opencode/bin:${PATH}"

RUN apt-get update && apt-get install -y --no-install-recommends \
    bash \
    fish \
    zsh \
    ca-certificates \
    curl \
    wget \
    fzf \
    git \
    openssh-client \
    unzip \
    zip \
    xz-utils \
    jq \
    less \
    nano \
    ripgrep \
    vim \
    tmux \
    htop \
    procps \
    lsof \
    net-tools \
    iputils-ping \
    dnsutils \
    rsync \
    file \
    tree \
    python3 \
    python3-pip \
    python3-venv \
    pipx \
    build-essential \
    make \
    gcc \
    g++ \
    libc6-dev \
    ncurses-bin \
    pkg-config \
    gnupg \
    gpg \
 && rm -rf /var/lib/apt/lists/*

RUN mkdir -p /etc/apt/keyrings \
 && curl -fsSL https://deb.nodesource.com/gpgkey/nodesource-repo.gpg.key \
    | gpg --dearmor -o /etc/apt/keyrings/nodesource.gpg \
 && echo "deb [signed-by=/etc/apt/keyrings/nodesource.gpg] https://deb.nodesource.com/node_20.x nodistro main" \
    > /etc/apt/sources.list.d/nodesource.list \
 && apt-get update \
 && apt-get install -y --no-install-recommends nodejs \
 && rm -rf /var/lib/apt/lists/*

RUN curl -fsSL https://bun.sh/install | bash \
 && curl -fsSL https://github.com/neovim/neovim/releases/download/v0.11.6/nvim-linux-x86_64.tar.gz -o /tmp/nvim-linux-x86_64.tar.gz \
 && rm -rf /opt/nvim \
 && tar -xzf /tmp/nvim-linux-x86_64.tar.gz -C /opt \
 && mv /opt/nvim-linux-x86_64 /opt/nvim \
 && ln -sf /opt/nvim/bin/nvim /usr/local/bin/nvim \
 && rm -f /tmp/nvim-linux-x86_64.tar.gz \
 && npm install -g @openai/codex@0.114.0 @mariozechner/pi-coding-agent@0.57.1 \
 && curl -fsSL https://claude.ai/install.sh | bash \
 && curl -fsSL https://opencode.ai/install | bash -s -- --no-modify-path \
 && curl -fsSL https://starship.rs/install.sh | sh -s -- -y -b /usr/local/bin \
 && ln -sf /root/.local/bin/claude /usr/local/bin/claude \
 && ln -sf /root/.opencode/bin/opencode /usr/local/bin/opencode \
 && pipx install uv

RUN mkdir -p /usr/share/keyrings /etc/apt/keyrings \
 && wget -qO- https://cli.github.com/packages/githubcli-archive-keyring.gpg \
    > /etc/apt/keyrings/githubcli-archive-keyring.gpg \
 && chmod go+r /etc/apt/keyrings/githubcli-archive-keyring.gpg \
 && echo "deb [arch=$(dpkg --print-architecture) signed-by=/etc/apt/keyrings/githubcli-archive-keyring.gpg] https://cli.github.com/packages stable main" \
    > /etc/apt/sources.list.d/github-cli.list \
 && curl -fsSL https://pkgs.tailscale.com/stable/ubuntu/noble.noarmor.gpg \
    | tee /usr/share/keyrings/tailscale-archive-keyring.gpg >/dev/null \
 && curl -fsSL https://pkgs.tailscale.com/stable/ubuntu/noble.tailscale-keyring.list \
    | tee /etc/apt/sources.list.d/tailscale.list >/dev/null \
 && apt-get update \
 && apt-get install -y --no-install-recommends gh tailscale \
 && rm -rf /var/lib/apt/lists/*

WORKDIR /workspace

RUN mkdir -p /data /data/repos /data/state /data/logs /workspace

COPY start.sh /usr/local/bin/start.sh
COPY devbox.sh /etc/profile.d/devbox.sh
COPY defaults/fish /usr/local/share/devbox-defaults/fish
COPY defaults/terminfo /usr/local/share/devbox-defaults/terminfo
COPY defaults/tmux.conf /usr/local/share/devbox-defaults/tmux.conf

RUN chmod +x /usr/local/bin/start.sh \
 && chmod +x /etc/profile.d/devbox.sh \
 && tic -x -o /usr/share/terminfo /usr/local/share/devbox-defaults/terminfo/xterm-ghostty.src \
 && printf '\n[ -f /etc/profile.d/devbox.sh ] && . /etc/profile.d/devbox.sh\n' >> /etc/zsh/zprofile \
 && chsh -s /usr/bin/fish root \
 && git config --system init.defaultBranch main

CMD ["/usr/local/bin/start.sh"]
