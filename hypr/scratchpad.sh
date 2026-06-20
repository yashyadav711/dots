#!/usr/bin/env bash
# Inner command for the Super+S floating dark scratchpad (kitty --class scratchpad).
# Opens ~/scratchpad.md in a TUI editor if one is installed; otherwise drops into
# a scratch shell in $HOME. The window lives on the `scratchpad` special workspace,
# so Super+S just hides/shows it — this command runs once, when the window spawns.
note="$HOME/scratchpad.md"
[ -f "$note" ] || printf '# Scratchpad\n\n' > "$note"
for ed in "$VISUAL" "$EDITOR" nvim vim micro hx helix nano vi; do
  case "$ed" in ""|true|false) continue ;; esac
  command -v "$ed" >/dev/null 2>&1 && exec "$ed" "$note"
done
cd "$HOME" || exit 1
echo "scratchpad -> ~/scratchpad.md (no TUI editor found; this is a scratch shell)"
exec "${SHELL:-/bin/bash}" -i
