-- This runs last in the setup process. Pure lua for anything that doesn't
-- fit the normal config locations above.

-- Fix Home / End under kitty + tmux.
-- The terminal delivers Home/End as the DEC "Find"/"Select" escape sequences,
-- which Neovim names <Find>/<Select> and does NOT treat as Home/End — so they
-- leak as literal text. Alias them in every mode (normal, visual/select,
-- insert, command, operator-pending) so Home/End behave everywhere.
local modes = { "n", "x", "s", "i", "c", "o" }
vim.keymap.set(modes, "<Find>", "<Home>", { desc = "Home (kitty/tmux Find alias)" })
vim.keymap.set(modes, "<Select>", "<End>", { desc = "End (kitty/tmux Select alias)" })
