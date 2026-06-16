#!/bin/bash
# Stop hook — fires a short "<emoji> <Agent> replied" desktop toast when a turn ends.
# Per-agent: Director 🧠 · HeyDaddy 💜 · Mirror 📸 · Envy 💻. Routed through nhq-notify (reply type).
#
# The agent is resolved by nhq-agent-name (fleet session / git repo / $HOME), NOT
# by the cwd basename — a session that ends in a `bin/` dir must still report the
# real agent, never the directory name.
input=$(cat 2>/dev/null)
cwd=$(echo "$input" | jq -r '.cwd // empty' 2>/dev/null)

# grok-chatter: no per-reply ping (not an NHQ agent; matched by its repo dir)
[ "$(basename "$cwd")" = "grok-chatter" ] && exit 0

RESOLVER="$HOME/.local/bin/nhq-agent-name"
name=""
[ -x "$RESOLVER" ] && name=$("$RESOLVER" --dir "$cwd" 2>/dev/null)

case "$name" in
  Director) em="🧠" ;;
  HeyDaddy) em="💜" ;;
  Mirror)   em="📸" ;;
  Envy)     em="💻" ;;
  "")       name="Claude"; em="💬" ;;   # unresolved — honest generic, never a junk basename
  *)        em="💬" ;;
esac

exec "$HOME/.local/bin/nhq-notify" reply "$em $name replied"
