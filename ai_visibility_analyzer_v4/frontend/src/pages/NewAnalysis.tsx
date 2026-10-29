import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { Check, Globe, Loader2, Search, X } from "lucide-react";
import ListEditor from "../components/ListEditor";
import { Badge } from "../components/ui";
import { previewQueries, runAnalysis } from "../lib/api";
import { useStore } from "../lib/store";
import { ALL_PROVIDERS, type AnalyzeRequest, type GeneratedQuery, type Provider } from "../lib/types";
import { brandFromUrl, cn } from "../lib/utils";

const INDUSTRIES = ["SaaS & Software", "E-commerce & Retail", "Education", "Healthcare", "Finance", "Travel & Hospitality", "Local business", "Other"];

function Stepper({ steps, active }: { steps: string[]; active: number }) {
  return (
    <ol className="space-y-2.5">
      {steps.map((s, i) => (
        <li key={s} className={cn("flex items-center gap-2.5 text-sm", i < active ? "text-good" : i === active ? "text-ink font-semibold" : "text-ink-faint")}>
          {i < active ? <Check size={16} /> : i === active ? <Loader2 size={16} className="animate-spin" /> : <span className="h-4 w-4 rounded-full border border-line" />}
          {s}
        </li>
      ))}
    </ol>
  );
}

