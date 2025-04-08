###
# Fish Shell Configuration File
# Official docs: https://fishshell.com/docs/current/index.html
# Cookbook: https://github.com/jorgebucaran/cookbook.fish

# Theme and plugin references
# Themes: https://github.com/oh-my-fish/oh-my-fish/blob/master/docs/Themes.md
# Plugins: 
# - fzf: https://github.com/jethrokuan/fzf
# - tide: https://github.com/IlanCosman/tide.git (install: fisher install IlanCosman/tide@v5)
# - plugin-git: https://github.com/jhillyerd/plugin-git

# Tool managers:
# - fisher: https://github.com/jorgebucaran/fisher
# - oh-my-fish: https://github.com/oh-my-fish/oh-my-fish
# - fundle: https://github.com/danhper/fundle
###

#set VIRTUAL_ENV_DISABLE_PROMPT "1"  # Uncomment if virtualenv prompt is undesired

# Exit early if shell is not interactive
if not status --is-interactive
  exit
end

# Load private overrides, secure tokens, or secrets
if [ -f $HOME/.config/fish/private.fish ]
    source $HOME/.config/fish/private.fish
end

# Load Git helper functions if available
if [ -f $HOME/.config/fish/git.fish ]
    source $HOME/.config/fish/git.fish
end

# Load user-defined aliases (delegated to a separate file)
if [ -f $HOME/.config/fish/alias.fish ]
    source $HOME/.config/fish/alias.fish
end

# Reload shell session
function reload
    exec fish
    set -l config (status -f)
    echo "reloading: $config"
end

# Clean and reinitialize user paths
set -e fish_user_paths
set -U fish_user_paths $HOME/.bin $HOME/.local/bin $HOME/Applications $fish_user_paths

# Starship prompt initializer (commented out)
#if command -sq starship
#    starship init fish | source
#end

# Environment variables for editors
set -x EDITOR vim
set -x VISUAL vim
#set -x TERM alacritty  # Uncomment if using Alacritty

# Terminal capabilities
set TERM "xterm-256color"

# Disable default greeting message
set fish_greeting

# Prevent path compression in prompt
set fish_prompt_pwd_dir_length 0

# fzf configuration (colors and behavior)
set -x FZF_DEFAULT_OPTS "--color=16,header:13,info:5,pointer:3,marker:9,spinner:1,prompt:5,fg:7,hl:14,fg+:3,hl+:9 --inline-info --tiebreak=end,length --bind=shift-tab:toggle-down,tab:toggle-up"

# Use 'bat' for viewing man pages if available
set -x MANPAGER "sh -c 'col -bx | bat -l man -p'"
set -x MANROFFOPT "-c"

# Use Nerd Fonts for enhanced prompts
set -g theme_nerd_fonts yes

# Re-append ~/.bin and ~/.local/bin during login for redundancy
if status --is-login
    set -gx PATH $PATH ~/.bin
end

if status --is-login
    set -gx PATH $PATH ~/.local/bin
end

# Override default `cat` with `bat` if installed
if type -q bat
    alias cat="bat --paging=never --style=plain --color=always"
end

# Setup fzf keybindings for directory traversal if available
if command -sq fzf && type -q fzf_configure_bindings
  fzf_configure_bindings --directory=\ct
end

# Initialize abbreviations if not already declared
if not set -q -g fish_user_abbreviations
  set -gx fish_user_abbreviations
end

# Tree output functions for various depths
if test tree >/dev/null
    function l1;  tree --dirsfirst -ChFL 1 $argv; end
    function l2;  tree --dirsfirst -ChFL 2 $argv; end
    function l3;  tree --dirsfirst -ChFL 3 $argv; end
    function ll1; tree --dirsfirst -ChFupDaL 1 $argv; end
    function ll2; tree --dirsfirst -ChFupDaL 2 $argv; end
    function ll3; tree --dirsfirst -ChFupDaL 3 $argv; end
end

# Enable direnv if available
if type -q direnv
    eval (direnv hook fish)
end

### FUNCTIONS ###

# Show command history with timestamps
function history
    builtin history --show-time='%F %T ' | sort
end

