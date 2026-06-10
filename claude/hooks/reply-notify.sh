#!/bin/bash
# Stop hook — fires a short "<emoji> <Agent> replied" desktop toast when a turn ends.
# Per-agent: PM 🎯 · HeyDaddy 🍼 · Mirror 🪞 · Envy 💻. Routed through nhq-notify (reply type).
input=$(cat 2>/dev/null)
cwd=$(echo "$input" | jq -r '.cwd // empty' 2>/dev/null)
proj=$(basename "$cwd")
case "$proj" in
  product-manager) name="PM";       em="🎯" ;;
  heydaddy)        name="HeyDaddy"; em="🍼" ;;
  mirror)          name="Mirror";   em="🪞" ;;
  envy)            name="Envy";     em="💻" ;;
  *)               name="$proj";    em="💬" ;;
esac
exec "$HOME/.local/bin/nhq-notify" reply "$em $name replied"
