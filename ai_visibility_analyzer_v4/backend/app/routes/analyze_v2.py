"""
/api/analyze for the React frontend (v2).

Self-contained and runnable:
  * prompts from query_generator (discovery + branded, with repeats)
  * asks ChatGPT / Gemini / Perplexity / Claude in parallel over plain REST
    (any provider without an API key returns a mock answer, flagged in the result)
  * lightweight on-page crawl for GEO/SEO signals
  * builds the response with result_builder (same shape as frontend/src/lib/types.ts)

If you prefer your existing llm_clients.py / crawler.py / geo_scorer.py, replace
ask_provider() and crawl_signals() with calls to them. Everything else stays.

Register in main.py INSTEAD of the old analyze router (same path):
    from app.routes import analyze_v2
    app.include_router(analyze_v2.router)
"""
from __future__ import annotations

import json
import os
import random
import re
from concurrent.futures import ThreadPoolExecutor
from typing import Dict, List, Optional
from urllib.parse import urljoin

import requests
from fastapi import APIRouter
from pydantic import BaseModel, Field

from ..query_generator import brand_from_url, generate_queries
from ..result_builder import build_analysis_result

router = APIRouter(prefix="/api", tags=["analyze"])
UA = {"User-Agent": "Mozilla/5.0 (AI Visibility Analyzer; academic project)"}
SYSTEM = "Answer the user's question helpfully and concisely. Name specific products, companies or websites where relevant."


class AnalyzeRequest(BaseModel):
    url: str
    competitors: List[str] = []
    keywords: List[str]
    industry: str = ""
    region: Optional[str] = None
    providers: List[str] = ["ChatGPT", "Gemini", "Perplexity"]
    per_keyword: int = Field(8, ge=1, le=15)
    branded_per_keyword: int = Field(2, ge=0, le=4)
    repeats: int = Field(1, ge=1, le=5)


# ----------------------------------------------------------------- providers
def _openai(prompt: str):
    key = os.getenv("OPENAI_API_KEY")
    r = requests.post("https://api.openai.com/v1/chat/completions", headers={"Authorization": f"Bearer {key}"}, timeout=90, json={
        "model": os.getenv("OPENAI_MODEL", "gpt-4o-mini"), "temperature": 0.7,
        "messages": [{"role": "system", "content": SYSTEM}, {"role": "user", "content": prompt}]})
    r.raise_for_status()
    return r.json()["choices"][0]["message"]["content"], []


def _gemini(prompt: str):
    from ..gemini_client import fast_models, generate
    return generate(SYSTEM, prompt, models=fast_models(), temperature=0.7, max_tokens=1200), []


def _perplexity(prompt: str):
    key = os.getenv("PERPLEXITY_API_KEY")
    r = requests.post("https://api.perplexity.ai/chat/completions", headers={"Authorization": f"Bearer {key}"}, timeout=90, json={
        "model": os.getenv("PERPLEXITY_MODEL", "sonar"),
        "messages": [{"role": "system", "content": SYSTEM}, {"role": "user", "content": prompt}]})
    r.raise_for_status()
    data = r.json()
    cites = data.get("citations") or [s.get("url") for s in data.get("search_results", []) if s.get("url")]
    return data["choices"][0]["message"]["content"], cites


def _claude(prompt: str):
    key = os.getenv("ANTHROPIC_API_KEY")
    r = requests.post("https://api.anthropic.com/v1/messages", timeout=90,
                      headers={"x-api-key": key, "anthropic-version": "2023-06-01"}, json={
        "model": os.getenv("CLAUDE_MODEL", "claude-haiku-5-5"), "max_tokens": 800, "system": SYSTEM,
        "messages": [{"role": "user", "content": prompt}]})
    r.raise_for_status()
    return "".join(b.get("text", "") for b in r.json()["content"] if b.get("type") == "text"), []


PROVIDERS = {
    "ChatGPT": ("OPENAI_API_KEY", _openai), "Gemini": ("GEMINI_API_KEY", _gemini),  # GOOGLE_API_KEY also accepted
    "Perplexity": ("PERPLEXITY_API_KEY", _perplexity), "Claude": ("ANTHROPIC_API_KEY", _claude),
}


def _mock_answer(provider: str, prompt: str, url: str, comps: List[str], seed: int):
    """Synthetic answer so the full pipeline runs without keys. Never presented as real."""
    rnd = random.Random(seed)
    names = [brand_from_url(c) for c in comps if rnd.random() < 0.6]
    if rnd.random() < 0.5 or brand_from_url(url).lower() in prompt.lower():
        names.insert(rnd.randint(0, len(names)), brand_from_url(url))
    words = ["popular", "reliable", "well reviewed", "on the pricier side", "widely available", "limited in range"]
    text = " ".join(f"{n} is {rnd.choice(words)}." for n in names) or "It depends on your needs and budget."
    # Simulated answers never invent citations: fake sources would show up as "observed" listings.
    cites = []
    return text, cites


def ask_provider(provider: str, prompt: str, url: str, comps: List[str], seed: int) -> Dict:
    env, fn = PROVIDERS.get(provider, (None, None))
    if fn and (os.getenv(env or "") or (provider == "Gemini" and os.getenv("GOOGLE_API_KEY"))):
        try:
            text, cites = fn(prompt)
            return {"text": text, "citations": cites, "mock": False}
        except Exception as e:
            print(f"[analyze] {provider} failed: {e}")
    text, cites = _mock_answer(provider, prompt, url, comps, seed)
    return {"text": text, "citations": cites, "mock": True}


# ----------------------------------------------------------------- on-page crawl
AI_BOTS = ["GPTBot", "PerplexityBot", "ClaudeBot", "Google-Extended", "OAI-SearchBot"]


