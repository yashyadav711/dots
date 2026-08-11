#!/usr/bin/env bash
set -euo pipefail

LAPTOP_MONITOR=${LAPTOP_MONITOR:-eDP-1}

# `hyprctl keyword monitor ...` is EPHEMERAL — a plain `hyprctl reload` re-runs
# the static monitors.conf (laptop-only baseline) and silently wipes any
# dual-right/dual-left/mirror positioning that was only ever applied live.
# Track the last chosen profile so the fallback watcher can re-apply it after
# a reload, not just after a real monitor disconnect.
PROFILE_STATE_FILE="${XDG_CACHE_HOME:-$HOME/.cache}/hypr-monitor-profile"

save_profile() {
  mkdir -p "$(dirname "$PROFILE_STATE_FILE")"
  printf '%s' "$1" > "$PROFILE_STATE_FILE"
}

last_profile() {
  cat "$PROFILE_STATE_FILE" 2>/dev/null || echo "laptop-only"
}

monitors_json() {
  hyprctl monitors all -j
}

first_external_any() {
  monitors_json | jq -r --arg lp "$LAPTOP_MONITOR" 'first(.[] | select(.name != $lp)) | .name // empty'
}

laptop_width() {
  monitors_json | jq -r --arg lp "$LAPTOP_MONITOR" 'first(.[] | select(.name == $lp)) | .width // 1920'
}

# highest-resolution, then highest-refresh-rate mode for a monitor. Hyprland's
# "preferred" keyword resolves to the EDID-preferred mode, which is almost
# always the safe 60Hz option, NOT the panel's max refresh rate.
best_mode() {
  local mon="$1" json
  json=$(monitors_json)
  python3 -c '
import json, sys
mon = sys.argv[1]
data = json.loads(sys.argv[2])
m = next((x for x in data if x["name"] == mon), None)
modes = m.get("availableModes", []) if m else []


def key(s):
    res, hz = s.split("@")
    w, h = res.split("x")
    return (int(w) * int(h), float(hz.rstrip("Hz")))


if modes:
    print(max(modes, key=key))
' "$mon" "$json"
}

# swww doesn't reliably propagate an already-set wallpaper to outputs that
# appear later — a newly enabled monitor shows a solid black fallback until
# told. Push the current image to EVERY enabled monitor (not just ones swww
# reports on the "color:" fallback — a freshly re-registered output may be
# missing from `swww query` entirely).
sync_wallpaper() {
  command -v swww >/dev/null 2>&1 || return 0
  local ref_img="" line mon
  while IFS= read -r line; do
    [[ "$line" == *"currently displaying: image:"* ]] && ref_img="${line##*image: }"
  done < <(swww query 2>/dev/null)
  [[ -z "$ref_img" ]] && return 0
  while IFS= read -r mon; do
    [[ -n "$mon" ]] || continue
    swww img "$ref_img" -o "$mon" >/dev/null 2>&1 || true
  done < <(monitors_json | jq -r '.[] | select(.disabled == false) | .name')
}

rehome_workspaces_to_laptop() {
  hyprctl workspaces -j | jq -r --arg lp "$LAPTOP_MONITOR" '.[] | select(.id > 0 and .monitor != $lp) | .id' |
  while read -r ws; do
    [[ -n "$ws" ]] || continue
    hyprctl dispatch moveworkspacetomonitor "$ws $LAPTOP_MONITOR" >/dev/null
  done
}

apply_laptop_only() {
  rehome_workspaces_to_laptop
  monitors_json | jq -r --arg lp "$LAPTOP_MONITOR" '.[] | select(.name != $lp) | .name' |
  while read -r mon; do
    [[ -n "$mon" ]] || continue
    hyprctl keyword monitor "$mon,disable" >/dev/null
  done
  hyprctl keyword monitor "$LAPTOP_MONITOR,preferred,0x0,1" >/dev/null
  hyprctl dispatch focusmonitor "$LAPTOP_MONITOR" >/dev/null
  save_profile "laptop-only"
}

