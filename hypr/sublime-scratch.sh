#!/usr/bin/env bash
# Launch the independent, minimal, dark Sublime Text scratchpad on ~/scratchpad.md.
#
# Separate Sublime instance via its own XDG dirs (~/.local/sublime-scratch) using the
# /opt binary — never merges with or changes the main Sublime. Config (minimal Preferences
# + the custom dark markdown color scheme) is seeded from dots/sublime-scratch so it's
# reproducible and authoritative. Chrome (tabs/menu/status/minimap) is hidden once and
# persists in this instance's session (sentinel). scratchpad-toggle.sh (Super+S) calls
# this for the cold spawn, then floats/sizes/pins the window (class sublime_text + title).
set -u

SCRATCH="$HOME/.local/sublime-scratch"
NOTE="$HOME/scratchpad.md"
BIN="/opt/sublime_text/sublime_text"
DOTS="$HOME/Github/dots/sublime-scratch"
export XDG_CONFIG_HOME="$SCRATCH/config"
export XDG_CACHE_HOME="$SCRATCH/cache"

# Seed config from dots (authoritative: keeps the minimal + dark-markdown setup correct).
USERPKG="$XDG_CONFIG_HOME/sublime-text/Packages/User"
mkdir -p "$USERPKG"
cp -f "$DOTS/Preferences.sublime-settings"      "$USERPKG/" 2>/dev/null
cp -f "$DOTS/MarkdownDark.sublime-color-scheme" "$USERPKG/" 2>/dev/null

[ -f "$NOTE" ] || printf '# Scratchpad\n\n' > "$NOTE"

# Launch in the dedicated instance. NO -n: a plain open focuses the existing scratchpad
# window if the instance is already running, instead of spawning a duplicate window.
"$BIN" "$NOTE" >/dev/null 2>&1 &

# First run only: hide tabs/menu/status/minimap (persists in this instance's session).
SENTINEL="$SCRATCH/.minimal-applied"
if [ ! -f "$SENTINEL" ]; then
  (
    sleep 3
    for cmd in toggle_tabs toggle_menu toggle_status_bar toggle_minimap; do
      "$BIN" --command "$cmd" >/dev/null 2>&1
      sleep 0.3
    done
    touch "$SENTINEL"
  ) &
fi
