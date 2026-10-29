"""
Listing Finder - "where should this brand get listed?", driven by the actual input.

Three sources, merged and ranked (strongest first):
  1. web_search   - a live Perplexity search about where people research this niche in this
                    region; every domain it cites is a real, current source (needs PERPLEXITY_API_KEY)
  2. ai_suggested - the writer model proposes niche-specific platforms from the brand, keywords and
                    region (needs a writer key); domains are validated before use
  3. niche_match  - offline fallback: keywords are matched to niches (baby products, food, software,
                    health, ...) and the region picks local platforms (e.g. FirstCry for India)

Domains already seen in this run's AI answers are reported separately as "observed" by
citation_gap.py; this module only covers platforms that were NOT observed.
"""
from __future__ import annotations

import os
import re
from typing import Dict, List, Optional

import requests

from .citation_gap import ACTIONS, classify, root_domain
from .llm_writer import TextGenerator
from .query_generator import brand_from_url

DOMAIN_RE = re.compile(r"\b((?:[a-z0-9-]+\.)+(?:com|in|net|org|co|io|ai|app|co\.in|co\.uk|com\.au))\b", re.I)
INDIA_HINTS = re.compile(r"india|bharat|chennai|mumbai|delhi|bengaluru|bangalore|hyderabad|coimbatore|kolkata|pune|"
                         r"kochi|madurai|jaipur|ahmedabad|tamil|kerala|karnataka", re.I)

# niche -> trigger words, then platforms per region as (domain, type)
NICHES = {
    "baby_kids": {
        "label": "baby and kids products",
        "triggers": ["baby", "babies", "infant", "toddler", "kids", "child", "children", "mom", "mother", "parent",
                     "newborn", "solids", "first food", "weaning", "nursery"],
        "IN": [("firstcry.com", "marketplace"), ("amazon.in", "marketplace"), ("babychakra.com", "community"),
               ("parentune.com", "community"), ("momspresso.com", "community"), ("flipkart.com", "marketplace")],
        "GLOBAL": [("amazon.com", "marketplace"), ("babycenter.com", "publisher"), ("whattoexpect.com", "community"),
                   ("reddit.com", "community")],
    },
    "food": {
        "label": "food and groceries",
        "triggers": ["food", "organic", "rice", "ragi", "millet", "grocery", "groceries", "snack", "flour", "dal",
                     "spice", "tea", "coffee", "staple", "cereal", "nutrition", "healthy eating", "recipe"],
        "IN": [("amazon.in", "marketplace"), ("bigbasket.com", "marketplace"), ("jiomart.com", "marketplace"),
               ("blinkit.com", "marketplace"), ("zeptonow.com", "marketplace"), ("youtube.com", "video")],
        "GLOBAL": [("amazon.com", "marketplace"), ("walmart.com", "marketplace"), ("reddit.com", "community"),
                   ("youtube.com", "video")],
    },
    "software": {
        "label": "software and SaaS",
        "triggers": ["software", "saas", "app", "tool", "platform", "crm", "project management", "knowledge base",
                     "workspace", "api", "automation", "analytics", "dashboard", "cloud"],
        "IN": [("g2.com", "review_platform"), ("capterra.com", "review_platform"), ("producthunt.com", "review_platform"),
               ("alternativeto.net", "review_platform"), ("reddit.com", "community")],
        "GLOBAL": [("g2.com", "review_platform"), ("capterra.com", "review_platform"), ("producthunt.com", "review_platform"),
                   ("trustradius.com", "review_platform"), ("alternativeto.net", "review_platform"), ("reddit.com", "community")],
    },
    "health": {
        "label": "health and wellness",
        "triggers": ["doctor", "clinic", "hospital", "health", "wellness", "dental", "physio", "therapy", "pharmacy",
                     "medicine", "diet", "fitness"],
        "IN": [("practo.com", "local_listing"), ("1mg.com", "marketplace"), ("justdial.com", "local_listing"),
               ("healthifyme.com", "community")],
        "GLOBAL": [("healthgrades.com", "review_platform"), ("zocdoc.com", "local_listing"), ("reddit.com", "community")],
    },
    "education": {
        "label": "education and courses",
        "triggers": ["course", "college", "school", "learn", "learning", "tuition", "coaching", "training",
                     "certification", "university", "exam", "admission"],
        "IN": [("shiksha.com", "review_platform"), ("collegedunia.com", "review_platform"), ("careers360.com", "publisher"),
               ("quora.com", "community"), ("youtube.com", "video")],
        "GLOBAL": [("coursereport.com", "review_platform"), ("reddit.com", "community"), ("quora.com", "community"),
                   ("youtube.com", "video")],
    },
    "travel": {
        "label": "travel and hospitality",
        "triggers": ["hotel", "travel", "trip", "resort", "tour", "homestay", "holiday", "vacation", "stay"],
        "IN": [("tripadvisor.in", "review_platform"), ("makemytrip.com", "marketplace"), ("booking.com", "marketplace"),
               ("goibibo.com", "marketplace")],
        "GLOBAL": [("tripadvisor.com", "review_platform"), ("booking.com", "marketplace"), ("expedia.com", "marketplace")],
    },
    "fashion_beauty": {
        "label": "fashion and beauty",
        "triggers": ["clothing", "fashion", "shoes", "footwear", "apparel", "skincare", "beauty", "cosmetics",
                     "makeup", "jewellery", "jewelry", "saree", "handbag"],
        "IN": [("myntra.com", "marketplace"), ("nykaa.com", "marketplace"), ("ajio.com", "marketplace"),
               ("amazon.in", "marketplace"), ("instagram.com", "community")],
        "GLOBAL": [("amazon.com", "marketplace"), ("trustpilot.com", "review_platform"), ("reddit.com", "community")],
    },
    "finance": {
        "label": "finance and insurance",
        "triggers": ["loan", "credit card", "insurance", "invest", "investment", "bank", "mutual fund", "tax", "accounting"],
        "IN": [("bankbazaar.com", "marketplace"), ("paisabazaar.com", "marketplace"), ("policybazaar.com", "marketplace")],
        "GLOBAL": [("nerdwallet.com", "publisher"), ("bankrate.com", "publisher"), ("trustpilot.com", "review_platform")],
    },
    "local_services": {
        "label": "local services",
        "triggers": ["near me", "salon", "restaurant", "cafe", "plumber", "repair", "cleaning", "gym", "bakery",
                     "catering", "local"],
        "IN": [("justdial.com", "local_listing"), ("sulekha.com", "local_listing"), ("zomato.com", "local_listing")],
        "GLOBAL": [("yelp.com", "local_listing"), ("tripadvisor.com", "review_platform")],
    },
}
GENERAL = [("reddit.com", "community"), ("quora.com", "community"), ("youtube.com", "video"), ("linkedin.com", "reference")]


