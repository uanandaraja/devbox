set -g fish_greeting
set -gx BUN_INSTALL "$HOME/.bun"

fish_add_path -g \
    "$HOME/.bun/bin" \
    "$HOME/.local/bin" \
    "$HOME/.npm-global/bin" \
    "$HOME/.opencode/bin"

if status is-interactive
    if command -sq starship
        starship init fish | source
    end
end
