import { AnimatePresence, motion } from "framer-motion";
import { useEffect, useState } from "react";
import type { Analysis, REdge, RNode, ViewKind, VizKind } from "../types";
import { MiniViz, VIZ_LABEL } from "../viz/MiniViz";

interface Props {
  analysis: Analysis | null;
  stale: boolean;
  busy: boolean;
  error: string | null;
  aiConfigured: boolean;
  tests: number;
  edgeMap: Map<string, REdge>;
  nodeMap: Map<string, RNode>;
  onRun: () => void;
  onHoverFinding: (ids: string[] | null) => void;
  onPickEdge: (id: string) => void;
}

export const VIEW_LABEL: Record<ViewKind, string> = { network: "연결망", radial: "원형", chart: "크게 보기", matrix: "표", rank: "순위" };
const steps = (tests: number) => [`지표 ${tests}쌍을 실제 데이터로 계산하는 중`, "AI가 마케팅에 중요한 사실을 고르는 중", "AI 문장 속 숫자를 원본과 대조하는 중"];
const ease = [0.22, 1, 0.36, 1] as const;

export function FindingsPanel(p: Props) {
  const STEPS = steps(p.tests);
  const [step, setStep] = useState(0);
  useEffect(() => {
    if (!p.busy) return;
    setStep(0);
    const t = setInterval(() => setStep((s) => Math.min(s + 1, 2)), 2600);
    return () => clearInterval(t);
  }, [p.busy]);

  return (
    <div>
      <div className="eyebrow">AI 분석 · GPT</div>
      <h2 className="mt-2 text-[20px] font-bold leading-[1.3] tracking-[-0.03em]">가설 없이, 확인된 사실만</h2>
      <p className="mt-2 text-[14px] leading-[1.65] text-ink-2">
        숫자는 서버가 실제 데이터로 계산하고, AI는 그중 중요한 사실을 골라 쉬운 말로 정리해요. 숫자가 틀리거나 추측이 섞인 문장은 자동으로 걸러져요.
      </p>

      <button type="button" onClick={p.onRun} disabled={p.busy || !p.aiConfigured}
        className="mt-5 flex w-full cursor-pointer items-center justify-center gap-2 bg-accent px-4 py-3 text-[15px] font-semibold text-white transition-opacity hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-40">
        {p.busy ? "분석 중…" : p.analysis ? "다시 분석" : "AI로 분석하기"}
      </button>
      {!p.aiConfigured && <p className="mt-2 text-[13px] text-muted">서버에 OPENAI_API_KEY가 없어 AI 분석을 사용할 수 없습니다. 연관 그래프는 그대로 동작합니다.</p>}
      {p.error && <p role="alert" className="mt-3 border-l-2 border-ink pl-3 text-[14px] leading-[1.6]">{p.error}</p>}

      <AnimatePresence mode="wait">
        {p.busy && (
          <motion.ol key="steps" className="mt-6 grid gap-3" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}>
            {STEPS.map((s, i) => (
              <li key={s} className={`flex gap-3 text-[14px] leading-[1.55] transition-colors ${i <= step ? "text-ink" : "text-muted"}`}>
                <span className="num w-5 shrink-0 text-muted">0{i + 1}</span>
                <span className="flex-1">{s}</span>
                {i === step && <motion.span className="mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full bg-accent" animate={{ opacity: [1, 0.2, 1] }} transition={{ duration: 1, repeat: Infinity }} />}
              </li>
            ))}
          </motion.ol>
        )}

        {!p.busy && p.analysis && (
          <motion.div key={p.analysis.created_at} initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}>
            {p.stale && <p className="mt-5 bg-accent-wash px-3 py-2 text-[14px] leading-[1.55]">필터가 바뀌었어요. 아래 내용은 이전 조건 기준이라 다시 분석해 주세요.</p>}
            <p className="mt-6 border-t border-ink pt-4 text-[17px] font-semibold leading-[1.55] tracking-[-0.02em]">{p.analysis.headline}</p>
            <p className="mt-2 text-[13px] leading-[1.6] text-muted">
              AI 추천 보기 <b className="font-semibold text-accent">{VIEW_LABEL[p.analysis.recommended_view]}</b>
              {p.analysis.view_reason && <> — {p.analysis.view_reason}</>}
            </p>
            <ol className="mt-5 grid">
              {p.analysis.findings.map((f, i) => (
                <FindingCard key={f.title + i} index={i} finding={f} {...p} />
              ))}
            </ol>
            {p.analysis.rejected.length > 0 && (
              <details className="mt-4 text-[14px]">
                <summary className="cursor-pointer text-ink-2">숫자 검증에서 걸러진 문장 {p.analysis.rejected.length}건</summary>
                <ul className="mt-2 grid gap-2">
                  {p.analysis.rejected.map((r, i) => (
                    <li key={i} className="border-l border-axis pl-3 leading-[1.55] text-muted"><b className="font-medium text-ink-2">{r.reason}</b><br />{r.fact}</li>
                  ))}
                </ul>
              </details>
            )}
            <p className="num mt-6 text-[12px] leading-[1.6] text-muted">
              {p.analysis.model} · 검토한 연결 {p.analysis.edges_considered}개 · {(p.analysis.elapsed_ms / 1000).toFixed(1)}초 · {p.analysis.snapshot_id}
            </p>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

function FindingCard({ finding, index, edgeMap, nodeMap, onHoverFinding, onPickEdge }: Props & { finding: Analysis["findings"][number]; index: number }) {
  const [viz, setViz] = useState<VizKind>(finding.viz);
  const edges = finding.edge_ids.map((id) => edgeMap.get(id)).filter((e): e is REdge => Boolean(e));
  return (
    <motion.li className="border-b border-hair py-5" initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.45, delay: index * 0.09, ease }}
      onPointerEnter={() => onHoverFinding(finding.edge_ids)} onPointerLeave={() => onHoverFinding(null)}>
      <div className="flex items-baseline gap-3">
        <span className="num text-[14px] text-muted">{String(index + 1).padStart(2, "0")}</span>
        <h3 className="text-[16px] font-semibold tracking-[-0.02em]">{finding.title}</h3>
      </div>
      <p className="mt-2 pl-7 text-[14px] leading-[1.7]">{finding.fact}</p>
      {finding.use && <p className="mt-1.5 pl-7 text-[14px] leading-[1.65] text-ink-2"><span className="text-muted">이렇게 써보세요 · </span>{finding.use}</p>}

      <div className="mt-4 pl-7">
        <div className="mb-3 flex flex-wrap items-center gap-x-3 gap-y-1 text-[13px]" role="tablist" aria-label="시각화 형태">
          {(Object.keys(VIZ_LABEL) as VizKind[]).map((k) => (
            <button key={k} type="button" role="tab" aria-selected={viz === k} onClick={() => setViz(k)}
              className={`cursor-pointer border-b pb-px ${viz === k ? "border-ink font-semibold text-ink" : "border-transparent text-muted hover:text-ink"}`}>
              {VIZ_LABEL[k]}{k === finding.viz && <sup className="ml-0.5 text-accent">AI</sup>}
            </button>
          ))}
        </div>
        <AnimatePresence mode="wait">
          <motion.div key={viz} className="grid gap-4" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} transition={{ duration: 0.2 }}>
            {edges.map((e) => <MiniViz key={e.id} kind={viz} edge={e} nodeMap={nodeMap} />)}
          </motion.div>
        </AnimatePresence>
        <div className="mt-3 flex flex-wrap gap-1.5">
          {edges.map((e) => (
            <button key={e.id} type="button" onClick={() => onPickEdge(e.id)}
              className="cursor-pointer border border-hair px-2 py-0.5 text-[13px] text-ink-2 hover:border-accent hover:text-accent">
              {nodeMap.get(e.source)?.label} ↔ {nodeMap.get(e.target)?.label} · 자세히 →
            </button>
          ))}
        </div>
      </div>
    </motion.li>
  );
}