def detect_region(region: str, url: str) -> str:
    return "IN" if INDIA_HINTS.search(region or "") or root_domain(url).endswith(".in") else "GLOBAL"


def detect_niches(text: str) -> List[str]:
    t = f" {text.lower()} "
    # whole words only (plural allowed): "tea" must not match "team", "hospital" not "hospitality"
    scores = {k: sum(1 for w in n["triggers"] if re.search(rf"\b{re.escape(w)}(?:s|es)?\b", t)) for k, n in NICHES.items()}
    return [k for k, s in sorted(scores.items(), key=lambda x: -x[1]) if s > 0][:2]


def _action(domain: str, kind: str) -> str:
    return ACTIONS.get(kind, ACTIONS["publisher"]).format(d=domain)


def _gemini_search(keywords: List[str], region_label: str, exclude: set) -> List[Dict]:
    from . import gemini_client
    found: Dict[str, Dict] = {}
    for kw in keywords[:2]:
        try:
            text, sources = gemini_client.grounded_search(
                f"Which websites, marketplaces, review sites, forums and publications do people in {region_label} "
                f"use to research, compare and buy {kw}? Name the specific websites with their domains.")
        except Exception as e:
            print(f"[listing_finder] Gemini search failed: {e}")
            continue
        domains = [root_domain(s["url"]) for s in sources] + [root_domain(m) for m in DOMAIN_RE.findall(text)]
        for d in domains:
            if d and d not in exclude and "google" not in d and "vertexaisearch" not in d:
                f = found.setdefault(d, {"hits": 0, "keywords": set()})
                f["hits"] += 1
                f["keywords"].add(kw)
    return [{"domain": d, "type": classify(d), "origin": "web_search", "score": 30 + 5 * f["hits"],
             "why": f"Came up in a live web search about where people research {', '.join(sorted(f['keywords']))}."}
            for d, f in found.items()]


def _web_search(keywords: List[str], region_label: str, exclude: set) -> List[Dict]:
    key = os.getenv("PERPLEXITY_API_KEY")
    if not keywords:
        return []
    if not key:
        from . import gemini_client
        return _gemini_search(keywords, region_label, exclude) if gemini_client.api_key() else []
    found: Dict[str, Dict] = {}
    for kw in keywords[:2]:
        prompt = (f"Which websites, marketplaces, review sites, forums and publications do people in {region_label} use "
                  f"to research, compare and buy {kw}? Name the specific websites.")
        try:
            r = requests.post("https://api.perplexity.ai/chat/completions", timeout=60,
                              headers={"Authorization": f"Bearer {key}"},
                              json={"model": os.getenv("PERPLEXITY_MODEL", "sonar"),
                                    "messages": [{"role": "user", "content": prompt}]})
            r.raise_for_status()
            data = r.json()
        except Exception as e:
            print(f"[listing_finder] web search failed: {e}")
            continue
        urls = data.get("citations") or [s.get("url") for s in data.get("search_results", []) if s.get("url")]
        text = data["choices"][0]["message"]["content"]
        domains = [root_domain(u) for u in urls] + [root_domain(m) for m in DOMAIN_RE.findall(text)]
        for d in domains:
            if not d or d in exclude:
                continue
            f = found.setdefault(d, {"domain": d, "hits": 0, "keywords": set()})
            f["hits"] += 1
            f["keywords"].add(kw)
    return [{"domain": d, "type": classify(d), "origin": "web_search", "score": 30 + 5 * f["hits"],
             "why": f"Came up in a live web search about where people research {', '.join(sorted(f['keywords']))}."}
            for d, f in found.items()]


