if status is-interactive
end

set -g fish_greeting

set -gx BUN_INSTALL /root/.bun
set -gx GH_CONFIG_DIR /data/state/gh
set -gx XDG_CONFIG_HOME /root/.config
set -gx STARSHIP_CONFIG /root/.config/starship.toml
set -gx EDITOR nvim
set -gx VISUAL nvim
set -gx PAGER less

alias c='clear'
alias gg='lazygit'
alias t='tmux'
alias vim='nvim'
alias vi='nvim'
alias oc='opencode'
alias ll='ls -lah'
alias la='ls -A'
alias gs='git status'
alias gd='git diff'
alias gc='git commit'
alias gp='git pull'
alias gl='git log --oneline --graph --decorate -20'
alias py='python3'
alias ts='tailscale --socket=/tmp/tailscaled.sock'
alias tss='tailscale --socket=/tmp/tailscaled.sock status'
alias codexh='cd /root/.codex'
alias pih='cd /root/.pi'
alias cdata='cd /data'
alias cwork='cd /workspace'
alias crepos='cd /data/repos'

fish_add_path /usr/local/bin
fish_add_path $HOME/.local/bin
fish_add_path $HOME/.opencode/bin
fish_add_path $HOME/.bun/bin

if test -d $HOME/.antigravity/antigravity/bin
    fish_add_path $HOME/.antigravity/antigravity/bin
end

if test -d $HOME/.ami/bin
    set -gx AMI_INSTALL $HOME/.ami
    fish_add_path $AMI_INSTALL/bin
end

if test -d $HOME/.garry/bin
    fish_add_path $HOME/.garry/bin
end

if command -q starship
    starship init fish | source
end

if status is-login; and test -d /data/repos
    cd /data/repos
end
