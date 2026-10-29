import { useEffect, useRef, useState } from "react";
import { useSearchParams } from "react-router-dom";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { Check, Copy, Download, Globe, Loader2, PenLine, RotateCcw, Sparkles, Square, Wand2, X } from "lucide-react";
import { Badge, SectionTitle, Tabs } from "../components/ui";
import { backendStatus, rewritePart, streamBlog, type BackendStatus } from "../lib/api";
import { recompute } from "../lib/blogMetrics";
import { useStore } from "../lib/store";
import type { ArticleType, BlogDraft, BlogEvent, BlogPart, BrandFacts } from "../lib/types";
import { cn, download } from "../lib/utils";

const TYPES: { id: ArticleType; label: string; hint: string }[] = [
  { id: "auto", label: "Auto", hint: "Picked from the question" },
  { id: "listicle", label: "Listicle", hint: "Numbered picks with a comparison table" },
  { id: "honest_assessment", label: "Honest assessment", hint: "Where it fits, where it doesn't, better alternatives" },
  { id: "comparison", label: "Comparison", hint: "Verdict, table, criterion by criterion" },
  { id: "how_to", label: "How-to guide", hint: "Steps, requirements, mistakes to avoid" },
  { id: "buyers_guide", label: "Buyer's guide", hint: "What to look for, options, checklist" },
];
const TYPE_LABEL: Record<string, string> = Object.fromEntries(TYPES.map((t) => [t.id, t.label]));
const QUICK_EDITS = ["Make it shorter", "Add a concrete example", "More conversational", "Turn it into a table", "Add a labelled list"];
const CHECK_LABELS: Record<string, string> = {
  direct_answer_at_top: "Direct answer at the top", question_headings: "Headings phrased as questions", has_table: "Comparison table",
  has_list: "Scannable list", has_faq: "FAQ with 3+ questions", enough_depth: "700+ words of depth", has_data_points: "Data points or stats",
};
const PLACEHOLDER = /\[(STAT|SOURCE|QUOTE|FACT):\s*([^\]]*)\]/g;

function Markdown({ md }: { md: string }) {
  // Placeholders become highlighted chips so nobody publishes them by accident.
  const prepared = md.replace(PLACEHOLDER, (_, kind, text) => `\`⚑ ${kind}: ${text}\``);
  return (
    <div className="prose-article">
      <ReactMarkdown remarkPlugins={[remarkGfm]} components={{
        code: ({ children }) => {
          const s = String(children);
          return s.startsWith("⚑")
            ? <mark className="rounded-md bg-amber-100 px-1.5 py-0.5 text-[13px] font-semibold text-amber-800">{s.slice(2)}</mark>
            : <code className="rounded bg-canvas px-1">{children}</code>;
        },
        a: ({ href, children }) => <a href={href} target="_blank" rel="noreferrer" className="font-medium text-brand underline decoration-brand/30 underline-offset-2 hover:decoration-brand">{children}</a>,
        table: ({ children }) => <div className="my-4 overflow-x-auto"><table>{children}</table></div>,
      }}>{prepared}</ReactMarkdown>
    </div>
  );
}

function Tick({ ok, children }: { ok: boolean; children: string }) {
  return (
    <li className="flex items-center gap-2 text-sm">
      <span className={cn("grid h-5 w-5 shrink-0 place-items-center rounded-full", ok ? "bg-green-50 text-good" : "bg-rose-50 text-bad")}>{ok ? <Check size={12} /> : <X size={12} />}</span>
      {children}
    </li>
  );
}