# Poll until a monitor reports enabled. A cold external (coming up from a
# disabled state) takes ~1-2s to finish link-training before Hyprland flips
# disabled=false; a fixed sleep races that and swww/focus then skip the output.
wait_enabled() {
  local mon="$1" i
  for i in $(seq 1 30); do
    [[ "$(monitors_json | jq -r --arg m "$mon" 'first(.[]|select(.name==$m))|.disabled')" == "false" ]] && return 0
    sleep 0.2
  done
  return 0
}

apply_dual() {  # $1 = right|left — which side the external monitor sits on
  local side="$1" ext width mode ext_width ext_x
  ext=$(first_external_any)
  [[ -n "$ext" ]] || { echo "No external monitor detected." >&2; exit 1; }
  width=$(laptop_width)
  mode=$(best_mode "$ext")
  [[ -z "$mode" ]] && mode="preferred"
  ext_width="${mode%%x*}"
  [[ "$ext_width" =~ ^[0-9]+$ ]] || ext_width=1920
  case "$side" in
    right) ext_x=$width ;;
    left)  ext_x=$(( -ext_width )) ;;
    *) echo "apply_dual: side must be right|left" >&2; exit 2 ;;
  esac
  hyprctl keyword monitor "$LAPTOP_MONITOR,preferred,0x0,1" >/dev/null
  # A live mode/position change on an already-enabled external can leave the
  # output present in `hyprctl monitors` yet invisible to Wayland clients
  # (swww/grim see nothing, panel stays black). Force a disable -> settle ->
  # enable cycle so the compositor tears down and re-advertises a fresh
  # wl_output that clients actually bind to.
  hyprctl keyword monitor "$ext,disable" >/dev/null
  sleep 1
  hyprctl keyword monitor "$ext,$mode,${ext_x}x0,1" >/dev/null
  wait_enabled "$ext"
  hyprctl dispatch focusmonitor "$LAPTOP_MONITOR" >/dev/null
  sync_wallpaper
  save_profile "dual-$side"
}

apply_dual_right() { apply_dual right; }
apply_dual_left()  { apply_dual left; }

apply_mirror() {
  local ext mode
  ext=$(first_external_any)
  [[ -n "$ext" ]] || { echo "No external monitor detected." >&2; exit 1; }
  mode=$(best_mode "$ext")
  [[ -z "$mode" ]] && mode="preferred"
  hyprctl keyword monitor "$LAPTOP_MONITOR,preferred,0x0,1" >/dev/null
  hyprctl keyword monitor "$ext,$mode,auto,1,mirror,$LAPTOP_MONITOR" >/dev/null
  hyprctl dispatch focusmonitor "$LAPTOP_MONITOR" >/dev/null
  sync_wallpaper
  save_profile "mirror"
}

# "right"/"left" mean spatially right/left of the CURRENTLY FOCUSED monitor,
# by actual x-coordinate — NOT "external vs laptop". Hardcoding external=right
# breaks the instant you run dual-left (external sits to the left), which is
# exactly what happened: focus-right was sending you to the external monitor
# even when it was the one on your left.
monitor_names_by_x() {  # enabled monitors, left-to-right
  monitors_json | python3 -c '
import json, sys
data = json.load(sys.stdin)
mons = sorted((m for m in data if not m.get("disabled")), key=lambda m: m["x"])
for m in mons:
    print(m["name"])
'
}

focused_monitor_name() {
  monitors_json | python3 -c '
import json, sys
data = json.load(sys.stdin)
m = next((x for x in data if x.get("focused")), None)
print(m["name"] if m else "")
'
}

