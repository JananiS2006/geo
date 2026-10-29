"""
AI GEO Advisor - replaces static recommendations with evidence-grounded,
run-specific ones, and includes a GEO-optimised Blog Writer.

Design principle (good for the viva): the LLM never invents the *diagnosis*.
Our own code measures everything (on-page signals, lost queries, citation
gaps); the LLM only turns that evidence into prioritised, readable advice and
content. Every recommendation carries the evidence it is based on.
"""
from __future__ import annotations

import json
import re
from collections import defaultdict
from dataclasses import asdict, dataclass, field
from datetime import date
from typing import Dict, List, Optional

from .citation_gap import analyze_citation_gaps, is_mentioned
from .llm_writer import TextGenerator
from .query_generator import brand_from_url

PRIORITIES = ("high", "medium", "low")
FACT_PLACEHOLDER_RE = re.compile(r"\[(?:STAT|SOURCE|QUOTE|FACT):[^\]]*\]", re.I)


# --------------------------------------------------------------------------- #
# 1. Content gaps - queries we lost to competitors become blog topics
# --------------------------------------------------------------------------- #
def find_content_gaps(responses: List[Dict], target_url: str, competitor_urls: List[str]) -> List[Dict]:
    by_query = defaultdict(lambda: {"lost_on": set(), "won_on": set(), "competitors": set(), "keyword": None})
    for r in responses:
        q = r.get("query", "")
        cites = r.get("citations") or []
        g = by_query[q]
        g["keyword"] = g["keyword"] or r.get("keyword")
        if is_mentioned(r.get("text", ""), target_url, cites):
            g["won_on"].add(r.get("provider", "?"))
        else:
            comps = [brand_from_url(c) for c in competitor_urls if is_mentioned(r.get("text", ""), c, cites)]
            if comps:
                g["lost_on"].add(r.get("provider", "?"))
                g["competitors"].update(comps)
    gaps = [{
        "query": q, "keyword": g["keyword"],
        "lost_on_providers": sorted(g["lost_on"]),
        "competitors_recommended_instead": sorted(g["competitors"]),
        "severity": len(g["lost_on"]) - 0.5 * len(g["won_on"]),
    } for q, g in by_query.items() if g["lost_on"]]
    return sorted(gaps, key=lambda x: -x["severity"])


# --------------------------------------------------------------------------- #
# 2. Recommendations
# --------------------------------------------------------------------------- #
def _evidence(signals: Dict, scores: Dict, gaps: List[Dict], cit: Dict) -> List[Dict]:
    """Turn raw measurements into numbered evidence items the LLM must cite."""
    ev = []

    def add(kind, detail):
        ev.append({"id": f"E{len(ev) + 1}", "kind": kind, "detail": detail})

    for k, v in (scores or {}).items():
        add("score", f"{k} = {v}/100")
    checks = {
        "has_schema": "No schema.org JSON-LD structured data found",
        "has_author": "No author/byline information found",
        "has_dates": "No visible publish/updated dates",
        "has_faq": "No FAQ / question-style headings",
        "allows_ai_crawlers": "robots.txt blocks one or more AI crawlers (GPTBot, PerplexityBot, etc.)",
    }
    for key, msg in checks.items():
        if key in signals and not signals[key]:
            add("on_page", msg)
    if signals.get("word_count") is not None and signals["word_count"] < 600:
        add("on_page", f"Main page has only {signals['word_count']} words (thin content)")
    if signals.get("stat_count") is not None and signals["stat_count"] < 3:
        add("on_page", f"Only {signals['stat_count']} statistics/numbers found - little citable data")
    for g in gaps[:5]:
        add("lost_query", f'"{g["query"]}" - competitors {", ".join(g["competitors_recommended_instead"])} '
                          f'mentioned instead of us on {", ".join(g["lost_on_providers"])}')
    for o in (cit or {}).get("observed", [])[:5]:
        if o["cited_when_we_were_missing"]:
            add("citation_gap", f'{o["domain"]} ({o["type"]}) was cited {o["cited_when_we_were_missing"]}x '
                                f'in answers where we were missing')
    for o in (cit or {}).get("suggested", [])[:3]:
        add("listing_suggestion", f'{o["domain"]} ({o["type"]}): {o.get("why") or "relevant platform"} '
                                  f'[{", ".join(o.get("origins", []))}]')
    return ev


