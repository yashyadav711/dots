-- AstroCommunity: language packs + quality-of-life modules.
-- Imported in `lazy_setup.lua` before the `plugins/` folder so specs resolve first.
-- Matched to Yash's stack (detected 2026-07-02): TS/JS, Python, Bash, Docker, Lua, +configs.

---@type LazySpec
return {
  "AstroNvim/astrocommunity",

  -- ── Languages (LSP + Treesitter + formatter/linter + debug where available) ──
  { import = "astrocommunity.pack.lua" },            -- nvim config itself
  { import = "astrocommunity.pack.typescript" },     -- TS/JS/JSX/TSX
  { import = "astrocommunity.pack.python.base" },        -- Python core (LSP + treesitter + debug)
  { import = "astrocommunity.pack.python.basedpyright" },-- type-checking LSP
  { import = "astrocommunity.pack.python.ruff" },        -- ruff: fast lint + format + import-sort
  { import = "astrocommunity.pack.bash" },           -- shell scripts
  { import = "astrocommunity.pack.docker" },         -- Dockerfile + compose
  { import = "astrocommunity.pack.html-css" },       -- web
  { import = "astrocommunity.pack.json" },           -- json/jsonc
  { import = "astrocommunity.pack.yaml" },           -- yaml
  { import = "astrocommunity.pack.markdown" },       -- markdown LSP (marksman) + treesitter
  { import = "astrocommunity.markdown-and-latex.render-markdown-nvim" }, -- in-buffer live preview (no browser)

  -- ── Quality-of-life ──
  { import = "astrocommunity.recipes.telescope-nvchad-theme" }, -- nicer picker
  { import = "astrocommunity.editing-support.nvim-treesitter-context" }, -- sticky scope header
}
