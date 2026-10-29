// Demo mode: used only when the FastAPI backend is unreachable, so the UI can
// always be shown. Every screen labels demo data clearly. Mirrors the backend
// logic (query_generator.py / content_advisor.py) closely.
import type {
  AnalysisResult, AnalyzeRequest, BlogDraft, BlogPart, BlogRequest, GeneratedQuery, QueryResult,
} from "./types";
import { brandFromUrl, domainOf } from "./utils";

function rng(seedStr: string) {
  let h = 2166136261;
  for (let i = 0; i < seedStr.length; i++) h = Math.imul(h ^ seedStr.charCodeAt(i), 16777619);
  return () => {
    h += 0x6d2b79f5;
    let t = h;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const pick = <T,>(r: () => number, a: T[]) => a[Math.floor(r() * a.length)];
const year = new Date().getFullYear();

const DISCOVERY: Record<string, string[]> = {
  best_of: ["What are the best {kw} options in {year}?", "Top 5 {kw} tools you would recommend right now", "Which {kw} do experts recommend the most?"],
  comparison: ["Compare the leading {kw} options for {a_persona}", "What are the main differences between the most popular {kw} tools?"],
  alternatives: ["What are good alternatives to {competitor} for {kw}?", "Is there anything better than {competitor} for {kw}?"],
  problem_solving: ["I'm {a_persona} looking for a {kw}. What should I pick and why?", "How do I choose the right {kw}? Give me specific options."],
  budget: ["What is the most affordable {kw} for {a_persona}?", "Are there free or low-cost {kw} options that are actually good?"],
  feature: ["Which {kw} has the best integrations and ease of use?", "Which {kw} is the most reliable for long-term use?"],
};
const BRANDED = ["What is {brand} and is it any good?", "What are the pros and cons of {brand}?", "What do users say about {brand}?", "{brand} vs {competitor}: which is better for {kw}?"];
const PERSONAS = ["startup founder", "small team", "enterprise IT manager", "freelancer"];
const art = (p: string) => (/^[aeiou]/i.test(p) ? "an " : "a ") + p;

export function demoQueries(req: Pick<AnalyzeRequest, "url" | "keywords" | "competitors" | "per_keyword" | "branded_per_keyword">): GeneratedQuery[] {
  const brand = brandFromUrl(req.url);
  const comps = req.competitors.filter(Boolean).map(brandFromUrl);
  if (!comps.length) comps.push("the market leader");
  const out: GeneratedQuery[] = [];
  const seen = new Set<string>();
  for (const kw of req.keywords.filter(Boolean)) {
    const r = rng(kw + req.url);
    const intents = Object.keys(DISCOVERY).sort(() => r() - 0.5);
    const pools = Object.fromEntries(intents.map((i) => [i, [...DISCOVERY[i]].sort(() => r() - 0.5)]));
    let count = 0, idx = 0;
    while (count < req.per_keyword && intents.some((i) => pools[i].length)) {
      const intent = intents[idx++ % intents.length];
      const tpl = pools[intent].pop();
      if (!tpl) continue;
      const text = tpl.replace("{kw}", kw).replace("{year}", String(year))
        .replace("{a_persona}", art(pick(r, PERSONAS))).replace("{competitor}", pick(r, comps));
      if (!seen.has(text)) { seen.add(text); out.push({ text, intent, keyword: kw, family: "discovery" }); count++; }
    }
    for (const tpl of [...BRANDED].sort(() => r() - 0.5).slice(0, req.branded_per_keyword)) {
      const text = tpl.replace("{brand}", brand).replace("{competitor}", pick(r, comps)).replace("{kw}", kw);
      if (!seen.has(text)) { seen.add(text); out.push({ text, intent: "branded", keyword: kw, family: "branded" }); }
    }
  }
  return out;
}

export function demoAnalysis(req: AnalyzeRequest): AnalysisResult {
  const r = rng(req.url + req.keywords.join());
  const brand = brandFromUrl(req.url);
  const comps = req.competitors.filter(Boolean);
  const compNames = comps.map(brandFromUrl);
  const queries = demoQueries(req);
  const baseRate = 0.45 + r() * 0.3;

  const results: QueryResult[] = [];
  for (const q of queries) {
    for (const p of req.providers) {
      const bias = { ChatGPT: 0.08, Gemini: 0, Perplexity: -0.06, Claude: 0.03 }[p] ?? 0;
      const mentioned = q.family === "branded" ? true : r() < baseRate + bias;
      const others = compNames.filter(() => r() < 0.55);
      results.push({
        provider: p, query: q.text, keyword: q.keyword, intent: q.intent, family: q.family, mentioned,
        position: mentioned ? pick(r, ["Early", "Mid", "Late"] as const) : null,
        cited: mentioned && r() < (p === "Perplexity" ? 0.5 : 0.25),
        sentiment: mentioned ? pick(r, ["Positive", "Positive", "Neutral", "Neutral", "Negative"] as const) : null,
        rank: mentioned ? 1 + Math.floor(r() * (others.length + 1)) : null,
        competitors_mentioned: others,
        consistency: req.repeats > 1 ? Math.round((0.55 + r() * 0.45) * 100) / 100 : null,
        excerpt: [...others.slice(0, 2).map((c) => `${c} is a popular choice for ${q.keyword}.`),
          mentioned ? `${brand} is also worth considering if it fits your needs.` : ""].join(" ").trim() || undefined,
      });
    }
  }
  const disc = results.filter((x) => x.family === "discovery");
  const rate = (a: QueryResult[], f: (x: QueryResult) => boolean) => (a.length ? a.filter(f).length / a.length : 0);
  const vis = (a: QueryResult[]) => Math.round(100 * (0.7 * rate(a, (x) => x.mentioned) + 0.3 * rate(a, (x) => x.cited)) + 8 * (rate(a, (x) => x.sentiment === "Positive") - rate(a, (x) => x.sentiment === "Negative")));
  const clamp = (n: number) => Math.max(0, Math.min(100, Math.round(n)));
  const ai = clamp(vis(disc));
  const geo = clamp(40 + r() * 30), seo = clamp(55 + r() * 30);

  const ourMentions = disc.filter((x) => x.mentioned).length;
  const compMentions = compNames.map((c) => disc.filter((x) => x.competitors_mentioned.includes(c)).length);
  const total = ourMentions + compMentions.reduce((a, b) => a + b, 0) || 1;

  const lost = new Map<string, { providers: Set<string>; comps: Set<string>; keyword: string | null }>();
  for (const x of disc) if (!x.mentioned && x.competitors_mentioned.length) {
    const g = lost.get(x.query) ?? { providers: new Set(), comps: new Set(), keyword: x.keyword };
    g.providers.add(String(x.provider)); x.competitors_mentioned.forEach((c) => g.comps.add(c)); lost.set(x.query, g);
  }
  const content_gaps = [...lost.entries()].map(([query, g]) => ({
    query, keyword: g.keyword, lost_on_providers: [...g.providers].sort(),
    competitors_recommended_instead: [...g.comps].sort(), severity: g.providers.size,
  })).sort((a, b) => b.severity - a.severity);

  const observed: AnalysisResult["advisor"]["citation_gaps"]["observed"] = []; // simulated answers have no real citations
  const suggested = demoPlatforms(req);
  const evidence = [
    { id: "E1", kind: "score", detail: `ai_visibility = ${ai}/100` },
    { id: "E2", kind: "on_page", detail: "No schema.org JSON-LD structured data found" },
    { id: "E3", kind: "on_page", detail: "robots.txt blocks one or more AI crawlers (GPTBot, PerplexityBot)" },
    { id: "E4", kind: "on_page", detail: "No FAQ or question-style headings" },
    ...content_gaps.slice(0, 2).map((g, i) => ({ id: `E${5 + i}`, kind: "lost_query", detail: `"${g.query}": ${g.competitors_recommended_instead.join(", ")} mentioned instead of you on ${g.lost_on_providers.join(", ")}` })),
  ];
  const ev = (prefix: string) => evidence.filter((e) => e.detail.includes(prefix)).map((e) => e.id);
  const recommendations = [
    { priority: "high", category: "Technical", title: "Allow AI crawlers in robots.txt", why: "Assistants can't read or cite pages their crawlers are blocked from.", action_steps: ["Allow GPTBot, PerplexityBot and Google-Extended", "Keep only private paths disallowed"], evidence_ids: ev("robots"), effort: "low" },
    { priority: "high", category: "Structured Data", title: "Add Organization and FAQPage schema", why: "Structured data lets AI crawlers extract facts about you reliably.", action_steps: ["Add Organization JSON-LD to the homepage", "Add FAQPage JSON-LD to key landing pages"], evidence_ids: ev("JSON-LD"), effort: "low" },
    ...content_gaps.slice(0, 2).map((g) => ({ priority: "high", category: "Content", title: `Publish an answer to "${g.query}"`, why: `${g.competitors_recommended_instead.join(", ")} get recommended here and you don't.`, action_steps: ["Draft it in Content Studio", "Include a comparison table and sourced data"], evidence_ids: ev(g.query), effort: "medium" })),
    ...suggested.slice(0, 2).map((o) => ({ priority: "medium", category: "Off-site presence", title: `Get listed on ${o.domain}`, why: o.why ?? "", action_steps: [o.action], evidence_ids: [], effort: "medium" })),
    { priority: "medium", category: "Content", title: "Add question headings with direct answers", why: "Assistants often lift a short, direct answer that follows a question heading.", action_steps: ["Rewrite H2s as the questions users ask", "Answer each in 40–60 words first"], evidence_ids: ev("FAQ"), effort: "medium" },
  ] as AnalysisResult["advisor"]["recommendations"]["recommendations"];

  const provider_scores = req.providers.map((p) => {
    const a = disc.filter((x) => x.provider === p);
    return { provider: p, visibility: clamp(vis(a)), mention_rate: Math.round(100 * rate(a, (x) => x.mentioned)), citation_rate: Math.round(100 * rate(a, (x) => x.cited)) };
  });

  return {
    id: `demo-${Date.now()}`, created_at: new Date().toISOString(), mode: "demo", brand, request: req,
    scores: { ai_visibility: ai, geo, seo, share_of_voice: Math.round((100 * ourMentions) / total) },
    geo_breakdown: [
      { factor: "Structured data", score: clamp(20 + r() * 30), detail: "No Organization or FAQPage JSON-LD on key pages" },
      { factor: "Direct answers", score: clamp(40 + r() * 40), detail: "Few question headings followed by short answers" },
      { factor: "Citable data", score: clamp(30 + r() * 40), detail: "Low density of statistics and sourced facts" },
      { factor: "Authority signals", score: clamp(40 + r() * 40), detail: "Authors and credentials missing on most articles" },
      { factor: "Freshness", score: clamp(50 + r() * 40), detail: "Several key pages not updated in over a year" },
      { factor: "AI crawler access", score: clamp(r() * 60), detail: "robots.txt blocks GPTBot" },
    ],
    provider_scores,
    competitors: [
      { domain: domainOf(req.url), is_you: true, ai_visibility: ai, geo, seo, share_of_voice: Math.round((100 * ourMentions) / total) },
      ...comps.map((c, i) => ({ domain: domainOf(c), is_you: false, ai_visibility: clamp(30 + r() * 55), geo: clamp(40 + r() * 50), seo: clamp(45 + r() * 45), share_of_voice: Math.round((100 * compMentions[i]) / total) })),
    ],
    query_results: results,
    advisor: {
      recommendations: { mode: "demo", evidence, recommendations },
      citation_gaps: {
        observed,
        suggested,
        summary: { responses_analyzed: results.length, answers_where_competitor_won: disc.filter((x) => !x.mentioned && x.competitors_mentioned.length).length, unique_sources_cited: 0 },
      },
      content_gaps,
      blog_topic_suggestions: content_gaps.slice(0, 5).map((g) => g.query),
    },
    stability: req.repeats > 1 ? { repeats: req.repeats, avg_consistency: Math.round(100 * results.reduce((a, x) => a + (x.consistency ?? 0), 0) / results.length) / 100 } : null,
  };
}

// Mirrors backend/app/listing_finder.py (niche_match only; web search and AI suggestions need the backend).
const NICHES: Record<string, { label: string; triggers: string[]; IN: [string, string][]; GLOBAL: [string, string][] }> = {
  baby_kids: { label: "baby and kids products", triggers: ["baby", "babies", "infant", "toddler", "kids", "child", "children", "mom", "mother", "parent", "newborn", "solids", "first food", "weaning", "nursery"],
    IN: [["firstcry.com", "marketplace"], ["amazon.in", "marketplace"], ["babychakra.com", "community"], ["parentune.com", "community"], ["momspresso.com", "community"]],
    GLOBAL: [["amazon.com", "marketplace"], ["babycenter.com", "publisher"], ["whattoexpect.com", "community"], ["reddit.com", "community"]] },
  food: { label: "food and groceries", triggers: ["food", "organic", "rice", "ragi", "millet", "grocery", "snack", "flour", "dal", "spice", "tea", "coffee", "staple", "cereal", "nutrition"],
    IN: [["amazon.in", "marketplace"], ["bigbasket.com", "marketplace"], ["jiomart.com", "marketplace"], ["blinkit.com", "marketplace"], ["youtube.com", "video"]],
    GLOBAL: [["amazon.com", "marketplace"], ["walmart.com", "marketplace"], ["reddit.com", "community"], ["youtube.com", "video"]] },
  software: { label: "software and SaaS", triggers: ["software", "saas", "app", "tool", "platform", "crm", "project management", "knowledge base", "workspace", "api", "automation", "analytics"],
    IN: [["g2.com", "review_platform"], ["capterra.com", "review_platform"], ["producthunt.com", "review_platform"], ["alternativeto.net", "review_platform"], ["reddit.com", "community"]],
    GLOBAL: [["g2.com", "review_platform"], ["capterra.com", "review_platform"], ["producthunt.com", "review_platform"], ["trustradius.com", "review_platform"], ["reddit.com", "community"]] },
  travel: { label: "travel and hospitality", triggers: ["hotel", "travel", "trip", "resort", "tour", "homestay", "holiday", "vacation"],
    IN: [["tripadvisor.in", "review_platform"], ["makemytrip.com", "marketplace"], ["booking.com", "marketplace"], ["goibibo.com", "marketplace"]],
    GLOBAL: [["tripadvisor.com", "review_platform"], ["booking.com", "marketplace"], ["expedia.com", "marketplace"]] },
  fashion_beauty: { label: "fashion and beauty", triggers: ["clothing", "fashion", "shoes", "footwear", "apparel", "skincare", "beauty", "cosmetics", "makeup", "jewellery"],
    IN: [["myntra.com", "marketplace"], ["nykaa.com", "marketplace"], ["ajio.com", "marketplace"], ["amazon.in", "marketplace"]],
    GLOBAL: [["amazon.com", "marketplace"], ["trustpilot.com", "review_platform"], ["reddit.com", "community"]] },
  education: { label: "education and courses", triggers: ["course", "college", "school", "learn", "learning", "tuition", "coaching", "training", "exam"],
    IN: [["shiksha.com", "review_platform"], ["collegedunia.com", "review_platform"], ["quora.com", "community"], ["youtube.com", "video"]],
    GLOBAL: [["coursereport.com", "review_platform"], ["reddit.com", "community"], ["quora.com", "community"]] },
};
const ACTION: Record<string, (d: string) => string> = {
  marketplace: (d) => `List your products on ${d} with complete specs and collect verified reviews.`,
  review_platform: (d) => `Create or claim your profile on ${d}, complete every field, and ask recent customers for reviews.`,
  community: (d) => `Join relevant ${d} discussions with genuinely helpful answers, and disclose your affiliation.`,
  publisher: (d) => `Pitch ${d} with original data, an expert quote, or a guest article.`,
  video: (d) => `Publish a short demo or explainer on ${d}.`,
};

function demoPlatforms(req: AnalyzeRequest) {
  const text = ` ${(req.keywords.join(" ") + " " + req.industry).toLowerCase()} `;
  const india = /india|chennai|mumbai|delhi|bengaluru|bangalore|hyderabad|coimbatore|pune|kochi|tamil|kerala|karnataka/i.test(req.region ?? "") || domainOf(req.url).endsWith(".in");
  const niches = Object.entries(NICHES)
    .map(([k, n]) => [k, n.triggers.filter((w) => new RegExp(`\\b${w}(?:s|es)?\\b`).test(text)).length] as const)
    .filter(([, c]) => c > 0).sort((x, y) => y[1] - x[1]).slice(0, 2).map(([k]) => NICHES[k]);
  const own = new Set([domainOf(req.url), ...req.competitors.map(domainOf)]);
  const lists = niches.map((n) => (india ? n.IN : n.GLOBAL).map(([d, t]) => ({ d, t, n })));
  const out: AnalysisResult["advisor"]["citation_gaps"]["suggested"] = [];
  for (let row = 0; row < Math.max(0, ...lists.map((l) => l.length)); row++) {
    for (const l of lists) {
      const x = l[row];
      if (x && !own.has(x.d) && !out.some((o) => o.domain === x.d)) {
        out.push({ domain: x.d, type: x.t, origins: ["niche_match"], why: `A leading platform for ${x.n.label} in ${india ? "India" : "your market"}.`,
          action: (ACTION[x.t] ?? ACTION.publisher)(x.d), evidence: "suggested" });
      }
    }
  }
  if (!out.length) for (const [d, t] of [["reddit.com", "community"], ["quora.com", "community"], ["youtube.com", "video"]] as const)
    out.push({ domain: d, type: t, origins: ["niche_match"], why: "A general platform AI assistants often cite.", action: ACTION[t](d), evidence: "suggested" });
  return out.slice(0, 8);
}

export function demoBlog(req: BlogRequest): BlogDraft {
  const brand = brandFromUrl(req.url);
  const primary = req.keywords[0] || req.topic;
  const comps = req.competitors.filter(Boolean).map(brandFromUrl).slice(0, 3);
  const title = `How to choose the right ${primary} in ${year}`;
  const faq = [
    { question: `What should I look for in a ${primary}?`, answer: `Start with ease of use, pricing that fits your budget, dependable support, and integrations with the tools you already use. Shortlist two or three options and test each on a real task before you commit.` },
    { question: `Is ${brand} a good choice for ${primary}?`, answer: `${brand} is worth evaluating if its features match your needs. Compare it with alternatives on price, features and independent reviews, and use a free trial where one is offered.` },
    { question: `How much does a ${primary} cost?`, answer: `Pricing varies by provider and plan. [STAT: typical monthly price range in this market] Check whether pricing is per user, per month, or a one-time fee.` },
  ];
  const rows = [brand, ...comps].map((n) => `| ${n} | [FACT: best-known strength] | [FACT: pricing model] |`).join("\n");
  const markdown = `# ${title}

**Quick answer:** The right ${primary} depends on your team size, budget and the tools you already use. This guide shows what to compare, how ${brand} stacks up against ${comps.join(", ") || "the alternatives"}, and a checklist for deciding this week.

## What is a ${primary}?
A ${primary} is a shared place where a team stores, organises and finds what it knows. [SOURCE: authoritative definition]

## Why does choosing the right one matter?
The wrong tool creates scattered information and repeated questions. [STAT: time employees spend searching for information]

## How do you compare the options?
Score each candidate on the same five things: setup time, search quality, permissions, integrations and total cost over a year.

| Option | Strength | Pricing |
|---|---|---|
${rows}

## What should be on your checklist?
- List your three must-have requirements
- Shortlist two or three tools
- Trial each on a real project for a week
- Read reviews on independent platforms
- Confirm the total cost for your team size

## FAQ
${faq.map((f) => `### ${f.question}\n${f.answer}\n`).join("\n")}`;
  const chunks = markdown.split("\n").slice(2).join("\n").split(/\n(?=## )/).filter((c) => !c.startsWith("## FAQ"));
  const parts: BlogPart[] = chunks.map((c, i) => ({
    id: i === 0 ? "intro" : `s${i}`, kind: i === 0 ? "intro" : "section",
    heading: i === 0 ? "" : c.split("\n")[0].replace(/^#+\s*/, ""), markdown: c.trim(),
  }));
  parts.push({ id: "faq", kind: "faq", heading: "FAQ", markdown: "## FAQ\n\n" + faq.map((f) => `### ${f.question}\n${f.answer}`).join("\n\n") });
  const words = markdown.toLowerCase().match(/[a-z0-9']+/g) ?? [];
  const count = (k: string) => (markdown.toLowerCase().match(new RegExp(`\\b${k.toLowerCase().replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\b`, "g")) ?? []).length;
  const pc = count(primary);
  const density = Math.round((10000 * pc * primary.split(" ").length) / Math.max(words.length, 1)) / 100;
  const today = new Date().toISOString().slice(0, 10);
  return {
    topic: req.topic, title, meta_title: title.slice(0, 60), article_type: "buyers_guide", parts,
    sources: [], brand_facts: {}, research_used: false,
    meta_description: `Compare ${primary} options, see what matters most, and use a simple checklist to choose the right one.`.slice(0, 155),
    slug: title.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, ""),
    primary_keyword: primary, secondary_keywords: req.keywords.slice(1),
    outline: [`What is a ${primary}?`, "Why does choosing the right one matter?", "How do you compare the options?", "What should be on your checklist?"],
    markdown, faq,
    json_ld: {
      "@context": "https://schema.org",
      "@graph": [
        { "@type": "Article", headline: title, datePublished: today, dateModified: today, author: { "@type": "Organization", name: brand, url: req.url } },
        { "@type": "FAQPage", mainEntity: faq.map((f) => ({ "@type": "Question", name: f.question, acceptedAnswer: { "@type": "Answer", text: f.answer } })) },
      ],
    },
    keyword_report: {
      word_count: words.length,
      primary: { keyword: primary, count: pc, density_pct: density, in_title: true, in_first_100_words: true, in_h2: true, density_ok: density >= 0.5 && density <= 2.5 },
      secondary: req.keywords.slice(1).map((k) => ({ keyword: k, count: count(k) })),
    },
    geo_check: { score: 86, checks: { direct_answer_at_top: true, question_headings: true, has_table: true, has_list: true, has_faq: true, enough_depth: false, has_data_points: true } },
    facts_to_verify: [...new Set(markdown.match(/\[(?:STAT|SOURCE|QUOTE|FACT):[^\]]*\]/g) ?? [])],
    mode: "demo",
    distribution_plan: [
      `Publish at ${req.url.replace(/\/$/, "")}/blog/… with the JSON-LD in the page head`,
      "Share a summary on LinkedIn and in relevant community threads, disclosing your affiliation",
      "Turn the FAQ into a short video or carousel",
      "Re-run the analysis for these queries in 3–4 weeks to measure the change",
    ],
  };
}
