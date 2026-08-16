# omp — always start omp inside tmux.
#
# omp on its own owns the whole terminal and cannot put anything beside itself.
# Two things Yash asked for need something that can split the screen:
#
#   Ctrl+Up  scroll back to the previous message  (built 2026-08-11)
#   Ctrl+E   open the draft in nvim beside the input box  (2026-08-13)
#
# Neither is omp's to give — the thing that owns the viewport has to do it, and
# in Orca's terminal that can only be tmux. `ompt` is the wrapper; this function
# just means you never have to remember to type it. It is a no-op passthrough
# when $TMUX is already set, so nesting is not a risk — and, since 2026-08-17,
# also for subcommands like `omp usage`, which used to print into a tmux pane
# that closed the instant they finished.
#
# Escape hatch: `command omp` runs the bare binary with no tmux at all.
function omp --description 'omp inside tmux (Ctrl+Up scrollback, Ctrl+E split editor)'
    ompt $argv
end
