-- AstroUI — theme. Base = astrodark (complete), with NHQ "Warline" accents layered
-- on top via highlights.init (applies over any colorscheme). Palette from vault
-- Design/NHQ Color Palette: red · warm-black · gold · olive. No blue, no neon.

local nhq = {
  ink = "#14130F", carbon = "#1E1D17", slate = "#2A2820", char = "#3B392F",
  ash = "#8C887E", stone = "#BDB8AC", bone = "#ECE7DA",
  red = "#C8102E", red_bright = "#E22740", ember = "#8A0F1E",
  gold = "#F2B705", gold_bright = "#FFC836", olive = "#7C873E",
  olive_bright = "#98A451", rust = "#C75B39", plum = "#8C5B7A",
}

---@type LazySpec
return {
  "AstroNvim/astroui",
  ---@type AstroUIOpts
  opts = {
    colorscheme = "astrodark",
    highlights = {
      init = {
        -- UI chrome
        CursorLineNr = { fg = nhq.gold, bold = true },
        Visual       = { fg = nhq.bone, bg = nhq.ember },
        Search       = { fg = nhq.ink, bg = nhq.gold },
        IncSearch    = { fg = nhq.bone, bg = nhq.red_bright },
        MatchParen   = { fg = nhq.gold_bright, bg = nhq.char, bold = true },
        PmenuSel     = { fg = nhq.ink, bg = nhq.gold, bold = true },
        -- classic syntax groups
        Comment      = { fg = nhq.ash, italic = true },
        String       = { fg = nhq.olive_bright },
        Constant     = { fg = nhq.gold },
        Number       = { fg = nhq.gold },
        Boolean      = { fg = nhq.gold },
        Function     = { fg = nhq.gold_bright },
        Identifier   = { fg = nhq.stone },
        Statement    = { fg = nhq.red_bright, bold = true },
        Conditional  = { fg = nhq.red_bright, bold = true },
        Repeat       = { fg = nhq.red_bright, bold = true },
        Keyword      = { fg = nhq.red_bright, bold = true },
        Operator     = { fg = nhq.stone },
        Type         = { fg = nhq.olive },
        Special      = { fg = nhq.plum },
        Title        = { fg = nhq.red, bold = true },
        -- treesitter groups (the ones that actually drive modern highlighting)
        ["@keyword"]        = { fg = nhq.red_bright, bold = true },
        ["@conditional"]    = { fg = nhq.red_bright, bold = true },
        ["@repeat"]         = { fg = nhq.red_bright, bold = true },
        ["@string"]         = { fg = nhq.olive_bright },
        ["@function"]       = { fg = nhq.gold_bright },
        ["@function.call"]  = { fg = nhq.gold_bright },
        ["@function.builtin"] = { fg = nhq.gold_bright },
        ["@type"]           = { fg = nhq.olive },
        ["@type.builtin"]   = { fg = nhq.olive },
        ["@number"]         = { fg = nhq.gold },
        ["@boolean"]        = { fg = nhq.gold },
        ["@constant"]       = { fg = nhq.gold },
        ["@comment"]        = { fg = nhq.ash, italic = true },
        ["@variable"]       = { fg = nhq.stone },
        ["@property"]       = { fg = nhq.stone },
        ["@punctuation.bracket"] = { fg = nhq.ash },
        ["@operator"]       = { fg = nhq.stone },
        -- markdown
        ["@markup.heading"] = { fg = nhq.red, bold = true },
        ["@markup.link"]    = { fg = nhq.gold_bright },
        ["@markup.link.url"] = { fg = nhq.olive, underline = true },
        ["@markup.raw"]     = { fg = nhq.gold },
        ["@markup.list"]    = { fg = nhq.red, bold = true },
        -- diagnostics / git (NHQ semantics: red danger, gold warn, olive ok)
        DiagnosticError = { fg = nhq.red },
        DiagnosticWarn  = { fg = nhq.gold },
        DiagnosticHint  = { fg = nhq.olive },
        DiagnosticInfo  = { fg = nhq.stone },
        GitSignsAdd     = { fg = nhq.olive },
        GitSignsChange  = { fg = nhq.gold },
        GitSignsDelete  = { fg = nhq.red },
      },
    },
    icons = {
      LSPLoading1 = "⠋", LSPLoading2 = "⠙", LSPLoading3 = "⠹", LSPLoading4 = "⠸",
      LSPLoading5 = "⠼", LSPLoading6 = "⠴", LSPLoading7 = "⠦", LSPLoading8 = "⠧",
      LSPLoading9 = "⠇", LSPLoading10 = "⠏",
    },
  },
}
