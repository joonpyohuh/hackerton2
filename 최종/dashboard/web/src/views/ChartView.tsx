import { AnimatePresence, motion } from "framer-motion";
import { useState } from "react";
import { IMP_COLOR, IMP_LABEL, fmt, importanceOf, pct, signed } from "../format";
import type { REdge, RNode, Selection } from "../types";

interface Props {
  edges: REdge[];
  nodeMap: Map<string, RNode>;
  selection: Selection;
  aiEdges: Set<string>;
  onSelect: (s: Selection) => void;
}

type Shape = "bar" | "pie";
const LIMIT = 12;
const ease = [0.22, 1, 0.36, 1] as const;

/** One large card per connection, strongest first — readable from across a room. */
export function ChartView({ edges, nodeMap, selection, aiEdges, onSelect }: Props) {
  const [shape, setShape] = useState<Shape>("bar");
  const rows = edges.slice(0, LIMIT);
  const selected = selection?.kind === "edge" ? selection.id : null;
  return (
    <div>
      <div className="mb-5 flex items-center gap-3">
        <span className="text-[14px] text-ink-2">차트 모양</span>
        <div className="inline-flex border border-ink text-[15px]" role="tablist" aria-label="차트 모양">
          {(["bar", "pie"] as const).map((s) => (
            <button key={s} type="button" role="tab" aria-selected={shape === s} onClick={() => setShape(s)}
              className={`cursor-pointer px-4 py-1.5 ${shape === s ? "bg-ink font-semibold text-bg" : "text-ink-2 hover:text-ink"} ${s === "pie" ? "border-l border-ink" : ""}`}>
              {s === "bar" ? "막대" : "원"}
            </button>
          ))}
        </div>
        <span className="text-[13px] text-muted">강한 순으로 {rows.length}개 · 카드를 누르면 자세히</span>
      </div>
      <div className="grid gap-5 md:grid-cols-2">
        <AnimatePresence initial={false}>
          {rows.map((e, i) => (
            <Card key={e.id} edge={e} index={i} shape={shape} nodeMap={nodeMap}
              active={e.id === selected} ai={aiEdges.has(e.id)} onClick={() => onSelect({ kind: "edge", id: e.id })} />
          ))}
        </AnimatePresence>
      </div>
      {edges.length > LIMIT && <p className="mt-4 text-[13px] text-muted">상위 {LIMIT}개만 보여요 · 전체 {edges.length}개는 ‘순위’ 보기에서 확인</p>}
    </div>
  );
}

interface CardProps { edge: REdge; index: number; shape: Shape; nodeMap: Map<string, RNode>; active: boolean; ai: boolean; onClick: () => void }