# Create a quick backup of any file
function backup --argument filename
    cp $filename $filename.bak
end

# List recently installed packages (default to 100)
function ripp --argument length -d "List the last n (100) packages installed"
    if test -z $length
        set length 100
    end
    expac --timefmt='%Y-%m-%d %T' '%l\t%n' | sort | tail -n $length | nl
end

# Interactive Git log browser with fzf and previews
function gl
    git log --graph --color=always --format="%C(auto)%h%d %s %C(black)%C(bold)%cr" $argv | fzf --ansi --no-sort --reverse --tiebreak=index --toggle-sort=\` --bind "ctrl-m:execute: echo '{}' | grep -o '[a-f0-9]\{7\}' | head -1 | xargs -I % sh -c 'git show --color=always % | less -R'"
end

# Smart extract for archives based on extension
function ex --description "Extract bundled & compressed files"
    if test -f "$argv[1]"
        switch $argv[1]
            case '*.tar.bz2'
                tar xjf $argv[1]
            case '*.tar.gz'
                tar xzf $argv[1]
            case '*.bz2'
                bunzip2 $argv[1]
            case '*.rar'
                unrar $argv[1]
            case '*.gz'
                gunzip $argv[1]
            case '*.tar'
                tar xf $argv[1]
            case '*.tbz2'
                tar xjf $argv[1]
            case '*.tgz'
                tar xzf $argv[1]
            case '*.zip'
                unzip $argv[1]
            case '*.Z'
                uncompress $argv[1]
            case '*.7z'
                7z $argv[1]
            case '*.deb'
                ar $argv[1]
            case '*.tar.xz'
                tar xf $argv[1]
            case '*.tar.zst'
                tar xf $argv[1]
            case '*'
                echo "'$argv[1]' cannot be extracted via ex"
        end
   else
       echo "'$argv[1]' is not a valid file"
   end
end

# Ensure less always shows color output correctly
function less
    command less -R $argv
end

# Auto-list contents when changing directory
function cd
    builtin cd $argv; and ls
end

### COLOR SCHEME CONFIGURATION ###

# Cyberpunk-inspired color configuration
set fish_color_autosuggestion "#4466ff"                # Dimmed blue suggestions
set fish_color_cancel -r                               # Reset on cancel
set fish_color_command --bold "#ffcc00"                # Commands: electric yellow
set fish_color_comment "#ff8800"                       # Comments: bright orange
set fish_color_cwd "#00ff99"                           # Current dir: neon green
set fish_color_cwd_root "#ff003c"                      # Root dir: danger red
set fish_color_end "#bb00ff"                           # Statement end: cyber purple
set fish_color_error --bold --underline "#ff003c"      # Errors: red, bold, underlined
set fish_color_escape "#ff5500"                        # Escapes: neon orange
set fish_color_history_current --bold                  # Bold current history match
set fish_color_host "#00ffaa"                          # Hostname: green
set fish_color_host_remote "#ffcc00"                   # Remote host: yellow
set fish_color_match --background="#0088ff"            # Match highlight: blue bg
set fish_color_normal normal                           # Default fallback
set fish_color_operator --bold "#ff00aa"               # Operators: magenta
set fish_color_param --bold "#00ffee"                  # Parameters: cyan-green
set fish_color_quote --bold "#00ffff"                  # Quotes: electric cyan
set fish_color_redirection "#ff66cc"                   # Redirection: pink
set fish_color_search_match --background="#0099ff"     # Search match: blue
set fish_color_selection white --bold --background="#005577"  # Selections
set fish_color_status "#ff0033"                        # Exit status: red
set fish_color_user "#00ff99"                          # User: cyber green
set fish_color_valid_path --underline                  # Valid paths: underlined
set fish_pager_color_completion normal
set fish_pager_color_description "#ffaa33" yellow
set fish_pager_color_prefix white --bold --underline
set fish_pager_color_progress brwhite --background="#00aaff"


# Initialize Atuin (command history manager)
atuin init fish --disable-up-arrow | source

# Initialize "thefuck" for intelligent command correction
thefuck --alias | source

# Copy a file to clipboard function
function copy; cat $argv | xsel --clipboard; echo "📋 Copied to clipboard!"; end