def generate_recommendations(brand_url: str, industry: str, keywords: List[str],
                             scores: Dict, signals: Dict, gaps: List[Dict], citation_gaps: Dict,
                             gen: Optional[TextGenerator] = None, max_items: int = 8) -> Dict:
    evidence = _evidence(signals, scores, gaps, citation_gaps)
    gen = gen or TextGenerator()
    if gen.available and evidence:
        try:
            recs = _llm_recommendations(gen, brand_url, industry, keywords, evidence, max_items)
            if recs:
                return {"mode": f"llm:{gen.provider}", "evidence": evidence, "recommendations": recs}
        except Exception as e:  # never break the analysis because the advisor failed
            print(f"[advisor] LLM failed, using rule-based fallback: {e}")
    return {"mode": "rule_based", "evidence": evidence,
            "recommendations": _rule_recommendations(evidence, gaps, citation_gaps, max_items)}


def _llm_recommendations(gen, brand_url, industry, keywords, evidence, max_items):
    system = (
        "You are a Generative Engine Optimization (GEO) consultant. You help websites get mentioned "
        "and cited by AI assistants (ChatGPT, Gemini, Perplexity). Use ONLY the evidence given; do not "
        "assume facts about the business that are not in the evidence. Be specific and practical. "
        "Return JSON only."
    )
    user = f"""Website: {brand_url}
Industry: {industry or 'unknown'}
Target keywords: {', '.join(keywords)}

Evidence measured by our analyzer:
{json.dumps(evidence, indent=1)}

Write at most {max_items} recommendations, most impactful first. Return:
{{"recommendations": [{{
  "priority": "high|medium|low",
  "category": "Content|Structured Data|Off-site Presence|Technical|Authority|Freshness",
  "title": "short imperative title",
  "why": "one sentence explaining the problem in plain words",
  "action_steps": ["concrete step 1", "concrete step 2"],
  "evidence_ids": ["E1"],
  "effort": "low|medium|high"
}}]}}"""
    data = gen.complete_json(system, user, temperature=0.3)
    valid_ids = {e["id"] for e in evidence}
    out = []
    for r in (data.get("recommendations") or [])[:max_items]:
        if not isinstance(r, dict) or not r.get("title"):
            continue
        r["priority"] = r.get("priority", "medium").lower() if r.get("priority", "").lower() in PRIORITIES else "medium"
        r["evidence_ids"] = [i for i in r.get("evidence_ids", []) if i in valid_ids]
        r["action_steps"] = [s for s in r.get("action_steps", []) if isinstance(s, str)]
        out.append(r)
    return out


def _rule_recommendations(evidence, gaps, cit, max_items):
    recs = []
    by_text = {e["detail"]: e["id"] for e in evidence}

    def ev_id(prefix):
        return [i for d, i in by_text.items() if d.startswith(prefix)]

    rules = [
        ("No schema", "high", "Structured Data", "Add Organization and FAQPage JSON-LD schema",
         "AI crawlers extract facts more reliably from structured data.",
         ["Add Organization schema to the homepage", "Add FAQPage schema to key landing pages"]),
        ("robots.txt blocks", "high", "Technical", "Allow AI crawlers in robots.txt",
         "Blocked crawlers cannot read or cite your pages.",
         ["Allow GPTBot, PerplexityBot and Google-Extended unless content must be gated"]),
        ("No author", "medium", "Authority", "Add named authors with credentials",
         "Bylines and credentials are trust signals for answer engines.",
         ["Add author bio boxes", "Link author pages with Person schema"]),
        ("No visible publish", "medium", "Freshness", "Show publish and last-updated dates",
         "Answer engines prefer content they can tell is current.",
         ["Display dates on articles", "Add dateModified to Article schema"]),
        ("No FAQ", "medium", "Content", "Add question-style headings with direct answers",
         "LLMs often lift short, direct answers to question headings.",
         ["Add H2 questions matching user prompts", "Answer each in 40-60 words first"]),
        ("Main page has only", "medium", "Content", "Expand thin pages",
         "Short pages give AI models little to quote.",
         ["Expand key pages to 1,000+ words of useful content"]),
        ("Only", "medium", "Content", "Add original statistics and data",
         "Numbers and data points are frequently quoted by AI answers.",
         ["Publish original survey or usage data", "Cite sources for every number"]),
    ]
    for prefix, pr, cat, title, why, steps in rules:
        ids = ev_id(prefix)
        if ids:
            recs.append({"priority": pr, "category": cat, "title": title, "why": why,
                         "action_steps": steps, "evidence_ids": ids, "effort": "low" if pr == "high" else "medium"})
    for g in gaps[:3]:
        recs.append({
            "priority": "high", "category": "Content",
            "title": f'Publish content answering: "{g["query"]}"',
            "why": f'{", ".join(g["competitors_recommended_instead"])} are recommended instead of you for this question.',
            "action_steps": ["Use the Blog Writer to draft an article for this query",
                             "Include comparison tables and cited data"],
            "evidence_ids": ev_id(f'"{g["query"]}"'), "effort": "medium"})
    for o in (cit or {}).get("observed", [])[:3]:
        if o["cited_when_we_were_missing"]:
            recs.append({"priority": "high", "category": "Off-site Presence",
                         "title": f'Get featured on {o["domain"]}',
                         "why": f'AI answers cite {o["domain"]} when recommending competitors.',
                         "action_steps": [o["action"]], "evidence_ids": ev_id(o["domain"]), "effort": "medium"})
    for o in (cit or {}).get("suggested", [])[:2]:
        recs.append({"priority": "high" if "web_search" in o.get("origins", []) else "medium",
                     "category": "Off-site Presence", "title": f'Get listed on {o["domain"]}',
                     "why": o.get("why") or f'{o["domain"]} matters for your niche.',
                     "action_steps": [o["action"]], "evidence_ids": ev_id(o["domain"]), "effort": "medium"})
    order = {p: i for i, p in enumerate(PRIORITIES)}
    return sorted(recs, key=lambda r: order[r["priority"]])[:max_items]


