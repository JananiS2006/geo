"""
Builds the /api/analyze response in the exact shape the React app expects
(see frontend/src/lib/types.ts -> AnalysisResult).

Your analyze route collects raw answers; this module does all the per-answer
measurement (mention, position, citation, rank, stability across repeats),
per-provider scores, share of voice, and calls the advisor.
"""
from __future__ import annotations

import re
import uuid
from collections import Counter, defaultdict
from datetime import datetime, timezone
from typing import Dict, List, Optional

from .citation_gap import first_mention, is_mentioned, root_domain
from .content_advisor import run_advisor
from .query_generator import brand_from_url

POS_WORDS = re.compile(r"\b(best|great|excellent|top|recommended|popular|leading|strong|reliable|easy)\b", re.I)
NEG_WORDS = re.compile(r"\b(expensive|limited|lacks|poor|slow|difficult|complicated|outdated|buggy|weak)\b", re.I)


def _first_index(text: str, url: str) -> int:
    return first_mention(text, url)


def _position(text: str, url: str) -> Optional[str]:
    i = _first_index(text, url)
    if i < 0:
        return None
    frac = i / max(len(text), 1)
    return "Early" if frac < 0.33 else "Mid" if frac < 0.66 else "Late"


def _sentence_sentiment(text: str, url: str) -> Optional[str]:
    """Simple lexicon fallback. If your pipeline already computes sentiment, pass it in the response dict."""
    i = _first_index(text, url)
    if i < 0:
        return None
    start = max(text.rfind(".", 0, i), 0)
    end = text.find(".", i)
    sent = text[start:end if end > 0 else len(text)]
    p, n = len(POS_WORDS.findall(sent)), len(NEG_WORDS.findall(sent))
    return "Positive" if p > n else "Negative" if n > p else "Neutral"


def _excerpt(text: str, url: str, limit: int = 320) -> str:
    """A readable slice of the answer around the brand's first mention (or the opening, if absent)."""
    clean = re.sub(r"[*_#`>|]+", "", re.sub(r"\s*\[(\d+)\]", "", text))
    clean = re.sub(r"\s+", " ", clean).strip()
    i = _first_index(clean, url)
    start = 0
    if i > 160:
        dot = clean.rfind(". ", 0, i - 60)
        start = dot + 2 if dot != -1 else i - 140
    out = clean[start:start + limit]
    if start + limit < len(clean):
        out = out.rsplit(" ", 1)[0] + "…"
    return ("…" if start else "") + out


def _rank(text: str, url: str, competitors: List[str]) -> Optional[int]:
    me = _first_index(text, url)
    if me < 0:
        return None
    others = [_first_index(text, c) for c in competitors]
    return 1 + sum(1 for o in others if 0 <= o < me)


def _visibility(rows: List[Dict]) -> int:
    """Matches the scoring slide: 70% mention rate + 30% citation rate + sentiment bonus (±8)."""
    if not rows:
        return 0
    n = len(rows)
    mention = sum(r["mentioned"] for r in rows) / n
    cited = sum(r["cited"] for r in rows) / n
    pos = sum(r["sentiment"] == "Positive" for r in rows) / n
    neg = sum(r["sentiment"] == "Negative" for r in rows) / n
    return max(0, min(100, round(100 * (0.7 * mention + 0.3 * cited) + 8 * (pos - neg))))