export default function NewAnalysis() {
  const nav = useNavigate();
  const { add } = useStore();
  const [url, setUrl] = useState("https://www.notion.so");
  const [competitors, setCompetitors] = useState(["https://coda.io", "https://clickup.com", "https://evernote.com"]);
  const [keywords, setKeywords] = useState(["team knowledge base", "collaborative workspace", "project management software"]);
  const [industry, setIndustry] = useState(INDUSTRIES[0]);
  const [region, setRegion] = useState("");
  const [providers, setProviders] = useState<Provider[]>(["ChatGPT", "Gemini", "Perplexity"]);
  const [perKeyword, setPerKeyword] = useState(8);
  const [branded, setBranded] = useState(2);
  const [repeats, setRepeats] = useState(1);
  const [running, setRunning] = useState(false);
  const [step, setStep] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [preview, setPreview] = useState<{ queries: GeneratedQuery[]; calls: number; demo: boolean } | null>(null);

  const req: AnalyzeRequest = useMemo(() => ({
    url: url.trim(), competitors: competitors.map((c) => c.trim()).filter(Boolean), keywords: keywords.map((k) => k.trim()).filter(Boolean),
    industry, region: region.trim() || undefined, providers, per_keyword: perKeyword, branded_per_keyword: branded, repeats,
  }), [url, competitors, keywords, industry, region, providers, perKeyword, branded, repeats]);

  const promptCount = req.keywords.length * (perKeyword + branded);
  const apiCalls = promptCount * providers.length * repeats;
  const steps = ["Crawling website", "Extracting structured data", "Generating prompts",
    ...providers.map((p) => `Asking ${p}`), "Benchmarking competitors", "Finding citation and content gaps", "Writing recommendations"];

  useEffect(() => {
    if (!running) return;
    const id = setInterval(() => setStep((s) => Math.min(s + 1, steps.length - 1)), 900);
    return () => clearInterval(id);
  }, [running, steps.length]);

  const valid = /^https?:\/\/.+\..+/.test(req.url) && req.keywords.length > 0 && providers.length > 0;

  async function run() {
    setError(null);
    setRunning(true);
    setStep(0);
    try {
      const result = await runAnalysis(req);
      add(result);
      nav("/dashboard");
    } catch (e) {
      setError((e as Error).message);
      setRunning(false);
    }
  }

  async function openPreview() {
    const r = await previewQueries(req);
    setPreview({ queries: r.queries, calls: r.estimated_api_calls, demo: r.demo });
  }

  const toggle = (p: Provider) => setProviders((ps) => (ps.includes(p) ? ps.filter((x) => x !== p) : [...ps, p]));

  return (
    <div className="grid gap-10 lg:grid-cols-[1.05fr_1fr] lg:gap-14">
      <section className="pt-2 lg:pt-8">
        <h1 className="max-w-xl text-4xl font-extrabold leading-[1.08] tracking-tight sm:text-5xl">
          Find out whether AI assistants recommend your brand.
        </h1>
        <p className="mt-5 max-w-lg text-[17px] leading-7 text-ink-soft">
          We ask ChatGPT, Gemini, Perplexity and Claude the questions your customers ask, then measure whether
          you're mentioned, where, and whether you're cited as a source. You get a plan to close the gap.
        </p>
        <dl className="mt-8 grid max-w-xl grid-cols-1 gap-4 text-sm sm:grid-cols-3">
          <div><dt className="font-bold">Up to 15 prompts per keyword</dt><dd className="text-ink-soft">Across seven buying intents</dd></div>
          <div><dt className="font-bold">Where to get listed</dt><dd className="text-ink-soft">From the sources AI actually cites</dd></div>
          <div><dt className="font-bold">Blog drafts</dt><dd className="text-ink-soft">Written to answer the queries you lose</dd></div>
        </dl>
      </section>

      <section className="panel h-fit p-6 sm:p-7">
        {running ? (
          <div aria-live="polite">
            <h2 className="text-lg font-bold">Analysing {brandFromUrl(req.url)}</h2>
            <p className="mb-5 mt-1 text-sm text-ink-soft tnum">{promptCount} prompts · {apiCalls} AI answers to read</p>
            <div className="mb-5 h-1.5 overflow-hidden rounded-full bg-canvas">
              <div className="h-full rounded-full bg-gradient-to-r from-brand to-violet transition-all duration-700" style={{ width: `${((step + 1) / steps.length) * 100}%` }} />
            </div>
            <Stepper steps={steps} active={step} />
          </div>
        ) : (
          <form className="space-y-5" onSubmit={(e) => { e.preventDefault(); if (valid) run(); }}>
            <div>
              <h2 className="text-lg font-bold">Run an analysis</h2>
              <p className="text-sm text-ink-soft">Live answers usually take one to three minutes.</p>
            </div>
            <div>
              <label className="label" htmlFor="url">Website URL</label>
              <div className="relative">
                <Globe size={15} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-ink-faint" />
                <input id="url" className="field pl-9" value={url} onChange={(e) => setUrl(e.target.value)} placeholder="https://yourbrand.com" />
              </div>
            </div>
            <ListEditor label="Competitor URLs" items={competitors} onChange={setCompetitors} max={5} placeholder="https://competitor.com" />
            <ListEditor label="Target keywords" items={keywords} onChange={setKeywords} max={5} placeholder="e.g. project management software" />
            <div className="grid gap-4 sm:grid-cols-2">
              <div>
                <label className="label" htmlFor="ind">Industry</label>
                <select id="ind" className="field" value={industry} onChange={(e) => setIndustry(e.target.value)}>
                  {INDUSTRIES.map((i) => <option key={i}>{i}</option>)}
                </select>
              </div>
              <div>
                <label className="label" htmlFor="region">Region <span className="font-normal text-ink-faint">(optional)</span></label>
                <input id="region" className="field" value={region} onChange={(e) => setRegion(e.target.value)} placeholder="e.g. Chennai" />
              </div>
            </div>
            <fieldset>
              <legend className="label">AI assistants to check</legend>
              <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
                {ALL_PROVIDERS.map((p) => (
                  <button type="button" key={p} aria-pressed={providers.includes(p)} onClick={() => toggle(p)}
                    className={cn("flex items-center justify-center gap-1.5 rounded-xl border px-3 py-2.5 text-sm font-semibold transition",
                      providers.includes(p) ? "border-brand/40 bg-brand-tint text-brand-dark" : "border-line bg-white text-ink-soft")}>
                    {providers.includes(p) && <Check size={14} />}{p}
                  </button>
                ))}
              </div>
            </fieldset>
            <fieldset className="rounded-xl border border-line bg-canvas/60 p-4">
              <legend className="px-1 text-sm font-semibold">Prompt depth</legend>
              {[
                { l: "Discovery prompts per keyword", v: perKeyword, set: setPerKeyword, min: 3, max: 15, h: "Never name your brand, so they measure organic mentions" },
                { l: "Branded prompts per keyword", v: branded, set: setBranded, min: 0, max: 4, h: "Name your brand, used only for sentiment" },
                { l: "Repeats per prompt", v: repeats, set: setRepeats, min: 1, max: 5, h: "AI answers vary; repeats measure how stable a result is" },
              ].map((s) => (
                <label key={s.l} className="mt-3 block first:mt-0">
                  <span className="flex justify-between text-sm"><span>{s.l}</span><span className="tnum font-bold">{s.v}</span></span>
                  <input type="range" min={s.min} max={s.max} value={s.v} onChange={(e) => s.set(+e.target.value)} className="mt-1 w-full accent-brand" />
                  <span className="text-xs text-ink-faint">{s.h}</span>
                </label>
              ))}
              <div className="mt-4 flex flex-wrap items-center justify-between gap-2 border-t border-line pt-3 text-sm">
                <span className="tnum"><b>{promptCount}</b> prompts · <b>{apiCalls}</b> API calls</span>
                <button type="button" onClick={openPreview} disabled={!req.keywords.length}
                  className="inline-flex items-center gap-1 font-semibold text-brand disabled:opacity-40">
                  <Search size={14} /> Preview prompts
                </button>
              </div>
            </fieldset>
            {error && <p role="alert" className="rounded-xl bg-rose-50 px-3 py-2 text-sm text-bad">{error}</p>}
            <button type="submit" className="btn-primary w-full py-3 text-[15px]" disabled={!valid}>Run analysis</button>
            {!valid && <p className="text-center text-xs text-ink-faint">Add a full URL (with https://), at least one keyword and one assistant.</p>}
          </form>
        )}
      </section>

      {preview && (
        <div className="fixed inset-0 z-50 flex justify-end bg-ink/30" onClick={() => setPreview(null)}>
          <aside role="dialog" aria-label="Prompt preview" className="h-full w-full max-w-lg overflow-y-auto bg-white p-6 shadow-2xl" onClick={(e) => e.stopPropagation()}>
            <div className="mb-4 flex items-start justify-between gap-3">
              <div>
                <h2 className="text-lg font-bold">Prompts we'll send</h2>
                <p className="text-sm text-ink-soft tnum">{preview.queries.length} prompts · {preview.calls} API calls{preview.demo && " · generated locally (backend offline)"}</p>
              </div>
              <button aria-label="Close" onClick={() => setPreview(null)} className="rounded-lg p-1.5 text-ink-faint hover:bg-canvas"><X size={18} /></button>
            </div>
            <ul className="divide-y divide-line">
              {preview.queries.map((q) => (
                <li key={q.text} className="py-2.5">
                  <p className="text-sm">{q.text}</p>
                  <div className="mt-1 flex gap-1.5">
                    <Badge tone={q.family === "branded" ? "rival" : "brand"}>{q.family}</Badge>
                    <Badge>{q.intent.replace("_", " ")}</Badge>
                  </div>
                </li>
              ))}
            </ul>
          </aside>
        </div>
      )}
    </div>
  );
}
