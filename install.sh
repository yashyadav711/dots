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
link fish/alias.fish                  "$HOME/.config/fish/conf.d/alias.fish"
for f in "$DOTS"/fish/functions/*.fish; do [ -e "$f" ] && link "fish/functions/$(basename "$f")" "$HOME/.config/fish/functions/$(basename "$f")"; done
for f in "$DOTS"/hypr/*;               do [ -e "$f" ] && link "hypr/$(basename "$f")"             "$HOME/.config/hypr/$(basename "$f")"; done
link gtk-3.0/settings.ini               "$HOME/.config/gtk-3.0/settings.ini"
link kitty/kitty.conf                 "$HOME/.config/kitty/kitty.conf"
# The notification chime. dunst.conf points its [notify-sound] rule at the
# script; the script and the re-cut wav both live here so a rebuilt machine does
# not go back to the clipped, aplay-at-full-hardware-volume original.
link dunst/notify-sound.sh              "$HOME/.config/dunst/notify-sound.sh"
link dunst/service-login.wav            "$HOME/.config/dunst/service-login.wav"
link vim/vimrc                        "$HOME/.vimrc"
link nvim                             "$HOME/.config/nvim"   # AstroNvim (full IDE); vim/vi stay minimal
link rofi/spotlight.rasi                "$HOME/.config/rofi/spotlight.rasi"
link yazi/theme.toml                    "$HOME/.config/yazi/theme.toml"
link yazi/yazi.toml                     "$HOME/.config/yazi/yazi.toml"
link yazi/package.toml                  "$HOME/.config/yazi/package.toml"  # then run: ya pkg install  (restores flavors)

# vox — system-wide voice typing. Source and config only; the venv (125 MB) and
# the whisper/silero models (55 MB) stay out of the repo and are rebuilt on a
# new machine. Untracked until 2026-08-13, which meant 1373 lines of voxd.py —
# and weeks of measured tuning written into its comments — existed on exactly
# one laptop.
# NO DENOISER. An rnnoise filter-chain and a gain unit sat here for one day —
# 2026-08-13 — because an hour of whisper benchmarking spun the fan up and the
# room floor rose until every session ended "abort: no speech". rnnoise fixed
# that number and broke the thing the number was for: at 10 cm and normal speed
# the transcript came back mangled, and only slowed-down, one-word-a-second
# speech got through. Yash: "you should remove it entirely. It is interfering
# with the mic."
#
# Measured after removal: the raw mic idles at -58.7 dBFS and steady, against
# the rnnoise chain's bursty -42 with the fan running. It was never the room
# that needed fixing; it was a laptop I had made hot.
mkdir -p "$HOME/.config/systemd/user"

mkdir -p "$HOME/.local/share/vox" "$HOME/.config/vox"
link vox/voxd.py                        "$HOME/.local/share/vox/voxd.py"
link vox/voxbar.py                      "$HOME/.local/share/vox/voxbar.py"
link vox/selftest.py                    "$HOME/.local/share/vox/selftest.py"
# The `vox` command itself. It lived only in ~/.local/bin until 2026-08-13,
# which is the same story as voxd.py: the thing you actually type existed on
# one laptop and no rebuild would have brought it back.
link vox/vox                            "$HOME/.local/bin/vox"
link vox/config.toml                    "$HOME/.config/vox/config.toml"
link vox/vocabulary.toml                "$HOME/.config/vox/vocabulary.toml"

echo "==> [3/4] tmux (Oh My Tmux base + custom override)"
[ -d "$HOME/.tmux" ] || git clone --single-branch https://github.com/gpakosz/.tmux.git "$HOME/.tmux"
ln -sfn "$HOME/.tmux/.tmux.conf" "$HOME/.tmux.conf"
link tmux/tmux.conf.local             "$HOME/.tmux.conf.local"   # NOT .tmux.conf.local — the dotted copy was stale and unlinked (removed 2026-08-13)
link bin/agyq           "$HOME/.local/bin/agyq"
link bin/agy-snapshot   "$HOME/.local/bin/agy-snapshot"
link bin/agy-usage      "$HOME/.local/bin/agy-usage"
# ompt — omp wrapped in tmux. The fish `omp` function calls it, and it is what
# makes Ctrl+Up scrollback and the Ctrl+E split editor possible at all: omp owns
# its terminal and cannot put anything beside itself, so the multiplexer has to.
link bin/ompt           "$HOME/.local/bin/ompt"

# NHQ Fleet Kit + P4 safety + P5 econ/ctx — per-file symlinks into ~/.local/bin.
#
# GLOB, not a hand-kept list (fixed 2026-08-11). This used to be a hardcoded
# `for cmd in nhq nhq-agent-name ...` allowlist, so every tool added to dots/bin
# was silently never installed. `nhq-agent-alive` — the tool the subagent-stall
# playbook tells you to run — sat unlinked for a day and `command not found`
# during a live overnight run, while docs and a session handoff both cited it.
# A new tool in dots/bin is now installed by existing, not by remembering.
#
# EXCLUDED, deliberately:
#   *.sh / *.yml / *.json / *.jsonl / *.md — libs + data. nhq-lib.sh and the
#     registries are resolved as siblings in dots/bin via `readlink -f`, so they
#     must stay beside the binaries and must NOT be linked.
#   nhq-heydaddy-deploy, nhq-heydaddy-probe — dispatchers that picks its behaviour from argv[0].
#     It is installed under its four face names (dev/prod × be/fe), which are
#     symlinks to it inside dots/bin and are matched by the glob. Linking the
#     dispatcher under its own name would give it no face to dispatch to.
# GLOB IS `nhq*`, NOT `nhq-*`: the bare `nhq` entrypoint has no hyphen, so the
# hyphenated glob skipped it entirely. It survived on this laptop only because it
# was hand-linked on 3 Jul, before this loop existed — a fresh rebuild from this
# repo would have come up without the main command. Found provisioning rig.
for path in "$DOTS"/bin/nhq*; do
  cmd=$(basename "$path")
  case "$cmd" in
    *.sh|*.yml|*.json|*.jsonl|*.md) continue ;;
    nhq-heydaddy-deploy|nhq-heydaddy-probe) continue ;;
  esac
  [ -x "$path" ] || continue
  link "bin/$cmd" "$HOME/.local/bin/$cmd"
done
link bin/mcp-write-guard "$HOME/.local/bin/mcp-write-guard"

# Generated faces, then the name guard.
#
# nhq-gen reads bin/nhq-commands.yml and creates every `nhq-<project>-<env>[-<side>]-<action>`
# symlink the manifest declares — the fully-qualified names Yash navigates by tab
# (2026-08-12). They are generated rather than hand-written because the grid is
# combinatorial (envs × sides × actions) and hand-maintaining it is exactly what
# let three prefixes appear for HeyDaddy between 15 Jul and 1 Aug.
#
# nhq-lint then refuses names the manifest cannot explain. It runs HERE, at
# install, for the same reason the loop above became a glob: the rule was never
# the problem, nothing checking it was. It prints and does not abort — a naming
# complaint must not stop a machine being rebuilt — but it is loud, and errors
# are only ever things provably broken, never style opinions.
"$DOTS"/bin/nhq-gen --apply
"$DOTS"/bin/nhq-lint --quiet || echo "  ^ naming errors above — fix them before they spread"


echo "==> [4/4] System config (apply manually with sudo or per-user as noted)"
echo "  earlyoom (anti-freeze OOM daemon):  sudo cp $DOTS/system/earlyoom.conf /etc/default/earlyoom && sudo systemctl enable --now earlyoom"
echo "  faillock (looser sudo lockout):     sudo install -m644 $DOTS/system/faillock.conf /etc/security/faillock.conf"
echo "  no-suspend-on-lid:                  sudo install -Dm644 $DOTS/system/logind-lid.conf /etc/systemd/logind.conf.d/10-lid.conf && sudo systemctl reload systemd-logind"
echo "  pi-antigravity-rotator (user svc):  ln -sfn $DOTS/system/pi-antigravity-rotator.service ~/.config/systemd/user/pi-antigravity-rotator.service && systemctl --user enable pi-antigravity-rotator"
echo "  agy-usage-snapshot (quota timer):   ln -sfn $DOTS/system/agy-usage-snapshot.service ~/.config/systemd/user/ && ln -sfn $DOTS/system/agy-usage-snapshot.timer ~/.config/systemd/user/ && systemctl --user daemon-reload && systemctl --user enable --now agy-usage-snapshot.timer"
echo "  nhq-msg-pull (fleet mail, DIRECTOR BOX ONLY):"
echo "                                      ln -sfn $DOTS/system/nhq-msg-pull.service ~/.config/systemd/user/ && ln -sfn $DOTS/system/nhq-msg-pull.timer ~/.config/systemd/user/ && systemctl --user daemon-reload && systemctl --user enable --now nhq-msg-pull.timer"
echo "                                      (fleet boxes cannot ssh back here, so mail addressed to Director only arrives when this box collects it)"

cat <<'NOTE'

──────────────── MANUAL STEPS (not automated) ────────────────
  • HyDE must already be installed (this overlays it).
  • Oh My Fish (fish plugins):   curl https://raw.githubusercontent.com/oh-my-fish/oh-my-fish/master/bin/install | fish
  • Secrets — recreate, NOT in this public repo:
        ~/.config/fish/private.fish   (API keys; auto-sourced by config.fish)
  • BT brain (PRIVATE repo):
        git clone git@github.com:yashyadav711/envy ~/Github/nHQ/envy
        ln -s ~/Github/nHQ/envy/CLAUDE.md ~/CLAUDE.md
        mkdir -p ~/.claude && ln -sfn ~/Github/nHQ/envy/store ~/.claude/envy
  • AppImages (~/Applications/): see packages/appimage.txt — download each and chmod +x.
        Desktop entries live in dots/appimage/ — link: ln -sfn $DOTS/appimage/kun.desktop ~/.local/share/applications/kun.desktop
  • Log out / reboot to apply Hyprland + shell changes.
───────────────────────────────────────────────────────────────
NOTE
echo "Done."