def _ai_suggest(gen: TextGenerator, brand: str, url: str, keywords: List[str], industry: str,
                region_label: str, competitors: List[str], exclude: set) -> List[Dict]:
    if not gen.available:
        return []
    try:
        data = gen.complete_json(
            "You are a GEO and digital PR specialist. You know which websites AI assistants and shoppers rely on "
            "in each niche and country. Return JSON only.",
            f"""Brand: {brand} ({url})
Keywords: {', '.join(keywords)}
Industry: {industry or 'unknown'}
Market: {region_label}
Competitors: {', '.join(competitors) or 'unknown'}

List 8 real, currently active websites where this brand should get listed, reviewed or discussed so AI assistants
find it: niche marketplaces, review platforms, communities, publications and directories that matter in this
market. Prefer specific niche sites over generic ones. Don't include the brand's or competitors' own sites.
Return: {{"platforms": [{{"domain": "example.com", "type": "marketplace|review_platform|community|publisher|local_listing|video|reference",
 "why": "one sentence on why it matters for this niche", "action": "one concrete action"}}]}}""",
            temperature=0.3, max_tokens=1500)
    except Exception as e:
        print(f"[listing_finder] AI suggestion failed: {e}")
        return []
    out = []
    for p in (data.get("platforms") or [])[:10]:
        if not isinstance(p, dict):
            continue
        d = root_domain(str(p.get("domain", "")))
        if not DOMAIN_RE.fullmatch(d) or d in exclude:
            continue
        kind = p.get("type") if p.get("type") in ACTIONS else classify(d)
        out.append({"domain": d, "type": kind, "origin": "ai_suggested", "score": 20,
                    "why": str(p.get("why", ""))[:240], "action": str(p.get("action", ""))[:240] or None})
    return out


def _niche_match(niches: List[str], region: str, exclude: set) -> List[Dict]:
    out, rank, seen = [], 0, set()
    lists = [[(d, kind, n) for d, kind in NICHES[n][region]] for n in niches]
    for row in range(max((len(l) for l in lists), default=0)):  # interleave niches: 1st of each, then 2nd...
        for l in lists:
            if row < len(l) and l[row][0] not in exclude and l[row][0] not in seen:
                d, kind, n = l[row]
                seen.add(d)
                rank += 1
                out.append({"domain": d, "type": kind, "origin": "niche_match", "score": 12 - rank * 0.5,
                            "why": f"A leading platform for {NICHES[n]['label']} in "
                                   f"{'India' if region == 'IN' else 'your market'}."})
    if not out:
        out = [{"domain": d, "type": kind, "origin": "niche_match", "score": 5,
                "why": "A general platform AI assistants often cite."} for d, kind in GENERAL if d not in exclude]
    return out


def find_platforms(target_url: str, competitor_urls: List[str], keywords: List[str], industry: str = "",
                   region: str = "", exclude: Optional[set] = None, gen: Optional[TextGenerator] = None,
                   limit: int = 8) -> List[Dict]:
    gen = gen or TextGenerator()
    exclude = set(exclude or set()) | {root_domain(target_url)} | {root_domain(c) for c in competitor_urls}
    reg = detect_region(region, target_url)
    region_label = region or ("India" if reg == "IN" else "their market")
    brand = brand_from_url(target_url)
    niches = detect_niches(" ".join(keywords) + " " + industry)

    candidates = (_web_search(keywords, region_label, exclude)
                  + _ai_suggest(gen, brand, target_url, keywords, industry, region_label,
                                [brand_from_url(c) for c in competitor_urls], exclude)
                  + _niche_match(niches, reg, exclude))

    merged: Dict[str, Dict] = {}
    for c in candidates:
        m = merged.get(c["domain"])
        if not m:
            merged[c["domain"]] = {**c, "origins": [c["origin"]]}
        else:  # the same site found by several methods is a stronger signal
            m["score"] += c["score"] / 2
            if c["origin"] not in m["origins"]:
                m["origins"].append(c["origin"])
            if not m.get("action") and c.get("action"):
                m["action"] = c["action"]
    ranked = sorted(merged.values(), key=lambda x: -x["score"])[:limit]
    labels = {"web_search": "found by live web search", "ai_suggested": "suggested by AI",
              "niche_match": "matched to your niche"}
    return [{
        "domain": r["domain"], "type": r["type"], "why": r.get("why", ""),
        "action": r.get("action") or _action(r["domain"], r["type"]),
        "origins": r["origins"], "score": round(r["score"], 1),
        "evidence": "suggested (" + ", ".join(labels[o] for o in r["origins"]) + "; not seen in this run's answers)",
    } for r in ranked]