# --------------------------------------------------------------------------- #
# 3. Blog Writer
# --------------------------------------------------------------------------- #
@dataclass
class BlogDraft:
    topic: str
    title: str
    meta_title: str
    meta_description: str
    slug: str
    primary_keyword: str
    secondary_keywords: List[str]
    outline: List[str]
    markdown: str
    faq: List[Dict]
    json_ld: Dict
    keyword_report: Dict
    geo_check: Dict
    facts_to_verify: List[str]
    mode: str
    distribution_plan: List[str] = field(default_factory=list)

    def to_dict(self):
        return asdict(self)


def _slugify(s: str) -> str:
    return re.sub(r"[^a-z0-9]+", "-", s.lower()).strip("-")[:70]


def write_blog(topic: str, brand_url: str, keywords: List[str], industry: str = "",
               competitors: Optional[List[str]] = None, audience: str = "",
               tone: str = "helpful and expert", target_words: int = 1200,
               gen: Optional[TextGenerator] = None) -> BlogDraft:
    gen = gen or TextGenerator()
    brand = brand_from_url(brand_url)
    primary, secondary = (keywords[0] if keywords else topic), keywords[1:]
    comps = [brand_from_url(c) for c in (competitors or [])]

    if gen.available:
        try:
            plan = _llm_plan(gen, topic, brand, primary, secondary, industry, audience, comps)
            md = _llm_article(gen, plan, topic, brand, brand_url, primary, secondary, tone, target_words, audience)
            mode = f"llm:{gen.provider}"
        except Exception as e:
            print(f"[blog] LLM failed, using template: {e}")
            plan, md, mode = None, None, "template"
    else:
        plan, md, mode = None, None, "template"
    if not md:
        plan, md = _template_blog(topic, brand, primary, secondary, comps)

    title = plan.get("title") or topic.capitalize()
    faq = [f for f in plan.get("faq", []) if isinstance(f, dict) and f.get("question") and f.get("answer")]
    meta_desc = (plan.get("meta_description") or "")[:160]
    return BlogDraft(
        topic=topic, title=title,
        meta_title=(plan.get("meta_title") or title)[:60],
        meta_description=meta_desc,
        slug=_slugify(plan.get("slug") or title),
        primary_keyword=primary, secondary_keywords=secondary,
        outline=plan.get("outline", []), markdown=md, faq=faq,
        json_ld=build_json_ld(title, meta_desc, brand, brand_url, faq),
        keyword_report=keyword_report(md, title, primary, secondary),
        geo_check=quick_geo_check(md, faq),
        facts_to_verify=sorted(set(FACT_PLACEHOLDER_RE.findall(md))),
        mode=mode,
        distribution_plan=[
            f"Publish on {brand_url.rstrip('/')}/blog/{_slugify(title)} with the JSON-LD in the <head>",
            "Post a summary with a link on LinkedIn and relevant community threads (disclose affiliation)",
            "Turn the FAQ into a short video or carousel for YouTube/Instagram",
            "Re-run the analyzer for the target queries after 3-4 weeks to measure impact",
        ],
    )