# $1 = right|left -> prints the monitor spatially adjacent to the focused one
# (clamps at the edge instead of wrapping, so "right" at the rightmost
# monitor is a no-op, not a jump back to the far left).
spatial_target() {
  local dir="$1" cur idx=-1 i
  local -a names
  mapfile -t names < <(monitor_names_by_x)
  cur=$(focused_monitor_name)
  for i in "${!names[@]}"; do
    [[ "${names[$i]}" == "$cur" ]] && idx=$i && break
  done
  ((idx < 0)) && idx=0
  if [[ "$dir" == "right" ]]; then
    if ((idx + 1 < ${#names[@]})); then printf '%s' "${names[$((idx + 1))]}"; else printf '%s' "${names[$idx]}"; fi
  else
    if ((idx - 1 >= 0)); then printf '%s' "${names[$((idx - 1))]}"; else printf '%s' "${names[$idx]}"; fi
  fi
}

focus_right() { hyprctl dispatch focusmonitor "$(spatial_target right)" >/dev/null; }
focus_left()  { hyprctl dispatch focusmonitor "$(spatial_target left)" >/dev/null; }

move_workspace_right() {
  local t
  t=$(spatial_target right)
  hyprctl dispatch movecurrentworkspacetomonitor "$t" >/dev/null
  hyprctl dispatch focusmonitor "$t" >/dev/null
}

move_workspace_left() {
  local t
  t=$(spatial_target left)
  hyprctl dispatch movecurrentworkspacetomonitor "$t" >/dev/null
  hyprctl dispatch focusmonitor "$t" >/dev/null
}

move_window_right() {
  hyprctl dispatch movewindow "mon:$(spatial_target right)" >/dev/null
}

move_window_left() {
  hyprctl dispatch movewindow "mon:$(spatial_target left)" >/dev/null
}

status() {
  monitors_json | jq -r --arg lp "$LAPTOP_MONITOR" '
    .[] | "\(.name)\tdisabled=\(.disabled)\tfocused=\(.focused)\tx=\(.x)\ty=\(.y)\tmirrorOf=\(.mirrorOf)"'
}

# Re-apply whatever profile was last chosen. Used by the fallback watcher
# after a `hyprctl reload` silently reset live monitor positioning back to
# the static baseline. Safe no-op-ish when no external monitor is present
# (falls through to laptop-only, which is already the reload baseline).
reapply() {
  local p
  p=$(last_profile)
  case "$p" in
    dual-right) apply_dual_right 2>/dev/null || true ;;
    dual-left)  apply_dual_left 2>/dev/null || true ;;
    mirror)     apply_mirror 2>/dev/null || true ;;
    *)          apply_laptop_only ;;
  esac
}

# One-key toggle for the F4 monitor key: if an external monitor is currently
# ENABLED, collapse to laptop-only; otherwise bring the external up in the
# correct dual layout (external on the LEFT, per monitors.conf).
toggle() {
  local ext_on
  ext_on=$(monitors_json | jq -r --arg lp "$LAPTOP_MONITOR" \
    'first(.[] | select(.name != $lp and .disabled == false)) | .name // empty')
  if [[ -n "$ext_on" ]]; then
    apply_laptop_only
  else
    apply_dual_left
  fi
}

cmd=${1:-status}
case "$cmd" in
  laptop-only) apply_laptop_only ;;
  dual-right)  apply_dual_right ;;
  dual-left)   apply_dual_left ;;
  mirror)      apply_mirror ;;
  toggle)      toggle ;;
  reapply)     reapply ;;
  focus-right) focus_right ;;
  focus-left)  focus_left ;;
  move-right)  move_workspace_right ;;
  move-left)   move_workspace_left ;;
  window-right) move_window_right ;;
  window-left)  move_window_left ;;
  status)      status ;;
  *)
    echo "Usage: $0 {laptop-only|dual-right|dual-left|mirror|toggle|reapply|focus-right|focus-left|move-right|move-left|window-right|window-left|status}" >&2
    exit 2
    ;;
esac
