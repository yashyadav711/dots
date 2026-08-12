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

-- `q` saves and quits; macro recording moves to `Q`.
--
-- Yash, 2026-08-13, after the omp Ctrl+E editor landed: "nvim m normal mode m q
-- dabane se save and quit hona chaiye", then "poore nvim m bhi chaiye".
--
-- Two things this must not break, both of which a bare `nnoremap q :x<CR>` does:
--
-- 1. MACROS. `q` is the record key. Losing it outright is a real cost for one
--    keystroke of convenience, so it moves to `Q` — which by default only
--    replays the last macro, the smaller loss of the two.
--
-- 2. SPECIAL WINDOWS. In help, quickfix, fugitive, Lazy, Mason and friends `q`
--    already means close, and those buffers have no file behind them: `:x`
--    there tries to WRITE and errors out. So the mapping is buffer-local and
--    only attaches where `buftype` is empty and the buffer is modifiable — a
--    real file. Everywhere else keeps whatever `q` the plugin gave it.
--
-- `:x` rather than `:wq` so an unchanged draft is not rewritten just to close it.
vim.api.nvim_create_autocmd("BufWinEnter", {
  desc = "q = save and quit in real file buffers (macro record moves to Q)",
  group = vim.api.nvim_create_augroup("nhq_q_quits", { clear = true }),
  callback = function(args)
    if vim.bo[args.buf].buftype ~= "" or not vim.bo[args.buf].modifiable then return end
    vim.keymap.set("n", "q", "<Cmd>x<CR>", { buffer = args.buf, desc = "Save and quit" })
    vim.keymap.set("n", "Q", "q", { buffer = args.buf, desc = "Record macro" })
  end,
})
