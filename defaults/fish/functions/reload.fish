function reload --description "Reload all Fish configuration files"
    source ~/.config/fish/config.fish

    for file in ~/.config/fish/conf.d/*.fish
        test -f $file && source $file
    end

    for file in ~/.config/fish/completions/*.fish
        test -f $file && source $file
    end

    echo "Fish config reloaded!"
end
