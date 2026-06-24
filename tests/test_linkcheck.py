# ~/Github/dots/tests/test_linkcheck.py
import importlib.util, os, importlib.machinery
path = os.path.expanduser("~/Github/dots/bin/nhq-linkcheck")
loader = importlib.machinery.SourceFileLoader("nlc", path)
spec = importlib.util.spec_from_loader("nlc", loader)
nlc = importlib.util.module_from_spec(spec); spec.loader.exec_module(nlc)

def test_homepage_rejected_article_ok():
    ok_home, _ = nlc.is_homepage("https://www.bbc.com/")
    ok_art, _ = nlc.is_homepage("https://www.bbc.com/news/world-12345")
    proj, _ = nlc.is_homepage("https://selforg-npa.github.io/")
    assert ok_home is True and ok_art is False and proj is False  # project-page root is real content

def test_anchor_resolution():
    md = "## In this edition\n- [Around the World](#around-the-world)\n- [Dead](#nope)\n## Around the World\nx\n"
    broken = nlc.check_anchors(md)
    assert "#nope" in broken and "#around-the-world" not in broken

def test_dead_vs_blocked_classification(monkeypatch):
    # dead codes drop; bot-blocks/throttles are kept (live but unverifiable)
    codes = {"https://x/dead": (404, ""), "https://x/conn": (0, ""),
             "https://x/blocked": (403, ""), "https://x/throttled": (429, ""),
             "https://x/ok": (200, "text/html")}
    monkeypatch.setattr(nlc, "_head", lambda u: codes[u])
    assert nlc.check_url("https://x/dead")[0] is False
    assert nlc.check_url("https://x/conn")[0] is False
    assert nlc.check_url("https://x/blocked")[0] is True      # 403 kept
    assert nlc.check_url("https://x/throttled")[0] is True    # 429 kept
    assert nlc.check_url("https://x/ok")[0] is True

def test_image_classification(monkeypatch):
    codes = {"https://i/dead": (404, ""), "https://i/notimg": (200, "text/html"),
             "https://i/img": (200, "image/jpeg"), "https://i/blocked": (403, "")}
    monkeypatch.setattr(nlc, "_head", lambda u: codes[u])
    assert nlc.check_image("https://i/dead") is False
    assert nlc.check_image("https://i/notimg") is False       # reachable but not an image
    assert nlc.check_image("https://i/img") is True
    assert nlc.check_image("https://i/blocked") is True       # blocked → keep

def test_format_issues_catches_render_defects():
    bad = "## 🌍 THE WORLD\n\n**H**\nsummary\n![](https://x/a.jpg)\n↗ [source](https://x/1)\n"
    assert any("blank-separated" in x for x in nlc.format_issues(bad))   # run-on collapse
    bad2 = "<p>raw</p>\n\ngo https:&#x2F;&#x2F;x\n"
    iss = nlc.format_issues(bad2)
    assert any("raw HTML" in x for x in iss) and any("entity" in x for x in iss)
    good = "## 🌍 THE WORLD\n\n**H**\n\nsummary\n\n![](https://x/a.jpg)\n\n↗ [source](https://x/1)\n"
    assert nlc.format_issues(good) == []
