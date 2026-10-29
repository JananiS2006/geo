// Recomputes the draft's checks in the browser after a section is rewritten,
// mirroring keyword_report() and quick_geo_check() in content_advisor.py.
import type { BlogDraft, BlogPart } from "./types";

export const PLACEHOLDER_RE = /\[(?:STAT|SOURCE|QUOTE|FACT):[^\]]*\]/gi;
const esc = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

export function assemble(title: string, parts: BlogPart[]) {
  return `# ${title}\n\n` + parts.map((p) => p.markdown.trim()).filter(Boolean).join("\n\n") + "\n";
}

export function recompute(draft: BlogDraft, parts: BlogPart[]): BlogDraft {
  const md = assemble(draft.title, parts);
  const text = md.toLowerCase();
  const words = text.match(/[a-z0-9']+/g) ?? [];
  const count = (k: string) => (text.match(new RegExp(`\\b${esc(k.toLowerCase())}\\b`, "g")) ?? []).length;
  const primary = draft.primary_keyword;
  const pc = count(primary);
  const density = Math.round((10000 * pc * Math.max(primary.split(" ").length, 1)) / Math.max(words.length, 1)) / 100;
  const h2 = [...md.matchAll(/^##\s+(.+)$/gm)].map((m) => m[1]);
  const checks = {
    direct_answer_at_top: /tl;dr|in short|quick answer/i.test(md.slice(0, 900)),
    question_headings: h2.filter((h) => h.trim().endsWith("?")).length >= 2,
    has_table: /^\|.+\|\s*$/m.test(md),
    has_list: /^\s*[-*]\s+/m.test(md),
    has_faq: draft.faq.length >= 3,
    enough_depth: md.split(/\s+/).length >= 700,
    has_data_points: (md.match(/\d+(?:\.\d+)?%|\[STAT/g) ?? []).length >= 2,
  };
  return {
    ...draft, parts, markdown: md,
    keyword_report: {
      word_count: words.length,
      primary: {
        keyword: primary, count: pc, density_pct: density,
        in_title: draft.title.toLowerCase().includes(primary.toLowerCase()),
        in_first_100_words: words.slice(0, 100).join(" ").includes(primary.toLowerCase()),
        in_h2: h2.join(" ").toLowerCase().includes(primary.toLowerCase()),
        density_ok: density >= 0.5 && density <= 2.5,
      },
      secondary: draft.secondary_keywords.map((k) => ({ keyword: k, count: count(k) })),
    },
    geo_check: { checks, score: Math.round((100 * Object.values(checks).filter(Boolean).length) / Object.keys(checks).length) },
    facts_to_verify: [...new Set(md.match(PLACEHOLDER_RE) ?? [])].sort(),
  };
}
