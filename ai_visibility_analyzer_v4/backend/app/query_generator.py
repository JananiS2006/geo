"""
Query Generator v2 - expands each target keyword into many realistic,
intent-diverse prompts (instead of a few fixed ones).

Two query families are kept SEPARATE on purpose:
  * discovery queries - never mention the brand. They measure whether the LLM
    brings the brand up on its own. Only these feed the AI Visibility Score.
  * branded queries   - name the brand. They measure what the LLM *says* about
    it (sentiment, accuracy). Mixing them into mention rate would inflate it,
    since a prompt that names the brand will almost always mention it.
"""
from __future__ import annotations

import hashlib
import random
import re
from dataclasses import asdict, dataclass
from datetime import datetime
from typing import List, Optional
from urllib.parse import urlparse

from .llm_writer import TextGenerator

YEAR = datetime.now().year

DISCOVERY_TEMPLATES = {
    "best_of": [
        "What are the best {kw} options in {year}?",
        "Top 5 {kw} tools you would recommend right now",
        "Which {kw} do experts recommend the most?",
    ],
    "comparison": [
        "Compare the leading {kw} options for {a_persona}",
        "What are the main differences between the most popular {kw} tools?",
    ],
    "alternatives": [
        "What are good alternatives to {competitor} for {kw}?",
        "Is there anything better than {competitor} for {kw}?",
    ],
    "problem_solving": [
        "I'm {a_persona} looking for a {kw}. What should I pick and why?",
        "How do I choose the right {kw}? Give me specific options.",
    ],
    "budget": [
        "What is the most affordable {kw} for {a_persona}?",
        "Are there free or low-cost {kw} options that are actually good?",
    ],
    "feature": [
        "Which {kw} has the best integrations and ease of use?",
        "Which {kw} is the most reliable for long-term use?",
    ],
    "local": [
        "What are the best {kw} options in {region}?",
    ],
}

BRANDED_TEMPLATES = [
    "What is {brand} and is it any good?",
    "What are the pros and cons of {brand}?",
    "What do users say about {brand}?",
    "{brand} vs {competitor}: which is better for {kw}?",
]

PERSONAS = {
    "saas": ["startup founder", "small team", "enterprise IT manager", "freelancer"],
    "ecommerce": ["first-time buyer", "budget shopper", "gift buyer", "frequent online shopper"],
    "education": ["student", "working professional", "parent", "teacher"],
    "healthcare": ["patient", "caregiver", "small clinic owner"],
    "finance": ["salaried employee", "small business owner", "first-time investor"],
    "travel": ["solo traveller", "family", "business traveller"],
    "default": ["beginner", "small business owner", "professional", "student"],
}


@dataclass
class GeneratedQuery:
    text: str
    intent: str
    keyword: str
    family: str  # "discovery" | "branded"

    def to_dict(self):
        return asdict(self)


def brand_from_url(url: str) -> str:
    host = urlparse(url if "://" in url else f"https://{url}").netloc.lower()
    host = host.removeprefix("www.")
    name = host.split(".")[0] if host else url
    known = {"clickup": "ClickUp", "hubspot": "HubSpot", "youtube": "YouTube", "linkedin": "LinkedIn",
             "github": "GitHub", "paypal": "PayPal", "wordpress": "WordPress"}
    return known.get(name, name.replace("-", " ").title())


def _personas(industry: Optional[str]) -> List[str]:
    key = (industry or "").lower()
    for k, v in PERSONAS.items():
        if k != "default" and k in key:
            return v
    if "software" in key:
        return PERSONAS["saas"]
    return PERSONAS["default"]


def _norm(text: str) -> str:
    return re.sub(r"[^a-z0-9 ]", "", text.lower()).strip()


def _seeded_rng(*parts: str) -> random.Random:
    seed = int(hashlib.md5("|".join(parts).encode()).hexdigest()[:8], 16)
    return random.Random(seed)  # deterministic -> same inputs give same prompts (reproducible runs)


def generate_queries(
    keywords: List[str],
    brand_url: str,
    competitors: Optional[List[str]] = None,
    industry: Optional[str] = None,
    region: Optional[str] = None,
    per_keyword: int = 8,
    branded_per_keyword: int = 2,
    llm_expand: int = 0,
    generator: Optional[TextGenerator] = None,
) -> List[GeneratedQuery]:
    """Return a de-duplicated list of prompts.

    per_keyword:   discovery prompts per keyword (round-robin across intents)
    llm_expand:    extra prompts per keyword written by an LLM (0 = off)
    """
    competitors = competitors or []
    comp_names = [brand_from_url(c) for c in competitors] or ["the market leader"]
    brand = brand_from_url(brand_url)
    personas = _personas(industry)

    out: List[GeneratedQuery] = []
    seen = set()

    def add(text, intent, kw, family):
        n = _norm(text)
        if n and n not in seen:
            seen.add(n)
            out.append(GeneratedQuery(text, intent, kw, family))

    for kw in keywords:
        kw = kw.strip()
        if not kw:
            continue
        rng = _seeded_rng(kw, brand_url, industry or "")
        intents = [i for i in DISCOVERY_TEMPLATES if i != "local" or region]
        rng.shuffle(intents)

        # Round-robin over intents so a small per_keyword still covers many intents.
        pools = {i: rng.sample(DISCOVERY_TEMPLATES[i], len(DISCOVERY_TEMPLATES[i])) for i in intents}
        count, idx = 0, 0
        while count < per_keyword and any(pools.values()):
            intent = intents[idx % len(intents)]
            idx += 1
            if not pools[intent]:
                continue
            tpl = pools[intent].pop()
            persona = rng.choice(personas)
            a_persona = ("an " if persona[0].lower() in "aeiou" else "a ") + persona
            text = tpl.format(kw=kw, year=YEAR, a_persona=a_persona,
                              competitor=rng.choice(comp_names), region=region or "")
            before = len(out)
            add(text, intent, kw, "discovery")
            count += len(out) > before

        for tpl in rng.sample(BRANDED_TEMPLATES, min(branded_per_keyword, len(BRANDED_TEMPLATES))):
            add(tpl.format(brand=brand, competitor=rng.choice(comp_names), kw=kw),
                "branded", kw, "branded")

        if llm_expand and generator and generator.available:
            for q in _llm_questions(generator, kw, industry, llm_expand, brand):
                add(q, "llm_generated", kw, "discovery")

    return out


def _llm_questions(gen: TextGenerator, kw: str, industry: Optional[str], n: int, brand: str) -> List[str]:
    system = ("You simulate real people typing questions into an AI assistant while researching "
              "a purchase or solution. Return JSON only.")
    user = (f'Write {n} different, natural questions a real user might ask about "{kw}"'
            f'{f" in the {industry} industry" if industry else ""}. Vary intent (comparison, '
            f'budget, problem, recommendation). Do NOT mention any brand names, especially "{brand}". '
            f'Return: {{"questions": ["...", "..."]}}')
    try:
        data = gen.complete_json(system, user, temperature=0.9)
        qs = data.get("questions", []) if isinstance(data, dict) else data
        return [q for q in qs if isinstance(q, str) and brand.lower() not in q.lower()][:n]
    except Exception:
        return []


def estimate_api_calls(n_queries: int, n_providers: int, repeats: int = 1) -> int:
    """Each prompt is sent to each provider `repeats` times (repeats>1 measures stability)."""
    return n_queries * n_providers * repeats
