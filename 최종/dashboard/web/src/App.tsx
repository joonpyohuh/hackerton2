import { AnimatePresence, motion } from "framer-motion";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { analyze, fetchFacts } from "./api";
import { EdgeDetail } from "./components/EdgeDetail";
import { FilterBar } from "./components/FilterBar";
import { FindingsPanel, VIEW_LABEL } from "./components/FindingsPanel";
import { NodeDetail } from "./components/NodeDetail";
import { IMP_COLOR, IMP_LABEL, fmt } from "./format";
import type { Analysis, Facts, Filters, REdge, RNode, Selection, ViewKind } from "./types";
import { GraphView } from "./views/GraphView";
import { MatrixView } from "./views/MatrixView";
import { RankView } from "./views/RankView";
import { ChartView } from "./views/ChartView";

const EMPTY: Filters = { from_date: "", to_date: "", dev: "all", age: "all", gen: "all", push: "all" };
const VIEWS: ViewKind[] = ["network", "radial", "chart", "rank", "matrix"];
const keyOf = (f: Filters) => JSON.stringify(f);

export default function App() {
  const [filters, setFilters] = useState<Filters>(EMPTY);
  const [facts, setFacts] = useState<Facts | null>(null);
  const [factsKey, setFactsKey] = useState("");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [aiConfigured, setAiConfigured] = useState(true);

  const [view, setView] = useState<ViewKind>("network");
  const [minPhi, setMinPhi] = useState(0.3);
  const [sigOnly, setSigOnly] = useState(true);
  const [outcomeOnly, setOutcomeOnly] = useState(false);
  const [selection, setSelection] = useState<Selection>(null);
  const [hoverFinding, setHoverFinding] = useState<string[] | null>(null);
  const [hoverNode, setHoverNode] = useState<string | null>(null);

  const [analysis, setAnalysis] = useState<Analysis | null>(null);
  const [analysisKey, setAnalysisKey] = useState("");
  const [analysisEdges, setAnalysisEdges] = useState<Map<string, REdge>>(new Map());
  const [busy, setBusy] = useState(false);
  const [aiError, setAiError] = useState<string | null>(null);
  const seeded = useRef(false);

  useEffect(() => {
    fetch("/api/health", { cache: "no-store" })
      .then((r) => r.json() as Promise<{ ai_configured?: boolean }>)
      .then((h) => setAiConfigured(Boolean(h.ai_configured)))
      .catch(() => setAiConfigured(false));
  }, []);

  useEffect(() => {
    const ctl = new AbortController();
    setLoading(true);
    const t = setTimeout(() => {
      fetchFacts(filters, ctl.signal)
        .then((f) => {
          setFacts(f);
          setFactsKey(keyOf(filters));
          setError(null);
          if (!seeded.current) {
            seeded.current = true;
            setFilters((x) => (x.from_date ? x : { ...x, from_date: f.dims.base_date, to_date: f.dims.max_date }));
          }
        })
        .catch((e: unknown) => { if (!ctl.signal.aborted) setError(e instanceof Error ? e.message : String(e)); })
        .finally(() => { if (!ctl.signal.aborted) setLoading(false); });
    }, 220);
    return () => { clearTimeout(t); ctl.abort(); };
  }, [filters]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") setSelection(null); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  const nodes = useMemo<RNode[]>(() => facts?.nodes ?? [], [facts]);
  const nodeMap = useMemo(() => new Map(nodes.map((n) => [n.id, n])), [nodes]);
  const edgeMap = useMemo(() => new Map((facts?.edges ?? []).map((e) => [e.id, e])), [facts]);

  // Seeded dates equal "full range": treat them as the same query as the empty initial filter.
  const normKey = useCallback((f: Filters) =>
    keyOf(facts && f.from_date === facts.dims.base_date && f.to_date === facts.dims.max_date ? { ...f, from_date: "", to_date: "" } : f), [facts]);
  const stale = analysis !== null && normKey(filters) !== analysisKey;
  const aiEdges = useMemo(() => new Set(!stale && analysis ? analysis.findings.flatMap((f) => f.edge_ids) : []), [analysis, stale]);
  const focusNodes = useMemo(() => new Set(!stale && analysis ? analysis.focus_nodes : []), [analysis, stale]);

  const visible = useMemo(() => (facts?.edges ?? []).filter((e) =>
    aiEdges.has(e.id) || (
      (!sigOnly || e.significant) && Math.abs(e.phi) >= minPhi &&
      (!outcomeOnly || nodeMap.get(e.source)?.group === "outcome" || nodeMap.get(e.target)?.group === "outcome"))),
  [facts, sigOnly, minPhi, outcomeOnly, nodeMap, aiEdges]);
  const visibleIds = useMemo(() => new Set(visible.map((e) => e.id)), [visible]);

  const emphasis = useMemo<Set<string> | null>(() => {
    if (hoverFinding) return new Set(hoverFinding);
    if (hoverNode) return new Set(visible.filter((e) => e.source === hoverNode || e.target === hoverNode).map((e) => e.id));
    if (selection?.kind === "node") return new Set(visible.filter((e) => e.source === selection.id || e.target === selection.id).map((e) => e.id));
    return null;
  }, [hoverFinding, hoverNode, selection, visible]);

  useEffect(() => {
    if (selection?.kind === "edge" && facts && !edgeMap.has(selection.id)) setSelection(null);
  }, [facts, edgeMap, selection]);

  const run = async () => {
    setBusy(true);
    setAiError(null);
    const k = normKey(filters);
    try {
      const a = await analyze(filters);
      setAnalysis(a);
      setAnalysisKey(k);
      if (factsKey === keyOf(filters)) setAnalysisEdges(edgeMap);
      else setAnalysisEdges(new Map((await fetchFacts(filters)).edges.map((e) => [e.id, e])));
      setView(a.recommended_view);
      setSelection(null);
    } catch (e) {
      setAiError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  const selectedEdge = selection?.kind === "edge" ? edgeMap.get(selection.id) : undefined;
  const selectedNode = selection?.kind === "node" ? nodeMap.get(selection.id) : undefined;

  return (
    <div className="min-h-screen bg-bg text-ink">
      <header className="border-b border-ink">
        <div className="mx-auto flex max-w-[1360px] flex-wrap items-end justify-between gap-6 px-4 pb-5 pt-10 sm:px-10">
          <div>
            <div className="eyebrow">OTT A사 · 지표 연관 지도</div>
            <h1 className="mt-2 text-[26px] font-bold leading-[1.15] tracking-[-0.035em] sm:text-[34px]">
              무엇이 무엇과<br />함께 움직이는가
            </h1>
          </div>
          <div className="text-right text-[14px] leading-[1.75] text-ink-2">
            {facts ? (
              <>
                <span className="num">선택 고객 {fmt(facts.n)}명 · 첫 결제 {fmt(facts.payers)}명</span><br />
                <span className="num">지표 {facts.tests}쌍 비교</span><br />
              </>
            ) : <span>데이터 불러오는 중…</span>}
            <a href="/" className="text-muted underline underline-offset-[3px] hover:text-ink">← 고객 여정 대시보드</a>
            <span aria-hidden="true"> · </span>
            <a href="https://nl2sql-agent-theta.vercel.app/" className="text-muted underline underline-offset-[3px] hover:text-ink">NL2SQL 분석</a>
          </div>
        </div>
      </header>

      <FilterBar filters={filters} dims={facts?.dims ?? null} loading={loading} onChange={setFilters}
        onReset={() => setFilters(facts ? { ...EMPTY, from_date: facts.dims.base_date, to_date: facts.dims.max_date } : EMPTY)} />

      <main className="mx-auto grid max-w-[1360px] gap-x-12 px-4 pb-20 sm:px-10 lg:grid-cols-[minmax(0,1fr)_380px]">
        <section className="min-w-0 pt-8">
          <div className="flex flex-wrap items-center gap-x-8 gap-y-4 border-b border-ink pb-4">
            <nav className="flex gap-5" aria-label="시각화 형태">
              {VIEWS.map((v) => (
                <button key={v} type="button" onClick={() => setView(v)} aria-pressed={view === v}
                  className={`relative cursor-pointer pb-1 text-[15px] tracking-[-0.01em] ${view === v ? "font-semibold text-ink" : "text-muted hover:text-ink"}`}>
                  {VIEW_LABEL[v]}
                  {analysis && !stale && analysis.recommended_view === v && <sup className="ml-0.5 text-[11px] text-accent">AI</sup>}
                  {view === v && <motion.span layoutId="view-underline" className="absolute inset-x-0 -bottom-px h-px bg-ink" />}
                </button>
              ))}
            </nav>
            <label className="flex items-center gap-3 text-[14px] text-ink-2">
              <span className="text-[13px] uppercase tracking-[0.08em] text-muted">최소 연관 강도</span>
              <input type="range" min={0.05} max={0.6} step={0.05} value={minPhi} onChange={(e) => setMinPhi(+e.target.value)} className="w-28" />
              <span className="num w-8 font-semibold text-ink">{minPhi.toFixed(2)}</span>
            </label>
            <Toggle checked={sigOnly} onChange={setSigOnly}>우연이 아닌 것만</Toggle>
            <Toggle checked={outcomeOnly} onChange={setOutcomeOnly}>결제·시청 성과와 연결된 것만</Toggle>
          </div>

          <div className="num mt-3 flex flex-wrap justify-between gap-2 text-[13px] text-muted">
            <span>연결선 {visible.length}개 표시 중 · 전체 {facts?.tests ?? 0}쌍 비교</span>
            <Legend />
          </div>

          {error && <p role="alert" className="mt-6 border-l-2 border-ink pl-3 text-[15px]">{error}</p>}

          <div className={`mt-4 transition-opacity duration-300 ${loading && facts ? "opacity-60" : ""}`}>
            {facts && visible.length === 0 && view !== "matrix" && (
              <p className="py-24 text-center text-[15px] text-muted">지금 기준에 맞는 연결이 없어요. ‘최소 연관 강도’를 낮추거나 필터를 넓혀 보세요.</p>
            )}
            <AnimatePresence mode="wait" initial={false}>
              {facts && (view === "network" || view === "radial") && visible.length > 0 && (
                <motion.div key="graph" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} transition={{ duration: 0.25 }}>
                  <GraphView mode={view} nodes={nodes} edges={visible} nodeMap={nodeMap} selection={selection}
                    aiEdges={aiEdges} focusNodes={focusNodes} emphasis={emphasis} onSelect={setSelection} onHoverNode={setHoverNode} />
                </motion.div>
              )}
              {facts && view === "chart" && visible.length > 0 && (
                <motion.div key="chart" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} transition={{ duration: 0.25 }}>
                  <ChartView edges={visible} nodeMap={nodeMap} selection={selection} aiEdges={aiEdges} onSelect={setSelection} />
                </motion.div>
              )}
              {facts && view === "matrix" && (
                <motion.div key="matrix" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} transition={{ duration: 0.25 }}>
                  <MatrixView nodes={nodes} allEdges={facts.edges} visible={visibleIds} nodeMap={nodeMap}
                    selection={selection} aiEdges={aiEdges} onSelect={setSelection} />
                </motion.div>
              )}
              {facts && view === "rank" && visible.length > 0 && (
                <motion.div key="rank" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} transition={{ duration: 0.25 }}>
                  <RankView edges={visible} nodeMap={nodeMap} selection={selection} aiEdges={aiEdges} onSelect={setSelection} />
                </motion.div>
              )}
            </AnimatePresence>
          </div>
          {facts && <p className="mt-6 text-[13px] leading-[1.7] text-muted">선을 누르면 자세히 보여요. 점에 마우스를 올리면 그 점의 선만 남고, 점을 끌면 위치를 옮길 수 있어요. Esc로 선택 해제. ({facts.method})</p>}
        </section>

        <aside className="border-t border-ink pt-8 lg:sticky lg:top-[60px] lg:max-h-[calc(100vh-60px)] lg:self-start lg:overflow-y-auto lg:border-t-0 lg:pb-10">
          <AnimatePresence mode="wait">
            {selectedEdge ? (
              <EdgeDetail key={selectedEdge.id} edge={selectedEdge} nodeMap={nodeMap} alpha={facts?.alpha_bonferroni ?? 0.05}
                findings={!stale && analysis ? analysis.findings.filter((f) => f.edge_ids.includes(selectedEdge.id)) : []}
                onBack={() => setSelection(null)} />
            ) : selectedNode ? (
              <NodeDetail key={selectedNode.id} node={selectedNode} edges={visible} nodeMap={nodeMap}
                onPickEdge={(id) => setSelection({ kind: "edge", id })} onBack={() => setSelection(null)} />
            ) : (
              <motion.div key="findings" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}>
                <FindingsPanel analysis={analysis} stale={stale} busy={busy} error={aiError} aiConfigured={aiConfigured}
                  tests={facts?.tests ?? 0} edgeMap={analysisEdges.size ? analysisEdges : edgeMap} nodeMap={nodeMap}
                  onRun={run} onHoverFinding={setHoverFinding}
                  onPickEdge={(id) => { setHoverFinding(null); setSelection({ kind: "edge", id }); }} />
              </motion.div>
            )}
          </AnimatePresence>
        </aside>
      </main>
    </div>
  );
}

