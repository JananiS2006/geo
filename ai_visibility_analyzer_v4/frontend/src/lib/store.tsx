import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import type { AnalysisResult } from "./types";

const KEY = "aiva.history.v2";
const MAX = 30;

interface Store {
  history: AnalysisResult[];
  current: AnalysisResult | null;
  add: (r: AnalysisResult) => void;
  select: (id: string) => void;
  clear: () => void;
}

const Ctx = createContext<Store | null>(null);

function load(): AnalysisResult[] {
  try {
    return JSON.parse(localStorage.getItem(KEY) || "[]");
  } catch {
    return [];
  }
}

export function StoreProvider({ children }: { children: ReactNode }) {
  const [history, setHistory] = useState<AnalysisResult[]>(load);
  const [currentId, setCurrentId] = useState<string | null>(() => load()[0]?.id ?? null);

  useEffect(() => {
    try {
      localStorage.setItem(KEY, JSON.stringify(history.slice(0, MAX)));
    } catch {
      /* storage full or unavailable: keep in memory only */
    }
  }, [history]);

  const add = useCallback((r: AnalysisResult) => {
    setHistory((h) => [r, ...h.filter((x) => x.id !== r.id)].slice(0, MAX));
    setCurrentId(r.id);
  }, []);
  const select = useCallback((id: string) => setCurrentId(id), []);
  const clear = useCallback(() => { setHistory([]); setCurrentId(null); }, []);

  const value = useMemo(
    () => ({ history, current: history.find((h) => h.id === currentId) ?? history[0] ?? null, add, select, clear }),
    [history, currentId, add, select, clear],
  );
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useStore() {
  const s = useContext(Ctx);
  if (!s) throw new Error("useStore outside StoreProvider");
  return s;
}
