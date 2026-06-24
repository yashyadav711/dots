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
