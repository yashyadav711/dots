import importlib.util, os, json
import importlib.machinery
loader = importlib.machinery.SourceFileLoader("ndf", os.path.expanduser("~/Github/dots/bin/nhq-daily-fetch"))
spec = importlib.util.spec_from_loader(loader.name, loader)
ndf = importlib.util.module_from_spec(spec); spec.loader.exec_module(ndf)
FX = os.path.expanduser("~/Github/dots/tests/fixtures")

def test_json_adapter_maps_and_filters_rating():
    entry = {"section":"Movie of the Day","part":"lounge","type":"json","count":2,
             "rating_field":"vote_average",
             "url":"file://"+FX+"/json_sample.json",
             "fields":{"root":"results","title":"title","url":"id|https://x/movie/{}",
                       "image":"poster_path|https://img{}","summary":"overview","rating":"vote_average"}}
    items = ndf.fetch_source(entry, rating_min=7)
    assert all(i["rating"] >= 7 for i in items)          # ≥7 filter applied
    assert items[0]["url"].startswith("https://x/movie/")  # template substitution
    assert items[0]["headline"] and items[0]["image"]

def test_rss_adapter_maps_fields():
    entry = {"section":"Around the World","part":"world","type":"rss","count":3,
             "url":"file://"+FX+"/rss_sample.xml",
             "fields":{"title":"title","url":"link","summary":"summary"}}
    items = ndf.fetch_source(entry, rating_min=7)
    assert len(items) <= 3 and items[0]["url"].startswith("http")
    assert items[0]["section"] == "Around the World"

def test_fetch_all_skips_failing_source():
    good = {"section":"Around the World","part":"world","type":"rss","count":2,
            "url":"file://"+FX+"/rss_sample.xml","fields":{"title":"title","url":"link"}}
    bad = {"section":"Dead API","part":"world","type":"json","count":1,
           "url":"https://127.0.0.1:1/nope.json","fields":{"root":"x","title":"t","url":"u"}}
    items = ndf.fetch_all([good, bad], 7)   # must not raise
    assert len(items) >= 1 and all(i["section"] == "Around the World" for i in items)

def test_clean_strips_html_entities_boilerplate():
    assert ndf._clean("<p>Hello <a href='x'>world</a></p>") == "Hello world"
    assert ndf._clean("go to https:&#x2F;&#x2F;x.com&#x2F;a now") == "go to https://x.com/a now"
    assert ndf._clean("arXiv:2606.123 Announce Type: new Abstract: Real text") == "Real text"
    assert ndf._clean("&lt;p&gt;escaped&lt;/p&gt;") == "escaped"