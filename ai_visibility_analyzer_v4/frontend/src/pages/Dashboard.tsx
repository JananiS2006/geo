import { useMemo, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { Bar, BarChart, CartesianGrid, Legend, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { Download, FileText, Printer, PenLine } from "lucide-react";
import { Badge, DemoBanner, Empty, ScoreRing, SectionTitle, Tabs } from "../components/ui";
import { useStore } from "../lib/store";
import type { AnalysisResult, QueryResult } from "../lib/types";
import { cn, domainOf, download, formatDate, scoreTone, TONE_HEX } from "../lib/utils";

type Tab = "queries" | "recs" | "listed" | "gaps" | "history";

export default function Dashboard() {
  const { current } = useStore();
  const [tab, setTab] = useState<Tab>("recs");
  if (!current) return <Empty title="No analysis yet" body="Run your first analysis to see how often AI assistants mention your brand." action={{ to: "/", label: "Start an analysis" }} />;
  const a = current;
  const adv = a.advisor;

  return (
    <div>
      <DemoBanner result={a} />
      <header className="mb-6 flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-3xl font-extrabold tracking-tight">{domainOf(a.request.url)}</h1>
          <p className="mt-1 text-sm text-ink-soft">
            {a.request.industry}, {a.request.keywords.length} keywords, {a.request.providers.join(", ")}. Run {formatDate(a.created_at)}
          </p>
        </div>
        <div className="no-print flex flex-wrap gap-2">
          <button className="btn-ghost" onClick={() => window.print()}><Printer size={15} /> Save as PDF</button>
          <button className="btn-ghost" onClick={() => download(`${a.brand}-analysis.json`, JSON.stringify(a, null, 2), "application/json")}><Download size={15} /> Export JSON</button>
          <Link to="/competitors" className="btn-ghost">Compare competitors</Link>
          <Link to="/" className="btn-primary">New analysis</Link>
        </div>
      </header>

      <section className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <ScoreRing value={a.scores.ai_visibility} label="AI Visibility" hint="How often and how prominently AI mentions you" />
        <ScoreRing value={a.crawl_error ? null : a.scores.geo} label="GEO Score" hint={a.crawl_error ? "Not measured: page couldn't be fetched" : "How easy your pages are for AI to read and quote"} />
        <ScoreRing value={a.crawl_error ? null : a.scores.seo} label="SEO Score" hint={a.crawl_error ? "Not measured: page couldn't be fetched" : "Classic on-page search health"} />
        <ScoreRing value={a.scores.share_of_voice} label="Share of voice" hint="Your share of all brand mentions in these answers" />
      </section>

      <section className="mt-4 grid gap-4 lg:grid-cols-2">
        <div className="panel p-5">
          <SectionTitle title="Visibility by assistant" sub="Discovery prompts only"
            right={a.stability && <Badge tone="plain">Stability {Math.round(a.stability.avg_consistency * 100)}% over {a.stability.repeats} repeats</Badge>} />
          <div className="h-56">
            <ResponsiveContainer>
              <BarChart data={a.provider_scores} margin={{ left: -20 }}>
                <CartesianGrid vertical={false} stroke="#EEF0F6" />
                <XAxis dataKey="provider" tickLine={false} axisLine={false} fontSize={12} />
                <YAxis domain={[0, 100]} tickLine={false} axisLine={false} fontSize={12} />
                <Tooltip cursor={{ fill: "#F4F5FB" }} contentStyle={{ borderRadius: 12, border: "1px solid #E6E6F0" }} />
                <Legend iconType="circle" wrapperStyle={{ fontSize: 12 }} />
                <Bar dataKey="visibility" name="Visibility" fill="#5458E8" radius={[8, 8, 0, 0]} maxBarSize={56} />
                <Bar dataKey="citation_rate" name="Citation rate %" fill="#B44BD8" radius={[8, 8, 0, 0]} maxBarSize={56} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </div>
        <div className="panel p-5">
          <SectionTitle title="GEO breakdown" sub="What's helping or holding back your pages" />
          {a.crawl_error && <p className="mb-3 rounded-xl bg-rose-50 px-3 py-2 text-sm text-bad">{a.crawl_error}</p>}
          {!a.crawl_error && <ul className="space-y-3">
            {a.geo_breakdown.map((g) => (
              <li key={g.factor}>
                <div className="flex justify-between text-sm"><span className="font-semibold">{g.factor}</span><span className="tnum font-bold">{g.score}</span></div>
                <div className="mt-1 h-2 rounded-full bg-canvas">
                  <div className="h-2 rounded-full" style={{ width: `${g.score}%`, background: TONE_HEX[scoreTone(g.score)] }} />
                </div>
                <p className="mt-0.5 text-xs text-ink-faint">{g.detail}</p>
              </li>
            ))}
          </ul>}
        </div>
      </section>

      <section className="mt-8">
        <div className="no-print mb-4">
          <Tabs<Tab> value={tab} onChange={setTab} tabs={[
            { id: "recs", label: "Recommendations", count: adv.recommendations.recommendations.length },
            { id: "listed", label: "Where to get listed", count: adv.citation_gaps.observed.length + adv.citation_gaps.suggested.length },
            { id: "gaps", label: "Lost queries", count: adv.content_gaps.length },
            { id: "queries", label: "AI answers", count: a.query_results.length },
            { id: "history", label: "Run history" },
          ]} />
        </div>
        {tab === "recs" && <Recommendations a={a} />}
        {tab === "listed" && <GetListed a={a} />}
        {tab === "gaps" && <LostQueries a={a} />}
        {tab === "queries" && <QueryTable rows={a.query_results} multi={!!a.stability} />}
        {tab === "history" && <History a={a} />}
      </section>
    </div>
  );
}

function Recommendations({ a }: { a: AnalysisResult }) {
  const [f, setF] = useState<"all" | "high" | "medium" | "low">("all");
  const { evidence, recommendations, mode } = a.advisor.recommendations;
  const ev = Object.fromEntries(evidence.map((e) => [e.id, e.detail]));
  const list = recommendations.filter((r) => f === "all" || r.priority === f);
  const modeText = mode.startsWith("llm") ? `Written by AI (${mode.split(":")[1]}) from ${evidence.length} measured findings` : mode === "demo" ? "Demo recommendations" : `Rule-based, from ${evidence.length} measured findings`;
  return (
    <div>
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <p className="text-sm text-ink-soft">{modeText}. Each one links to the finding behind it.</p>
        <div className="flex gap-1.5">
          {(["all", "high", "medium", "low"] as const).map((p) => (
            <button key={p} onClick={() => setF(p)} className={cn("rounded-full px-3 py-1 text-xs font-semibold capitalize", f === p ? "bg-brand text-white" : "bg-white border border-line text-ink-soft")}>{p}</button>
          ))}
        </div>
      </div>
      <div className="grid gap-4 md:grid-cols-2">
        {list.map((r) => (
          <article key={r.title} className="panel p-5">
            <div className="flex flex-wrap gap-1.5"><Badge tone={r.priority}>{r.priority}</Badge><Badge>{r.category}</Badge><Badge>Effort: {r.effort}</Badge></div>
            <h3 className="mt-3 font-bold leading-snug">{r.title}</h3>
            <p className="mt-1 text-sm text-ink-soft">{r.why}</p>
            {r.action_steps.length > 0 && (
              <ul className="mt-3 list-disc space-y-1 pl-5 text-sm">{r.action_steps.map((s) => <li key={s}>{s}</li>)}</ul>
            )}
            {r.evidence_ids.length > 0 && (
              <div className="mt-4 border-t border-line pt-3 text-xs text-ink-faint">
                Based on: {r.evidence_ids.map((id) => ev[id]).filter(Boolean).join("; ")}
              </div>
            )}
          </article>
        ))}
      </div>
    </div>
  );
}

const ORIGIN: Record<string, { label: string; tone: "yes" | "brand" | "plain" }> = {
  web_search: { label: "Live web search", tone: "yes" },
  ai_suggested: { label: "AI suggested", tone: "brand" },
  niche_match: { label: "Niche match", tone: "plain" },
};

function GetListed({ a }: { a: AnalysisResult }) {
  const { observed, suggested, summary } = a.advisor.citation_gaps;
  const max = Math.max(1, ...observed.map((o) => o.cited_when_we_were_missing));
  const simulated = a.mode === "demo" || (a.mock_answers ?? 0) > 0;
  return (
    <div className="space-y-4">
      <div className="panel p-5">
        <SectionTitle title="Sources AI cited when competitors won"
          sub={`From ${summary.responses_analyzed} answers. Competitors were recommended instead of you in ${summary.answers_where_competitor_won}.`} />
        {observed.length === 0 ? (
          <p className="text-sm text-ink-soft">
            {simulated
              ? "None yet: simulated answers don't cite real sources. Run with live API keys, especially Perplexity, which returns the sites behind each answer."
              : "No cited sources in this run. Include Perplexity, which returns the sites behind each answer."}
          </p>
        ) : (
          <ul className="divide-y divide-line">
            {observed.map((o) => (
              <li key={o.domain} className="grid gap-2 py-4 sm:grid-cols-[180px_1fr]">
                <div>
                  <div className="font-bold">{o.domain}</div>
                  <div className="text-xs capitalize text-ink-faint">{o.type.replace("_", " ")}</div>
                  <div className="mt-2 h-1.5 rounded-full bg-canvas"><div className="h-1.5 rounded-full bg-violet" style={{ width: `${(o.cited_when_we_were_missing / max) * 100}%` }} /></div>
                  <div className="mt-1 text-xs tnum text-ink-soft">Cited {o.cited_when_we_were_missing}× when you were missing</div>
                </div>
                <div>
                  <p className="text-sm">{o.action}</p>
                  {o.competitors_seen_with_it.length > 0 && (
                    <div className="mt-2 flex flex-wrap items-center gap-1.5 text-xs text-ink-faint">
                      Appeared alongside {o.competitors_seen_with_it.map((c) => <Badge key={c} tone="rival">{c}</Badge>)}
                    </div>
                  )}
                </div>
              </li>
            ))}
          </ul>
        )}
      </div>
      <div className="panel p-5">
        <SectionTitle title="Where else to get listed"
          sub={`Chosen for ${a.request.keywords.slice(0, 3).join(", ")}${a.request.region ? ` in ${a.request.region}` : ""}. Not seen in this run's answers.`} />
        <ul className="grid gap-3 md:grid-cols-2">
          {suggested.map((s) => (
            <li key={s.domain} className="rounded-xl border border-line p-4">
              <div className="flex flex-wrap items-center gap-2">
                <span className="font-bold">{s.domain}</span>
                <span className="text-xs capitalize text-ink-faint">{s.type.replace("_", " ")}</span>
              </div>
              {s.origins && s.origins.length > 0 && (
                <div className="mt-1.5 flex flex-wrap gap-1.5">{s.origins.map((o) => <Badge key={o} tone={ORIGIN[o]?.tone ?? "plain"}>{ORIGIN[o]?.label ?? o}</Badge>)}</div>
              )}
              {s.why && <p className="mt-2 text-sm text-ink-soft">{s.why}</p>}
              <p className="mt-1.5 text-sm">{s.action}</p>
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}

function LostQueries({ a }: { a: AnalysisResult }) {
  const nav = useNavigate();
  const gaps = a.advisor.content_gaps;
  if (!gaps.length) return <div className="panel p-6 text-sm text-ink-soft">No lost queries. You were mentioned in every answer where a competitor appeared.</div>;
  return (
    <div className="panel divide-y divide-line">
      {gaps.map((g) => (
        <div key={g.query} className="flex flex-wrap items-center gap-4 p-4">
          <div className="min-w-0 flex-1">
            <p className="font-semibold">{g.query}</p>
            <div className="mt-1.5 flex flex-wrap items-center gap-1.5 text-xs text-ink-faint">
              Lost on {g.lost_on_providers.map((p) => <Badge key={p}>{p}</Badge>)} to {g.competitors_recommended_instead.map((c) => <Badge key={c} tone="rival">{c}</Badge>)}
            </div>
          </div>
          <button className="btn-ghost no-print" onClick={() => nav(`/studio?topic=${encodeURIComponent(g.query)}`)}><PenLine size={15} /> Write a blog for this</button>
        </div>
      ))}
    </div>
  );
}

function QueryTable({ rows, multi }: { rows: QueryResult[]; multi: boolean }) {
  const [provider, setProvider] = useState("All");
  const [family, setFamily] = useState("discovery");
  const [lostOnly, setLostOnly] = useState(false);
  const providers = useMemo(() => ["All", ...new Set(rows.map((r) => String(r.provider)))], [rows]);
  const list = rows.filter((r) => (provider === "All" || r.provider === provider) && (family === "all" || r.family === family) && (!lostOnly || (!r.mentioned && r.competitors_mentioned.length)));
  const yn = (b: boolean) => <Badge tone={b ? "yes" : "no"}>{b ? "Yes" : "No"}</Badge>;
  return (
    <div className="panel p-5">
      <div className="mb-4 flex flex-wrap items-center gap-3 text-sm">
        <select className="field w-auto py-1.5" value={provider} onChange={(e) => setProvider(e.target.value)} aria-label="Assistant">{providers.map((p) => <option key={p}>{p}</option>)}</select>
        <select className="field w-auto py-1.5" value={family} onChange={(e) => setFamily(e.target.value)} aria-label="Prompt type">
          <option value="discovery">Discovery prompts</option><option value="branded">Branded prompts</option><option value="all">All prompts</option>
        </select>
        <label className="flex items-center gap-2"><input type="checkbox" checked={lostOnly} onChange={(e) => setLostOnly(e.target.checked)} className="accent-brand" /> Only lost to competitors</label>
        <span className="ml-auto tnum text-ink-faint">{list.length} answers</span>
      </div>
      <div className="overflow-x-auto">
        <table className="w-full min-w-[860px] text-sm">
          <thead>
            <tr className="border-b border-line text-left text-xs text-ink-faint">
              <th className="py-2 pr-3 font-semibold">Assistant</th><th className="pr-3 font-semibold">Prompt</th><th className="pr-3 font-semibold">Mentioned</th>
              <th className="pr-3 font-semibold">Position</th><th className="pr-3 font-semibold">Cited</th><th className="pr-3 font-semibold">Sentiment</th>
              <th className="pr-3 font-semibold">Rank</th><th className="pr-3 font-semibold">Competitors</th>{multi && <th className="font-semibold">Stable</th>}
            </tr>
          </thead>
          <tbody>
            {list.map((r, i) => (
              <tr key={i} className="border-b border-line/60 align-top last:border-0">
                <td className="py-2.5 pr-3 font-semibold">{r.provider}</td>
                <td className="max-w-[340px] pr-3">{r.query}<div className="text-xs text-ink-faint">{r.intent.replace("_", " ")}</div></td>
                <td className="pr-3">{yn(r.mentioned)}</td>
                <td className="pr-3">{r.position ?? "–"}</td>
                <td className="pr-3">{yn(r.cited)}</td>
                <td className="pr-3">{r.sentiment ? <Badge tone={r.sentiment}>{r.sentiment}</Badge> : "–"}</td>
                <td className="pr-3 tnum">{r.rank ? `#${r.rank}` : "–"}</td>
                <td className="pr-3 text-xs text-ink-soft">{r.competitors_mentioned.join(", ") || "–"}</td>
                {multi && <td className="tnum">{r.consistency !== null ? `${Math.round(r.consistency * 100)}%` : "–"}</td>}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function History({ a }: { a: AnalysisResult }) {
  const { history, select } = useStore();
  const runs = history.filter((h) => domainOf(h.request.url) === domainOf(a.request.url)).slice().reverse();
  const data = runs.map((r) => ({ date: new Date(r.created_at).toLocaleDateString(undefined, { day: "numeric", month: "short" }), "AI Visibility": r.scores.ai_visibility, GEO: r.scores.geo, SEO: r.scores.seo }));
  return (
    <div className="grid gap-4 lg:grid-cols-[2fr_1fr]">
      <div className="panel p-5">
        <SectionTitle title="Score trend" sub={`${runs.length} run${runs.length === 1 ? "" : "s"} for ${domainOf(a.request.url)}`} />
        {runs.length < 2 ? <p className="text-sm text-ink-soft">Run the analysis again after making changes to see the trend here.</p> : (
          <div className="h-64">
            <ResponsiveContainer>
              <LineChart data={data} margin={{ left: -20 }}>
                <CartesianGrid vertical={false} stroke="#EEF0F6" />
                <XAxis dataKey="date" tickLine={false} axisLine={false} fontSize={12} />
                <YAxis domain={[0, 100]} tickLine={false} axisLine={false} fontSize={12} />
                <Tooltip contentStyle={{ borderRadius: 12, border: "1px solid #E6E6F0" }} />
                <Line dataKey="AI Visibility" stroke="#5458E8" strokeWidth={2.5} dot />
                <Line dataKey="GEO" stroke="#B44BD8" strokeWidth={2.5} dot />
                <Line dataKey="SEO" stroke="#14B8A6" strokeWidth={2.5} dot />
              </LineChart>
            </ResponsiveContainer>
          </div>
        )}
      </div>
      <div className="panel h-fit p-5">
        <SectionTitle title="All runs" />
        <ul className="divide-y divide-line">
          {history.map((h) => (
            <li key={h.id}>
              <button onClick={() => select(h.id)} className={cn("flex w-full items-center justify-between gap-2 py-2.5 text-left text-sm", h.id === a.id && "font-bold text-brand-dark")}>
                <span className="flex items-center gap-2"><FileText size={14} className="text-ink-faint" />{domainOf(h.request.url)}</span>
                <span className="text-xs text-ink-faint">{formatDate(h.created_at)}{h.mode === "demo" && " · demo"}</span>
              </button>
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}
