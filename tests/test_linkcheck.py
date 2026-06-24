# ~/Github/dots/tests/test_linkcheck.py
import importlib.util, os, importlib.machinery
path = os.path.expanduser("~/Github/dots/bin/nhq-linkcheck")
loader = importlib.machinery.SourceFileLoader("nlc", path)
spec = importlib.util.spec_from_loader("nlc", loader)
nlc = importlib.util.module_from_spec(spec); spec.loader.exec_module(nlc)

def test_homepage_rejected_article_ok():
    ok_home, _ = nlc.is_homepage("https://www.bbc.com/")
    ok_art, _ = nlc.is_homepage("https://www.bbc.com/news/world-12345")
    assert ok_home is True and ok_art is False   # bare root flagged, deep article fine

def test_anchor_resolution():
    md = "## In this edition\n- [Around the World](#around-the-world)\n- [Dead](#nope)\n## Around the World\nx\n"
    broken = nlc.check_anchors(md)
    assert "#nope" in broken and "#around-the-world" not in broken