def build_analysis_result(
    request: Dict,
    responses: List[Dict],
    geo_score: int,
    seo_score: int,
    geo_breakdown: List[Dict],
    signals: Dict,
    competitor_onpage: Optional[Dict[str, Dict]] = None,
    mode: str = "live",
) -> Dict:
    """
    request:    the AnalyzeRequest body (url, competitors, keywords, industry, providers, repeats, ...)
    responses:  one dict per answer: {provider, query, keyword, intent, family, text, citations,
                                      sentiment (optional)}. With repeats > 1, include every repeat.
    geo_breakdown: [{"factor": "Structured data", "score": 30, "detail": "..."}] from geo_scorer
    signals:    on-page signals for the advisor (has_schema, has_author, has_faq, word_count, ...)
    competitor_onpage: {"coda.io": {"geo": 70, "seo": 65}, ...} if you crawl competitors too
    """
    url, comps = request["url"], request.get("competitors", [])
    comp_names = {c: brand_from_url(c) for c in comps}

    # 1. Group repeats of the same (provider, query) and take the majority outcome
    groups: Dict[tuple, List[Dict]] = defaultdict(list)
    for r in responses:
        groups[(r["provider"], r["query"])].append(r)

    rows = []
    for (provider, query), reps in groups.items():
        measured = []
        for r in reps:
            text, cites = r.get("text", ""), r.get("citations") or []
            m = is_mentioned(text, url, cites)
            measured.append({
                "mentioned": m,
                "cited": any(root_domain(c) == root_domain(url) for c in cites),
                "position": _position(text, url) if m else None,
                "sentiment": r.get("sentiment") or (_sentence_sentiment(text, url) if m else None),
                "rank": _rank(text, url, comps) if m else None,
                "competitors": [comp_names[c] for c in comps if is_mentioned(text, c, cites)],
                "excerpt": _excerpt(text, url),
            })
        majority = Counter(x["mentioned"] for x in measured).most_common(1)[0]
        best = next(x for x in measured if x["mentioned"] == majority[0])
        rows.append({
            "provider": provider, "query": query, "keyword": reps[0].get("keyword"),
            "intent": reps[0].get("intent", "custom"), "family": reps[0].get("family", "discovery"),
            "mentioned": majority[0], "position": best["position"],
            "cited": any(x["cited"] for x in measured), "sentiment": best["sentiment"], "rank": best["rank"],
            "competitors_mentioned": sorted({c for x in measured for c in x["competitors"]}),
            "consistency": round(majority[1] / len(measured), 2) if len(measured) > 1 else None,
            "excerpt": best["excerpt"],
        })

    disc = [r for r in rows if r["family"] == "discovery"]
    providers = request.get("providers") or sorted({r["provider"] for r in rows})
    provider_scores = []
    for p in providers:
        pr = [r for r in disc if r["provider"] == p]
        n = max(len(pr), 1)
        provider_scores.append({
            "provider": p, "visibility": _visibility(pr),
            "mention_rate": round(100 * sum(r["mentioned"] for r in pr) / n),
            "citation_rate": round(100 * sum(r["cited"] for r in pr) / n),
        })

    # 2. Share of voice and competitor AI visibility from the same answers
    ours = sum(r["mentioned"] for r in disc)
    comp_counts = {c: sum(comp_names[c] in r["competitors_mentioned"] for r in disc) for c in comps}
    total = max(ours + sum(comp_counts.values()), 1)
    n_disc = max(len(disc), 1)
    ai = _visibility(disc)
    competitor_onpage = competitor_onpage or {}
    competitors = [{"domain": root_domain(url), "is_you": True, "ai_visibility": ai, "geo": geo_score,
                    "seo": seo_score, "share_of_voice": round(100 * ours / total)}]
    for c in comps:
        d = root_domain(c)
        competitors.append({
            "domain": d, "is_you": False,
            "ai_visibility": round(100 * comp_counts[c] / n_disc),  # mention rate (no citation data for rivals)
            "geo": competitor_onpage.get(d, {}).get("geo", 0),
            "seo": competitor_onpage.get(d, {}).get("seo", 0),
            "share_of_voice": round(100 * comp_counts[c] / total),
        })

    # 3. Advisor: only discovery answers are used for gaps
    disc_raw = [r for r in responses if r.get("family", "discovery") == "discovery"]
    scores = {"ai_visibility": ai, "geo": geo_score, "seo": seo_score}
    advisor = run_advisor(disc_raw, url, comps, request.get("industry", ""), request.get("keywords", []),
                          scores, signals, region=request.get("region") or "")

    multi = [r["consistency"] for r in rows if r["consistency"] is not None]
    return {
        "id": str(uuid.uuid4()),
        "created_at": datetime.now(timezone.utc).isoformat(),
        "mode": mode,
        "brand": brand_from_url(url),
        "request": request,
        "scores": {**scores, "share_of_voice": round(100 * ours / total)},
        "geo_breakdown": geo_breakdown,
        "provider_scores": provider_scores,
        "competitors": competitors,
        "query_results": rows,
        "advisor": advisor,
        "crawl_error": ("Couldn't fetch the page, so GEO and SEO weren't measured. Check the URL or whether the site blocks bots."
                        if signals.get("crawl_failed") else None),
        "stability": ({"repeats": request.get("repeats", 1), "avg_consistency": round(sum(multi) / len(multi), 2)}
                      if multi else None),
    }
