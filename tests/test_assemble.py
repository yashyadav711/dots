# ~/Github/dots/tests/test_assemble.py
import importlib.util, importlib.machinery, os
loader = importlib.machinery.SourceFileLoader("nda", os.path.expanduser("~/Github/dots/bin/nhq-daily-assemble"))
spec = importlib.util.spec_from_loader("nda", loader)
nda = importlib.util.module_from_spec(spec); spec.loader.exec_module(nda)

CFG = {"sources":[{"section":"Around the World","part":"world"},{"section":"Movie of the Day","part":"lounge"}]}

def test_assemble_structure_and_rules():
    items = [
        {"section":"Around the World","part":"world","headline":"Big news","summary":"s","url":"https://bbc.com/news/1","image":"https://x/a.jpg","rating":None},
        {"section":"Movie of the Day","part":"lounge","headline":"Film","summary":"why worth it","url":"https://t/movie/1","image":"https://x/p.jpg","rating":8.2},
    ]
    md = nda.assemble(items, "2026-06-25", CFG)
    assert "## 🌍 THE WORLD" in md or "THE WORLD" in md
    assert "**Big news**" in md and "![](https://x/a.jpg)" in md          # photo present
    assert "8.2" in md and "- [ ] Already know this" in md                 # rating + tick on lounge
    assert "(#around-the-world)" in md and "(#movie-of-the-day)" in md     # index anchors match slugs
    assert md.count("- [ ] Already know this") == 1                        # only lounge gets it
    assert "![hero](_covers/2026-06-25-cover.png)" in md                   # hero cover emitted
    assert md.index("![hero]") < md.index("TL;DR")                        # hero above the fold

def test_blocks_blank_line_separated():
    items = [{"section":"Around the World","part":"world","headline":"Big news","summary":"s","url":"https://bbc.com/news/1","image":"https://x/a.jpg","rating":None}]
    md = nda.assemble(items, "2026-06-25", CFG)
    assert "\n\n![](https://x/a.jpg)\n\n" in md        # image is its own block (blank lines around)
    assert "**Big news**\n\ns\n\n" in md               # headline / summary separated by blank line
    assert "\n\n↗ [source](https://bbc.com/news/1)" in md
