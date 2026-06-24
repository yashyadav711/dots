import yaml, os
CFG = os.path.expanduser("~/.claude/skills/daily-news/config.yaml")

def test_config_well_formed():
    cfg = yaml.safe_load(open(CFG))
    assert cfg["thresholds"]["rating_min"] == 7
    assert isinstance(cfg["sources"], list) and len(cfg["sources"]) >= 15
    parts = {s["part"] for s in cfg["sources"]}
    assert {"world", "workshop", "lounge"} <= parts
    for s in cfg["sources"]:
        assert s["type"] in {"rss", "json", "firecrawl"}
        assert s["section"] and s["url"]
        assert {"title", "url"} <= set(s["fields"])  # every source maps title+url
    assert "{section_motif}" in cfg["image"]["template"]
    assert cfg["image"]["motifs"]  # per-section motifs exist
