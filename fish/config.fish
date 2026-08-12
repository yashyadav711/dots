# CachyOS default config
source /usr/share/cachyos-fish-config/cachyos-config.fish

###
# Fish Shell Configuration File (Restored from Backup)
# Official docs: https://fishshell.com/docs/current/index.html
###

# nHQ Obsidian vault — single source of truth for vault path (moved out of Github 2026-07-13).
# Set BEFORE the interactive-exit guard so non-interactive shells + child scripts inherit it.
set -gx NHQ_VAULT /home/yash/Obsidian/nHQ

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

# NHQ: Starship disabled 2026-07-28 — using OMF budspencer-NHQ theme. Revert: uncomment below.
# Starship prompt initializer
#if command -sq starship
#    starship init fish | source
#end

# Environment variables for editors
#
# EDITOR stays plain vim: it is what git and other line-oriented tools grab, and
# for a commit message a minimal fast editor is the right tool.
#
# VISUAL is the "give me a real editor" variable, and it is what omp reads first
# for Ctrl+E. It points at nhq-editor, which opens nvim in a tmux split across
# the bottom half of the window — where the input box already is — so the
# conversation stays readable while you write. Outside tmux it is just nvim.
# Yash, 2026-08-13: "vim nahi nvim khulna chahiye, aur wo bhi aadhi screen
# inside the input box where i write prompt."
set -x EDITOR vim
set -x VISUAL nhq-editor
set -x TERM kitty

# Antigravity CLI — route through rotator proxy
set -gx AGY_ENDPOINT http://localhost:51200

# omp: disable the desktop-notification subsystem (+ its OSC 99 capability probe
# that leaked as raw text on vim/editor exit inside tmux). We use nhq-notify instead.
set -gx PI_NOTIFICATIONS off

# Terminal capabilities
set TERM "xterm-256color"

# Greeting defined as function below — NHQ block fires on shell start

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


# Initialize "thefuck" for intelligent command correction
if type -q thefuck
    thefuck --alias | source
end

# Copy a file to clipboard function
function copy; cat $argv | nhq-clip; end


# VFrame project setup alias
alias setupproject='bash -c "$(curl -fsSL https://raw.githubusercontent.com/yashyadav711/vframe-installer/main/setup-vframe.sh)"'

# jump into HeyDaddy on omp (reverted from jcode 2026-07-28; jcode still available: heydaddy-j)
alias heydaddy='cd ~/Github/Work/heydaddy && omp --continue'
# launch Envy in its office (~/Github/nHQ/envy) on omp (reverted 2026-07-28; jcode: envy-j)
alias envy='cd ~/Github/nHQ/envy && omp'
# jump into Mirror on omp (reverted 2026-07-28; jcode: mirror-j)
alias mirror='cd ~/Github/Work/mirror && omp --continue'
# jump into Director (nhq-agentic-os) — STAYS on omp until her rules rewrite + jcode trial (use director-j to try jcode)
alias director='cd ~/Github/nhq-agentic-os && omp --continue'
# jump into HeyDaddy-Design on omp
alias heydaddy-design='cd ~/Github/Work/heydaddy-design && omp --continue'
# jump into Mirror-Design on omp
alias mirror-design='cd ~/Github/Work/mirror-design && omp --continue'
# jump into NHQ-Features on omp
alias nhq-features='cd ~/Github/nhq-features && omp --continue'

# ── jcode trial aliases (omp→jcode migration 2026-07-19) — primary envy/heydaddy/mirror now ON jcode.
# -j = jcode variants (director-j is the Director trial); -omp = omp fallbacks for the flipped three.
alias envy-omp='cd ~/Github/nHQ/envy && omp'
alias heydaddy-omp='cd ~/Github/Work/heydaddy && omp --continue'
alias mirror-omp='cd ~/Github/Work/mirror && omp --continue'
alias envy-j='cd ~/Github/nHQ/envy && jcode'
alias director-j='cd ~/Github/nhq-agentic-os && jcode'
alias heydaddy-j='cd ~/Github/Work/heydaddy && jcode'
alias mirror-j='cd ~/Github/Work/mirror && jcode'
alias heydaddy-design-j='cd ~/Github/Work/heydaddy-design && jcode'
alias mirror-design-j='cd ~/Github/Work/mirror-design && jcode'
alias nhq-features-j='cd ~/Github/nhq-features && jcode'
# typing /exit (slash-command muscle memory) expands to exit
abbr -a -- /exit exit

# live overview of every running Claude Code session/agent + what each is doing
# `claudes` = one-shot snapshot, `claudes -w` = live refresh (script in dots/bin -> ~/.local/bin)
alias claudes='claude-overview'

set -gx PATH ~/.npm-global/bin $PATH

# tmux-aware fastfetch logo (overrides HyDE's kitty-only alias in conf.d/hyde.fish).
# tmux can't pass kitty's graphics protocol, so use chafa (ANSI blocks) inside tmux;
# use the full kitty image in raw kitty. `command` avoids recursing into this function.
function fastfetch
    if set -q TMUX
        command fastfetch --logo-type chafa $argv
    else
        command fastfetch --logo-type kitty $argv
    end
end


# Added by Antigravity CLI installer
set -gx PATH "/home/yash/.local/bin" $PATH

# gemini → agy (Antigravity CLI; agy is the actual binary)
alias gemini='agy'