def _robots_allows_ai(url: str) -> Optional[bool]:
    try:
        txt = requests.get(urljoin(url, "/robots.txt"), headers=UA, timeout=10).text
    except Exception:
        return None
    blocks, agent = set(), None
    for line in txt.splitlines():
        line = line.split("#")[0].strip()
        if line.lower().startswith("user-agent:"):
            agent = line.split(":", 1)[1].strip()
        elif line.lower().startswith("disallow:") and line.split(":", 1)[1].strip() == "/" and agent:
            blocks.add(agent.lower())
    return not any(b.lower() in blocks for b in AI_BOTS)


def crawl_signals(url: str) -> Dict:
    """Returns (signals, geo_breakdown, geo_score, seo_score). Swap for crawler.py + geo_scorer.py if preferred."""
    try:
        from bs4 import BeautifulSoup
        html = requests.get(url, headers=UA, timeout=20).text
        soup = BeautifulSoup(html, "html.parser")
    except Exception as e:
        print(f"[analyze] crawl failed for {url}: {e}")
        soup = None

    if soup is None:
        signals = {"crawl_failed": True}
        return signals, [{"factor": "Crawl", "score": 0, "detail": "Page could not be fetched"}], 0, 0

    text = soup.get_text(" ", strip=True)
    ld = [s.get_text() for s in soup.find_all("script", type="application/ld+json")]
    types = " ".join(ld)
    headings = [h.get_text(" ", strip=True) for h in soup.find_all(["h2", "h3"])]
    stat_count = len(re.findall(r"\b\d+(?:\.\d+)?\s?(?:%|percent|million|billion|k\b)", text, re.I))
    signals = {
        "has_schema": bool(ld),
        "has_faq": "FAQPage" in types or sum(h.endswith("?") for h in headings) >= 2,
        "has_author": bool(soup.select('[rel=author], [itemprop=author], .author, meta[name=author]')) or '"author"' in types,
        "has_dates": bool(soup.select("time, [itemprop=dateModified], meta[property='article:modified_time']")) or "dateModified" in types,
        "allows_ai_crawlers": _robots_allows_ai(url),
        "word_count": len(text.split()),
        "stat_count": stat_count,
    }
    title = soup.title.get_text(strip=True) if soup.title else ""
    meta = soup.find("meta", attrs={"name": "description"})
    h1s = soup.find_all("h1")

    def s(b): return 100 if b else 0
    breakdown = [
        {"factor": "Structured data", "score": 100 if "Organization" in types and "FAQPage" in types else 60 if ld else 0,
         "detail": "JSON-LD types found: " + (", ".join(sorted(set(re.findall(r'"@type"\s*:\s*"(\w+)"', types)))) or "none")},
        {"factor": "Direct answers", "score": min(100, 25 * sum(h.endswith("?") for h in headings)), "detail": f"{sum(h.endswith('?') for h in headings)} question-style headings"},
        {"factor": "Citable data", "score": min(100, stat_count * 15), "detail": f"{stat_count} statistics or figures on the page"},
        {"factor": "Authority signals", "score": s(signals["has_author"]), "detail": "Author information found" if signals["has_author"] else "No author or byline found"},
        {"factor": "Freshness", "score": s(signals["has_dates"]), "detail": "Publish/update dates found" if signals["has_dates"] else "No visible dates"},
        {"factor": "AI crawler access", "score": 50 if signals["allows_ai_crawlers"] is None else s(signals["allows_ai_crawlers"]),
         "detail": "robots.txt unreadable" if signals["allows_ai_crawlers"] is None else "AI crawlers allowed" if signals["allows_ai_crawlers"] else "robots.txt blocks AI crawlers"},
        {"factor": "Content depth", "score": min(100, signals["word_count"] // 12), "detail": f"{signals['word_count']} words"},
    ]
    geo = round(sum(b["score"] for b in breakdown) / len(breakdown))
    seo = round((s(10 <= len(title) <= 60) + s(meta and 50 <= len(meta.get("content", "")) <= 160)
                 + s(len(h1s) == 1) + min(100, signals["word_count"] // 6) + s(len(soup.find_all("a", href=True)) > 10)) / 5)
    return signals, breakdown, geo, seo


# ----------------------------------------------------------------- route
@router.post("/analyze")
def analyze(req: AnalyzeRequest):
    queries = generate_queries(req.keywords, req.url, req.competitors, req.industry, req.region,
                               req.per_keyword, req.branded_per_keyword)
    jobs = [(p, q, rep) for q in queries for p in req.providers for rep in range(req.repeats)]

    def run(job):
        p, q, rep = job
        seed = hash((p, q.text, rep)) & 0xFFFFFFFF
        a = ask_provider(p, q.text, req.url, req.competitors, seed)
        return {"provider": p, "query": q.text, "keyword": q.keyword, "intent": q.intent, "family": q.family, **a}

    with ThreadPoolExecutor(max_workers=int(os.getenv("ANALYZE_WORKERS", "8"))) as pool:
        responses = list(pool.map(run, jobs))

    signals, breakdown, geo, seo = crawl_signals(req.url)
    comp_onpage = {}
    for c in req.competitors:
        _, _, cg, cs = crawl_signals(c)
        from ..citation_gap import root_domain
        comp_onpage[root_domain(c)] = {"geo": cg, "seo": cs}

    all_mock = all(r["mock"] for r in responses)
    result = build_analysis_result(req.model_dump(), responses, geo, seo, breakdown, signals, comp_onpage,
                                   mode="demo" if all_mock else "live")
    result["mock_answers"] = sum(r["mock"] for r in responses)
    return result
