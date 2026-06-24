import importlib.util, os, json, tempfile
import importlib.machinery
loader = importlib.machinery.SourceFileLoader("ndl", os.path.expanduser("~/Github/dots/bin/nhq-daily-ledger"))
spec = importlib.util.spec_from_loader("ndl", loader)
ndl = importlib.util.module_from_spec(spec); spec.loader.exec_module(ndl)

def test_filter_and_append_roundtrip(tmp_path):
    led = str(tmp_path/"seen.json")
    a = {"section":"Top GitHub Repos","url":"https://github.com/x/y","headline":"x/y"}
    b = {"section":"Top GitHub Repos","url":"https://github.com/p/q","headline":"p/q"}
    assert ndl.filter_unseen([a,b], led) == [a,b]   # empty ledger -> all unseen
    ndl.append([a], led)
    assert ndl.filter_unseen([a,b], led) == [b]     # a now seen, dropped

def test_absorb_ticks(tmp_path):
    led = str(tmp_path/"seen.json")
    md = tmp_path/"ed.md"
    md.write_text("### Album X\n- [x] Already know this\n[listen](https://open.spotify.com/album/aaa)\n"
                  "### Album Y\n- [ ] Already know this\n[listen](https://open.spotify.com/album/bbb)\n")
    n = ndl.absorb_ticks(str(md), led)
    assert n == 1
    seen = json.load(open(led))
    assert any("aaa" in s for s in seen) and not any("bbb" in s for s in seen)

def test_title_dedup_across_sections(tmp_path):
    led = str(tmp_path/"seen.json")
    bbc = {"section":"Around the World","url":"https://bbc.com/iran-vote","headline":"US Senate approves Iran war powers resolution"}
    ajz = {"section":"Developing Today","url":"https://aljazeera.com/iran-vote","headline":"US Senate approves Iran war powers resolution: what it means"}
    out = ndl.filter_unseen([bbc, ajz], led)
    assert len(out) == 1   # same story, different outlet/section → deduped by title
