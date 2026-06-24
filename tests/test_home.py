import os, types, importlib.machinery

loader = importlib.machinery.SourceFileLoader("ndh", os.path.expanduser("~/Github/dots/bin/nhq-daily-home"))
ndh = types.ModuleType("ndh")
loader.exec_module(ndh)

def test_block_replaced_in_place(tmp_path):
    home = tmp_path/"Home.md"
    home.write_text("# Home\n<!-- DAILY:START -->\nold\n<!-- DAILY:END -->\n<!-- DOC-INDEX -->\nkeep\n")
    blk = ndh.render_block("2026-06-25","c.png",[{"headline":"H","url":"https://x/1"}])
    ndh.update_home(str(home), blk)
    out = home.read_text()
    assert "old" not in out and "2026-06-25" in out and "keep" in out  # block swapped, rest intact
    assert out.count("<!-- DAILY:START -->") == 1

def test_no_markers_inserts_after_frontmatter(tmp_path):
    home = tmp_path/"Home.md"
    home.write_text("---\ntitle: Home\n---\n\n# Welcome\nbody\n")
    blk = ndh.render_block("2026-06-25","c.png",[{"headline":"H","url":"https://x/1"}])
    ndh.update_home(str(home), blk)
    out = home.read_text()
    assert out.startswith("---\ntitle: Home\n---")          # frontmatter stays at top
    assert out.index("title: Home") < out.index("DAILY:START")  # block is BELOW frontmatter
    assert "# Welcome" in out and out.count("DAILY:START") == 1