def _llm_plan(gen, topic, brand, primary, secondary, industry, audience, comps):
    system = ("You are an SEO + GEO content strategist. You plan articles that AI assistants can easily "
              "quote: direct answers, question headings, data, comparison tables. Return JSON only.")
    user = f"""Plan a blog article.
Topic / target AI query: {topic}
Brand publishing it: {brand}
Industry: {industry or 'unknown'}
Audience: {audience or 'people researching this topic'}
Primary keyword: {primary}
Secondary keywords: {', '.join(secondary) or 'none'}
Competitors (may be mentioned fairly, never disparaged): {', '.join(comps) or 'none'}

Return:
{{"title": "...(include primary keyword)", "meta_title": "...(<=60 chars)",
 "meta_description": "...(<=155 chars, include primary keyword)", "slug": "...",
 "outline": ["H2 heading phrased as a question where natural", "..."],
 "faq": [{{"question": "...", "answer": "40-60 word direct answer"}}]}}
Use 5-7 outline items and 4-5 FAQ items."""
    return gen.complete_json(system, user, temperature=0.5)


def _llm_article(gen, plan, topic, brand, brand_url, primary, secondary, tone, words, audience):
    system = (
        "You write blog articles optimised for both search engines and AI answer engines. Rules:\n"
        "- Start with a 2-3 sentence direct answer (TL;DR) to the topic.\n"
        "- Use the given H2 headings; open each section with a 1-2 sentence direct answer.\n"
        "- Include at least one comparison table and one bulleted checklist.\n"
        "- NEVER invent statistics, quotes, studies or customer names. Wherever a real number, "
        "source or expert quote would strengthen the text, insert a placeholder like "
        "[STAT: what data is needed] or [SOURCE: what to cite] or [QUOTE: who should be quoted].\n"
        "- Mention the brand naturally, not as an advert. Do not disparage competitors.\n"
        "- Output Markdown only, starting with an H1."
    )
    user = f"""Title: {plan.get('title')}
Topic: {topic}
Brand: {brand} ({brand_url})
Audience: {audience or 'general'}
Tone: {tone}
Length: about {words} words
Primary keyword (use in H1, first 100 words, and 1-2 H2s): {primary}
Secondary keywords (use each at least once): {', '.join(secondary) or 'none'}
Outline (H2s): {json.dumps(plan.get('outline', []))}
End with an "## FAQ" section using these Q&As (H3 per question):
{json.dumps(plan.get('faq', []), indent=1)}"""
    return gen.complete(system, user, temperature=0.6, max_tokens=4000).strip()


def _template_blog(topic, brand, primary, secondary, comps):
    """Mock-mode article so the UI and scoring can be demoed without API keys."""
    title = f"{topic.rstrip('?').capitalize()}: A Practical Guide"
    outline = [f"What is {primary}?", f"Why does {primary} matter?",
               f"How to choose the right {primary}", f"Comparing popular {primary} options",
               "Checklist before you decide"]
    faq = [
        {"question": f"What should I look for in {primary}?",
         "answer": f"Look for ease of use, pricing that fits your budget, reliable support and integrations "
                   f"with tools you already use. Shortlist two or three options and test them on a real task "
                   f"before committing."},
        {"question": f"Is {brand} a good choice for {primary}?",
         "answer": f"{brand} is worth evaluating if its features match your needs. Compare it against "
                   f"alternatives on price, features and reviews, and use a free trial if available."},
        {"question": f"How much does {primary} cost?",
         "answer": "Costs vary widely by provider and plan. [STAT: typical price range in this market] "
                   "Check whether pricing is per user, per month or a one-time fee."},
    ]
    others = ", ".join(comps[:3]) or "other leading options"
    sec = f" It also touches on {', '.join(secondary)}." if secondary else ""
    rows = "\n".join(f"| {n} | [FACT: key strength] | [FACT: pricing model] |" for n in [brand] + comps[:3])
    md = f"""# {title}

**TL;DR:** Choosing {primary} comes down to your goals, budget and team size. This guide explains what matters, compares {brand} with {others}, and gives a checklist you can use today.{sec}

## {outline[0]}
{primary.capitalize()} refers to tools and services that help you solve this problem efficiently. [SOURCE: authoritative definition]

## {outline[1]}
Picking the right option saves time and money. [STAT: measurable benefit reported by an industry study]

## {outline[2]}
Start with your must-have requirements, then compare shortlisted options on features, pricing and support.

## {outline[3]}
| Option | Strength | Pricing |
|---|---|---|
{rows}

## {outline[4]}
- Define your top three requirements
- Shortlist two or three options
- Run a free trial on a real task
- Check reviews on independent platforms
- Confirm total cost over a year

## FAQ
""" + "\n".join(f"### {f['question']}\n{f['answer']}\n" for f in faq)
    plan = {"title": title, "meta_title": title[:60],
            "meta_description": f"A practical guide to {primary}: what to look for, comparisons and a checklist."[:155],
            "slug": _slugify(title), "outline": outline, "faq": faq}
    return plan, md


