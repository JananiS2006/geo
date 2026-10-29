// API contract between the React app and the FastAPI backend.
// backend/app/result_builder.py produces exactly this shape.

export type Provider = "ChatGPT" | "Gemini" | "Perplexity" | "Claude";
export const ALL_PROVIDERS: Provider[] = ["ChatGPT", "Gemini", "Perplexity", "Claude"];

export interface AnalyzeRequest {
  url: string;
  competitors: string[];
  keywords: string[];
  industry: string;
  region?: string;
  providers: Provider[];
  per_keyword: number;
  branded_per_keyword: number;
  repeats: number;
}

export interface GeneratedQuery {
  text: string;
  intent: string;
  keyword: string;
  family: "discovery" | "branded";
}

export interface QueryResult {
  provider: Provider | string;
  query: string;
  keyword: string | null;
  intent: string;
  family: "discovery" | "branded";
  mentioned: boolean;
  position: "Early" | "Mid" | "Late" | null;
  cited: boolean;
  sentiment: "Positive" | "Neutral" | "Negative" | null;
  rank: number | null;
  competitors_mentioned: string[];
  consistency: number | null; // share of repeats where the mention outcome matched the majority (0-1)
  excerpt?: string; // slice of the real AI answer around the brand mention
}

export interface Scores {
  ai_visibility: number;
  geo: number;
  seo: number;
  share_of_voice: number;
}

export interface GeoFactor {
  factor: string;
  score: number;
  detail: string;
}

export interface ProviderScore {
  provider: string;
  visibility: number;
  mention_rate: number;
  citation_rate: number;
}

export interface CompetitorRow {
  domain: string;
  is_you: boolean;
  ai_visibility: number;
  geo: number;
  seo: number;
  share_of_voice: number;
}

export interface Evidence {
  id: string;
  kind: string;
  detail: string;
}

export interface Recommendation {
  priority: "high" | "medium" | "low";
  category: string;
  title: string;
  why: string;
  action_steps: string[];
  evidence_ids: string[];
  effort: string;
}

export interface ListingObserved {
  domain: string;
  type: string;
  times_cited: number;
  cited_when_we_were_missing: number;
  competitors_seen_with_it: string[];
  example_queries: string[];
  providers: string[];
  priority_score: number;
  action: string;
  evidence: string;
}

export interface ListingSuggested {
  domain: string;
  type: string;
  action: string;
  evidence: string;
  why?: string;
  origins?: ("web_search" | "ai_suggested" | "niche_match")[];
  score?: number;
}

export interface ContentGap {
  query: string;
  keyword: string | null;
  lost_on_providers: string[];
  competitors_recommended_instead: string[];
  severity: number;
}

export interface Advisor {
  recommendations: { mode: string; evidence: Evidence[]; recommendations: Recommendation[] };
  citation_gaps: {
    observed: ListingObserved[];
    suggested: ListingSuggested[];
    summary: { responses_analyzed: number; answers_where_competitor_won: number; unique_sources_cited: number };
  };
  content_gaps: ContentGap[];
  blog_topic_suggestions: string[];
}

export interface AnalysisResult {
  id: string;
  created_at: string;
  mode: "live" | "demo";
  brand: string;
  request: AnalyzeRequest;
  scores: Scores;
  geo_breakdown: GeoFactor[];
  provider_scores: ProviderScore[];
  competitors: CompetitorRow[];
  query_results: QueryResult[];
  advisor: Advisor;
  stability: { repeats: number; avg_consistency: number } | null;
  crawl_error?: string | null;
  mock_answers?: number; // set by the backend when some providers had no API key
}

export type ArticleType = "auto" | "listicle" | "honest_assessment" | "comparison" | "how_to" | "buyers_guide";

export interface BlogRequest {
  topic: string;
  url: string;
  keywords: string[];
  industry: string;
  competitors: string[];
  audience: string;
  tone: string;
  target_words: number;
  article_type: ArticleType;
  use_research: boolean;
  region?: string;
}

export interface BlogPart {
  id: string;
  kind: "intro" | "section" | "conclusion" | "faq" | "sources";
  heading: string;
  markdown: string;
}

export interface BrandFacts {
  summary?: string;
  products?: string[];
  differentiators?: string[];
  audience?: string;
  proof_points?: string[];
  pages_read?: string[];
  error?: string;
}

export type BlogEvent =
  | { type: "status"; step: string; message: string }
  | { type: "brand"; data: BrandFacts }
  | { type: "research"; data: { used: boolean; sources: { n: number; url: string }[]; error?: string } }
  | { type: "plan"; data: { title: string; article_type: string; sections: string[] } }
  | { type: "part"; index: number; part: BlogPart }
  | { type: "done"; draft: BlogDraft }
  | { type: "error"; message: string };

export interface BlogDraft {
  topic: string;
  title: string;
  article_type: string;
  parts: BlogPart[];
  sources: { n: number; url: string }[];
  brand_facts: BrandFacts;
  research_used: boolean;
  meta_title: string;
  meta_description: string;
  slug: string;
  primary_keyword: string;
  secondary_keywords: string[];
  outline: string[];
  markdown: string;
  faq: { question: string; answer: string }[];
  json_ld: Record<string, unknown>;
  keyword_report: {
    word_count: number;
    primary: {
      keyword: string;
      count: number;
      density_pct: number;
      in_title: boolean;
      in_first_100_words: boolean;
      in_h2: boolean;
      density_ok: boolean;
    };
    secondary: { keyword: string; count: number }[];
  };
  geo_check: { checks: Record<string, boolean>; score: number };
  facts_to_verify: string[];
  mode: string;
  distribution_plan: string[];
}
