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

def test_title_dedup_reworded_across_outlets(tmp_path):
    led = str(tmp_path/"seen.json")
    # the REAL case: same story, differently worded by BBC vs Al Jazeera
    bbc = {"section":"Around the World","url":"https://bbc.com/a","headline":"Congress passes war powers measure for first time, breaking with Trump over Iran"}
    ajz = {"section":"Developing Today","url":"https://aljazeera.com/b","headline":"US Senate approves Iran war powers resolution: what that means for Trump"}
    m1  = {"section":"Around the World","url":"https://bbc.com/c","headline":"Clean sweep for Mamdani-backed candidates in New York's Democratic primary"}
    m2  = {"section":"Developing Today","url":"https://aljazeera.com/d","headline":"Mamdani-backed candidates defeat pro-Israel lawmakers in primaries"}
    distinct = {"section":"Developing Today","url":"https://x/e","headline":"North Korea commissions warship as Kim eyes nuclear navy"}
    out = ndl.filter_unseen([bbc, ajz, m1, m2, distinct], led)
    heads = [o["headline"][:10] for o in out]
    assert len(out) == 3   # Iran pair → 1, Mamdani pair → 1, NK distinct → 1
    assert any("North Korea" in o["headline"] for o in out)   # distinct story kept