def build_json_ld(title, description, brand, brand_url, faq) -> Dict:
    """Schema is built in code, not by the LLM, so it is always valid."""
    today = date.today().isoformat()
    graph = [{
        "@type": "Article", "headline": title, "description": description,
        "datePublished": today, "dateModified": today,
        "author": {"@type": "Organization", "name": brand, "url": brand_url},
        "publisher": {"@type": "Organization", "name": brand, "url": brand_url},
    }]
    if faq:
        graph.append({"@type": "FAQPage", "mainEntity": [{
            "@type": "Question", "name": f["question"],
            "acceptedAnswer": {"@type": "Answer", "text": f["answer"]}} for f in faq]})
    return {"@context": "https://schema.org", "@graph": graph}


def keyword_report(md: str, title: str, primary: str, secondary: List[str]) -> Dict:
    text = md.lower()
    words = re.findall(r"[a-z0-9']+", text)
    first_100 = " ".join(words[:100])
    h2s = " ".join(re.findall(r"^##\s+(.+)$", md, re.M)).lower()

    def count(k):
        return len(re.findall(rf"\b{re.escape(k.lower())}\b", text))

    p = count(primary)
    density = round(100 * p * max(len(primary.split()), 1) / max(len(words), 1), 2)
    return {
        "word_count": len(words),
        "primary": {"keyword": primary, "count": p, "density_pct": density,
                    "in_title": primary.lower() in title.lower(),
                    "in_first_100_words": primary.lower() in first_100,
                    "in_h2": primary.lower() in h2s,
                    "density_ok": 0.5 <= density <= 2.5},
        "secondary": [{"keyword": k, "count": count(k)} for k in secondary],
    }


def quick_geo_check(md: str, faq: List[Dict]) -> Dict:
    """Lightweight GEO checklist for a draft. Swap in geo_scorer for full scoring if preferred."""
    h2 = re.findall(r"^##\s+(.+)$", md, re.M)
    checks = {
        "direct_answer_at_top": bool(re.search(r"tl;dr|in short|quick answer", md[:600], re.I)),
        "question_headings": sum(h.strip().endswith("?") for h in h2) >= 2,
        "has_table": bool(re.search(r"^\|.+\|\s*$", md, re.M)),
        "has_list": bool(re.search(r"^\s*[-*]\s+", md, re.M)),
        "has_faq": len(faq) >= 3,
        "enough_depth": len(md.split()) >= 700,
        "has_data_points": len(re.findall(r"\d+(?:\.\d+)?%|\[STAT", md)) >= 2,
    }
    return {"checks": checks, "score": round(100 * sum(checks.values()) / len(checks))}


# --------------------------------------------------------------------------- #
# 4. One call to plug into routes/analyze.py
# --------------------------------------------------------------------------- #
def citation_gaps_with_suggestions(responses: List[Dict], target_url: str, competitor_urls: List[str],
                                   industry: str, keywords: List[str], region: str = "",
                                   gen: Optional[TextGenerator] = None) -> Dict:
    """Observed sources from this run's answers + input-driven suggestions for everything else."""
    from .listing_finder import find_platforms  # local import avoids a circular import
    cit = analyze_citation_gaps(responses, target_url, competitor_urls, industry)
    cit["suggested"] = find_platforms(target_url, competitor_urls, keywords, industry, region,
                                      exclude={o["domain"] for o in cit["observed"]}, gen=gen)
    return cit


def run_advisor(responses: List[Dict], target_url: str, competitor_urls: List[str], industry: str,
                keywords: List[str], scores: Dict, signals: Dict,
                gen: Optional[TextGenerator] = None, region: str = "") -> Dict:
    gen = gen or TextGenerator()
    gaps = find_content_gaps(responses, target_url, competitor_urls)
    cit = citation_gaps_with_suggestions(responses, target_url, competitor_urls, industry, keywords, region, gen)
    recs = generate_recommendations(target_url, industry, keywords, scores, signals, gaps, cit, gen)
    return {
        "recommendations": recs,
        "citation_gaps": cit,
        "content_gaps": gaps,
        "blog_topic_suggestions": [g["query"] for g in gaps[:5]],
    }
