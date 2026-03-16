export BUN_INSTALL=/root/.bun
export PATH="/root/.bun/bin:/root/.local/bin:/root/.opencode/bin:${PATH}"
export GH_CONFIG_DIR=/data/state/gh
export XDG_CONFIG_HOME=/root/.config
export STARSHIP_CONFIG=/root/.config/starship.toml
export EDITOR=nvim
export VISUAL=nvim
export PAGER=less

alias ll='ls -lah'
alias la='ls -A'
alias vi='nvim'
alias vim='nvim'
alias gs='git status'
alias gd='git diff'
alias gc='git commit'
alias gp='git pull'
alias gl='git log --oneline --graph --decorate -20'
alias py='python3'
alias venv='python3 -m venv .venv && . .venv/bin/activate'
alias ts='tailscale --socket=/tmp/tailscaled.sock'
alias tss='tailscale --socket=/tmp/tailscaled.sock status'
alias tssh='tailscale --socket=/tmp/tailscaled.sock ssh'
alias codexh='cd /root/.codex'
alias pih='cd /root/.pi'
alias cdata='cd /data'
alias cwork='cd /workspace'
alias crepos='cd /data/repos'

if [ -d /data/repos ]; then
  cd /data/repos 2>/dev/null || true
fi

if command -v starship >/dev/null 2>&1; then
  case "${SHELL##*/}" in
    bash) eval "$(starship init bash)" ;;
    zsh) eval "$(starship init zsh)" ;;
  esac
fi
