"""
Citation Gap Analysis - "Where should we get listed?"

Instead of a fixed list of directories, this looks at the sources the LLMs
ACTUALLY cited (Perplexity returns citation URLs; other models sometimes
include links in the text). If a source keeps appearing in answers where
competitors are mentioned but our brand is not, that source is a concrete
opportunity: get listed / reviewed / discussed there.

Output is split into:
  observed  - evidence-backed, found in real LLM responses this run
  suggested - industry defaults, shown only as a fallback and clearly labelled
This split is important for the viva: observed items are data, suggested
items are heuristics.
"""
from __future__ import annotations

import re
from collections import defaultdict
from typing import Dict, List, Optional
from urllib.parse import urlparse

from .query_generator import brand_from_url

URL_RE = re.compile(r"https?://[^\s\)\]\"'>]+")
TWO_PART_TLDS = {"co.uk", "co.in", "com.au", "co.jp", "org.uk", "ac.in", "gov.in", "com.br"}

SOURCE_TYPES = {
    "review_platform": ["g2.com", "capterra.com", "trustradius.com", "getapp.com", "softwareadvice.com",
                        "trustpilot.com", "producthunt.com", "gartner.com", "clutch.co", "alternativeto.net"],
    "community": ["reddit.com", "quora.com", "stackoverflow.com", "ycombinator.com", "dev.to",
                  "medium.com", "stackexchange.com"],
    "reference": ["wikipedia.org", "wikidata.org", "crunchbase.com", "linkedin.com"],
    "video": ["youtube.com"],
    "local_listing": ["justdial.com", "indiamart.com", "sulekha.com", "yelp.com", "tripadvisor.com",
                      "tripadvisor.in", "practo.com", "zomato.com"],
    "marketplace": ["amazon.com", "amazon.in", "flipkart.com", "etsy.com"],
}

ACTIONS = {
    "review_platform": "Create/claim your profile on {d}, complete every field, and ask recent happy customers for reviews.",
    "community": "Take part in relevant {d} threads with genuinely helpful answers (disclose your affiliation; no spam).",
    "reference": "Make sure {d} has an accurate, up-to-date entry for your organisation (follow its notability/editing rules).",
    "video": "Publish a short demo or explainer on {d} targeting the lost queries listed here.",
    "local_listing": "Claim and complete your business listing on {d} with consistent name, address and phone.",
    "marketplace": "List products on {d} with complete specs and collect verified reviews.",
    "publisher": "Pitch {d}: offer original data, an expert quote, or a guest article - it already ranks as a source for these queries.",
}

INDUSTRY_SEEDS = {
    "saas": ["g2.com", "capterra.com", "producthunt.com", "alternativeto.net", "reddit.com"],
    "software": ["g2.com", "capterra.com", "producthunt.com", "alternativeto.net", "reddit.com"],
    "ecommerce": ["trustpilot.com", "amazon.in", "flipkart.com", "reddit.com", "youtube.com"],
    "education": ["quora.com", "reddit.com", "youtube.com", "linkedin.com", "medium.com"],
    "healthcare": ["practo.com", "justdial.com", "wikipedia.org", "youtube.com"],
    "local": ["justdial.com", "sulekha.com", "yelp.com", "tripadvisor.in"],
    "default": ["reddit.com", "quora.com", "linkedin.com", "youtube.com", "medium.com"],
}


def root_domain(url_or_host: str) -> str:
    host = urlparse(url_or_host if "://" in url_or_host else f"https://{url_or_host}").netloc.lower()
    host = host.split(":")[0].removeprefix("www.")
    parts = host.split(".")
    if len(parts) >= 3 and ".".join(parts[-2:]) in TWO_PART_TLDS:
        return ".".join(parts[-3:])
    return ".".join(parts[-2:]) if len(parts) >= 2 else host


def classify(domain: str) -> str:
    for t, domains in SOURCE_TYPES.items():
        if domain in domains:
            return t
    return "publisher"


def brand_pattern(url: str) -> Optional[re.Pattern]:
    """Brand name from the domain, allowing a space or hyphen between letters, so
    slurrpfarm.com matches "Slurrp Farm" and earlyfoods.com matches "Early Foods"."""
    name = re.sub(r"[^a-z0-9]", "", brand_from_url(url).lower())
    if len(name) < 3:
        return None
    if len(name) <= 4:  # short names: exact word only, to avoid false matches
        return re.compile(rf"\b{re.escape(name)}\b", re.I)
    return re.compile(r"\b" + r"[\s\-]?".join(re.escape(c) for c in name) + r"\b", re.I)


def first_mention(text: str, url: str) -> int:
    """Index of the brand's first mention (domain or name), or -1."""
    t = text.lower()
    idx = [t.find(root_domain(url))] if root_domain(url) in t else []
    pat = brand_pattern(url)
    m = pat.search(text) if pat else None
    if m:
        idx.append(m.start())
    return min(idx) if idx else -1


def is_mentioned(text: str, url: str, citations: List[str]) -> bool:
    dom = root_domain(url)
    if any(root_domain(c) == dom for c in citations):
        return True
    return first_mention(text, url) >= 0


def analyze_citation_gaps(
    responses: List[Dict],
    target_url: str,
    competitor_urls: List[str],
    industry: Optional[str] = None,
    top_n: int = 10,
) -> Dict:
    """responses: [{"provider": str, "query": str, "text": str, "citations": [url, ...]}]"""
    own = {root_domain(target_url)} | {root_domain(c) for c in competitor_urls}
    stats = defaultdict(lambda: {"cited": 0, "gap": 0, "competitors": set(), "queries": set(), "providers": set()})
    lost_answers = 0

    for r in responses:
        text, cites = r.get("text", ""), r.get("citations") or []
        cited = {root_domain(u) for u in cites + URL_RE.findall(text)} - own - {""}
        we_in = is_mentioned(text, target_url, cites)
        comps_in = [brand_from_url(c) for c in competitor_urls if is_mentioned(text, c, cites)]
        lost = bool(comps_in) and not we_in
        lost_answers += lost
        for d in cited:
            s = stats[d]
            s["cited"] += 1
            s["providers"].add(r.get("provider", "?"))
            if lost:
                s["gap"] += 1
                s["competitors"].update(comps_in)
                s["queries"].add(r.get("query", ""))

    observed = []
    for d, s in stats.items():
        kind = classify(d)
        observed.append({
            "domain": d,
            "type": kind,
            "times_cited": s["cited"],
            "cited_when_we_were_missing": s["gap"],
            "competitors_seen_with_it": sorted(s["competitors"]),
            "example_queries": sorted(q for q in s["queries"] if q)[:3],
            "providers": sorted(s["providers"]),
            "priority_score": s["gap"] * 2 + s["cited"],
            "action": ACTIONS[kind].format(d=d),
            "evidence": "observed",
        })
    observed.sort(key=lambda x: (-x["priority_score"], x["domain"]))
    observed = observed[:top_n]

    seed_key = next((k for k in INDUSTRY_SEEDS if k != "default" and k in (industry or "").lower()), "default")
    seen = {o["domain"] for o in observed}
    suggested = [{
        "domain": d, "type": classify(d), "action": ACTIONS[classify(d)].format(d=d),
        "evidence": "suggested (industry default - not observed in this run)",
    } for d in INDUSTRY_SEEDS[seed_key] if d not in seen]

    return {
        "observed": observed,
        "suggested": suggested,
        "summary": {
            "responses_analyzed": len(responses),
            "answers_where_competitor_won": lost_answers,
            "unique_sources_cited": len(stats),
        },
    }