# NHQ startup greeting — fastfetch + git status of all three repos
function fish_greeting
    return  # NHQ greeting paused 2026-07-02 (Yash) — delete this line to restore fastfetch + repo status
    fastfetch
    echo ""

    set -l cb (set_color brmagenta)
    set -l cl (set_color --bold brcyan)
    set -l cy (set_color bryellow)
    set -l cg (set_color brgreen)
    set -l cr (set_color brred)
    set -l cn (set_color normal)

    echo "$cb  ╭─── NetrunnersHQ ─────────────────────────────────────╮$cn"

    for entry in "HeyDaddy |/home/yash/Github/Work/heydaddy" "Mirror   |/home/yash/Github/Work/mirror" "Director |/home/yash/Github/nhq-agentic-os"
        set -l parts (string split "|" $entry)
        set -l label $parts[1]
        set -l path $parts[2]

        if test -d "$path"
            set -l branch (git -C "$path" rev-parse --abbrev-ref HEAD 2>/dev/null)
            set -l hash (git -C "$path" log -1 --format="%h" 2>/dev/null)
            set -l msg (git -C "$path" log -1 --format="%s" 2>/dev/null)
            set -l dirty (git -C "$path" status --porcelain 2>/dev/null | wc -l | string trim)
            test -z "$branch"; and set branch "?"
            test -z "$hash"; and set hash "---"
            set branch (string sub -l 18 "$branch")
            set msg (string sub -l 35 "$msg")

            set -l dot
            if test "$dirty" -gt 0 2>/dev/null
                set dot "$cr●$cn"
            else
                set dot "$cg○$cn"
            end

            printf "%s  │%s  %s%-9s%s %s%s%-18s%s  %s%s%s  %s\n" \
                "$cb" "$cn" "$cl" "$label" "$cn" \
                "$dot" "$cy" "$branch" "$cn" \
                "$cg" "$hash" "$cn" "$msg"
        end
    end

    echo "$cb  ╰──────────────────────────────────────────────────────╯$cn"
    echo ""
end

# >>> grok installer >>>
fish_add_path $HOME/.grok/bin
# <<< grok installer <<<

# ─── NHQ agy fallback launchers (free Opus 4.6 via pi-antigravity-rotator) ───
# omp with Director seat + plan/slow on free agy Opus, smol on fast Gemini — zero native-Claude quota.
#   <folder>-agy        = fresh session in that folder
#   <folder>-agy-resume = continue the last session in that folder
#   omp-agy / omp-agy-resume = generic, runs in the CURRENT directory (any other folder you use)
# NOTE: named `omp-agy` (not `agy`) so it never shadows the `agy` Antigravity CLI binary.
function _agy --description 'omp on free agy Opus; $argv[1]=dir, rest passed to omp'
    builtin cd $argv[1]
    and omp --model agy/claude-opus-4-6-thinking --plan agy/claude-opus-4-6-thinking --slow agy/claude-opus-4-6-thinking --smol agy/gemini-3.5-flash-high $argv[2..-1]
end

function omp-agy        --description 'omp free Opus — current dir';         _agy . $argv; end
function omp-agy-resume --description 'omp free Opus — current dir, resume'; _agy . --continue $argv; end

function nhq-agy            --description 'Director (nhq-agentic-os) — free Opus';         _agy ~/Github/nhq-agentic-os $argv; end
function nhq-agy-resume     --description 'Director (nhq-agentic-os) — free Opus, resume'; _agy ~/Github/nhq-agentic-os --continue $argv; end
function heydaddy-agy        --description 'HeyDaddy — free Opus';         _agy ~/Github/Work/heydaddy $argv; end
function heydaddy-agy-resume --description 'HeyDaddy — free Opus, resume'; _agy ~/Github/Work/heydaddy --continue $argv; end
function mirror-agy        --description 'Mirror — free Opus';         _agy ~/Github/Work/mirror $argv; end
function mirror-agy-resume --description 'Mirror — free Opus, resume'; _agy ~/Github/Work/mirror --continue $argv; end
function envy-agy        --description 'Envy — free Opus';         _agy ~/Github/nHQ/envy $argv; end
function envy-agy-resume --description 'Envy — free Opus, resume'; _agy ~/Github/nHQ/envy --continue $argv; end
function heydaddy-design-agy        --description 'HeyDaddy-Design — free Opus';         _agy ~/Github/Work/heydaddy-design $argv; end
function heydaddy-design-agy-resume --description 'HeyDaddy-Design — free Opus, resume'; _agy ~/Github/Work/heydaddy-design --continue $argv; end
function mirror-design-agy        --description 'Mirror-Design — free Opus';         _agy ~/Github/Work/mirror-design $argv; end
function mirror-design-agy-resume --description 'Mirror-Design — free Opus, resume'; _agy ~/Github/Work/mirror-design --continue $argv; end
function nhq-features-agy        --description 'NHQ-Features — free Opus';         _agy ~/Github/nhq-features $argv; end
function nhq-features-agy-resume --description 'NHQ-Features — free Opus, resume'; _agy ~/Github/nhq-features --continue $argv; end

# omp-private — ephemeral session: omp's transcript is NOT saved to disk (--no-session).
# The real "nothing on disk" launcher; pair with the /private or /extra-private posture inside.
function omp-private --description 'omp ephemeral — no session transcript saved to disk'
    omp --no-session $argv
end

# Added by codebase-memory-mcp install
fish_add_path /home/yash/.local/bin
