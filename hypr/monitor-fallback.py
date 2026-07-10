#!/usr/bin/env python3
"""Watches Hyprland's monitor topology and keeps it matching the last profile
the user chose via monitor-profile.sh.

Two things this recovers from, with one mechanism:
  1. The external monitor actually disconnects (power loss, cable pull) ->
     re-apply falls through to laptop-only (nothing is saved as "laptop-only"
     unless that really was the last profile, but reapply's default branch
     handles a missing/unreadable state file the same way).
  2. A plain `hyprctl reload` re-sources the static monitors.conf baseline,
     silently discarding whatever `hyprctl keyword monitor ...` positioning
     apply_dual_right/apply_dual_left/apply_mirror applied live. This isn't
     a disconnect, so a disconnect-only watcher misses it entirely.

Both cases share one observable: the monitor topology (which outputs exist,
their x position, disabled/mirror state) changes. So instead of tracking
"had an external monitor", this tracks a signature of the whole topology and
re-applies the last-saved profile whenever that signature changes. Re-running
the same profile the user just manually applied is a harmless no-op — cheap
enough at a monitor-hotplug event rate.
"""
import json
import subprocess
import time
from pathlib import Path

PROFILE_SCRIPT = str(Path.home() / ".config/hypr/monitor-profile.sh")


def topology_signature():
    out = subprocess.check_output(["hyprctl", "monitors", "all", "-j"], text=True)
    data = json.loads(out)
    return tuple(
        sorted(
            (m.get("name"), m.get("x"), m.get("disabled", False), m.get("mirrorOf", "none"))
            for m in data
        )
    )


def main() -> int:
    last_sig = None
    try:
        last_sig = topology_signature()
    except Exception:
        pass
    while True:
        time.sleep(2.0)
        try:
            sig = topology_signature()
        except Exception:
            continue
        if last_sig is not None and sig != last_sig:
            subprocess.run(
                [PROFILE_SCRIPT, "reapply"],
                stdout=subprocess.DEVNULL,
                stderr=subprocess.DEVNULL,
            )
            try:
                sig = topology_signature()
            except Exception:
                pass
        last_sig = sig


if __name__ == "__main__":
    raise SystemExit(main())
