#!/usr/bin/env bash
# ──────────────────────────────────────────────────────────────────────────────
# dots restore — yash's CachyOS/Arch + HyDE setup, reproducible from git.
#
# ORDER OF OPERATIONS on a fresh machine:
#   1. Install Arch/CachyOS + HyDE first (HyDE owns the base hypr/kitty/fish/waybar
#      configs; this repo only OVERLAYS your customizations on top).
#      HyDE: https://github.com/HyDE-Project/HyDE
#   2. git clone https://github.com/yashyadav711/dots ~/Github/dots
#   3. bash ~/Github/dots/install.sh
#   4. Do the MANUAL steps it prints at the end (secrets, BT brain, omf).
#
# Safe to re-run: existing real files are backed up to *.pre-dots.bak before linking.
# ──────────────────────────────────────────────────────────────────────────────
set -uo pipefail
DOTS="$(cd "$(dirname "$0")" && pwd)"

link() {  # link <repo-relative-src> <absolute-dest>
  local src="$DOTS/$1" dest="$2"
  [ -e "$src" ] || { echo "  skip (missing): $1"; return; }
  mkdir -p "$(dirname "$dest")"
  if [ -e "$dest" ] && [ ! -L "$dest" ]; then mv "$dest" "$dest.pre-dots.bak"; fi
  ln -sfn "$src" "$dest"
  echo "  linked: $dest"
}

echo "==> [1/4] Packages (native, AUR, flatpak)"
if command -v pacman >/dev/null;  then sudo pacman -S --needed - < "$DOTS/packages/pacman-native.txt" || true; fi
if command -v paru   >/dev/null && [ -s "$DOTS/packages/aur.txt" ];     then paru -S --needed - < "$DOTS/packages/aur.txt" || true; fi
if command -v flatpak >/dev/null && [ -s "$DOTS/packages/flatpak.txt" ]; then
  flatpak remote-add --user --if-not-exists flathub https://flathub.org/repo/flathub.flatpakrepo || true
  # shellcheck disable=SC2046
  flatpak install --user -y flathub $(cat "$DOTS/packages/flatpak.txt") || true
fi

echo "==> [2/4] Symlink configs"
link fish/config.fish                 "$HOME/.config/fish/config.fish"
for f in "$DOTS"/fish/functions/*.fish; do [ -e "$f" ] && link "fish/functions/$(basename "$f")" "$HOME/.config/fish/functions/$(basename "$f")"; done
for f in "$DOTS"/hypr/*;               do [ -e "$f" ] && link "hypr/$(basename "$f")"             "$HOME/.config/hypr/$(basename "$f")"; done
link kitty/kitty.conf                 "$HOME/.config/kitty/kitty.conf"

echo "==> [3/4] tmux (Oh My Tmux base + custom override)"
[ -d "$HOME/.tmux" ] || git clone --single-branch https://github.com/gpakosz/.tmux.git "$HOME/.tmux"
ln -sfn "$HOME/.tmux/.tmux.conf" "$HOME/.tmux.conf"
link tmux/.tmux.conf.local            "$HOME/.tmux.conf.local"
link bin/agyq           "$HOME/.local/bin/agyq"
link bin/agy-snapshot   "$HOME/.local/bin/agy-snapshot"
link bin/agy-usage      "$HOME/.local/bin/agy-usage"

# NHQ Fleet Kit + P4 safety + P5 econ/ctx — per-file symlinks into ~/.local/bin.
# NOTE: nhq-lib.sh, fleet-registry.json, p3-paths.json, routing-policy.json are NOT
# linked — the scripts resolve them as siblings in dots/bin via `readlink -f`, so
# they must stay beside the binaries.
for cmd in nhq-agent-name nhq-await nhq-blocked nhq-cost nhq-done nhq-fleet \
           nhq-fleet-selftest nhq-kill nhq-meta nhq-notify nhq-reap nhq-spawn \
           nhq-status nhq-tell nhq-warden \
           nhq-audit nhq-audit-verify nhq-ctx nhq-econ nhq-handoff nhq-p3-guard \
           mcp-write-guard; do
  link "bin/$cmd" "$HOME/.local/bin/$cmd"
done


echo "==> [4/4] System config (apply manually with sudo or per-user as noted)"
echo "  earlyoom (anti-freeze OOM daemon):  sudo cp $DOTS/system/earlyoom.conf /etc/default/earlyoom && sudo systemctl enable --now earlyoom"
echo "  faillock (looser sudo lockout):     sudo install -m644 $DOTS/system/faillock.conf /etc/security/faillock.conf"
echo "  no-suspend-on-lid:                  sudo install -Dm644 $DOTS/system/logind-lid.conf /etc/systemd/logind.conf.d/10-lid.conf && sudo systemctl reload systemd-logind"
echo "  pi-antigravity-rotator (user svc):  ln -sfn $DOTS/system/pi-antigravity-rotator.service ~/.config/systemd/user/pi-antigravity-rotator.service && systemctl --user enable pi-antigravity-rotator"
echo "  agy-usage-snapshot (quota timer):   ln -sfn $DOTS/system/agy-usage-snapshot.service ~/.config/systemd/user/ && ln -sfn $DOTS/system/agy-usage-snapshot.timer ~/.config/systemd/user/ && systemctl --user daemon-reload && systemctl --user enable --now agy-usage-snapshot.timer"

cat <<'NOTE'

──────────────── MANUAL STEPS (not automated) ────────────────
  • HyDE must already be installed (this overlays it).
  • Oh My Fish (fish plugins):   curl https://raw.githubusercontent.com/oh-my-fish/oh-my-fish/master/bin/install | fish
  • Secrets — recreate, NOT in this public repo:
        ~/.config/fish/private.fish   (API keys; auto-sourced by config.fish)
  • BT brain (PRIVATE repo):
        git clone git@github.com:yashyadav711/home-bt ~/Github/home-bt
        ln -s ~/Github/home-bt/CLAUDE.md ~/CLAUDE.md
        mkdir -p ~/.claude && ln -s ~/Github/home-bt/store ~/.claude/bt
  • AppImages (~/Applications/): see packages/appimage.txt — download each and chmod +x.
        Desktop entries live in dots/appimage/ — link: ln -sfn $DOTS/appimage/kun.desktop ~/.local/share/applications/kun.desktop
  • Log out / reboot to apply Hyprland + shell changes.
───────────────────────────────────────────────────────────────
NOTE
echo "Done."