function PartBlock({ part, editable, onRewrite, onUndo, canUndo }: {
  part: BlogPart; editable: boolean; onRewrite: (instruction: string) => Promise<void>; onUndo: () => void; canUndo: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  async function go(instruction: string) {
    if (!instruction.trim()) return;
    setBusy(true); setErr(null);
    try { await onRewrite(instruction); setOpen(false); setText(""); }
    catch (e) { setErr((e as Error).message); }
    finally { setBusy(false); }
  }
  return (
    <section className={cn("group relative -mx-3 rounded-xl px-3 py-1 transition", editable && "hover:bg-canvas/70", busy && "opacity-60")}>
      {editable && !open && (
        <div className="no-print absolute right-2 top-2 z-10 flex gap-1 opacity-0 transition group-hover:opacity-100 focus-within:opacity-100">
          {canUndo && <button onClick={onUndo} className="btn-ghost px-2 py-1 text-xs"><RotateCcw size={13} /> Undo</button>}
          <button onClick={() => setOpen(true)} className="btn-ghost px-2 py-1 text-xs"><Wand2 size={13} /> Rewrite</button>
        </div>
      )}
      {open && (
        <div className="no-print mb-3 mt-2 rounded-xl border border-brand/30 bg-white p-3 shadow-card">
          <div className="mb-2 flex flex-wrap gap-1.5">
            {QUICK_EDITS.map((q) => <button key={q} disabled={busy} onClick={() => go(q)} className="rounded-full border border-line bg-canvas px-2.5 py-1 text-xs font-medium text-ink-soft hover:text-ink">{q}</button>)}
          </div>
          <form className="flex gap-2" onSubmit={(e) => { e.preventDefault(); go(text); }}>
            <input autoFocus className="field py-2" placeholder="Or describe the change, e.g. mention the FSSAI certification" value={text} onChange={(e) => setText(e.target.value)} />
            <button className="btn-primary px-3 py-2" disabled={busy || !text.trim()}>{busy ? <Loader2 size={15} className="animate-spin" /> : "Apply"}</button>
            <button type="button" className="btn-ghost px-3 py-2" onClick={() => setOpen(false)}>Cancel</button>
          </form>
          {err && <p className="mt-2 text-sm text-bad">{err}</p>}
        </div>
      )}
      <Markdown md={part.markdown} />
    </section>
  );
}

function BrandPanel({ facts }: { facts: BrandFacts }) {
  const list = (label: string, items?: string[]) => items && items.length > 0 && (
    <div><h4 className="text-xs font-semibold uppercase tracking-wide text-ink-faint">{label}</h4>
      <ul className="mt-1 list-disc space-y-0.5 pl-4 text-sm">{items.map((x) => <li key={x}>{x}</li>)}</ul></div>
  );
  return (
    <div className="space-y-3">
      {facts.error && <p className="rounded-lg bg-rose-50 px-3 py-2 text-sm text-bad">{facts.error}</p>}
      {facts.summary && <p className="text-sm">{facts.summary}</p>}
      {list("Products", facts.products)}
      {list("Differentiators", facts.differentiators)}
      {list("Proof points", facts.proof_points)}
      {facts.pages_read && facts.pages_read.length > 0 && (
        <p className="text-xs text-ink-faint">Read from: {facts.pages_read.map((p) => p.replace(/^https?:\/\//, "")).join(", ")}</p>
      )}
    </div>
  );
}

export default function ContentStudio() {
  const { current } = useStore();
  const [params] = useSearchParams();
  const req = current?.request;
  const [status, setStatus] = useState<BackendStatus | null | undefined>(undefined);
  const [topic, setTopic] = useState(params.get("topic") || current?.advisor.blog_topic_suggestions[0] || "What are the best first foods for babies in India?");
  const [url, setUrl] = useState(req?.url ?? "https://lilcoo.in");
  const [keywords, setKeywords] = useState((req?.keywords ?? ["first foods for babies", "sprouted ragi powder for babies"]).join(", "));
  const [articleType, setArticleType] = useState<ArticleType>("auto");
  const [audience, setAudience] = useState("new parents");
  const [tone, setTone] = useState("helpful and expert");
  const [words, setWords] = useState(1500);
  const [research, setResearch] = useState(true);

  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [log, setLog] = useState<string[]>([]);
  const [plan, setPlan] = useState<{ title: string; article_type: string; sections: string[] } | null>(null);
  const [parts, setParts] = useState<BlogPart[]>([]);
  const [brand, setBrand] = useState<BrandFacts | null>(null);
  const [draft, setDraft] = useState<BlogDraft | null>(null);
  const [history, setHistory] = useState<Record<string, string[]>>({});
  const [view, setView] = useState<"article" | "seo" | "research">("article");
  const [copied, setCopied] = useState(false);
  const abort = useRef<AbortController | null>(null);

  useEffect(() => { backendStatus().then(setStatus); }, []);
  useEffect(() => { const t = params.get("topic"); if (t) setTopic(t); }, [params]);

  const live = status?.mode === "live";
  const canResearch = !!status?.research;

  function onEvent(e: BlogEvent) {
    if (e.type === "status") setLog((l) => [...l, e.message]);
    if (e.type === "brand") setBrand(e.data);
    if (e.type === "research" && !e.data.used && e.data.error) setLog((l) => [...l, `Research skipped: ${e.data.error}`]);
    if (e.type === "plan") setPlan(e.data);
    if (e.type === "part") setParts((p) => { const n = [...p]; n[e.index] = e.part; return n; });
    if (e.type === "done") { setDraft(e.draft); setParts(e.draft.parts); }
  }

  async function write() {
    abort.current?.abort();
    const ctrl = new AbortController();
    abort.current = ctrl;
    setBusy(true); setError(null); setLog([]); setPlan(null); setParts([]); setDraft(null); setBrand(null); setHistory({}); setView("article");
    try {
      await streamBlog({
        topic, url, keywords: keywords.split(",").map((k) => k.trim()).filter(Boolean), industry: req?.industry ?? "",
        competitors: req?.competitors ?? [], audience, tone, target_words: words, article_type: articleType,
        use_research: research && canResearch, region: req?.region ?? "",
      }, onEvent, ctrl.signal);
    } catch (e) {
      if ((e as Error).name !== "AbortError") setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  async function rewrite(i: number, instruction: string) {
    if (!draft) return;
    const md = await rewritePart({ markdown: parts[i].markdown, instruction, title: draft.title, url });
    setHistory((h) => ({ ...h, [parts[i].id]: [...(h[parts[i].id] ?? []), parts[i].markdown] }));
    const next = parts.map((p, j) => (j === i ? { ...p, markdown: md } : p));
    setParts(next);
    setDraft(recompute(draft, next));
  }

  function undo(i: number) {
    if (!draft) return;
    const stack = history[parts[i].id] ?? [];
    if (!stack.length) return;
    const next = parts.map((p, j) => (j === i ? { ...p, markdown: stack[stack.length - 1] } : p));
    setHistory((h) => ({ ...h, [parts[i].id]: stack.slice(0, -1) }));
    setParts(next);
    setDraft(recompute(draft, next));
  }

  const md = draft?.markdown ?? "";
  const schemaTag = draft ? `<script type="application/ld+json">\n${JSON.stringify(draft.json_ld, null, 2)}\n</script>` : "";
  const suggestions = current?.advisor.blog_topic_suggestions ?? [];
  const total = plan?.sections.length ?? 0;
  const doneCount = Math.min(parts.slice(0, total).filter(Boolean).length, total);
  const templateMode = draft && (draft.mode === "template" || draft.mode === "demo");

  return (
    <div className="grid gap-6 lg:grid-cols-[380px_1fr]">
      <aside className="panel h-fit p-6 lg:sticky lg:top-20">
        <h1 className="text-xl font-extrabold">Content Studio</h1>
        <p className="mt-1 text-sm text-ink-soft">Writes a full article that answers a question AI assistants currently answer with your competitors.</p>
        <p className={cn("mt-3 rounded-lg px-3 py-2 text-xs", status === undefined ? "bg-canvas text-ink-faint" : live ? "bg-green-50 text-green-800" : "bg-amber-50 text-amber-800")}>
          {status === undefined ? "Checking the writer…" : live ? `Writer: ${status!.writer_provider} (${status!.model})${canResearch ? " · web research on" : ""}`
            : status ? "No writer API key on the backend: drafts use the offline template." : "Backend offline: drafts use the offline demo."}
        </p>
        <form className="mt-5 space-y-4" onSubmit={(e) => { e.preventDefault(); write(); }}>
          <div>
            <label className="label" htmlFor="topic">Question to answer</label>
            <textarea id="topic" rows={3} className="field resize-none" value={topic} onChange={(e) => setTopic(e.target.value)} />
            {suggestions.length > 0 && (
              <div className="mt-2">
                <p className="mb-1.5 text-xs text-ink-faint">Queries you lost in your last analysis:</p>
                <div className="flex flex-wrap gap-1.5">
                  {suggestions.slice(0, 4).map((s) => (
                    <button type="button" key={s} onClick={() => setTopic(s)} className={cn("rounded-lg border px-2 py-1 text-left text-xs", s === topic ? "border-brand bg-brand-tint text-brand-dark" : "border-line bg-white text-ink-soft hover:text-ink")}>{s}</button>
                  ))}
                </div>
              </div>
            )}
          </div>
          <div>
            <label className="label" htmlFor="atype">Article type</label>
            <select id="atype" className="field" value={articleType} onChange={(e) => setArticleType(e.target.value as ArticleType)}>
              {TYPES.map((t) => <option key={t.id} value={t.id}>{t.label}</option>)}
            </select>
            <p className="mt-1 text-xs text-ink-faint">{TYPES.find((t) => t.id === articleType)?.hint}</p>
          </div>
          <div><label className="label" htmlFor="site">Your website</label><input id="site" className="field" value={url} onChange={(e) => setUrl(e.target.value)} /></div>
          <div><label className="label" htmlFor="kw">Keywords <span className="font-normal text-ink-faint">(first is primary)</span></label><input id="kw" className="field" value={keywords} onChange={(e) => setKeywords(e.target.value)} /></div>
          <div className="grid grid-cols-2 gap-3">
            <div><label className="label" htmlFor="aud">Audience</label><input id="aud" className="field" value={audience} onChange={(e) => setAudience(e.target.value)} /></div>
            <div><label className="label" htmlFor="tone">Tone</label>
              <select id="tone" className="field" value={tone} onChange={(e) => setTone(e.target.value)}>
                {["helpful and expert", "friendly", "formal", "conversational"].map((t) => <option key={t}>{t}</option>)}
              </select>
            </div>
          </div>
          <label className="block">
            <span className="flex justify-between text-sm font-semibold"><span>Length</span><span className="tnum">{words} words</span></span>
            <input type="range" min={800} max={3000} step={100} value={words} onChange={(e) => setWords(+e.target.value)} className="mt-1 w-full accent-brand" />
          </label>
          <label className={cn("flex items-start gap-2.5 rounded-xl border border-line p-3 text-sm", !canResearch && "opacity-60")}>
            <input type="checkbox" className="mt-0.5 accent-brand" checked={research && canResearch} disabled={!canResearch} onChange={(e) => setResearch(e.target.checked)} />
            <span><span className="font-semibold">Web research with sources</span>
              <span className="block text-xs text-ink-faint">{canResearch ? "Finds real facts and cites them as links" : "Needs a Gemini or Perplexity key on the backend"}</span></span>
          </label>
          {error && <p role="alert" className="rounded-xl bg-rose-50 px-3 py-2 text-sm text-bad">{error}</p>}
          {busy ? (
            <button type="button" className="btn-ghost w-full py-3" onClick={() => abort.current?.abort()}><Square size={14} /> Stop</button>
          ) : (
            <button className="btn-primary w-full py-3" disabled={!topic.trim()}><PenLine size={16} /> {draft ? "Write a new draft" : "Write article"}</button>
          )}
        </form>
      </aside>

      <section className="min-w-0">
        {!plan && !busy && !draft && (
          <div className="panel grid min-h-[420px] place-items-center p-10 text-center">
            <div className="max-w-md">
              <Sparkles className="mx-auto text-brand" />
              <h2 className="mt-3 text-lg font-bold">Your article appears here, section by section</h2>
              <p className="mt-2 text-sm text-ink-soft">The writer reads your website, researches the topic, plans an outline for the article type, then writes every section. Afterwards you can rewrite any section and export the Markdown and FAQ schema.</p>
            </div>
          </div>
        )}

        {(busy || plan) && (
          <div className="no-print mb-4 panel p-4" aria-live="polite">
            <div className="flex flex-wrap items-center justify-between gap-2 text-sm">
              <span className="flex items-center gap-2 font-semibold">
                {busy ? <Loader2 size={15} className="animate-spin text-brand" /> : <Check size={15} className="text-good" />}
                {busy ? (log[log.length - 1] ?? "Starting") : "Draft ready"}
              </span>
              {total > 0 && <span className="tnum text-ink-faint">{doneCount} of {total} parts written</span>}
            </div>
            {total > 0 && <div className="mt-3 h-1.5 rounded-full bg-canvas"><div className="h-1.5 rounded-full bg-gradient-to-r from-brand to-violet transition-all" style={{ width: `${(doneCount / total) * 100}%` }} /></div>}
          </div>
        )}

        {templateMode && (
          <div className="mb-4 rounded-xl border border-amber-200 bg-amber-50 px-4 py-2.5 text-sm text-amber-800">
            {draft!.mode === "demo" ? "Offline demo draft: the backend isn't running." : "Offline template draft: the backend has no writer API key."} For a real article, start the backend with <code className="font-semibold">WRITER_PROVIDER</code> and its API key.
          </div>
        )}

        {draft && (
          <div className="mb-4 space-y-4">
            <div className="grid gap-4 sm:grid-cols-4">
              <div className="panel p-4"><div className="text-xs text-ink-faint">GEO checklist</div><div className="tnum text-2xl font-extrabold">{draft.geo_check.score}<span className="text-sm font-semibold text-ink-faint">/100</span></div></div>
              <div className="panel p-4"><div className="text-xs text-ink-faint">Words</div><div className="tnum text-2xl font-extrabold">{draft.keyword_report.word_count}</div></div>
              <div className="panel p-4"><div className="text-xs text-ink-faint">Sources cited</div><div className="tnum text-2xl font-extrabold">{draft.sources.length}</div></div>
              <div className="panel p-4"><div className="text-xs text-ink-faint">Facts to confirm</div><div className={cn("tnum text-2xl font-extrabold", draft.facts_to_verify.length > 0 && "text-warn")}>{draft.facts_to_verify.length}</div></div>
            </div>
            <div className="flex flex-wrap items-center justify-between gap-3">
              <Tabs value={view} onChange={setView} tabs={[{ id: "article", label: "Article" }, { id: "seo", label: "SEO and schema" }, { id: "research", label: "Research" }]} />
              <div className="flex flex-wrap gap-2">
                <button className="btn-ghost" onClick={async () => { await navigator.clipboard.writeText(md); setCopied(true); setTimeout(() => setCopied(false), 1500); }}>
                  {copied ? <Check size={15} /> : <Copy size={15} />} {copied ? "Copied" : "Copy Markdown"}
                </button>
                <button className="btn-ghost" onClick={() => download(`${draft.slug}.md`, md, "text/markdown")}><Download size={15} /> Markdown</button>
                <button className="btn-ghost" onClick={() => download(`${draft.slug}-schema.html`, schemaTag, "text/html")}><Download size={15} /> Schema</button>
              </div>
            </div>
          </div>
        )}

        {plan && view === "article" && (
          <div className="grid gap-4 xl:grid-cols-[1fr_280px]">
            <article className="panel min-w-0 p-6 sm:p-8">
              <div className="mb-4 flex flex-wrap gap-1.5">
                <Badge tone="brand">{TYPE_LABEL[plan.article_type] ?? plan.article_type}</Badge>
                {draft?.research_used && <Badge tone="yes"><Globe size={11} /> Researched</Badge>}
                {draft && live && !templateMode && <Badge>Hover a section to rewrite it</Badge>}
              </div>
              <h1 className="mb-4 text-3xl font-extrabold leading-tight tracking-tight">{draft?.title ?? plan.title}</h1>
              {plan.sections.map((heading, i) => {
                const part = parts[i];
                return part ? (
                  <PartBlock key={part.id} part={part} editable={!!draft && live && !templateMode && ["intro", "section", "conclusion"].includes(part.kind)}
                    onRewrite={(ins) => rewrite(i, ins)} onUndo={() => undo(i)} canUndo={(history[part.id]?.length ?? 0) > 0} />
                ) : (
                  <div key={i} className="my-5 animate-pulse">
                    {i > 0 && <div className="mb-2 text-lg font-bold text-ink-faint">{heading}</div>}
                    <div className="h-3 w-full rounded bg-canvas" /><div className="mt-2 h-3 w-11/12 rounded bg-canvas" /><div className="mt-2 h-3 w-4/5 rounded bg-canvas" />
                  </div>
                );
              })}
              {draft && parts.slice(plan.sections.length).map((p, k) => (
                <PartBlock key={p.id} part={p} editable={false} onRewrite={async () => {}} onUndo={() => {}} canUndo={false} />
              ))}
            </article>
            {draft && (
              <div className="space-y-4">
                <div className="panel p-5">
                  <h3 className="mb-3 font-bold">GEO checklist</h3>
                  <ul className="space-y-2">{Object.entries(draft.geo_check.checks).map(([k, v]) => <Tick key={k} ok={v}>{CHECK_LABELS[k] ?? k}</Tick>)}</ul>
                </div>
                {draft.facts_to_verify.length > 0 && (
                  <div className="panel border-amber-200 p-5">
                    <h3 className="font-bold">Confirm before publishing</h3>
                    <p className="mb-2 text-xs text-ink-soft">The writer never invents numbers or quotes. Replace each highlight with a real, sourced fact, or rewrite the section to drop it.</p>
                    <ul className="space-y-1.5 text-sm">{draft.facts_to_verify.map((f) => <li key={f} className="text-amber-800">{f.replace(/^\[|\]$/g, "")}</li>)}</ul>
                  </div>
                )}
                <div className="panel p-5">
                  <h3 className="mb-2 font-bold">After publishing</h3>
                  <ol className="list-decimal space-y-1.5 pl-4 text-sm text-ink-soft">{draft.distribution_plan.map((s) => <li key={s}>{s}</li>)}</ol>
                </div>
              </div>
            )}
          </div>
        )}

        {draft && view === "seo" && (
          <div className="grid gap-4 lg:grid-cols-2">
            <div className="panel space-y-4 p-5">
              <SectionTitle title="Search preview" />
              <div className="rounded-xl border border-line p-4">
                <div className="text-xs text-ink-faint">{url.replace(/\/$/, "")}/blog/{draft.slug}</div>
                <div className="mt-0.5 text-lg font-semibold text-brand-dark">{draft.meta_title}</div>
                <p className="text-sm text-ink-soft">{draft.meta_description}</p>
              </div>
              <div className="text-xs text-ink-faint tnum">Title {draft.meta_title.length}/60 characters · description {draft.meta_description.length}/155</div>
              <div>
                <h3 className="mb-2 font-bold">Keyword placement</h3>
                <ul className="space-y-2">
                  <Tick ok={draft.keyword_report.primary.in_title}>{`“${draft.primary_keyword}” in title`}</Tick>
                  <Tick ok={draft.keyword_report.primary.in_first_100_words}>In the first 100 words</Tick>
                  <Tick ok={draft.keyword_report.primary.in_h2}>In at least one H2</Tick>
                  <Tick ok={draft.keyword_report.primary.density_ok}>{`Density ${draft.keyword_report.primary.density_pct}% (aim for 0.5–2.5%)`}</Tick>
                </ul>
                {draft.keyword_report.secondary.length > 0 && (
                  <div className="mt-3 flex flex-wrap gap-1.5">{draft.keyword_report.secondary.map((s) => <Badge key={s.keyword} tone={s.count ? "yes" : "no"}>{s.keyword}: {s.count}×</Badge>)}</div>
                )}
              </div>
            </div>
            <div className="panel min-w-0 p-5">
              <SectionTitle title="FAQ schema (JSON-LD)" sub="Paste inside the page's <head>" />
              <pre className="max-h-[480px] overflow-auto rounded-xl bg-[#1F1D3D] p-4 text-xs leading-5 text-indigo-100">{schemaTag}</pre>
            </div>
          </div>
        )}

        {draft && view === "research" && (
          <div className="grid gap-4 lg:grid-cols-2">
            <div className="panel p-5">
              <SectionTitle title="What we read on your site" sub="The writer may only state brand facts found here" />
              {brand || draft.brand_facts ? <BrandPanel facts={brand ?? draft.brand_facts} /> : <p className="text-sm text-ink-soft">Nothing read.</p>}
            </div>
            <div className="panel p-5">
              <SectionTitle title="Sources cited" sub={draft.research_used ? "From web research during writing" : "Web research was off for this draft"} />
              {draft.sources.length ? (
                <ol className="list-decimal space-y-1.5 pl-5 text-sm">{draft.sources.map((s) => <li key={s.url}><a href={s.url} target="_blank" rel="noreferrer" className="break-all text-brand underline">{s.url}</a></li>)}</ol>
              ) : <p className="text-sm text-ink-soft">No sources were cited. Specific numbers are left as placeholders to confirm.</p>}
            </div>
          </div>
        )}
      </section>
    </div>
  );
}