function Toggle({ checked, onChange, children }: { checked: boolean; onChange: (v: boolean) => void; children: React.ReactNode }) {
  return (
    <label className="flex cursor-pointer items-center gap-2 text-[14px] text-ink-2">
      <input type="checkbox" checked={checked} onChange={(e) => onChange(e.target.checked)} className="sr-only" />
      <span aria-hidden className={`relative h-3.5 w-6 border transition-colors ${checked ? "border-ink bg-ink" : "border-axis"}`}>
        <motion.span className={`absolute top-[2px] h-2 w-2 ${checked ? "bg-bg" : "bg-axis"}`} animate={{ left: checked ? 12 : 2 }} transition={{ type: "spring", stiffness: 500, damping: 30 }} />
      </span>
      {children}
    </label>
  );
}

function Legend() {
  return (
    <span className="flex flex-wrap items-center gap-x-4 gap-y-1 text-[13px] text-ink-2">
      {(["high", "mid", "low"] as const).map((k) => (
        <span key={k} className="flex items-center gap-1.5">
          <svg width="24" height="8" aria-hidden><line x1="2" y1="4" x2="22" y2="4" stroke={IMP_COLOR[k]} strokeWidth={k === "high" ? 6 : k === "mid" ? 4.5 : 3} strokeLinecap="round" /></svg>
          {IMP_LABEL[k]}
        </span>
      ))}
      <span className="flex items-center gap-1.5"><svg width="24" height="8" aria-hidden><line x1="2" y1="4" x2="22" y2="4" stroke="var(--ink-2)" strokeWidth="3" strokeDasharray="5 4" /></svg>반대로 움직임</span>
      <span className="flex items-center gap-1.5"><svg width="24" height="8" aria-hidden><line x1="2" y1="4" x2="22" y2="4" stroke="var(--accent)" strokeWidth="4" strokeLinecap="round" /></svg>선택</span>
    </span>
  );
}
