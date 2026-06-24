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