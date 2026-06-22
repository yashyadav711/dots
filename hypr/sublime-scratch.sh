#!/usr/bin/env bash
# Launch the independent, minimal Sublime Text scratchpad on ~/scratchpad.md.
#
# Runs as a SEPARATE Sublime instance via its own XDG dirs, so it never merges with —
# or changes the settings of — your main Sublime, while still using the auto-updating
# /opt binary. "Very minimal": no gutter/line-numbers/indent-guides (settings) and
# tabs + menu + status bar + minimap hidden once (they persist in THIS instance's
# session, guarded by a sentinel so the toggles run exactly once).
#
# scratchpad-toggle.sh (Super+S) calls this for the cold spawn; it then floats/sizes
# and pins the window (matched by class sublime_text + title containing scratchpad.md).
set -u

SCRATCH="$HOME/.local/sublime-scratch"
NOTE="$HOME/scratchpad.md"
BIN="/opt/sublime_text/sublime_text"
export XDG_CONFIG_HOME="$SCRATCH/config"
export XDG_CACHE_HOME="$SCRATCH/cache"

# Seed minimal Preferences on first run.
PREF_DIR="$XDG_CONFIG_HOME/sublime-text/Packages/User"
PREF="$PREF_DIR/Preferences.sublime-settings"
if [ ! -f "$PREF" ]; then
  mkdir -p "$PREF_DIR"
  cat > "$PREF" <<'JSON'
{
    "gutter": false,
    "line_numbers": false,
    "draw_white_space": "none",
    "draw_indent_guides": false,
    "rulers": [],
    "highlight_line": false,
    "scroll_past_end": false,
    "fold_buttons": false,
    "show_definitions": false,
    "word_wrap": true,
    "font_size": 12
}
JSON
fi

[ -f "$NOTE" ] || printf '# Scratchpad\n\n' > "$NOTE"

# Launch a new window in the dedicated instance.
"$BIN" -n "$NOTE" >/dev/null 2>&1 &

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