function Card({ edge, index, shape, nodeMap, active, ai, onClick }: CardProps) {
  const a = nodeMap.get(edge.source)?.label ?? "", b = nodeMap.get(edge.target)?.label ?? "";
  const imp = importanceOf(edge.phi);
  const color = IMP_COLOR[imp];
  const rows = [
    { k: `‘${a}’ 고객`, v: edge.p_b_given_a, n: edge.table.both + edge.table.a_only, hi: true },
    { k: "그 외 고객", v: edge.p_b_given_not_a, n: edge.table.b_only + edge.table.neither, hi: false },
  ];
  return (
    <motion.button type="button" layout onClick={onClick}
      initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }}
      transition={{ duration: 0.45, delay: Math.min(index * 0.05, 0.4), ease }}
      className={`cursor-pointer border bg-bg p-6 text-left transition-colors hover:border-ink ${active ? "border-accent" : "border-hair"}`}
      style={{ borderTop: `6px solid ${color}` }}>
      <div className="flex flex-wrap items-center gap-2 text-[13px]">
        <span className="inline-flex items-center gap-1.5 px-2 py-0.5 font-semibold text-ink" style={{ background: `color-mix(in srgb, ${color} 18%, transparent)` }}>
          <i className="block h-2.5 w-2.5 rounded-full" style={{ background: color }} />{IMP_LABEL[imp]}
        </span>
        {ai && <span className="px-2 py-0.5 font-semibold text-accent ring-1 ring-accent">AI가 찾은 연결</span>}
        {edge.phi < 0 && <span className="px-2 py-0.5 text-ink-2 ring-1 ring-axis">반대로 움직임</span>}
      </div>
      <h3 className="mt-3 text-[20px] font-bold leading-[1.35] tracking-[-0.03em]">{a} <span className="font-normal text-muted">→</span> {b}</h3>
      <p className="mt-1 text-[15px] text-ink-2">‘{b}’ 비율을 비교했어요</p>

      {shape === "bar" ? (
        <div className="mt-6 grid gap-5">
          {rows.map((r) => (
            <div key={r.k}>
              <div className="mb-1.5 flex items-baseline justify-between gap-3">
                <span className={`text-[16px] ${r.hi ? "font-semibold" : "text-ink-2"}`}>{r.k}</span>
                <span className={`num text-[30px] leading-none tracking-[-0.04em] ${r.hi ? "font-bold" : "font-semibold text-ink-2"}`}>{pct(r.v)}%</span>
              </div>
              <div className="h-10 bg-surface ring-1 ring-hair ring-inset">
                <motion.div className="h-full" style={{ background: r.hi ? color : "var(--bar-2)" }}
                  initial={{ width: 0 }} animate={{ width: `${r.v * 100}%` }} transition={{ duration: 0.9, ease }} />
              </div>
              <div className="num mt-1 text-[13px] text-muted">{fmt(r.n)}명 중</div>
            </div>
          ))}
        </div>
      ) : (
        <div className="mt-6 grid grid-cols-2 gap-4">
          {rows.map((r) => <Pie key={r.k} label={r.k} v={r.v} n={r.n} color={r.hi ? color : "var(--bar-2)"} strong={r.hi} />)}
        </div>
      )}

      <div className="num mt-6 flex flex-wrap items-baseline gap-x-5 gap-y-1 border-t border-hair pt-4">
        <span className="text-[15px]">차이 <b className="text-[22px] tracking-[-0.03em]">{signed(edge.diff_pp)}%p</b></span>
        <span className="text-[14px] text-ink-2">평균보다 <b className="text-ink">{edge.lift.toFixed(1)}배</b></span>
        <span className="text-[13px] text-muted">{edge.population === "payers" ? "결제 고객" : "가입 고객"} {fmt(edge.n)}명 기준</span>
      </div>
    </motion.button>
  );
}

function Pie({ label, v, n, color, strong }: { label: string; v: number; n: number; color: string; strong: boolean }) {
  const R = 70, C = 2 * Math.PI * R;
  return (
    <figure className="grid justify-items-center gap-2">
      <svg viewBox="-100 -100 200 200" className="h-auto w-full max-w-[200px]" aria-label={`${label} ${pct(v)}%`}>
        <circle r={R} fill="none" stroke="var(--hair)" strokeWidth={36} />
        <motion.circle r={R} fill="none" stroke={color} strokeWidth={36} transform="rotate(-90)" strokeDasharray={C}
          initial={{ strokeDashoffset: C }} animate={{ strokeDashoffset: C * (1 - v) }} transition={{ duration: 1, ease }} />
        <text textAnchor="middle" dy={12} fontSize={34} fontWeight={strong ? 700 : 600} fill="var(--ink)" className="num" letterSpacing="-0.04em">{pct(v, 0)}%</text>
      </svg>
      <figcaption className="text-center">
        <span className={`block text-[15px] ${strong ? "font-semibold" : "text-ink-2"}`}>{label}</span>
        <span className="num text-[13px] text-muted">{fmt(n)}명 중</span>
      </figcaption>
    </figure>
  );
}
