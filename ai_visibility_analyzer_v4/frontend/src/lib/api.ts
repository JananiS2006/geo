import type { AnalysisResult, AnalyzeRequest, BlogDraft, BlogEvent, BlogRequest, GeneratedQuery } from "./types";
import { demoAnalysis, demoBlog, demoQueries } from "./demo";

export class BackendUnavailable extends Error {}

async function post<T>(path: string, body: unknown, timeoutMs = 600_000): Promise<T> {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const res = await fetch(path, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body), signal: ctrl.signal });
    if (res.status === 404 || res.status >= 502) throw new BackendUnavailable(`Backend returned ${res.status}`);
    if (!res.ok) {
      const detail = await res.text();
      // Vite's dev/preview proxy answers an empty 500 when FastAPI isn't running.
      if (res.status === 500 && !detail.trim()) throw new BackendUnavailable("Backend not running");
      throw new Error(`Request failed (${res.status}): ${detail.slice(0, 200)}`);
    }
    return (await res.json()) as T;
  } catch (e) {
    if (e instanceof TypeError || (e as Error).name === "AbortError") throw new BackendUnavailable(String(e));
    throw e;
  } finally {
    clearTimeout(t);
  }
}

export interface BackendStatus { mode: string; writer_provider: string; model: string; research?: boolean }

export async function backendStatus(): Promise<BackendStatus | null> {
  try {
    const r = await fetch("/api/advisor/status");
    return r.ok ? await r.json() : null;
  } catch {
    return null;
  }
}

/** Live result if the backend responds; demo result (clearly flagged) if it is unreachable. */
export async function runAnalysis(req: AnalyzeRequest): Promise<AnalysisResult> {
  try {
    const r = await post<AnalysisResult>("/api/analyze", req);
    return { ...r, mode: r.mode ?? "live" };
  } catch (e) {
    if (e instanceof BackendUnavailable) return demoAnalysis(req);
    throw e;
  }
}

export async function previewQueries(req: AnalyzeRequest): Promise<{ queries: GeneratedQuery[]; estimated_api_calls: number; demo: boolean }> {
  try {
    const r = await post<{ queries: GeneratedQuery[]; estimated_api_calls: number }>("/api/queries/generate", { ...req, providers: req.providers.length }, 60_000);
    return { ...r, demo: false };
  } catch (e) {
    if (!(e instanceof BackendUnavailable)) throw e;
    const queries = demoQueries(req);
    return { queries, estimated_api_calls: queries.length * req.providers.length * req.repeats, demo: true };
  }
}

/** Streams the blog as it is written. Falls back to the offline demo draft if the backend is down. */
export async function streamBlog(req: BlogRequest, onEvent: (e: BlogEvent) => void, signal?: AbortSignal): Promise<BlogDraft> {
  let res: Response;
  try {
    res = await fetch("/api/advisor/blog/stream", {
      method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(req), signal,
    });
  } catch (e) {
    if ((e as Error).name === "AbortError") throw e;
    return playDemo(req, onEvent);
  }
  if (!res.ok || !res.body) {
    const detail = await res.text().catch(() => "");
    if (res.status === 404 || res.status >= 502 || (res.status === 500 && !detail.trim())) return playDemo(req, onEvent);
    throw new Error(`Blog writer failed (${res.status}): ${detail.slice(0, 200)}`);
  }
  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  let draft: BlogDraft | null = null;
  for (;;) {
    const { value, done } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    let nl: number;
    while ((nl = buffer.indexOf("\n")) >= 0) {
      const line = buffer.slice(0, nl).trim();
      buffer = buffer.slice(nl + 1);
      if (!line) continue;
      const ev = JSON.parse(line) as BlogEvent;
      if (ev.type === "error") throw new Error(ev.message);
      if (ev.type === "done") draft = ev.draft;
      onEvent(ev);
    }
  }
  if (!draft) throw new Error("The writer stopped before finishing. Try again.");
  return draft;
}

async function playDemo(req: BlogRequest, onEvent: (e: BlogEvent) => void): Promise<BlogDraft> {
  const draft = demoBlog(req);
  const wait = () => new Promise((r) => setTimeout(r, 180));
  onEvent({ type: "status", step: "plan", message: "Backend offline: showing the offline demo draft" });
  onEvent({ type: "plan", data: { title: draft.title, article_type: draft.article_type, sections: draft.parts.map((p) => p.heading || "Introduction") } });
  for (const [i, part] of draft.parts.entries()) { await wait(); onEvent({ type: "part", index: i, part }); }
  onEvent({ type: "done", draft });
  return draft;
}

export async function rewritePart(body: { markdown: string; instruction: string; title: string; url: string }): Promise<string> {
  const res = await fetch("/api/advisor/blog/rewrite", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
  if (!res.ok) {
    let msg = `Rewrite failed (${res.status})`;
    try { msg = (await res.json()).detail ?? msg; } catch { /* backend offline or non-JSON */ }
    throw new Error(res.status >= 500 ? "Rewrite needs the backend running with a writer API key." : msg);
  }
  return (await res.json()).markdown;
}
